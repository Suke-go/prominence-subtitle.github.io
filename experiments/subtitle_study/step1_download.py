#!/usr/bin/env python3
"""
step1_download.py -- Download TED talk audio (and optionally video) via yt-dlp.

Usage:
    python step1_download.py                    # all 6 talks, audio only
    python step1_download.py --video            # all 6 talks, audio + video
    python step1_download.py --clip H1 --video  # single talk with video
"""

import argparse
import sys
from pathlib import Path
from config import TALKS, DOWNLOADS_DIR, ensure_dirs, get_clip_ids


def download_talk(clip_id: str, info: dict) -> bool:
    """Download a single TED talk audio via yt-dlp Python API."""
    out_path = DOWNLOADS_DIR / f"{clip_id}.wav"

    if out_path.exists():
        print(f"  [OK] Already downloaded: {out_path.name}")
        return True

    url = info["url"]
    print(f"  Downloading audio: {info['speaker']} - {info['title']} ({info['year']})")
    print(f"  URL: {url}")

    try:
        import yt_dlp
    except ImportError:
        print("  [FAIL] yt-dlp not installed. Run: pip install yt-dlp")
        return False

    # yt-dlp options: audio-only, wav output, medium quality
    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': str(DOWNLOADS_DIR / f"{clip_id}.%(ext)s"),
        'noplaylist': True,
        'quiet': False,
        'no_warnings': True,
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'wav',
            'preferredquality': '5',
        }],
    }

    # Try TED URL first, then YouTube search
    urls_to_try = [
        url,
        f"ytsearch1:{info['speaker']} {info['title']} TED talk",
    ]

    for attempt, try_url in enumerate(urls_to_try):
        if attempt > 0:
            print(f"  Trying YouTube search fallback...")
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([try_url])

            # Check output
            if out_path.exists():
                size_mb = out_path.stat().st_size / (1024 * 1024)
                print(f"  -> {out_path.name} ({size_mb:.1f} MB)")
                return True

            # yt-dlp may have created a different extension before postprocessing
            candidates = list(DOWNLOADS_DIR.glob(f"{clip_id}.*"))
            wav_candidates = [c for c in candidates if c.suffix == '.wav']
            if wav_candidates:
                # Rename if needed
                if wav_candidates[0] != out_path:
                    wav_candidates[0].rename(out_path)
                size_mb = out_path.stat().st_size / (1024 * 1024)
                print(f"  -> {out_path.name} ({size_mb:.1f} MB)")
                return True

            if candidates:
                # Non-wav file exists, convert with ffmpeg
                import subprocess
                actual = candidates[0]
                print(f"  Converting {actual.name} to WAV...")
                cmd = [
                    "ffmpeg", "-y", "-i", str(actual),
                    "-ac", "1", "-ar", "16000",
                    str(out_path),
                ]
                subprocess.run(cmd, capture_output=True)
                if out_path.exists():
                    actual.unlink()
                    return True

        except Exception as e:
            print(f"  [FAIL] {e}")
            continue

    print(f"  [FAIL] All download attempts failed for {clip_id}")
    return False


def download_video(clip_id: str, info: dict) -> bool:
    """Download video (MP4, ≤540p) for experiment overlay."""
    out_path = DOWNLOADS_DIR / f"{clip_id}.mp4"

    if out_path.exists():
        print(f"  [OK] Video already downloaded: {out_path.name}")
        return True

    url = info["url"]
    print(f"  Downloading video: {info['speaker']} - {info['title']}")

    try:
        import yt_dlp
    except ImportError:
        print("  [FAIL] yt-dlp not installed. Run: pip install yt-dlp")
        return False

    ydl_opts = {
        'format': 'bestvideo[height<=540]+bestaudio/best[height<=540]/best',
        'outtmpl': str(DOWNLOADS_DIR / f"{clip_id}_video.%(ext)s"),
        'noplaylist': True,
        'quiet': False,
        'no_warnings': True,
        'merge_output_format': 'mp4',
        'postprocessors': [{
            'key': 'FFmpegVideoConvertor',
            'preferedformat': 'mp4',
        }],
        # Disable subtitles from source
        'writesubtitles': False,
        'writeautomaticsub': False,
    }

    urls_to_try = [
        url,
        f"ytsearch1:{info['speaker']} {info['title']} TED talk",
    ]

    for attempt, try_url in enumerate(urls_to_try):
        if attempt > 0:
            print(f"  Trying YouTube search fallback...")
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([try_url])

            # Find the downloaded file and rename
            candidates = list(DOWNLOADS_DIR.glob(f"{clip_id}_video.*"))
            mp4_candidates = [c for c in candidates if c.suffix == '.mp4']
            if mp4_candidates:
                mp4_candidates[0].rename(out_path)
                size_mb = out_path.stat().st_size / (1024 * 1024)
                print(f"  -> {out_path.name} ({size_mb:.1f} MB)")
                return True

            # Convert non-mp4
            if candidates:
                import subprocess
                actual = candidates[0]
                print(f"  Converting {actual.name} to MP4...")
                cmd = [
                    "ffmpeg", "-y", "-i", str(actual),
                    "-vf", "scale=-2:540",
                    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                    "-c:a", "aac", "-b:a", "128k",
                    str(out_path),
                ]
                subprocess.run(cmd, capture_output=True)
                if out_path.exists():
                    actual.unlink()
                    return True

        except Exception as e:
            print(f"  [FAIL] {e}")
            continue

    print(f"  [FAIL] Video download failed for {clip_id}")
    return False


def main():
    parser = argparse.ArgumentParser(description="Download TED talk audio (and video)")
    parser.add_argument("--clip", default=None, help="Clip ID(s), e.g. H1 or H1,H2")
    parser.add_argument("--video", action="store_true", help="Also download video (MP4, 540p)")
    args = parser.parse_args()

    ensure_dirs()
    clip_ids = get_clip_ids(args.clip)

    mode = "audio + video" if args.video else "audio only"
    print(f"=== Step 1: Download TED Talks ({len(clip_ids)} talks, {mode}) ===\n")

    success, fail = 0, 0
    for cid in clip_ids:
        info = TALKS[cid]
        print(f"\n--- {cid}: {info['speaker']} ---")
        if download_talk(cid, info):
            success += 1
        else:
            fail += 1

        if args.video:
            if not download_video(cid, info):
                fail += 1

    print(f"\n=== Done: {success} downloaded, {fail} failed ===")
    if fail > 0:
        print("Fix failed downloads before proceeding to step 2.")
        sys.exit(1)


if __name__ == "__main__":
    main()
