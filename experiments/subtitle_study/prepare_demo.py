#!/usr/bin/env python3
"""
prepare_demo.py -- Prepare audio files for the EMS subtitle demo.

Processes any WAV file through Whisper + spaCy + ACN to generate
subtitle JSON data for the demo page.

Usage:
    python prepare_demo.py input.wav                  # single file
    python prepare_demo.py audio1.wav audio2.wav      # multiple files
    python prepare_demo.py --from-pipeline            # copy TED clips
"""

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

DEMO_DATA_DIR = Path(__file__).resolve().parent / "demo_data"
SCRIPT_DIR = Path(__file__).resolve().parent
VENV_PYTHON = SCRIPT_DIR / ".venv" / "Scripts" / "python.exe"

# Use venv python if available, else system python
PYTHON = str(VENV_PYTHON) if VENV_PYTHON.exists() else sys.executable

CONTENT_POS = {"NOUN", "VERB", "ADJ", "ADV", "PROPN"}


def ensure_imports():
    """Lazy import heavy modules."""
    global whisper_timestamped, spacy, np, librosa, sf
    import numpy as np
    try:
        import whisper_timestamped
    except ImportError:
        print("[FAIL] whisper-timestamped not installed")
        sys.exit(1)
    try:
        import spacy
    except ImportError:
        print("[FAIL] spacy not installed")
        sys.exit(1)
    return np


