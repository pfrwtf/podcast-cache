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
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, ''); // Remove trailing slashes
    
    // Helper to get the full URL for a path
    const getFullUrl = (path: string) => {
      const baseUrl = url.origin + url.pathname.split('/').slice(0, -1).join('/');
      return `${baseUrl}/${path}`.replace(/([^:]\/)\/+/g, "$1"); // Clean up double slashes
    };

    try {
      switch (path.split('/').pop()) {
        case '':
        case undefined:
          return new Response("Oh hai! You're actually in the wrong place. See https://pfr.wtf/disobedient/ for podcast episodes on our site, or find Disobedient by PFR on your favorite Podcast App!", {
            headers: {
              "Content-Type": "text/plain",
              "Cache-Control": "public, max-age=15552000",
              "CF-Cache-Status": "dynamic"
            },
            cf: {
              caching: {
                bypassCache: false,
                cacheTtl: 3600,
              },
            }
          });

        case 'xml':
          const xml = await env.PODCAST_STORE.get("xml");
          if (!xml) {
            return new Response("404 :: There is no XML feed currently ingested.", { status: 404 });
          }
          return new Response(xml, {
            headers: {
              "Content-Type": "application/xml",
              "Cache-Control": "public, max-age=300",
              "CF-Cache-Status": "dynamic"
            },
            cf: {
              caching: {
                bypassCache: false,
                cacheTtl: 3600,
              },
            }
          });

        case 'json':
          const json = await env.PODCAST_STORE.get("json");
          if (!json) {
            return new Response("404 :: There is no JSON feed currently ingested", { status: 404 });
          }
          return new Response(json, {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=300",
              "CF-Cache-Status": "dynamic"
            },
            cf: {
              caching: {
                bypassCache: false,
                cacheTtl: 3600,
              },
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
            return new Response("404 :: There is no data currently ingested, and I can't pull any status messages.", { status: 404 });
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
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=3600",
              "CF-Cache-Status": "dynamic"
            },
            cf: {
              caching: {
                bypassCache: false,
                cacheTtl: 3600,
              },
            }
          });

        default:
          return new Response("Not Found", {
            status: 404,
            headers: { 
              "Content-Type": "text/plain",
              "Cache-Control": "no-store"
            }
          });
      }
    } catch (error) {
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { 
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        }
      });
    }
  }
};