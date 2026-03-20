#!/usr/bin/env python3
"""
run_all.py - Master script: run the full pipeline (steps 1-8).

Skips steps whose output already exists. Use --force to re-run everything.

Usage:
    python run_all.py                    # full pipeline, all clips
    python run_all.py --clip H1          # single clip
    python run_all.py --skip-download    # skip yt-dlp (clips already downloaded)
    python run_all.py --from-step 5      # start from step 5
    python run_all.py --force            # re-run everything
"""

import argparse
import subprocess
import sys
import time
from pathlib import Path
from config import TALKS, ensure_dirs, get_clip_ids


STEPS = [
    ("step1_download.py",          "Download TED talks"),
    ("step2_extract_clips.py",     "Extract clips"),
    ("step3_align_words.py",       "Whisper word alignment"),
    ("step4_pos_tagging.py",       "spaCy POS tagging"),
    ("step5_acn_prominence.py",    "ACN prominence scoring"),
    ("step6_divergence.py",        "Divergence analysis"),
    ("step7_generate_subtitles.py", "Generate subtitle JSONs"),
    ("step8_preview.py",           "Generate HTML previews"),
]


def run_step(script: str, description: str, clip_arg: str = None,
             extra_args: list = None):
    """Run a pipeline step as a subprocess."""
    cmd = [sys.executable, script]
    if clip_arg:
        cmd.extend(["--clip", clip_arg])
    if extra_args:
        cmd.extend(extra_args)

    print(f"\n{'=' * 60}")
    print(f"  {description}")
    print(f"  Command: {' '.join(cmd)}")
    print(f"{'=' * 60}\n")

    t0 = time.time()
    result = subprocess.run(cmd, cwd=str(Path(__file__).parent))
    elapsed = time.time() - t0

    if result.returncode != 0:
        print(f"\n[FAIL] FAILED: {script} (exit {result.returncode}) [{elapsed:.1f}s]")
        return False

    print(f"\n[OK] {description} [{elapsed:.1f}s]")
    return True


def main():
    parser = argparse.ArgumentParser(description="Run the full subtitle study pipeline")
    parser.add_argument("--clip", default=None, help="Clip ID(s), e.g. H1 or H1,H2")
    parser.add_argument("--skip-download", action="store_true",
                        help="Skip step 1 (download)")
    parser.add_argument("--from-step", type=int, default=1,
                        help="Start from step N (1-8)")
    parser.add_argument("--force", action="store_true",
                        help="Force re-run (ignore existing outputs)")
    parser.add_argument("--whisper-model", default=None,
                        help="Whisper model size (default: medium)")
    args = parser.parse_args()

    ensure_dirs()

    # Validate clip IDs
    if args.clip:
        try:
            get_clip_ids(args.clip)
        except ValueError as e:
            print(f"Error: {e}")
            sys.exit(1)

    print("=" * 60)
    print("  TED Talk Subtitle Study Pipeline")
    print(f"  Clips: {args.clip or 'all (' + str(len(TALKS)) + ')'}")
    print(f"  Starting from step: {args.from_step}")
    print("=" * 60)

    t_total = time.time()
    results = []

    for i, (script, desc) in enumerate(STEPS, 1):
        if i < args.from_step:
            print(f"\n  Skipping step {i}: {desc}")
            continue
        if i == 1 and args.skip_download:
            print(f"\n  Skipping step 1: {desc} (--skip-download)")
            continue

        # Step 6 (divergence) doesn't take --clip
        clip_arg = args.clip if i != 6 else None

        # Extra args
        extra = []
        if i == 3 and args.whisper_model:
            extra.extend(["--model", args.whisper_model])

        ok = run_step(script, f"Step {i}: {desc}",
                      clip_arg=clip_arg, extra_args=extra or None)
        results.append((i, desc, ok))

        if not ok:
            print(f"\n{'!' * 60}")
            print(f"  Pipeline stopped at step {i}: {desc}")
            print(f"  Fix the issue and re-run with: --from-step {i}")
            print(f"{'!' * 60}")
            sys.exit(1)

    elapsed_total = time.time() - t_total
    print(f"\n{'=' * 60}")
    print(f"  Pipeline complete! [{elapsed_total:.0f}s total]")
    print(f"{'=' * 60}")
    for i, desc, ok in results:
        status = "[OK]" if ok else "[FAIL]"
        print(f"  {status} Step {i}: {desc}")

    print(f"\nOutputs:")
    print(f"  Clips:     experiments/subtitle_study/clips/")
    print(f"  Alignment: experiments/subtitle_study/alignment/")
    print(f"  Subtitles: experiments/subtitle_study/subtitles/")
    print(f"  Previews:  experiments/subtitle_study/preview/")


if __name__ == "__main__":
    main()
