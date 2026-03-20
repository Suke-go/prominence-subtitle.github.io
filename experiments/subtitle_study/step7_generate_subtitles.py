#!/usr/bin/env python3
"""
step7_generate_subtitles.py - Generate 4-condition subtitle JSONs.

Conditions:
  normal     - uniform 18pt
  syntactic  - content=18pt, function=12pt (Dynamik-style)
  prosody    - 3-bin by ACN prominence (per-clip percentile thresholds → 12/15/18pt)
  syn_prosody - function=12pt, content split by prominence

Usage:
    python step7_generate_subtitles.py              # all clips
    python step7_generate_subtitles.py --clip H1    # single clip
"""

import argparse
import json
import sys
from config import (POS_DIR, PROMINENCE_DIR, SUBTITLES_DIR,
                    CONDITIONS, CHUNK_INTERVAL_S,
                    ensure_dirs, get_clip_ids)


def compute_otsu_thresholds(prominences):
    """Per-clip Otsu multi-threshold (3-class) for prominence binning.
    
    Maximizes inter-class variance to find optimal 2 thresholds,
    normalizing speaker-specific baseline expressiveness.
    No external dependency (manual implementation).
    """
    import numpy as np
    scores = np.array(prominences)
    n = len(scores)
    if n < 6:
        return float(np.percentile(scores, 33)), float(np.percentile(scores, 67))

    # Quantize into 128 histogram bins for efficient exhaustive search
    nbins = 128
    hist, bin_edges = np.histogram(scores, bins=nbins)
    bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2
    total = hist.sum()

    best_sigma = -1.0
    best_t1, best_t2 = 0, 0

    for i in range(1, nbins - 1):
        for j in range(i + 1, nbins):
            w0 = hist[:i].sum()
            w1 = hist[i:j].sum()
            w2 = hist[j:].sum()
            if w0 == 0 or w1 == 0 or w2 == 0:
                continue

            mu0 = np.sum(hist[:i] * bin_centers[:i]) / w0
            mu1 = np.sum(hist[i:j] * bin_centers[i:j]) / w1
            mu2 = np.sum(hist[j:] * bin_centers[j:]) / w2
            mu_t = np.sum(hist * bin_centers) / total

            sigma = (w0 * (mu0 - mu_t)**2 +
                     w1 * (mu1 - mu_t)**2 +
                     w2 * (mu2 - mu_t)**2) / total

            if sigma > best_sigma:
                best_sigma = sigma
                best_t1, best_t2 = i, j

    return float(bin_centers[best_t1]), float(bin_centers[best_t2])


def style(word_data: dict, condition: str, t_low: float, t_high: float):
    """Return (font_size, font_weight) for a word under a given condition.
    
    t_low, t_high are per-clip percentile thresholds.
    """
    if condition == "normal":
        return 18, 400

    elif condition == "syntactic":
        return (18, 400) if word_data["is_content"] else (12, 400)

    elif condition == "prosody":
        p = word_data["prominence"]
        if p < t_low:
            return 12, 300
        elif p < t_high:
            return 15, 400
        else:
            return 18, 700

    elif condition == "syn_prosody":
        if not word_data["is_content"]:
            return 12, 300
        else:
            p = word_data["prominence"]
            return (18, 700) if p >= t_high else (15, 400)

    return 18, 400


def generate_subtitle(clip_id: str) -> bool:
    """Generate 4-condition subtitle JSONs for a clip."""
    pos_path = POS_DIR / f"{clip_id}.json"
    prom_path = PROMINENCE_DIR / f"{clip_id}.json"

    if not pos_path.exists():
        print(f"  [FAIL] POS data not found: {pos_path}")
        return False
    if not prom_path.exists():
        print(f"  [FAIL] Prominence data not found: {prom_path}")
        return False

    with open(pos_path, encoding="utf-8") as f:
        pos_data = json.load(f)
    with open(prom_path, encoding="utf-8") as f:
        prom_data = json.load(f)

    n = min(len(pos_data), len(prom_data))

    # Merge POS and prominence data
    merged = []
    for i in range(n):
        merged.append({
            **pos_data[i],
            "prominence": prom_data[i]["prominence"],
        })

    # Compute per-clip Otsu thresholds for 3-tier binning
    all_proms = [w["prominence"] for w in merged]
    t_low, t_high = compute_otsu_thresholds(all_proms)
    print(f"  Thresholds (Otsu): low={t_low:.3f}, high={t_high:.3f}")

    generated = 0
    for cond in CONDITIONS:
        chunks = []
        current_chunk = {"start_time": 0, "words": []}

        for w in merged:
            fs, fw = style(w, cond, t_low, t_high)
            word_entry = {
                "text": w["word"],
                "start": w["start"],
                "end": w["end"],
                "font_size": fs,
                "font_weight": fw,
            }

            # Split into chunks at CHUNK_INTERVAL_S
            if (current_chunk["words"] and
                    (w["start"] - current_chunk["start_time"]) >= CHUNK_INTERVAL_S):
                current_chunk["end_time"] = current_chunk["words"][-1]["end"]
                chunks.append(current_chunk)
                current_chunk = {"start_time": w["start"], "words": []}

            if not current_chunk["words"]:
                current_chunk["start_time"] = w["start"]
            current_chunk["words"].append(word_entry)

        # Final chunk
        if current_chunk["words"]:
            current_chunk["end_time"] = current_chunk["words"][-1]["end"]
            chunks.append(current_chunk)

        out_path = SUBTITLES_DIR / f"{clip_id}_{cond}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump({
                "clip_id": clip_id,
                "condition": cond,
                "chunks": chunks,
            }, f, indent=2, ensure_ascii=False)
        generated += 1

    # Summary: size distribution per condition
    for cond in CONDITIONS:
        out_path = SUBTITLES_DIR / f"{clip_id}_{cond}.json"
        with open(out_path, encoding="utf-8") as f:
            data = json.load(f)
        sizes = {}
        for chunk in data["chunks"]:
            for w in chunk["words"]:
                s = w["font_size"]
                sizes[s] = sizes.get(s, 0) + 1
        dist = ", ".join(f"{k}pt:{v}" for k, v in sorted(sizes.items()))
        print(f"  {cond:<12}: {dist}")

    print(f"  -> {generated} files generated")
    return True


def main():
    parser = argparse.ArgumentParser(description="Generate 4-condition subtitle JSONs")
    parser.add_argument("--clip", default=None, help="Clip ID(s)")
    args = parser.parse_args()

    ensure_dirs()
    clip_ids = get_clip_ids(args.clip)

    print(f"=== Step 7: Generate Subtitle JSONs ({len(clip_ids)} clips) ===\n")

    success, fail = 0, 0
    for cid in clip_ids:
        print(f"\n--- {cid} ---")
        if generate_subtitle(cid):
            success += 1
        else:
            fail += 1

    print(f"\n=== Done: {success} clips × 4 conditions = {success * 4} files ===")
    print(f"Output: {SUBTITLES_DIR}/")
    if fail > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()

