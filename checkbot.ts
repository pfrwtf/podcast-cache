interface Env {
  FEED: string;
  PODCAST_STORE: KVNamespace;
}

interface PodcastStatus {
  checked: string;
  updated: string;
  status: string;
  errorMessage?: string;
  xml?: string;
  json?: string;
}

// Let's use a simple XML parser approach for Workers
class SimpleXMLParser {
  private static getTagContent(xml: string, tag: string): string {
    const regex = new RegExp(`<${tag}[^>]*>(.*?)<\/${tag}>`, 's');
    const match = xml.match(regex);
    return match ? match[1].trim() : '';
  }

  private static getAllTagsContent(xml: string, tag: string): string[] {
    const regex = new RegExp(`<${tag}[^>]*>(.*?)<\/${tag}>`, 'gs');
    const matches = xml.matchAll(regex);
    return Array.from(matches).map(match => match[1].trim());
  }

  private static getAttributeValue(xml: string, attr: string): string {
    const regex = new RegExp(`${attr}="([^"]*)"`, 'i');
    const match = xml.match(regex);
    return match ? match[1] : '';
  }

  static parseXMLToJSON(xmlString: string) {
    const channel = this.getTagContent(xmlString, 'channel');
    
    if (!channel) {
      throw new Error("Invalid podcast feed format");
    }

    const items = this.getAllTagsContent(channel, 'item').map(item => ({
      title: this.getTagContent(item, 'title'),
      description: this.getTagContent(item, 'description'),
      pubDate: this.getTagContent(item, 'pubDate'),
      enclosure: {
        url: this.getAttributeValue(item, 'url'),
        type: this.getAttributeValue(item, 'type'),
        length: this.getAttributeValue(item, 'length'),
      }
    }));

    return {
      title: this.getTagContent(channel, 'title'),
      description: this.getTagContent(channel, 'description'),
      lastBuildDate: this.getTagContent(channel, 'lastBuildDate'),
      items
    };
  }

  static getLastBuildDate(xmlString: string): string {
    const channel = this.getTagContent(xmlString, 'channel');
    const lastBuildDate = this.getTagContent(channel, 'lastBuildDate');
    if (!lastBuildDate) {
      throw new Error("Could not find lastBuildDate in feed");
    }
    return lastBuildDate;
  }
}

export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const timestamp = new Date().toISOString();
    
    try {
      // Fetch current KV state
      const currentXML = await env.PODCAST_STORE.get("xml");
      const isInitialRun = !currentXML;

      // Fetch the feed
      const response = await fetch(env.FEED, {
        cf: {
          cacheTtl: 300,
          cacheEverything: true,
        }
      });

      // Handle HTTP errors
      if (!response.ok) {
        let status: string;
        switch (response.status) {
          case 404:
            status = "stale/NotFound";
            break;
          case 429:
            status = "stale/RateLimit";
            break;
          default:
            status = "stale/Outage";
        }

        const errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        await updateErrorState(env.PODCAST_STORE, status, errorMessage, timestamp);
        console.error(errorMessage);
        return;
      }

      // Get the XML content
      const newXMLContent = await response.text();

      // Initial population of KV
      if (isInitialRun) {
        await populateInitialState(env.PODCAST_STORE, newXMLContent, timestamp);
        console.info("Initial feed population completed");
        return;
      }

      // Compare build dates
      const currentBuildDate = SimpleXMLParser.getLastBuildDate(currentXML);
      const newBuildDate = SimpleXMLParser.getLastBuildDate(newXMLContent);

      if (currentBuildDate === newBuildDate) {
        // No changes needed
        await env.PODCAST_STORE.put("checked", timestamp);
        await env.PODCAST_STORE.put("status", "fresh");
        console.info("Feed is up to date, no changes needed");
        return;
      }

      // Update with new content
      await updatePodcastContent(env.PODCAST_STORE, newXMLContent, timestamp);
      console.info("Feed was updated successfully");

    } catch (error) {
      let status = "stale/Unknown";
      let errorMessage = error.message;

      if (error.name === "TimeoutError") {
        status = "stale/Timeout";
      } else if (error.message.includes("Invalid podcast feed format") || 
                 error.message.includes("Could not find lastBuildDate")) {
        status = "stale/Malformed";
      }

      await updateErrorState(env.PODCAST_STORE, status, errorMessage, timestamp);
      console.error(errorMessage);
    }
  }
};

async function populateInitialState(kv: KVNamespace, xmlContent: string, timestamp: string) {
  const jsonContent = SimpleXMLParser.parseXMLToJSON(xmlContent);
  
  await Promise.all([
    kv.put("checked", timestamp),
    kv.put("updated", timestamp),
    kv.put("status", "populated"),
    kv.put("xml", xmlContent),
    kv.put("json", JSON.stringify(jsonContent)),
    kv.delete("errorMessage")
  ]);
}

async function updatePodcastContent(kv: KVNamespace, xmlContent: string, timestamp: string) {
  const jsonContent = SimpleXMLParser.parseXMLToJSON(xmlContent);
  
  await Promise.all([
    kv.put("checked", timestamp),
    kv.put("updated", timestamp),
    kv.put("status", "rotated"),
    kv.put("xml", xmlContent),
    kv.put("json", JSON.stringify(jsonContent)),
    kv.delete("errorMessage")
  ]);
}

async function updateErrorState(kv: KVNamespace, status: string, errorMessage: string, timestamp: string) {
  await Promise.all([
    kv.put("checked", timestamp),
    kv.put("status", status),
    kv.put("errorMessage", errorMessage)
  ]);
}
