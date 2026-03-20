#!/usr/bin/env python3
"""
step4_pos_tagging.py - spaCy POS tagging + Dynamik content/function classification.

Content words (NOUN, VERB, ADJ, ADV) get larger font in the Dynamik-style condition.

Usage:
    python step4_pos_tagging.py              # all clips
    python step4_pos_tagging.py --clip H1    # single clip
"""

import argparse
import json
import sys
from config import ALIGNMENT_DIR, POS_DIR, CONTENT_POS, ensure_dirs, get_clip_ids


def tag_clip(clip_id: str, nlp) -> bool:
    """POS-tag a single clip's aligned words."""
    json_path = ALIGNMENT_DIR / f"{clip_id}.json"
    out_path = POS_DIR / f"{clip_id}.json"

    if out_path.exists():
        print(f"  [OK] Already tagged: {out_path.name}")
        return True

    if not json_path.exists():
        print(f"  [FAIL] Alignment not found: {json_path}")
        print(f"    Run step3_align_words.py first")
        return False

    with open(json_path, encoding="utf-8") as f:
        words = json.load(f)

    # Build full text and process with spaCy
    full_text = " ".join(w["word"] for w in words)
    doc = nlp(full_text)

    # Build a character-offset to POS map from spaCy
    char_to_pos = {}
    for tok in doc:
        for i in range(tok.idx, tok.idx + len(tok.text)):
            char_to_pos[i] = tok.pos_

    # Map each Whisper word to its POS by finding it in the full text
    result = []
    char_offset = 0

    for w in words:
        word_text = w["word"]
        # Find position of this word in the full text
        pos_in_text = full_text.find(word_text, char_offset)
        if pos_in_text >= 0:
            # Get POS at the start of this word
            pos = char_to_pos.get(pos_in_text, "X")
            char_offset = pos_in_text + len(word_text)
        else:
            # Fallback: process word individually
            single_doc = nlp(word_text)
            pos = single_doc[0].pos_ if len(single_doc) > 0 else "X"

        is_content = pos in CONTENT_POS
        result.append({
            "word": w["word"],
            "start": w["start"],
            "end": w["end"],
            "pos": pos,
            "is_content": is_content,
            "dynamik_size": 18 if is_content else 12,
        })

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    n_content = sum(1 for r in result if r["is_content"])
    n_func = len(result) - n_content
    pct = n_func / len(result) * 100 if result else 0
    print(f"  {len(result)} words: content={n_content}, function={n_func} ({pct:.0f}% function)")
    print(f"  -> {out_path.name}")

    # Dynamik paper expects ~40% function words
    if pct < 25 or pct > 60:
        print(f"  [WARN] Function word ratio ({pct:.0f}%) outside expected range (25-60%)")

    return True


def main():
    parser = argparse.ArgumentParser(description="POS tagging with spaCy")
    parser.add_argument("--clip", default=None, help="Clip ID(s)")
    args = parser.parse_args()

    ensure_dirs()
    clip_ids = get_clip_ids(args.clip)

    import spacy
    print("Loading spaCy model (en_core_web_sm)...")
    nlp = spacy.load("en_core_web_sm")
    print("Model loaded.\n")

    print(f"=== Step 4: POS Tagging ({len(clip_ids)} clips) ===\n")

    success, fail = 0, 0
    for cid in clip_ids:
        print(f"\n--- {cid} ---")
        if tag_clip(cid, nlp):
            success += 1
        else:
            fail += 1

    print(f"\n=== Done: {success} tagged, {fail} failed ===")
    if fail > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
