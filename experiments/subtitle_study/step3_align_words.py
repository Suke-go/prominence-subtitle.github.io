#!/usr/bin/env python3
"""
step3_align_words.py - Word-level alignment via whisper-timestamped.

Produces per-word JSON with start/end times and plain text for review.

Usage:
    python step3_align_words.py              # all clips
    python step3_align_words.py --clip H1    # single clip
    python step3_align_words.py --model small # use smaller model
"""

import argparse
import json
import sys
from pathlib import Path
from config import CLIPS_DIR, ALIGNMENT_DIR, WHISPER_MODEL, ensure_dirs, get_clip_ids


def align_clip(clip_id: str, model, model_name: str) -> bool:
    """Run Whisper alignment on a single clip."""
    import whisper_timestamped as whisper

    wav_path = CLIPS_DIR / f"{clip_id}.wav"
    out_json = ALIGNMENT_DIR / f"{clip_id}.json"
    out_txt = ALIGNMENT_DIR / f"{clip_id}.txt"

    if out_json.exists():
        print(f"  [OK] Already aligned: {out_json.name}")
        return True

    if not wav_path.exists():
        print(f"  [FAIL] Clip not found: {wav_path}")
        print(f"    Run step2_extract_clips.py first")
        return False

    print(f"  Transcribing with Whisper ({model_name})...")
    audio = whisper.load_audio(str(wav_path))
    result = whisper.transcribe(model, audio, language="en")

    words = []
    for seg in result["segments"]:
        for w in seg.get("words", []):
            words.append({
                "word": w["text"].strip(),
                "start": round(w["start"], 3),
                "end": round(w["end"], 3),
                "confidence": round(w.get("confidence", 0.0), 3),
            })

    # Save JSON
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(words, f, indent=2, ensure_ascii=False)

    # Save plain text
    transcript = " ".join(w["word"] for w in words)
    with open(out_txt, "w", encoding="utf-8") as f:
        f.write(transcript)

    print(f"  {len(words)} words")
    print(f"  First 100 chars: {transcript[:100]}...")
    print(f"  -> {out_json.name}")

    # Sanity checks
    low_conf = sum(1 for w in words if w["confidence"] < 0.5)
    if low_conf > len(words) * 0.2:
        print(f"  [WARN] {low_conf}/{len(words)} words have low confidence (<0.5)")

    return True


def main():
    parser = argparse.ArgumentParser(description="Word-level alignment with Whisper")
    parser.add_argument("--clip", default=None, help="Clip ID(s)")
    parser.add_argument("--model", default=WHISPER_MODEL,
                        help=f"Whisper model size (default: {WHISPER_MODEL})")
    args = parser.parse_args()

    ensure_dirs()
    clip_ids = get_clip_ids(args.clip)

    # Load model once
    import whisper_timestamped as whisper
    print(f"Loading Whisper model ({args.model})...")
    model = whisper.load_model(args.model)
    print("Model loaded.\n")

    print(f"=== Step 3: Word Alignment ({len(clip_ids)} clips) ===\n")

    success, fail = 0, 0
    for cid in clip_ids:
        print(f"\n--- {cid} ---")
        if align_clip(cid, model, args.model):
            success += 1
        else:
            fail += 1

    print(f"\n=== Done: {success} aligned, {fail} failed ===")
    if fail > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
