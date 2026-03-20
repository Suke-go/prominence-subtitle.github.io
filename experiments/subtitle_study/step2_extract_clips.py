#!/usr/bin/env python3
"""
step2_extract_clips.py - Extract ~90s clips from downloaded TED talks.

Uses ffmpeg to cut the specified time range and convert to 16kHz mono WAV.

Usage:
    python step2_extract_clips.py              # all clips
    python step2_extract_clips.py --clip H1    # single clip
"""

import argparse
import subprocess
import sys
from config import TALKS, DOWNLOADS_DIR, CLIPS_DIR, SAMPLE_RATE, ensure_dirs, get_clip_ids


def extract_clip(clip_id: str, info: dict) -> bool:
    """Extract a clip segment from the full talk."""
    src = DOWNLOADS_DIR / f"{clip_id}.wav"
    dst = CLIPS_DIR / f"{clip_id}.wav"

    if dst.exists():
        print(f"  [OK] Already extracted: {dst.name}")
        return True

    if not src.exists():
        # Try other extensions
        candidates = list(DOWNLOADS_DIR.glob(f"{clip_id}.*"))
        if candidates:
            src = candidates[0]
        else:
            print(f"  [FAIL] Source not found: {src}")
            print(f"    Run step1_download.py first")
            return False

    start = info["start"]
    end = info["end"]
    duration = end - start

    print(f"  Extracting {start:.0f}s -> {end:.0f}s ({duration:.0f}s)")

    cmd = [
        "ffmpeg", "-y",
        "-i", str(src),
        "-ss", str(start),
        "-t", str(duration),
        "-ac", "1",                     # mono
        "-ar", str(SAMPLE_RATE),        # 16kHz
        "-sample_fmt", "s16",           # 16-bit
        "-f", "wav",
        str(dst),
    ]

    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace")
        print(f"  [FAIL] ffmpeg failed:\n    {stderr[:200]}")
        return False

    if not dst.exists():
        print(f"  [FAIL] Output file not created")
        return False

    # Validate duration
    try:
        import soundfile as sf
        data, sr = sf.read(str(dst))
        actual_dur = len(data) / sr
        print(f"  -> {dst.name} ({actual_dur:.1f}s, {sr}Hz)")

        if actual_dur < 30:
            print(f"  [WARN] Very short clip ({actual_dur:.1f}s). Check start/end times.")
        elif actual_dur > 150:
            print(f"  [WARN] Very long clip ({actual_dur:.1f}s). Consider shortening.")
    except ImportError:
        size_mb = dst.stat().st_size / (1024 * 1024)
        print(f"  -> {dst.name} ({size_mb:.1f} MB)")

    return True


def main():
    parser = argparse.ArgumentParser(description="Extract clips from downloaded talks")
    parser.add_argument("--clip", default=None, help="Clip ID(s)")
    args = parser.parse_args()

    ensure_dirs()
    clip_ids = get_clip_ids(args.clip)

    print(f"=== Step 2: Extract Clips ({len(clip_ids)} clips) ===\n")

    success, fail = 0, 0
    for cid in clip_ids:
        info = TALKS[cid]
        print(f"\n--- {cid}: {info['speaker']} [{info['start']:.0f}s-{info['end']:.0f}s] ---")
        if extract_clip(cid, info):
            success += 1
        else:
            fail += 1

    print(f"\n=== Done: {success} extracted, {fail} failed ===")
    if fail > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
