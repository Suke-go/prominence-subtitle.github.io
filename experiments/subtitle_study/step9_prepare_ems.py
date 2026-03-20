#!/usr/bin/env python3
"""
step9_prepare_ems.py -- Generate EMS stereo WAV files from ACN prominence data.

Reads the clip WAV + ACN prominence JSON (from step5) and produces
a stereo WAV file:
  L channel = original audio (48kHz for playback quality)
  R channel = EMS carrier signal (triggered at prominent words)

Hardware setup:
  PC -> USB-C audio adapter -> stereo splitter
    L -> headphone/speaker
    R -> EMS electrode pad

Usage:
    python step9_prepare_ems.py              # all clips
    python step9_prepare_ems.py --clip H1    # single clip
    python step9_prepare_ems.py --threshold 0.55 --pulse-ms 120
"""

import argparse
import json
import math
import struct
import subprocess
import sys
import tempfile
import os
from pathlib import Path
from config import (CLIPS_DIR, PROMINENCE_DIR, TALKS,
                    ensure_dirs, get_clip_ids)

# ── EMS Parameters ──
EMS_SAMPLE_RATE = 48000       # 48kHz for output (better for analog EMS)
CARRIER_FREQ_DEFAULT = 4000   # Hz (biphasic carrier)
PULSE_DURATION_MS = 100       # ms per pulse
ATTACK_MS = 5                 # ms ramp up
DECAY_MS = 20                 # ms ramp down
EMS_AMPLITUDE = 0.8           # max amplitude [0, 1]
PROMINENCE_THRESHOLD = 0.55   # Words above this trigger EMS

# ── Output directory ──
EMS_DIR = Path(__file__).resolve().parent / "ems_output"


def resample_to_48k(clip_path: Path) -> Path:
    """Resample clip WAV to 48kHz mono for EMS output."""
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    cmd = [
        "ffmpeg", "-y", "-i", str(clip_path),
        "-ac", "1", "-ar", str(EMS_SAMPLE_RATE),
        "-sample_fmt", "s16", "-f", "wav", tmp.name,
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace")
        print(f"  [FAIL] ffmpeg resample failed: {stderr[:200]}")
        return None
    return Path(tmp.name)


def read_wav_mono(path: Path):
    """Read a mono 16-bit WAV file, return (samples_float_list, sample_rate)."""
    with open(path, "rb") as f:
        data = f.read()
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("Not a valid WAV file")
    pos = 12
    fmt_found = False
    sr = 0
    while pos < len(data) - 8:
        chunk_id = data[pos:pos + 4]
        chunk_size = struct.unpack_from("<I", data, pos + 4)[0]
        if chunk_id == b"fmt ":
            fmt = struct.unpack_from("<HHIIHH", data, pos + 8)
            _, _, sr, _, _, _ = fmt
            fmt_found = True
        elif chunk_id == b"data" and fmt_found:
            pcm_data = data[pos + 8:pos + 8 + chunk_size]
            break
        pos += 8 + chunk_size
    else:
        raise ValueError("Missing data chunk")
    n_samples = len(pcm_data) // 2
    samples = struct.unpack(f"<{n_samples}h", pcm_data)
    return [s / 32768.0 for s in samples], sr


def write_stereo_wav(path: Path, left: list, right: list, sr: int):
    """Write a stereo 16-bit WAV file."""
    n = min(len(left), len(right))
    pcm = bytearray(n * 4)
    for i in range(n):
        l_val = max(-1.0, min(1.0, left[i]))
        r_val = max(-1.0, min(1.0, right[i]))
        struct.pack_into("<hh", pcm, i * 4,
                         int(l_val * 32767), int(r_val * 32767))
    data_size = len(pcm)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 36 + data_size, b"WAVE",
        b"fmt ", 16,
        1, 2, sr, sr * 4, 4, 16,
        b"data", data_size,
    )
    with open(path, "wb") as f:
        f.write(header)
        f.write(pcm)


