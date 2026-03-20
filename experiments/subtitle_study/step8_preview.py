#!/usr/bin/env python3
"""
step8_preview.py - Generate HTML preview pages for visual verification.

Creates self-contained HTML files with synchronized subtitle display
across all 4 conditions, with audio playback.

Usage:
    python step8_preview.py              # all clips
    python step8_preview.py --clip H1    # single clip
"""

import argparse
import json
import sys
import base64
from pathlib import Path
from config import (CLIPS_DIR, SUBTITLES_DIR, PREVIEW_DIR, CONDITIONS,
                    TALKS, ensure_dirs, get_clip_ids)


HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{clip_id} - Subtitle Preview ({speaker})</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    font-family: 'Segoe UI', 'Helvetica Neue', sans-serif;
    background: #0a0a0a; color: #e0e0e0;
    display: flex; flex-direction: column; align-items: center;
    min-height: 100vh; padding: 20px;
  }}
  h1 {{
    font-size: 1.4rem; margin-bottom: 8px; color: #90caf9;
  }}
  .meta {{
    font-size: 0.85rem; color: #888; margin-bottom: 16px;
  }}
  .audio-row {{
    margin-bottom: 20px;
  }}
  audio {{ width: 500px; }}
  .grid {{
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 16px; max-width: 1000px; width: 100%;
  }}
  .condition-box {{
    background: #1a1a2e; border-radius: 10px; padding: 16px;
    border: 1px solid #333;
  }}
  .condition-label {{
    font-size: 0.75rem; text-transform: uppercase;
    letter-spacing: 1px; color: #64b5f6; margin-bottom: 10px;
    font-weight: 600;
  }}
  .subtitle-area {{
    min-height: 80px; display: flex; flex-wrap: wrap;
    align-items: baseline; gap: 4px; line-height: 1.6;
  }}
  .word {{
    transition: color 0.15s, opacity 0.15s;
    opacity: 0.35;
  }}
  .word.active {{
    opacity: 1; color: #fff;
  }}
  .word.past {{
    opacity: 0.6; color: #aaa;
  }}
  .controls {{
    margin-top: 16px; display: flex; gap: 12px; align-items: center;
    font-size: 0.8rem; color: #888;
  }}
  .time-display {{
    font-family: monospace; font-size: 0.9rem; color: #64b5f6;
  }}
</style>
</head>
<body>
  <h1>{clip_id}: {speaker} - {title}</h1>
  <p class="meta">{year} | {note}</p>

  <div class="audio-row">
    <audio id="player" controls src="{audio_src}"></audio>
  </div>

  <div class="controls">
    <span class="time-display" id="timeDisplay">0:00.0 / 0:00.0</span>
  </div>

  <div class="grid" id="grid">
    {condition_boxes}
  </div>

<script>
const subtitleData = {subtitle_data_json};
const player = document.getElementById('player');
const timeDisplay = document.getElementById('timeDisplay');

function formatTime(s) {{
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}}

function updateSubtitles() {{
  const t = player.currentTime;
  timeDisplay.textContent = formatTime(t) + ' / ' + formatTime(player.duration || 0);

  for (const cond of Object.keys(subtitleData)) {{
    const words = subtitleData[cond];
    for (const w of words) {{
      const el = document.getElementById(w.id);
      if (!el) continue;
      if (t >= w.start && t <= w.end) {{
        el.className = 'word active';
      }} else if (t > w.end) {{
        el.className = 'word past';
      }} else {{
        el.className = 'word';
      }}
    }}
  }}
  requestAnimationFrame(updateSubtitles);
}}

player.addEventListener('play', () => requestAnimationFrame(updateSubtitles));
// Initial render
requestAnimationFrame(updateSubtitles);
</script>
</body>
</html>"""


def generate_preview(clip_id: str) -> bool:
    """Generate an HTML preview file for a clip."""
    info = TALKS.get(clip_id, {})
    out_path = PREVIEW_DIR / f"{clip_id}.html"

    # Check subtitle files exist
    subtitle_data = {}
    for cond in CONDITIONS:
        sub_path = SUBTITLES_DIR / f"{clip_id}_{cond}.json"
        if not sub_path.exists():
            print(f"  [FAIL] Subtitle file not found: {sub_path.name}")
            return False
        with open(sub_path, encoding="utf-8") as f:
            subtitle_data[cond] = json.load(f)

    # Audio source (relative path)
    audio_path = CLIPS_DIR / f"{clip_id}.wav"
    audio_src = f"../clips/{clip_id}.wav"
    if not audio_path.exists():
        print(f"  [WARN] Audio file not found: {audio_path.name} (preview will lack audio)")

    # Build condition boxes HTML
    condition_boxes = []
    flat_data = {}  # for JS: {condition: [{id, start, end}, ...]}

    for cond in CONDITIONS:
        words_html = []
        flat_words = []
        for chunk in subtitle_data[cond]["chunks"]:
            for i, w in enumerate(chunk["words"]):
                word_id = f"{cond}_{w['start']:.3f}"
                fs = w["font_size"]
                fw = w["font_weight"]
                words_html.append(
                    f'<span class="word" id="{word_id}" '
                    f'style="font-size:{fs}px;font-weight:{fw}">'
                    f'{w["text"]}</span>'
                )
                flat_words.append({
                    "id": word_id,
                    "start": w["start"],
                    "end": w["end"],
                })
        flat_data[cond] = flat_words

        cond_label = {
            "normal": "Normal (uniform)",
            "syntactic": "Syntactic (Dynamik)",
            "prosody": "Prosody (ACN)",
            "syn_prosody": "Syntax × Prosody",
        }.get(cond, cond)

        box = f"""<div class="condition-box">
      <div class="condition-label">{cond_label}</div>
      <div class="subtitle-area">
        {" ".join(words_html)}
      </div>
    </div>"""
        condition_boxes.append(box)

    html = HTML_TEMPLATE.format(
        clip_id=clip_id,
        speaker=info.get("speaker", "Unknown"),
        title=info.get("title", ""),
        year=info.get("year", ""),
        note=info.get("note", ""),
        audio_src=audio_src,
        condition_boxes="\n    ".join(condition_boxes),
        subtitle_data_json=json.dumps(flat_data),
    )

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"  -> {out_path.name}")
    print(f"    Open in browser: file:///{out_path.as_posix()}")
    return True


def main():
    parser = argparse.ArgumentParser(description="Generate HTML preview pages")
    parser.add_argument("--clip", default=None, help="Clip ID(s)")
    args = parser.parse_args()

    ensure_dirs()
    clip_ids = get_clip_ids(args.clip)

    print(f"=== Step 8: HTML Preview ({len(clip_ids)} clips) ===\n")

    success, fail = 0, 0
    for cid in clip_ids:
        print(f"\n--- {cid} ---")
        if generate_preview(cid):
            success += 1
        else:
            fail += 1

    print(f"\n=== Done: {success} preview pages generated ===")
    print(f"Output: {PREVIEW_DIR}/")
    if fail > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
