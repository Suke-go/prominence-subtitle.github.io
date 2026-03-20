#!/usr/bin/env python3
"""
step10_prepare_experiment.py — Prepare video clips for the experiment overlay.

Cuts full-length MP4 downloads into clip segments and places them in demo_data/.

Usage:
    python step10_prepare_experiment.py              # all clips
    python step10_prepare_experiment.py --clip H3    # single clip
"""

import argparse
import json
import subprocess
import shutil
import sys
from pathlib import Path
from config import TALKS, DOWNLOADS_DIR, CLIPS_DIR, ensure_dirs, get_clip_ids

BASE_DIR = Path(__file__).resolve().parent
DEMO_DATA_DIR = BASE_DIR / "demo_data"


def prepare_video_clip(clip_id: str, info: dict) -> bool:
    """Cut video segment matching the audio clip timestamps."""
    src_video = DOWNLOADS_DIR / f"{clip_id}.mp4"
    out_video = DEMO_DATA_DIR / clip_id / "video.mp4"

    if out_video.exists():
        size_mb = out_video.stat().st_size / (1024 * 1024)
        print(f"  [OK] Already prepared: {out_video.name} ({size_mb:.1f} MB)")
        return True

    if not src_video.exists():
        print(f"  [SKIP] No video found: {src_video}")
        print(f"         Run: python step1_download.py --clip {clip_id} --video")
        return False

    # Create output directory
    out_video.parent.mkdir(parents=True, exist_ok=True)

    start_s = info.get("start", 0)
    end_s = info.get("end", start_s + 90)
    duration_s = end_s - start_s

    print(f"  Cutting {clip_id}: {start_s:.0f}s → {end_s:.0f}s ({duration_s:.0f}s)")

    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start_s),
        "-i", str(src_video),
        "-t", str(duration_s),
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-vf", "scale=-2:540",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",      # web-friendly
        str(out_video),
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  [FAIL] FFmpeg error:\n{result.stderr[-300:]}")
        return False

    if out_video.exists():
        size_mb = out_video.stat().st_size / (1024 * 1024)
        print(f"  → {out_video.name} ({size_mb:.1f} MB)")
        return True

    return False


def update_manifest(clip_ids: list):
    """Update manifest.json with has_video flag."""
    manifest_path = DEMO_DATA_DIR / "manifest.json"
    manifest = []

    if manifest_path.exists():
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)

    # Index by name
    by_name = {m["name"]: m for m in manifest}

    for cid in clip_ids:
        video_exists = (DEMO_DATA_DIR / cid / "video.mp4").exists()
        if cid in by_name:
            by_name[cid]["has_video"] = video_exists
        else:
            info = TALKS.get(cid, {})
            by_name[cid] = {
                "name": cid,
                "speaker": info.get("speaker", ""),
                "title": info.get("title", ""),
                "year": info.get("year", 0),
                "note": info.get("note", ""),
                "group": "high" if cid.startswith("H") else "low",
                "has_video": video_exists,
            }

    manifest = list(by_name.values())

    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print(f"\n  Manifest updated: {manifest_path}")


def main():
    parser = argparse.ArgumentParser(description="Prepare video clips for experiment")
    parser.add_argument("--clip", default=None, help="Clip ID(s), e.g. H1 or H1,H2")
    args = parser.parse_args()

    ensure_dirs()
    DEMO_DATA_DIR.mkdir(parents=True, exist_ok=True)
    clip_ids = get_clip_ids(args.clip)

    print(f"=== Step 10: Prepare Experiment Videos ({len(clip_ids)} clips) ===\n")

    success, fail = 0, 0
    for cid in clip_ids:
        info = TALKS[cid]
        print(f"\n--- {cid}: {info['speaker']} ---")
        if prepare_video_clip(cid, info):
            success += 1
        else:
            fail += 1

    update_manifest(clip_ids)

    print(f"\n=== Done: {success} prepared, {fail} skipped/failed ===")
    if fail > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
