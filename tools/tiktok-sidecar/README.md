# TikTok fetch sidecar

A ~100 line FastAPI service that gives the desk a dependable, self-hosted way to
read TikTok when the free public middlemen are blocked from your network.

It uses [TikTokApi](https://github.com/davidteather/TikTok-Api) (MIT) driving a
real Playwright Chromium session — no TikTok developer account, no API key.

## Run it

```bash
cd tools/tiktok-sidecar
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
uvicorn app:app --host 0.0.0.0 --port 8787
```

Then point the desk at it:

```bash
TIKTOK_FETCH_URL=http://127.0.0.1:8787
```

Restart the desk and run **fetch health → run diagnostics** in the Source panel;
the `self-hosted fetch service` row should be green.

## Optional environment

| Variable         | What it does                                                     |
| ---------------- | ---------------------------------------------------------------- |
| `ms_token`       | A `msToken` cookie from a logged-out tiktok.com search. Improves search reliability. |
| `TIKTOK_BROWSER` | `chromium` (default), `firefox`, `webkit`                         |
| `TIKTOK_HEADLESS`| `0` to watch the browser while debugging                          |
| `TIKTOK_PROXY`   | `http://user:pass@host:port` if your IP is rate-limited           |
| `TIKTOK_FETCH_TOKEN` | If set on both sides, the desk sends `Authorization: Bearer …` |

## Contract

The desk calls exactly these routes:

```http
GET /health
GET /search?q=relatable&count=10&region=US   -> {"items": [itemStruct, …]}
GET /tag?tag=relatable&count=10              -> {"items": [itemStruct, …]}
GET /video?id=7300000000000000001            -> {"item": itemStruct}
GET /video?url=https://www.tiktok.com/@x/video/7300…
```

Any TikTok item struct, tikwm item or the desk's own video object is accepted,
so you can swap in your own implementation (yt-dlp, a paid API, a different
library) as long as it answers these four routes.

Scraping TikTok is best-effort and can break whenever TikTok changes its
private endpoints. Keep it to content you have the right to use.
