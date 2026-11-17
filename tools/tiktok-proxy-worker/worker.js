/**
 * Tiny egress proxy for the TikTok desk.
 *
 * Why this exists: Cloudflare (and therefore tikwm.com) answers "bot challenge"
 * 403s to datacenter IPs such as Vercel/Lambda/Fly. Running the same request
 * from a Cloudflare Worker's edge fixes that, and a Worker is free and needs no
 * server. Deploy it once, then set on the desk:
 *
 *   TIKTOK_PROXY_URL=https://<your-worker>.workers.dev/
 *   TIKTOK_PROXY_SECRET=<optional shared secret>
 *
 * Usage from the desk:  GET/POST  <worker>/?url=<url-encoded https://…>
 * Allowed upstreams:    www.tikwm.com, www.tiktok.com
 */

const ALLOWED = ["https://www.tikwm.com/", "https://www.tiktok.com/"];

const PASS_THROUGH_HEADERS = [
  "accept",
  "accept-language",
  "content-type",
  "user-agent",
  "referer",
  "range",
];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);

    if (incoming.pathname === "/health") {
      return json({ ok: true, service: "tiktok-desk-proxy" });
    }

    if (env.PROXY_SECRET) {
      const provided =
        request.headers.get("x-proxy-secret") ?? incoming.searchParams.get("secret");
      if (provided !== env.PROXY_SECRET) {
        return json({ error: "unauthorized" }, 401);
      }
    }

    const target = incoming.searchParams.get("url");
    if (!target) {
      return json(
        {
          error: "missing ?url=",
          usage: `${incoming.origin}/?url=${encodeURIComponent("https://www.tikwm.com/api/feed/search?keywords=cat")}`,
        },
        400,
      );
    }
    if (!ALLOWED.some((prefix) => target.startsWith(prefix))) {
      return json({ error: "host not allowed", allowed: ALLOWED }, 403);
    }

    const headers = new Headers();
    for (const name of PASS_THROUGH_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (!headers.has("user-agent")) {
      headers.set(
        "user-agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
      );
    }

    let upstream;
    try {
      upstream = await fetch(target, {
        method: request.method === "POST" ? "POST" : "GET",
        headers,
        body: request.method === "POST" ? await request.text() : undefined,
        redirect: "follow",
        cf: { cacheTtl: 0 },
      });
    } catch (err) {
      return json({ error: "upstream fetch failed", detail: String(err) }, 502);
    }

    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
        "x-proxy-upstream-status": String(upstream.status),
      },
    });
  },
};
