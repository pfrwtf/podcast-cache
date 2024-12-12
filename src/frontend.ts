interface Env {
  FEED: string;
  PODCAST_STORE: KVNamespace;
}

interface PodcastStatus {
  checked: string;
  updated: string;
  status: string;
  errorMessage?: string;
  urls: {
    xml: string;
    json: string;
    source: string;
  }
}

// [Previous SimpleXMLParser class and other helper functions remain the same]

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, ''); // Remove trailing slashes
    
    // Common cache settings for responses
    const cacheHeaders = {
      "Cache-Control": "public, max-age=3600", // Cache for 1 hour
      "Content-Type": "application/json",
    };
    
    // Helper to get the full URL for a path
    const getFullUrl = (path: string) => {
      const baseUrl = url.origin + url.pathname.split('/').slice(0, -1).join('/');
      return `${baseUrl}/${path}`.replace(/([^:]\/)\/+/g, "$1"); // Clean up double slashes
    };

    try {
      switch (path.split('/').pop()) { // Get the last segment of the path
        case '':
        case undefined:
          return new Response("Oh hai! You're in the wrong place. See https://pfr.wtf/disobedient/", {
            headers: {
              "Content-Type": "text/plain",
              "Cache-Control": "public, max-age=15552000"
            }
          });

        case 'xml':
          const xml = await env.PODCAST_STORE.get("xml");
          if (!xml) {
            return new Response("Feed not found", { status: 404 });
          }
          return new Response(xml, {
            headers: {
              "Content-Type": "application/xml",
              "Cache-Control": "public, max-age=15552000"
            }
          });

        case 'json':
          const json = await env.PODCAST_STORE.get("json");
          if (!json) {
            return new Response("Feed not found", { status: 404 });
          }
          return new Response(json, {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=300"
            }
          });

        case 'status':
          const [checked, updated, status, errorMessage] = await Promise.all([
            env.PODCAST_STORE.get("checked"),
            env.PODCAST_STORE.get("updated"),
            env.PODCAST_STORE.get("status"),
            env.PODCAST_STORE.get("errorMessage")
          ]);

          if (!checked || !updated || !status) {
            return new Response("Status not available", { status: 404 });
          }

          const statusResponse: PodcastStatus = {
            checked,
            updated,
            status,
            urls: {
              xml: getFullUrl('xml'),
              json: getFullUrl('json'),
              source: env.FEED
            }
          };

          if (errorMessage) {
            statusResponse.errorMessage = errorMessage;
          }

          return new Response(JSON.stringify(statusResponse, null, 2), {
            headers: cacheHeaders
          });

        default:
          return new Response("Not Found", {
            status: 404,
            headers: { "Content-Type": "text/plain" }
          });
      }
    } catch (error) {
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  },

  // Scheduled handler remains the same as before
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    // [Previous scheduled implementation remains unchanged]
  }
};
