#!/usr/bin/env python3
"""
step6_divergence.py - Compute divergence between ACN (prosody) and Dynamik (syntax).

Primary metric: Point-biserial correlation (threshold-free)
  r_pb = corr(is_content, prominence)
  D_new = 1 - r_pb
  High D_new -> ACN and syntax disagree (prosodic contrast)
  Low  D_new -> ACN and syntax agree

Secondary metric (for reference): Otsu-based D_total
  D1 = fraction of ACN-high words (Otsu) that are function words
  D2 = fraction of ACN-low words (Otsu) that are content words
  D_total = (D1 + D2) / 2

Usage:
    python step6_divergence.py
"""

import json
import numpy as np
from scipy.stats import pointbiserialr
from config import POS_DIR, PROMINENCE_DIR, TALKS
from step7_generate_subtitles import compute_otsu_thresholds


def compute_divergence(clip_id: str):
    """Compute divergence metrics for a single clip."""
    pos_path = POS_DIR / f"{clip_id}.json"
    prom_path = PROMINENCE_DIR / f"{clip_id}.json"

    if not pos_path.exists() or not prom_path.exists():
        return None

    with open(pos_path, encoding="utf-8") as f:
        pos_data = json.load(f)
    with open(prom_path, encoding="utf-8") as f:
        prom_data = json.load(f)

    n = min(len(pos_data), len(prom_data))
    if n == 0:
        return None

    scores = [prom_data[i]["prominence"] for i in range(n)]
    is_content = [1 if pos_data[i]["is_content"] else 0 for i in range(n)]

    # --- Primary: Point-biserial correlation (threshold-free) ---
    r_pb, p_val = pointbiserialr(is_content, scores)
    D_new = 1 - r_pb  # high = more divergence

    # --- Secondary: Otsu-based (for comparison) ---
    th_lo, th_hi = compute_otsu_thresholds(scores)
    hi_words = [(pos_data[i], prom_data[i]) for i in range(n) if scores[i] >= th_hi]
    D1 = sum(1 for p, _ in hi_words if not p["is_content"]) / max(len(hi_words), 1)
    lo_words = [(pos_data[i], prom_data[i]) for i in range(n) if scores[i] < th_lo]
    D2 = sum(1 for p, _ in lo_words if p["is_content"]) / max(len(lo_words), 1)
    D_total = (D1 + D2) / 2

    return {
        "clip_id": clip_id,
        "n_words": n,
        "r_pb": r_pb,
        "p_val": p_val,
        "D_new": D_new,
        "D1": D1,
        "D2": D2,
        "D_total": D_total,
        "group": "HIGH" if clip_id.startswith("H") else "LOW",
    }


def main():
    print("=== Step 6: Divergence Analysis ===\n")
    print(f"{'Clip':<6} | {'Group':<5} | {'r_pb':>6} | {'p-val':>8} | "
          f"{'D_new':>6} | {'D_total(Otsu)':>13}")
    print("-" * 65)

    results = []
    for clip_id in sorted(TALKS.keys()):
        r = compute_divergence(clip_id)
        if r is None:
            print(f"{clip_id:<6} | ---- data missing ----")
            continue
        results.append(r)
        sig = "***" if r["p_val"] < 0.001 else "**" if r["p_val"] < 0.01 else "*" if r["p_val"] < 0.05 else "ns"
        print(f"{r['clip_id']:<6} | {r['group']:<5} | {r['r_pb']:>6.3f} | "
              f"{r['p_val']:>7.4f}{sig:>2} | {r['D_new']:>6.3f} | {r['D_total']:>13.3f}")

    if not results:
        print("\nNo data found. Run steps 4 and 5 first.")
        return

    # Group analysis
    high_group = [r for r in results if r["group"] == "HIGH"]
    low_group = [r for r in results if r["group"] == "LOW"]

    print(f"\n{'='*65}")
    print("\n--- Point-Biserial D_new (threshold-free) ---")
    if high_group:
        h_vals = [r["D_new"] for r in high_group]
        print(f"  HIGH group: {', '.join(f'{v:.3f}' for v in h_vals)}  mean={np.mean(h_vals):.3f}")
    if low_group:
        l_vals = [r["D_new"] for r in low_group]
        print(f"  LOW  group: {', '.join(f'{v:.3f}' for v in l_vals)}  mean={np.mean(l_vals):.3f}")
    if high_group and low_group:
        h_mean = np.mean([r["D_new"] for r in high_group])
        l_mean = np.mean([r["D_new"] for r in low_group])
        diff = h_mean - l_mean
        print(f"  Difference (HIGH - LOW): {diff:+.3f}")

    # Rank all clips by D_new
    ranked = sorted(results, key=lambda r: r["D_new"], reverse=True)
    print("\n--- Rank by D_new (descending = more divergent) ---")
    for i, r in enumerate(ranked):
        marker = "<- HIGH" if r["group"] == "HIGH" else "<- LOW"
        print(f"  {i+1}. {r['clip_id']} D_new={r['D_new']:.3f} (r_pb={r['r_pb']:.3f}) {marker}")

    print("\n--- Interpretation ---")
    print("D_new = 1 - r_pb(is_content, prominence)")
    print("High D_new = ACN prominence does NOT follow content/function pattern")
    print("Low  D_new = ACN prominence follows content/function pattern")


if __name__ == "__main__":
    main()