def generate_ems_from_prominence(n_samples: int, sr: int,
                                  words: list, threshold: float,
                                  carrier_freq: float, pulse_ms: float):
    """Generate EMS carrier signal from ACN word-level prominence.

    Each word above threshold triggers a pulse burst centered on the word.
    Higher prominence = stronger pulse.
    """
    ems = [0.0] * n_samples
    pulse_samples = int(pulse_ms / 1000.0 * sr)
    attack_samples = int(ATTACK_MS / 1000.0 * sr)
    decay_samples = int(DECAY_MS / 1000.0 * sr)
    two_pi = 2.0 * math.pi
    triggered = 0

    for w in words:
        score = w["prominence"]
        if score < threshold:
            continue

        triggered += 1
        # Center pulse on word midpoint
        word_mid = (w["start"] + w["end"]) / 2.0
        center = int(word_mid * sr)
        start = max(0, center - pulse_samples // 4)
        end = min(n_samples, start + pulse_samples)

        # Intensity: higher prominence -> stronger
        intensity = min(1.0, (score - threshold) / (1.0 - threshold) * 0.7 + 0.3)

        for i in range(start, end):
            elapsed = i - start
            total = end - start

            # Envelope (attack/sustain/decay)
            if elapsed < attack_samples and attack_samples > 0:
                env = elapsed / attack_samples
            elif elapsed >= total - decay_samples and decay_samples > 0:
                decay_elapsed = elapsed - (total - decay_samples)
                env = 1.0 - decay_elapsed / decay_samples
            else:
                env = 1.0

            # Biphasic carrier
            phase = two_pi * carrier_freq * elapsed / sr
            p = (phase % two_pi) / two_pi
            if p < 0.25:
                carrier = 1.0
            elif p < 0.5:
                carrier = -1.0
            else:
                carrier = 0.0

            ems[i] += carrier * env * intensity * EMS_AMPLITUDE
            if ems[i] > 1.0:
                ems[i] = 1.0
            elif ems[i] < -1.0:
                ems[i] = -1.0

    return ems, triggered


def process_clip(clip_id: str, threshold: float,
                 carrier_freq: float, pulse_ms: float) -> bool:
    """Generate EMS stereo WAV for one clip."""
    clip_path = CLIPS_DIR / f"{clip_id}.wav"
    prom_path = PROMINENCE_DIR / f"{clip_id}.json"
    out_path = EMS_DIR / f"{clip_id}_ems.wav"

    if out_path.exists():
        print(f"  [OK] Already exists: {out_path.name}")
        return True

    if not clip_path.exists():
        print(f"  [FAIL] Clip not found: {clip_path}")
        return False
    if not prom_path.exists():
        print(f"  [FAIL] Prominence data not found: {prom_path}")
        return False

    # Load prominence data
    with open(prom_path, encoding="utf-8") as f:
        words = json.load(f)

    # Resample clip to 48kHz
    print(f"  Resampling to {EMS_SAMPLE_RATE}Hz...")
    tmp_wav = resample_to_48k(clip_path)
    if tmp_wav is None:
        return False

    try:
        samples, sr = read_wav_mono(tmp_wav)
    finally:
        os.unlink(tmp_wav)

    n_samples = len(samples)
    duration = n_samples / sr
    print(f"  Audio: {n_samples} samples ({duration:.1f}s @ {sr}Hz)")

    # Scale word times from clip's 16kHz domain (times are in seconds, so they work directly)
    # Generate EMS channel
    ems_signal, triggered = generate_ems_from_prominence(
        n_samples, sr, words, threshold, carrier_freq, pulse_ms
    )

    n_prominent = sum(1 for w in words if w["prominence"] >= threshold)
    print(f"  Words: {len(words)} total, {n_prominent} above threshold ({threshold:.2f})")
    print(f"  EMS triggers: {triggered}")

    # Write stereo WAV
    write_stereo_wav(out_path, samples, ems_signal, sr)
    size_mb = out_path.stat().st_size / (1024 * 1024)
    print(f"  -> {out_path.name} ({size_mb:.1f} MB)")
    print(f"     L=audio, R=EMS carrier ({carrier_freq}Hz, {pulse_ms}ms pulse)")

    return True


def main():
    parser = argparse.ArgumentParser(
        description="Generate EMS stereo WAV from ACN prominence"
    )
    parser.add_argument("--clip", default=None, help="Clip ID(s)")
    parser.add_argument("--threshold", type=float, default=PROMINENCE_THRESHOLD,
                        help=f"Prominence threshold (default: {PROMINENCE_THRESHOLD})")
    parser.add_argument("--carrier-freq", type=float, default=CARRIER_FREQ_DEFAULT,
                        help=f"Carrier frequency Hz (default: {CARRIER_FREQ_DEFAULT})")
    parser.add_argument("--pulse-ms", type=float, default=PULSE_DURATION_MS,
                        help=f"Pulse duration ms (default: {PULSE_DURATION_MS})")
    args = parser.parse_args()

    ensure_dirs()
    EMS_DIR.mkdir(parents=True, exist_ok=True)
    clip_ids = get_clip_ids(args.clip)

    print(f"=== Step 9: Prepare EMS ({len(clip_ids)} clips) ===")
    print(f"  Threshold: {args.threshold}")
    print(f"  Carrier: {args.carrier_freq}Hz, Pulse: {args.pulse_ms}ms\n")

    success, fail = 0, 0
    for cid in clip_ids:
        info = TALKS[cid]
        print(f"\n--- {cid}: {info['speaker']} ---")
        if process_clip(cid, args.threshold, args.carrier_freq, args.pulse_ms):
            success += 1
        else:
            fail += 1

    print(f"\n=== Done: {success} EMS files generated, {fail} failed ===")
    print(f"Output: {EMS_DIR}/")
    print(f"\nPlayback:")
    print(f"  L channel -> headphone/speaker (audio)")
    print(f"  R channel -> EMS electrode pad (carrier)")
    if fail > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