def process_audio(audio_path: Path, name: str = None,
                  whisper_model: str = "medium") -> bool:
    """Process a single audio file to generate demo data."""
    import numpy as np

    if not audio_path.exists():
        print(f"  [FAIL] File not found: {audio_path}")
        return False

    if name is None:
        name = audio_path.stem

    out_dir = DEMO_DATA_DIR / name
    out_dir.mkdir(parents=True, exist_ok=True)

    # Check if already processed
    if (out_dir / "subtitle.json").exists():
        print(f"  [OK] Already processed: {name}")
        return True

    print(f"\n  Processing: {name}")
    print(f"  Source: {audio_path}")

    # 1. Convert to 16kHz mono WAV for Whisper
    wav_16k = out_dir / "audio_16k.wav"
    if not wav_16k.exists():
        print("  -> Converting to 16kHz mono...")
        cmd = ["ffmpeg", "-y", "-i", str(audio_path),
               "-ac", "1", "-ar", "16000", "-sample_fmt", "s16",
               str(wav_16k)]
        subprocess.run(cmd, capture_output=True)

    # 2. Copy original for playback (or convert to usable format)
    wav_play = out_dir / "audio.wav"
    if not wav_play.exists():
        if audio_path.suffix.lower() == ".wav":
            shutil.copy2(audio_path, wav_play)
        else:
            cmd = ["ffmpeg", "-y", "-i", str(audio_path),
                   "-ac", "1", "-ar", "48000", str(wav_play)]
            subprocess.run(cmd, capture_output=True)

    # 3. Whisper alignment
    align_path = out_dir / "align.json"
    if not align_path.exists():
        print("  -> Running Whisper alignment...")
        import whisper_timestamped as whisper
        model = whisper.load_model(whisper_model, device="cpu")
        audio = whisper.load_audio(str(wav_16k))
        result = whisper.transcribe(model, audio, language="en")

        words = []
        for seg in result.get("segments", []):
            for w in seg.get("words", []):
                words.append({
                    "word": w["text"].strip(),
                    "start": round(w["start"], 3),
                    "end": round(w["end"], 3),
                    "confidence": round(w.get("confidence", 1.0), 3),
                })

        with open(align_path, "w", encoding="utf-8") as f:
            json.dump(words, f, indent=2, ensure_ascii=False)
        print(f"     {len(words)} words aligned")
    else:
        with open(align_path, encoding="utf-8") as f:
            words = json.load(f)

    # 4. POS tagging
    pos_path = out_dir / "pos.json"
    if not pos_path.exists():
        print("  -> POS tagging...")
        import spacy
        nlp = spacy.load("en_core_web_sm")
        full_text = " ".join(w["word"] for w in words)
        doc = nlp(full_text)

        char_to_pos = {}
        for tok in doc:
            for i in range(tok.idx, tok.idx + len(tok.text)):
                char_to_pos[i] = tok.pos_

        result_pos = []
        char_offset = 0
        for w in words:
            pos_in_text = full_text.find(w["word"], char_offset)
            if pos_in_text >= 0:
                pos = char_to_pos.get(pos_in_text, "X")
                char_offset = pos_in_text + len(w["word"])
            else:
                single_doc = nlp(w["word"])
                pos = single_doc[0].pos_ if len(single_doc) > 0 else "X"

            is_content = pos in CONTENT_POS
            result_pos.append({
                "word": w["word"],
                "start": w["start"],
                "end": w["end"],
                "pos": pos,
                "is_content": is_content,
            })

        with open(pos_path, "w", encoding="utf-8") as f:
            json.dump(result_pos, f, indent=2, ensure_ascii=False)
        n_content = sum(1 for r in result_pos if r["is_content"])
        print(f"     {n_content}/{len(result_pos)} content words")
    else:
        with open(pos_path, encoding="utf-8") as f:
            result_pos = json.load(f)

    # 5. ACN prominence (simple acoustic features)
    prom_path = out_dir / "prominence.json"
    if not prom_path.exists():
        print("  -> ACN prominence scoring...")
        import soundfile as sf
        import librosa

        audio_data, sr = sf.read(str(wav_16k))
        result_prom = []

        for i, w in enumerate(words):
            s = int(w["start"] * sr)
            e = int(w["end"] * sr)
            if e <= s or s >= len(audio_data):
                result_prom.append({**w, "prominence": 0.5})
                continue

            seg = audio_data[s:min(e, len(audio_data))]
            duration = len(seg) / sr

            # Simple acoustic cues
            log_dur = np.log(max(duration, 1e-6))
            rms = np.sqrt(np.mean(seg ** 2))
            log_energy = np.log(max(rms, 1e-6))

            try:
                mfcc = librosa.feature.mfcc(y=seg.astype(np.float32),
                                             sr=sr, n_mfcc=3,
                                             n_fft=min(512, len(seg)))
                mfcc0_mean = float(np.mean(mfcc[0]))
            except Exception:
                mfcc0_mean = 0.0

            # Normalize to [0, 1] range using sigmoid-like
            raw = 0.4 * log_dur + 0.3 * log_energy + 0.3 * (mfcc0_mean / 50.0)
            prominence = 1.0 / (1.0 + np.exp(-raw - 1.5))
            prominence = float(np.clip(prominence, 0.0, 1.0))

            result_prom.append({
                "word": w["word"],
                "start": w["start"],
                "end": w["end"],
                "prominence": round(prominence, 4),
            })

        with open(prom_path, "w", encoding="utf-8") as f:
            json.dump(result_prom, f, indent=2, ensure_ascii=False)
        scores = [p["prominence"] for p in result_prom]
        print(f"     mean={np.mean(scores):.3f}, std={np.std(scores):.3f}")
    else:
        with open(prom_path, encoding="utf-8") as f:
            result_prom = json.load(f)

    # 6. Generate subtitle JSON (4 conditions)
    sub_path = out_dir / "subtitle.json"
    if not sub_path.exists():
        print("  -> Generating subtitle JSON...")
        subtitle = {"conditions": {}}

        for cond in ["normal", "syntactic", "prosody", "syn_prosody"]:
            cond_words = []
            for i, w in enumerate(words):
                pos_info = result_pos[i] if i < len(result_pos) else {}
                prom_info = result_prom[i] if i < len(result_prom) else {}
                is_content = pos_info.get("is_content", False)
                prom = prom_info.get("prominence", 0.5)

                if cond == "normal":
                    fs, fw = 16, 400
                elif cond == "syntactic":
                    fs = 18 if is_content else 12
                    fw = 600 if is_content else 300
                elif cond == "prosody":
                    if prom >= 0.6:
                        fs, fw = 20, 700
                    elif prom >= 0.45:
                        fs, fw = 15, 400
                    else:
                        fs, fw = 11, 300
                else:  # syn_prosody
                    if is_content and prom >= 0.55:
                        fs, fw = 20, 700
                    elif is_content:
                        fs, fw = 16, 500
                    else:
                        fs, fw = 12, 300

                cond_words.append({
                    "text": w["word"],
                    "start": w["start"],
                    "end": w["end"],
                    "font_size": fs,
                    "font_weight": fw,
                    "prominence": prom,
                    "is_content": is_content,
                    "pos": pos_info.get("pos", "X"),
                })

            subtitle["conditions"][cond] = cond_words

        with open(sub_path, "w", encoding="utf-8") as f:
            json.dump(subtitle, f, indent=2, ensure_ascii=False)
        print(f"     4 conditions generated")

    # 7. Write metadata
    meta_path = out_dir / "meta.json"
    import soundfile as sf_meta
    info = sf_meta.info(str(wav_16k))
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump({
            "name": name,
            "duration": round(info.duration, 1),
            "words": len(words),
            "source": str(audio_path.name),
        }, f, indent=2)

    print(f"  [OK] {name} -> demo_data/{name}/")
    return True


