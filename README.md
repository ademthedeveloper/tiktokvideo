# TikTok desk

A self-hosted desk for finding TikTok clips, rewriting their captions, queueing
them, and posting them to your own account.

- **Find** — keyword / `#hashtag` / `@creator` search, link grab, region firehose
- **Rewrite** — caption variants with credit lines and hashtag packs
- **Queue** — save clips with the caption you picked
- **Post** — through your logged-in TikTok session (**no developer account**) or
  through the official Content Posting API if you already have an app

Stack: Next.js 16 (App Router), React 19, Tailwind 4, Drizzle ORM + Postgres.

---

## 1. Quick start

```bash
npm install
cp .env.example .env          # set DATABASE_URL
npm run dev                   # http://localhost:3000
```

The schema is created lazily on first request (`ensureSchema`), so an empty
database is enough. `npm run build && npm start` for production.

---

## 2. Fetching (this is the part that used to say "Nothing came back")

### Why it broke

Search used to read `tiktok.com/tag/<tag>` and parse the `ItemList` JSON-LD block
those pages used to ship. TikTok stopped emitting that block, so the parser found
zero clips — every search returned *"Nothing came back"* even though the request
itself succeeded.

### How it works now

`src/lib/tiktok.ts` is a provider chain; every read has a fallback and every
attempt is reported back to the UI:

| Read      | 1st choice                        | then                                        | then                    |
| --------- | --------------------------------- | ------------------------------------------- | ----------------------- |
| Search    | optional self-hosted sidecar      | tikwm `/api/feed/search` (keyword + hashtag) | tiktok.com web API (`/api/challenge/item_list/`) → `tiktok.com/tag/<tag>` |
| Link grab | optional sidecar                  | tikwm `/api/`                                | tiktok.com web API → embed → video page → oEmbed |
| Firehose  | tikwm `/api/feed/list`            | tiktok.com `#fyp` item list → **TikTok Creative Center top videos** (official, no tikwm) | tikwm search `'fyp'` |
| Enrich    | optional sidecar                  | tikwm `/api/`                                | tiktok.com embed → video page |

Every upstream above can be reached by two more routes that are not tikwm and
not www.tiktok.com:

- **Your browser.** If the server's answer comes back empty, the same request is
  repeated from the reader's connection (`your browser → …` rows).
- **Public relays.** A blocked request is replayed through several key-less
  `?url=` relays *in parallel* (`allorigins`, `codetabs`, `jina`, `corsproxy.io`,
  `cors.lol`) and the first real JSON wins: `via codetabs relay`.
- **By hand.** Search → *still empty? paste it by hand* opens tikwm's own JSON in
  a tab; paste it back and `/api/tiktok/import` normalises it. Nothing about
  that route can be blocked.

- `@handle` searches list that creator's recent posts (tikwm `/api/user/posts`).
- Results are de-duplicated by video id and sorted by engagement.
- When an upstream fails, the Source panel shows exactly which provider failed,
  its error and its latency — not a generic "nothing came back".

### Diagnostics

**Source panel → fetch health → run diagnostics** (or `GET /api/tiktok/diagnostics`)
probes, live, from the machine that runs the app:

- `tikwm feed` — is the middleman reachable at all
- `tikwm keyword search` — does a real query return clips
- `tiktok.com reachability` / `tiktok.com #tag page` / `tiktok.com web api`
- `TikTok Creative Center trends` — TikTok's own ad-platform report (no tikwm)
- `your browser → tikwm` — the client-side fallback, checked from the tab
- `self-hosted fetch service` — only when `TIKTOK_FETCH_URL` is set
- `posting uploader` — is the session uploader installed

That is the first place to look if a fetch misbehaves: it separates "TikTok
blocked this IP" from "this provider changed its response".

### Environment

| Variable | Purpose |
| --- | --- |
| `TIKWM_BASE_URL` | use a tikwm mirror instead of `https://www.tikwm.com` |
| `TIKTOK_COOKIE` | a logged-out browser cookie header; makes direct tiktok.com reads far more reliable |
| `TIKTOK_PROXY_URL` / `TIKTOK_PROXY_SECRET` | route tikwm/tiktok.com through your own proxy (`tools/tiktok-proxy-worker`) |
| `TIKTOK_PUBLIC_RELAY` | set to `off` to stop the server borrowing a free `?url=` relay when a host blocks its IP |
| `TIKTOK_FETCH_URL` / `TIKTOK_FETCH_TOKEN` | your own fetch service, used before public scrapers (see §4) |

### If your host is blocked (`403 bot challenge`, or HTML instead of JSON)

