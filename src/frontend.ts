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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '');
      
      // Create cache key from the request
      const cacheKey = new Request(url.toString(), request);
      const cache = caches.default;

      // Check cache first
      let response = await cache.match(cacheKey);
      if (response) {
        return response; // Cache hit
      }

      // Helper to get the full URL for a path
      const getFullUrl = (path: string) => {
        const baseUrl = url.origin + url.pathname.split('/').slice(0, -1).join('/');
        return `${baseUrl}/${path}`.replace(/([^:]\/)\/+/g, "$1");
      };

      // Generate response based on path
      switch (path.split('/').pop()) {
        case '':
        case undefined: {
          response = new Response("Hello from the podcast cache worker!", {
            headers: {
              "Content-Type": "text/plain",
              "Cache-Control": "public, max-age=3600"
            }
          });
          break;
        }

        case 'xml': {
          const xml = await env.PODCAST_STORE.get("xml");
          if (!xml) {
            return new Response("Feed not found", { status: 404 });
          }
          response = new Response(xml, {
            headers: {
              "Content-Type": "application/xml",
              "Cache-Control": "public, max-age=3600"
            }
          });
          break;
        }

        case 'json': {
          const json = await env.PODCAST_STORE.get("json");
          if (!json) {
            return new Response("Feed not found", { status: 404 });
          }
          response = new Response(json, {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=3600"
            }
          });
          break;
        }

        case 'status': {
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

          response = new Response(JSON.stringify(statusResponse, null, 2), {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=3600"
            }
          });
          break;
        }

        default:
          return new Response("Not Found", { status: 404 });
      }

      // Cache successful responses
      if (response.ok) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }

      return response;
    } catch (error) {
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
};