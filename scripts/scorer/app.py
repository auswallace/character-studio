#!/usr/bin/env python3
"""
scripts/scorer/app.py

Face-consistency scorer for create.ai. Small HTTP service the dashboard calls
after each generation so it can write `consistency_score`.

    POST /score        { image_url, persona_id }            -> one result
    POST /score/batch  { items: [{ image_url, persona_id }] } -> { results: [...] }
    POST /refresh      { persona_id? }                       -> drop cached canonical face(s)
    GET  /health                                             -> { ok, model, personas_cached }

Result: { similarity, faces, view, face_h, det_score, ref_source, ref_count }
  similarity: ArcFace cosine vs the persona's canonical face, null when no face
  view:       'face' | 'half' | 'full' | '' (from face height / image height)
  ref_source: 'sheet' when identity-sheet refs exist, else 'face'

Canonical face = mean embedding of persona_refs rows with ref_type='sheet'
(identity sheet, preferred) or ref_type='face' (legacy refs) when no sheet
exists. Cached in memory for CACHE_TTL seconds.

Same model and thresholds as scripts/eval_consistency.py:
  >= 0.60 same person, confident | 0.45-0.60 probably | < 0.45 not the same face

Config comes from dashboard/.env.local (SUPABASE_URL, SUPABASE_ANON_KEY), plus:
  SCORER_TOKEN          optional; when set, requests need "Authorization: Bearer <token>"
  SCORER_ALLOWED_HOSTS  optional; extra image hosts (comma-separated). Supabase
                        storage and fal/wavespeed CDNs are allowed by default.
  SCORER_CACHE_TTL      seconds, default 600

Run: see README.md in this folder.
"""

from __future__ import annotations

import ipaddress
import json
import os
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

import cv2
import numpy as np
from fastapi import Depends, FastAPI, Header, HTTPException
from insightface.app import FaceAnalysis
from pydantic import BaseModel

# ─── Config ───────────────────────────────────────────────

ROOT = Path(__file__).resolve().parents[2]


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.split(" #")[0].strip().strip('"').strip("'"))


load_env_file(ROOT / "dashboard" / ".env.local")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
TOKEN = os.environ.get("SCORER_TOKEN", "")
CACHE_TTL = int(os.environ.get("SCORER_CACHE_TTL", "600"))
MAX_BYTES = 25 * 1024 * 1024
MAX_BATCH = 50

ALLOWED_SUFFIXES = ["supabase.co", "supabase.in", "fal.media", "fal.run", "wavespeed.ai", "cloudfront.net"]
ALLOWED_SUFFIXES += [h.strip().lower() for h in os.environ.get("SCORER_ALLOWED_HOSTS", "").split(",") if h.strip()]
if SUPABASE_URL:
    ALLOWED_SUFFIXES.append(urllib.parse.urlparse(SUPABASE_URL).hostname or "")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("[scorer] WARNING: SUPABASE_URL / SUPABASE_ANON_KEY not found; persona refs cannot load")

# ─── Helpers ──────────────────────────────────────────────


def check_url(url: str) -> None:
    u = urllib.parse.urlparse(url)
    host = (u.hostname or "").lower()
    if u.scheme != "https" or not host:
        raise HTTPException(400, "image_url must be https")
    try:
        ipaddress.ip_address(host)
        raise HTTPException(400, "IP-literal hosts are not allowed")
    except ValueError:
        pass
    if not any(host == s or host.endswith("." + s) for s in ALLOWED_SUFFIXES if s):
        raise HTTPException(400, f"host not allowed: {host} (add it to SCORER_ALLOWED_HOSTS)")


def fetch_image(url: str) -> np.ndarray:
    check_url(url)
    req = urllib.request.Request(url, headers={"User-Agent": "create-ai-scorer/1"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "image too large")
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(422, "could not decode image")
    return img


def supabase_get(path: str) -> list:
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


# ─── Face model ───────────────────────────────────────────


class Embedder:
    def __init__(self) -> None:
        self.app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        self.app.prepare(ctx_id=0, det_size=(640, 640))
        self.lock = threading.Lock()  # onnxruntime session is not safe for concurrent calls here

    def embed(self, img: np.ndarray):
        h, w = img.shape[:2]
        if max(h, w) > 1600:
            s = 1600 / max(h, w)
            img = cv2.resize(img, (int(w * s), int(h * s)))
        with self.lock:
            faces = self.app.get(img)
        if not faces:
            return None, 0, 0.0, 0.0
        faces.sort(key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]), reverse=True)
        f = faces[0]
        face_h = float(f.bbox[3] - f.bbox[1]) / float(img.shape[0])
        return f.normed_embedding, len(faces), float(f.det_score), face_h


