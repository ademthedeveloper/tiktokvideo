# tiktok-desk proxy (Cloudflare Worker)

Fixes the most common reason the desk finds nothing on a hosted deployment:

```
tikwm search: tikwm is serving a bot-challenge page — HTTP 403
```

Cloudflare challenges requests coming from datacenter IPs (Vercel, Lambda, Fly,
Render). A Worker runs on Cloudflare's own edge, where tikwm answers normally,
so it only needs to sit in front of the request. Free plan is plenty.

## Deploy (dashboard, ~2 minutes)

1. Cloudflare dashboard → **Workers & Pages → Create → Worker** → Deploy the
   "Hello World" starter.
2. **Edit code**, replace everything with the contents of `worker.js`, **Deploy**.
3. Copy the URL: `https://<name>.<subdomain>.workers.dev`
4. In Vercel (or your host), add:
   - `TIKTOK_PROXY_URL=https://<name>.<subdomain>.workers.dev/`
   - optional `TIKTOK_PROXY_SECRET=some-long-random-string` — then also set the
     same value as a Worker secret (`Settings → Variables → PROXY_SECRET`, type
     *Secret*), so only your desk can use the proxy.
5. Redeploy the desk (env vars are baked at build time) and run
   **fetch health → run diagnostics**: `tikwm feed` / `tikwm keyword search`
   should turn green, and results show `self-hosted fetch service`/`tikwm`.

## Deploy (CLI)

```bash
cd tools/tiktok-proxy-worker
npx wrangler deploy
npx wrangler secret put PROXY_SECRET   # optional
```

## What it allows

Only `https://www.tikwm.com/…` and `https://www.tiktok.com/…` are proxied —
nothing else. Include the query string in `?url=`; the Worker forwards the
method, body, and the headers that matter (`accept`, `content-type`,
`user-agent`, `range`, …).

```bash
curl "https://<worker>/?url=$(python3 -c 'import urllib.parse;print(urllib.parse.quote("https://www.tikwm.com/api/feed/search?keywords=cat&count=3"))')" | head -c 300
```

Blank/failed response? Check `x-proxy-upstream-status` in the response headers:
`403` still means the Worker's egress is challenged too (rare), `200` means the
proxy works and the problem is elsewhere.