def copy_from_pipeline():
    """Copy pre-processed TED clips from the subtitle study pipeline."""
    from config import TALKS, CLIPS_DIR, ALIGNMENT_DIR, POS_DIR, PROMINENCE_DIR, SUBTITLES_DIR

    print("=== Copying from subtitle study pipeline ===\n")

    for cid, info in TALKS.items():
        out_dir = DEMO_DATA_DIR / cid
        out_dir.mkdir(parents=True, exist_ok=True)

        clip_wav = CLIPS_DIR / f"{cid}.wav"
        if not clip_wav.exists():
            print(f"  [SKIP] {cid}: clip not found")
            continue

        # Copy audio
        dst_audio = out_dir / "audio.wav"
        if not dst_audio.exists():
            shutil.copy2(clip_wav, dst_audio)

        # Copy alignment
        src_align = ALIGNMENT_DIR / f"{cid}.json"
        if src_align.exists():
            shutil.copy2(src_align, out_dir / "align.json")

        # Copy POS
        src_pos = POS_DIR / f"{cid}.json"
        if src_pos.exists():
            shutil.copy2(src_pos, out_dir / "pos.json")

        # Copy prominence
        src_prom = PROMINENCE_DIR / f"{cid}.json"
        if src_prom.exists():
            shutil.copy2(src_prom, out_dir / "prominence.json")

        # Build unified subtitle JSON from separate condition files
        sub_path = out_dir / "subtitle.json"
        if not sub_path.exists():
            subtitle = {"conditions": {}}
            with open(out_dir / "prominence.json", encoding="utf-8") as f:
                prom_data = json.load(f)
            with open(out_dir / "pos.json", encoding="utf-8") as f:
                pos_data = json.load(f)
            with open(out_dir / "align.json", encoding="utf-8") as f:
                align_data = json.load(f)

            for cond in ["normal", "syntactic", "prosody", "syn_prosody"]:
                src_sub = SUBTITLES_DIR / f"{cid}_{cond}.json"
                if src_sub.exists():
                    with open(src_sub, encoding="utf-8") as f:
                        sub_data = json.load(f)
                    # Flatten chunks into word list
                    cond_words = []
                    for chunk in sub_data.get("chunks", []):
                        for w in chunk.get("words", []):
                            # Find matching prominence/POS
                            idx = next((j for j, a in enumerate(align_data)
                                        if abs(a["start"] - w["start"]) < 0.01), -1)
                            prom = prom_data[idx]["prominence"] if 0 <= idx < len(prom_data) else 0.5
                            is_content = pos_data[idx]["is_content"] if 0 <= idx < len(pos_data) else False
                            pos = pos_data[idx]["pos"] if 0 <= idx < len(pos_data) else "X"
                            cond_words.append({
                                "text": w["text"],
                                "start": w["start"],
                                "end": w["end"],
                                "font_size": w["font_size"],
                                "font_weight": w["font_weight"],
                                "prominence": prom,
                                "is_content": is_content,
                                "pos": pos,
                            })
                    subtitle["conditions"][cond] = cond_words

            with open(sub_path, "w", encoding="utf-8") as f:
                json.dump(subtitle, f, indent=2, ensure_ascii=False)

        # Write metadata
        meta_path = out_dir / "meta.json"
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump({
                "name": cid,
                "speaker": info["speaker"],
                "title": info["title"],
                "year": info["year"],
                "note": info.get("note", ""),
                "group": info.get("group", ""),
                "duration": 90.0,
                "words": len(json.load(open(out_dir / "align.json"))),
                "source": f"{cid}.wav",
            }, f, indent=2, ensure_ascii=False)

        print(f"  [OK] {cid}: {info['speaker']} - {info['title']}")

    # Write manifest
    manifest = []
    for d in sorted(DEMO_DATA_DIR.iterdir()):
        meta_file = d / "meta.json"
        if meta_file.exists():
            with open(meta_file, encoding="utf-8") as f:
                manifest.append(json.load(f))

    with open(DEMO_DATA_DIR / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print(f"\n=== Done: {len(manifest)} clips in demo_data/ ===")


def main():
    parser = argparse.ArgumentParser(description="Prepare audio for EMS subtitle demo")
    parser.add_argument("files", nargs="*", help="Audio files to process")
    parser.add_argument("--from-pipeline", action="store_true",
                        help="Copy pre-processed TED clips from pipeline")
    parser.add_argument("--whisper-model", default="medium",
                        help="Whisper model size (default: medium)")
    args = parser.parse_args()

    DEMO_DATA_DIR.mkdir(parents=True, exist_ok=True)

    if args.from_pipeline:
        copy_from_pipeline()
        return

    if not args.files:
        print("Usage: python prepare_demo.py input.wav [input2.wav ...]")
        print("       python prepare_demo.py --from-pipeline")
        sys.exit(1)

    ensure_imports()
    import numpy as np

    for fpath in args.files:
        p = Path(fpath)
        if p.is_dir():
            wavs = list(p.glob("*.wav")) + list(p.glob("*.mp3"))
            for wav in sorted(wavs):
                process_audio(wav, whisper_model=args.whisper_model)
        else:
            process_audio(p, whisper_model=args.whisper_model)

    # Update manifest
    manifest = []
    for d in sorted(DEMO_DATA_DIR.iterdir()):
        meta_file = d / "meta.json"
        if meta_file.exists():
            with open(meta_file, encoding="utf-8") as f:
                manifest.append(json.load(f))

    with open(DEMO_DATA_DIR / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print(f"\n=== Updated manifest: {len(manifest)} clips ===")


if __name__ == "__main__":
    main()
