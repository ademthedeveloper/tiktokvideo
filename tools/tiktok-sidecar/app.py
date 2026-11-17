"""
Minimal self-hosted fetch service for the TikTok desk.

It speaks the contract in src/lib/providers/sidecar.ts:

    GET /health
    GET /search?q=<keywords>&count=<n>&region=<CC>
    GET /tag?tag=<hashtag>&count=<n>
    GET /video?id=<video id>   or   ?url=<tiktok link>

Everything is built on open-source pieces:
  * TikTokApi  (MIT, davidteather/TikTok-Api) — search + hashtags + item detail
  * Playwright (Apache-2.0) — the browser session TikTokApi drives

Why a separate process? TikTokApi needs a real Chromium session, which is a
poor fit for a Next.js server. Running it beside the desk keeps both simple.

    python -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    playwright install chromium
    uvicorn app:app --host 0.0.0.0 --port 8787

Then in the desk's environment:

    TIKTOK_FETCH_URL=http://127.0.0.1:8787

Note: TikTok changes its private endpoints often. This service is a convenience,
not a contract with TikTok; treat scraping as best-effort and keep it to your
own research/curation.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Query, Request
from TikTokApi import TikTokApi

MS_TOKEN = os.getenv("ms_token") or os.getenv("MS_TOKEN")
BROWSER = os.getenv("TIKTOK_BROWSER", "chromium")
HEADLESS = os.getenv("TIKTOK_HEADLESS", "1") != "0"
PROXY = os.getenv("TIKTOK_PROXY") or None


@asynccontextmanager
async def lifespan(app: FastAPI):
    api = TikTokApi(proxy=PROXY) if PROXY else TikTokApi()
    await api.__aenter__()
    kwargs: dict[str, Any] = {}
    if MS_TOKEN:
        kwargs["ms_tokens"] = [MS_TOKEN]
    await api.create_sessions(
        num_sessions=1,
        sleep_after=3,
        headless=HEADLESS,
        browser=BROWSER,
        **kwargs,
    )
    app.state.api = api
    try:
        yield
    finally:
        await api.__aexit__(None, None, None)


app = FastAPI(title="tiktok-desk sidecar", lifespan=lifespan)


def _api(request: Request) -> TikTokApi:
    api: Optional[TikTokApi] = getattr(request.app.state, "api", None)
    if api is None:
        raise HTTPException(status_code=503, detail="session not ready yet")
    return api


@app.get("/health")
async def health(request: Request):
    return {"ok": getattr(request.app.state, "api", None) is not None}


async def _collect(videos, limit: int) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    async for video in videos:
        try:
            items.append(await video.info())
        except Exception:  # one bad item should not sink the page
            continue
        if len(items) >= limit:
            break
    return items


@app.get("/search")
async def search(
    request: Request,
    q: str = Query("", alias="q"),
    keywords: str = Query(""),
    count: int = 12,
    region: str = "US",
):
    term = (q or keywords).strip()
    if not term:
        raise HTTPException(status_code=400, detail="q is required")
    api = _api(request)
    limit = min(max(count, 1), 30)
    try:
        # search_type(…, "item") is keyword video search in TikTokApi 7.x
        items = await _collect(api.search.search_type(term, "item", count=limit), limit)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"search failed: {exc}") from exc
    return {"items": items, "query": term, "region": region}


@app.get("/tag")
async def tag(request: Request, tag: str, count: int = 12):
    api = _api(request)
    limit = min(max(count, 1), 30)
    name = tag.lstrip("#")
    try:
        items = await _collect(api.hashtag(name=name).videos(count=limit), limit)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"hashtag failed: {exc}") from exc
    return {"items": items, "tag": name}


@app.get("/video")
async def video(request: Request, id: Optional[str] = None, url: Optional[str] = None):
    api = _api(request)
    if not id and not url:
        raise HTTPException(status_code=400, detail="id or url is required")
    try:
        handle = api.video(id=id) if id else api.video(url=url)
        return {"item": await handle.info()}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"video failed: {exc}") from exc