Vercel/Lambda/Fly/Render egress from datacenter IPs. Cloudflare answers those
with a bot challenge — the `tikwm is serving a bot-challenge page — HTTP 403`
error — and tiktok.com soft-blocks them too, serving its website shell instead of
the API's JSON (`TikTok served its page instead of JSON — HTTP 200`). Neither is
a bug in the request: the *address* is the problem. What happens, in order:

- **Nothing — the server just works** whenever the host isn't blocked.
- **The same search is retried from your browser.** When the server answer is
   empty, the UI asks tikwm from the reader's own connection (a laptop or phone
   is not a datacenter IP) and posts the raw JSON to `/api/tiktok/import`, which
   normalises it server-side. This needs no setup and shows up as
   `your browser → tikwm` in the attempts list and in diagnostics.
- **The server borrows a free relay.** If a host blocks the server, the GET is
   replayed through several key-less `?url=` relays *at the same time* —
   `allorigins`, `codetabs`, `jina`, `corsproxy.io`, `cors.lol` — and the first
   that returns real JSON answers; the UI names it (`via codetabs relay`).
   Same for a `200` that turns out to be a website shell instead of JSON.
   Turn it off with `TIKTOK_PUBLIC_RELAY=off`.
- **You paste it in.** *still empty? paste it by hand* opens the upstream's JSON
   in a tab and posts it to `/api/tiktok/import` for normalising. Last resort,
   but nothing on the network can refuse a copy-paste.
- **Your own proxy — the dependable route.** Deploy
   [`tools/tiktok-proxy-worker`](tools/tiktok-proxy-worker) (free, ~2 minutes),
   then set:

   ```bash
   TIKTOK_PROXY_URL=https://<your-worker>.workers.dev/
   TIKTOK_PROXY_SECRET=some-long-random-string   # optional but recommended
   ```

   Only tikwm/tiktok.com requests are routed through it; everything else is
   untouched. The Worker egresses from Cloudflare's edge, which tikwm answers
   normally.

A self-hosted sidecar (§4) is the other way out: searches then skip tikwm
entirely.

### If your network blocks everything

Free scrapers are rate-limited and region-sensitive. If diagnostics show tikwm
unreachable from your host, run the sidecar in §4 — the desk then reads TikTok
through your own machine and stops depending on third parties.

---

## 3. Posting

### 3a. Session upload — no developer account, no app review (recommended)

The official Content Posting API requires a TikTok developer app (and, for
public posts, an approved audit). This desk also supports the route every
open-source uploader uses: **your own logged-in session**.

1. Install the open-source uploader once:

   ```bash
   pip install tiktok-uploader        # wkaisertexas/tiktok-uploader, MIT
   playwright install chromium
   ```

2. In your own browser, log in to tiktok.com → DevTools → **Application →
   Cookies → `https://www.tiktok.com`** → copy the `sessionid` value.

3. Desk → **Publish → "no developer account? link your session"** → paste it →
   **Save session**. (Or set `TIKTOK_SESSION_ID` in the environment.)

4. Pick a clip or a file, write the caption, hit **Post to TikTok**. The desk
   writes the video + a Netscape `cookies.txt` to a temp dir and runs:

   ```bash
   tiktok-uploader -v <file> -d <caption> -c <cookies.txt>
   ```

The session id is stored in the `tiktok_sessions` table (single row, no
encryption at rest — put the database on a trusted host), and the cookie file is
deleted with the temp dir after every upload.

**Use a different tool?** Point `TIKTOK_UPLOADER_CMD` at it and use the
placeholders `{file}`, `{caption}`, `{cookies}`, `{visibility}`:

```bash
# another Python tool
TIKTOK_UPLOADER_CMD="python -m tiktok_uploader -v {file} -d {caption} -c {cookies}"
# your own wrapper around Playwright / Selenium
TIKTOK_UPLOADER_CMD="/opt/my-uploader/run.sh --video {file} --caption {caption} --cookies {cookies}"
```

If your uploader runs as a service instead, use HTTP mode — the desk POSTs
multipart (`file`, `caption`, `visibility`) and expects a 2xx:

```bash
TIKTOK_UPLOAD_MODE=http
TIKTOK_UPLOADER_URL=http://127.0.0.1:9090/upload
TIKTOK_UPLOADER_TOKEN=optional-bearer-token
```

### 3b. Official Content Posting API (optional)

Only needed if you already have a TikTok developer app:

```bash
TIKTOK_CLIENT_KEY=...
TIKTOK_CLIENT_SECRET=...
# optional: TIKTOK_REDIRECT_URI, TIKTOK_ACCESS_TOKEN
```

Add `<origin>/api/tiktok/auth/callback` as an authorised redirect URI, then
**Connect TikTok** on the Publish tab. Scopes used: `video.publish`,
`video.upload`, `user.info.basic`. Public privacy levels need an audited app;
before that TikTok only allows `SELF_ONLY` and inbox drafts.

