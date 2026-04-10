"""FastAPI server for LightFlow v3 — serves analysis + show data to the webapp."""

import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Add v3 to path for imports
sys.path.insert(0, str(Path(__file__).parent))

app = FastAPI(title="LightFlow v3 API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "v3"}


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    """Run full v3 analysis on uploaded audio file.

    Caching strategy: hash the uploaded file's content and use the hash
    as both the tempfile stem and the saved analysis filename. This
    means dropping the same audio a second time hits:
      - the demucs stem cache (keyed by filename stem in analyze.py)
      - the saved analysis JSON (short-circuit: skip re-analysis)
    Without this, every upload gets a random tmpfile name and the cache
    never hits.
    """
    from analyze import analyze_song

    content = await file.read()
    # Hash file bytes → stable cache key across re-drops of the same file.
    digest = hashlib.sha256(content).hexdigest()[:16]
    ext = os.path.splitext(file.filename or ".mp3")[1] or ".mp3"

    out_dir = DATA_DIR / "tmp_analyses"
    out_dir.mkdir(parents=True, exist_ok=True)
    cache_dir = DATA_DIR / ".demucs_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)

    # Short-circuit: if we've already analyzed this exact file, return the cached JSON.
    cached_path = DATA_DIR / f"{digest}_analysis.json"
    if cached_path.exists():
        print(f"  [cache hit] {file.filename} → {digest}")
        with open(cached_path) as f:
            return JSONResponse(content=json.load(f))

    # Write to a tempfile whose stem IS the digest, so run_demucs keys its
    # cache on the digest too (cache_dir / "htdemucs" / <digest>).
    tmp_dir = Path(tempfile.gettempdir())
    tmp_path = tmp_dir / f"{digest}{ext}"
    with open(tmp_path, "wb") as tmp:
        tmp.write(content)

    try:
        result = analyze_song(tmp_path, out_dir, cache_dir)
        result_dict = result.model_dump()

        # Persist by digest so subsequent identical uploads short-circuit.
        with open(cached_path, "w") as f:
            json.dump(result_dict, f)

        # Also save under the friendly filename for humans browsing the data dir.
        friendly = Path(file.filename or "unknown").stem
        friendly_path = DATA_DIR / f"{friendly}_analysis.json"
        try:
            with open(friendly_path, "w") as f:
                json.dump(result_dict, f)
        except OSError:
            pass

        return JSONResponse(content=result_dict)
    finally:
        # Keep the tmp audio file — demucs cache references its stem name,
        # and deleting it doesn't affect correctness but it's tiny. Leaving
        # it preserves predictability if anyone debugs by hand.
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@app.post("/generate")
async def generate(
    file: UploadFile = File(...),
    style: str = Form("energetic"),
):
    """Generate a show plan from analysis JSON."""
    from generate import generate_show as gen_show
    from schemas import AnalysisResult

    content = await file.read()
    analysis_dict = json.loads(content)
    analysis = AnalysisResult(**analysis_dict)

    show = gen_show(analysis, style=style)
    show_dict = show.model_dump()

    # Save
    name = analysis.song.replace(" ", "_").lower()
    out_path = DATA_DIR / f"{name}_show.json"
    with open(out_path, "w") as f:
        json.dump(show_dict, f)

    return JSONResponse(content=show_dict)


@app.get("/data/{filename}")
async def get_data(filename: str):
    """Serve saved analysis/show JSON files."""
    path = DATA_DIR / filename
    if not path.exists():
        return JSONResponse(content={"error": "not found"}, status_code=404)
    with open(path) as f:
        return JSONResponse(content=json.load(f))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