def view_label(face_h: float) -> str:
    return "face" if face_h >= 0.30 else "half" if face_h >= 0.12 else "full" if face_h > 0 else ""


EMB = Embedder()
_cache: dict[str, tuple[float, np.ndarray, str, int]] = {}
_cache_lock = threading.Lock()


def canonical(persona_id: str) -> tuple[np.ndarray, str, int]:
    now = time.time()
    with _cache_lock:
        hit = _cache.get(persona_id)
    if hit and now - hit[0] < CACHE_TTL:
        return hit[1], hit[2], hit[3]

    pid = urllib.parse.quote(persona_id, safe="")
    # Best canonical: the approved face images in the character dataset (curated, one person).
    # Fall back to the persona's sheet / face refs when there is no dataset yet.
    ds = supabase_get(f"dataset_images?persona_id=eq.{pid}&approved=eq.true&view=like.face*&select=url&limit=24")
    if len(ds) >= 5:
        use, source = ds, "dataset"
    else:
        rows = supabase_get(f"persona_refs?persona_id=eq.{pid}&ref_type=in.(sheet,face)&select=url,ref_type")
        sheet = [r for r in rows if r.get("ref_type") == "sheet" and r.get("url")]
        use, source = (sheet, "sheet") if sheet else ([r for r in rows if r.get("ref_type") == "face" and r.get("url")], "face")
    embs = []
    for r in use:
        try:
            e, _n, _d, _h = EMB.embed(fetch_image(r["url"]))
            if e is not None:
                embs.append(e)
        except Exception as err:  # one bad ref should not kill the persona
            print(f"[scorer] ref skipped ({r['url'][:60]}...): {err}")
    if not embs:
        raise HTTPException(404, f"no usable {source} refs for persona {persona_id}")
    m = np.mean(np.stack(embs), axis=0)
    m = m / (np.linalg.norm(m) + 1e-9)
    with _cache_lock:
        _cache[persona_id] = (now, m, source, len(embs))
    print(f"[scorer] canonical face for {persona_id}: {len(embs)} {source} refs")
    return m, source, len(embs)


def score_one(image_url: str, persona_id: str) -> dict:
    canon, source, n = canonical(persona_id)
    emb, faces, det, face_h = EMB.embed(fetch_image(image_url))
    sim = None if emb is None else round(float(np.dot(emb, canon)), 4)
    return {
        "similarity": sim,
        "faces": faces,
        "view": view_label(face_h),
        "face_h": round(face_h, 3),
        "det_score": round(det, 3),
        "ref_source": source,
        "ref_count": n,
    }


# ─── HTTP ─────────────────────────────────────────────────

app = FastAPI(title="create.ai scorer")


def auth(authorization: str | None = Header(default=None)) -> None:
    if TOKEN and authorization != f"Bearer {TOKEN}":
        raise HTTPException(401, "bad or missing token")


class ScoreReq(BaseModel):
    image_url: str
    persona_id: str


class BatchReq(BaseModel):
    items: list[ScoreReq]


class RefreshReq(BaseModel):
    persona_id: str | None = None


@app.get("/health")
def health():
    return {"ok": True, "model": "buffalo_l", "personas_cached": len(_cache)}


@app.post("/score", dependencies=[Depends(auth)])
def score(req: ScoreReq):
    return score_one(req.image_url, req.persona_id)


@app.post("/score/batch", dependencies=[Depends(auth)])
def score_batch(req: BatchReq):
    if len(req.items) > MAX_BATCH:
        raise HTTPException(413, f"max {MAX_BATCH} items per batch")
    out = []
    for it in req.items:
        try:
            out.append({"image_url": it.image_url, **score_one(it.image_url, it.persona_id)})
        except HTTPException as e:
            out.append({"image_url": it.image_url, "error": e.detail})
        except Exception as e:
            out.append({"image_url": it.image_url, "error": str(e)})
    return {"results": out}


@app.post("/refresh", dependencies=[Depends(auth)])
def refresh(req: RefreshReq):
    with _cache_lock:
        if req.persona_id:
            _cache.pop(req.persona_id, None)
        else:
            _cache.clear()
    return {"ok": True}