Both connection types can be linked at once — the composer then offers an
**auto / session / api** switch.

### Why not Postiz / n8n / Mixpost?

They are good tools, but their TikTok integrations are built *on* the official
OAuth Content Posting API, so you still need a TikTok developer app, client key
and redirect URI — exactly what you wanted to avoid. The cookie-session route is
the only one that works with nothing but a logged-in browser, which is why the
desk integrates that directly (`wkaisertexas/tiktok-uploader`, MIT).

Be aware: automating TikTok is against their terms, sessions expire (log in
again to refresh the cookie), and a wrong caption/account is your responsibility.
Use it for your own account and your own content.

---

## 4. Optional: self-hosted fetch sidecar

`tools/tiktok-sidecar/` is a small FastAPI service (TikTokApi by davidteather,
MIT, driving Playwright Chromium) that speaks the desk's fetch contract.

```bash
cd tools/tiktok-sidecar
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
uvicorn app:app --host 0.0.0.0 --port 8787
```

```bash
TIKTOK_FETCH_URL=http://127.0.0.1:8787
```

See `tools/tiktok-sidecar/README.md` for the contract — any service that answers
`/health`, `/search`, `/tag`, `/video` works, so you can drop in yt-dlp or a paid
API later without touching the desk.

---

## 5. API map

| Route | What it does |
| --- | --- |
| `POST /api/tiktok/fetch` | `{mode: "search"\|"link"\|"firehose", keyword, links, region, count, cursor}` → clips + `attempts` |
| `POST /api/tiktok/enrich` | resolve a watermark-free MP4 / HD link for one clip |
| `GET /api/tiktok/health` | tikwm + tiktok.com health |
| `GET /api/tiktok/diagnostics` | full provider sweep (fetch + uploader) |
| `GET/PUT/DELETE /api/tiktok/session` | read / store / forget the sessionid |
| `GET /api/tiktok/account` | Content Posting API account status |
| `POST /api/tiktok/publish` | post a clip or file (`backend: "auto"\|"session"\|"api"`) |
| `GET /api/tiktok/publish` | publish history |
| `POST /api/tiktok/publish/status` | re-check an API publish job |
| `GET /api/tiktok/auth` | OAuth authorize URL (developer app only) |
| `GET/POST /api/posts`, `PATCH /api/posts/:id` | the queue |
| `GET/PUT /api/settings` | caption recipe |
| `GET /api/media/stream?url=` | media proxy (TikTok's own CDN needs a UA) |
| `GET /api/export` | export the queue |

---

## 6. Deploying to Vercel

- **Set `DATABASE_URL`** in Project → Settings → Environment Variables (Postgres
  from Neon/Supabase/Vercel Postgres). The build itself no longer needs it — the
  pool is created on first query — but every queue/settings/session request does.
- Without it the site still renders and returns graceful errors; `/api/health`
  reports `ok: false`.
- **Serverless cannot run the session uploader.** Vercel functions have no
  Python/browser and a read-only runtime, so `TIKTOK_UPLOAD_MODE=cli` refuses
  with a clear message. Either:
  - run `tiktok-uploader` on a VPS/sidecar and set `TIKTOK_UPLOADER_URL` +
    `TIKTOK_UPLOAD_MODE=http`, or
  - connect a TikTok developer app and post through the official API, or
  - host the desk itself on a VPS, where CLI mode works as-is.
- **Vercel IPs are datacenter IPs** and are often rate-limited by tikwm /
  tiktok.com. Run `run diagnostics`: if both public providers are red, point
  `TIKTOK_FETCH_URL` at the sidecar (§4) running somewhere TikTok accepts, or
  self-host the desk next to it.

## 7. Troubleshooting

| Symptom | Check |
| --- | --- |
| Search returns nothing | Run diagnostics. tikwm down → set `TIKWM_BASE_URL`, `TIKTOK_COOKIE`, or the sidecar. |
| Link grab fails | Short links must be public; try the canonical `tiktok.com/@user/video/<id>` URL. |
| "The uploader command … was not found" | `pip install tiktok-uploader && playwright install chromium`, or set `TIKTOK_UPLOADER_CMD`. |
| "No TikTok session stored" | Paste the `sessionid` on the Publish tab (browser must be logged in). |
| Uploads fail with a login/expired error | Log in to tiktok.com again and re-paste the cookie. |
| `DATABASE_URL is required` | Copy `.env.example` to `.env` and point it at Postgres; on Vercel add it to the project env vars. |
| Build fails with `DATABASE_URL is required` | Fixed: the connection is lazy, so builds no longer need a database (this was the old behaviour). |
| "serverless runtime cannot launch the uploader" | Expected on Vercel — use `TIKTOK_UPLOADER_URL` (HTTP mode) or the official API. |
