"""FastAPI server for LightFlow v3 — serves analysis + show data to the webapp."""

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
    """Run full v3 analysis on uploaded audio file."""
    from analyze import run_analysis

    with tempfile.NamedTemporaryFile(suffix=os.path.splitext(file.filename or ".mp3")[1], delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = run_analysis(tmp_path, cache_dir=str(DATA_DIR / ".demucs_cache"))
        result_dict = result.model_dump()

        # Save for later use
        name = Path(file.filename or "unknown").stem
        out_path = DATA_DIR / f"{name}_analysis.json"
        with open(out_path, "w") as f:
            json.dump(result_dict, f)

        return JSONResponse(content=result_dict)
    finally:
        os.unlink(tmp_path)


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
