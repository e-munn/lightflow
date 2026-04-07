"""Batch pipeline: generate show plans → validate → report scores.

Usage:
  python batch.py                          # run all synthetic songs
  python batch.py synthetic/synth_dnb_analysis.json  # run one
  python batch.py --style chill synthetic/  # all in dir with style override
  python batch.py --max-retries 3          # re-generate on low scores
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from generate import generate_show, build_prompt
from schemas import AnalysisResult, ShowPlan
from validate import validate_show, format_report, ScoreCard


DEFAULT_DIR = Path(__file__).parent / "synthetic"


def load_analysis(path: Path) -> AnalysisResult:
    with open(path) as f:
        return AnalysisResult(**json.load(f))


def save_show(show: ShowPlan, path: Path):
    path.write_text(show.model_dump_json(indent=2))


def run_one(
    analysis_path: Path,
    style: str = "energetic",
    model: str = "claude-sonnet-4-6",
    max_retries: int = 0,
    output_dir: Path | None = None,
) -> tuple[ShowPlan, ScoreCard]:
    """Generate + validate one song. Optionally retry on low scores."""
    analysis = load_analysis(analysis_path)
    out_dir = output_dir or analysis_path.parent

    print(f"\n{'='*60}")
    print(f"  Song: {analysis.song}")
    print(f"  BPM: {analysis.bpm}, Duration: {analysis.duration:.0f}s, Sections: {len(analysis.sections)}")
    print(f"{'='*60}")

    best_show = None
    best_score = None

    for attempt in range(1 + max_retries):
        if attempt > 0:
            print(f"\n  --- Retry {attempt}/{max_retries} (previous grade: {best_score.grade}) ---")

        show = generate_show(analysis, style=style, model=model)
        score = validate_show(show, analysis)

        if best_score is None or score.overall_score > best_score.overall_score:
            best_show = show
            best_score = score

        print(format_report(score))

        if score.grade in ("A", "B"):
            break

        # Build feedback for retry
        if attempt < max_retries:
            print(f"  Grade {score.grade} — retrying with feedback...")

    # Save outputs
    stem = analysis_path.stem.replace("_analysis", "")
    show_path = out_dir / f"{stem}_show.json"
    save_show(best_show, show_path)
    print(f"  Saved: {show_path}")

    score_path = out_dir / f"{stem}_score.json"
    score_data = {
        "song": analysis.song,
        "grade": best_score.grade,
        "overall": best_score.overall_score,
        "rule_score": best_score.rule_score,
        "render_score": best_score.render_score,
        "errors": len([v for v in best_score.violations if v.severity == "error"]),
        "warnings": len([v for v in best_score.violations if v.severity == "warning"]),
    }
    score_path.write_text(json.dumps(score_data, indent=2))

    return best_show, best_score


def run_batch(
    paths: list[Path],
    style: str = "energetic",
    model: str = "claude-sonnet-4-6",
    max_retries: int = 0,
    output_dir: Path | None = None,
):
    """Run the full pipeline on multiple songs and print a summary."""
    results = []
    start = time.time()

    for path in paths:
        try:
            show, score = run_one(path, style=style, model=model,
                                  max_retries=max_retries, output_dir=output_dir)
            results.append((path.stem, score))
        except Exception as e:
            print(f"  FAILED: {path.name} — {e}")
            results.append((path.stem, None))

    elapsed = time.time() - start

    # Summary
    print(f"\n{'='*60}")
    print(f"  BATCH SUMMARY — {len(results)} songs in {elapsed:.0f}s")
    print(f"{'='*60}")
    print(f"  {'Song':<35} {'Grade':>5} {'Overall':>8} {'Rules':>7} {'Render':>7} {'Err':>4} {'Warn':>5}")
    print(f"  {'-'*35} {'-'*5} {'-'*8} {'-'*7} {'-'*7} {'-'*4} {'-'*5}")

    grades = []
    for name, score in results:
        if score is None:
            print(f"  {name:<35} {'FAIL':>5}")
            continue
        grades.append(score.grade)
        errs = len([v for v in score.violations if v.severity == "error"])
        warns = len([v for v in score.violations if v.severity == "warning"])
        print(f"  {name:<35} {score.grade:>5} {score.overall_score:>8.1f} "
              f"{score.rule_score:>7.1f} {score.render_score:>7.1f} {errs:>4} {warns:>5}")

    if grades:
        avg_score = sum(s.overall_score for _, s in results if s) / len(grades)
        print(f"\n  Average: {avg_score:.1f}/100")
        print(f"  Grades: {', '.join(grades)}")
    print()


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Batch generate + validate light shows")
    parser.add_argument("paths", nargs="*", help="Analysis JSON files or directories")
    parser.add_argument("--style", default="energetic", help="Show style")
    parser.add_argument("--model", default="claude-sonnet-4-6", help="Claude model")
    parser.add_argument("--max-retries", type=int, default=0, help="Retry on low scores")
    parser.add_argument("--output-dir", type=str, default=None, help="Output directory")
    args = parser.parse_args()

    # Collect paths
    paths = []
    if not args.paths:
        paths = sorted(DEFAULT_DIR.glob("*_analysis.json"))
    else:
        for p in args.paths:
            p = Path(p)
            if p.is_dir():
                paths.extend(sorted(p.glob("*_analysis.json")))
            else:
                paths.append(p)

    if not paths:
        print("No analysis files found.")
        sys.exit(1)

    print(f"Found {len(paths)} analysis files")
    output_dir = Path(args.output_dir) if args.output_dir else None

    run_batch(paths, style=args.style, model=args.model,
              max_retries=args.max_retries, output_dir=output_dir)


if __name__ == "__main__":
    main()
