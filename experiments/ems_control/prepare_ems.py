#!/usr/bin/env python3
"""
prepare_ems.py — Offline EMS Stereo WAV Generator

Processes audio/video files through syllable.dll (prominence detection)
and generates stereo WAV files:
  L channel = original audio (for listening)
  R channel = EMS carrier signal (triggered at prominence peaks)

Usage:
  python prepare_ems.py input.mp4
  python prepare_ems.py input.mp3 --carrier-freq 4000 --pulse-ms 100
  python prepare_ems.py media_src/   # batch process directory

Hardware:
  PC → USB-C audio adapter → stereo splitter
    L → headphone/speaker
    R → EMS electrode pad
"""

import argparse
import ctypes
import math
import os
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

# ── Constants ──
SAMPLE_RATE = 48000
CARRIER_FREQ_DEFAULT = 4000    # Hz
PULSE_DURATION_MS_DEFAULT = 100
ATTACK_MS = 5
DECAY_MS = 20
EMS_AMPLITUDE = 0.8            # 0-1, max amplitude of EMS carrier
PROMINENCE_THRESHOLD = 0.5     # fusion_score threshold for triggering

SUPPORTED_EXTENSIONS = {'.wav', '.mp3', '.mp4', '.m4a', '.ogg', '.webm',
                        '.flac', '.aac', '.mkv', '.avi', '.mov'}


# ═══════════════════════════════════════════════════════════════════
# ctypes bindings for syllable.dll
# ═══════════════════════════════════════════════════════════════════

class SyllableConfig(ctypes.Structure):
    _fields_ = [
        ("sample_rate", ctypes.c_int),
        ("zff_trend_window_ms", ctypes.c_float),
        ("peak_rate_band_min", ctypes.c_float),
        ("peak_rate_band_max", ctypes.c_float),
        ("min_syllable_dist_ms", ctypes.c_float),
        ("threshold_peak_rate", ctypes.c_float),
        ("adaptive_peak_rate_k", ctypes.c_float),
        ("adaptive_peak_rate_tau_ms", ctypes.c_float),
        ("voiced_hold_ms", ctypes.c_float),
        ("hysteresis_on_factor", ctypes.c_float),
        ("hysteresis_off_factor", ctypes.c_float),
        ("context_size", ctypes.c_int),
        ("enable_spectral_flux", ctypes.c_int),
        ("enable_high_freq_energy", ctypes.c_int),
        ("enable_mfcc_delta", ctypes.c_int),
        ("enable_wavelet", ctypes.c_int),
        ("fft_size_ms", ctypes.c_float),
        ("hop_size_ms", ctypes.c_float),
        ("high_freq_cutoff_hz", ctypes.c_float),
        ("weight_peak_rate", ctypes.c_float),
        ("weight_spectral_flux", ctypes.c_float),
        ("weight_high_freq", ctypes.c_float),
        ("weight_mfcc_delta", ctypes.c_float),
        ("weight_wavelet", ctypes.c_float),
        ("weight_voiced_bonus", ctypes.c_float),
        ("fusion_blend_alpha", ctypes.c_float),
        ("unvoiced_onset_threshold", ctypes.c_float),
        ("allow_unvoiced_onsets", ctypes.c_int),
        ("enable_agc", ctypes.c_int),
        ("realtime_mode", ctypes.c_int),
        ("calibration_duration_ms", ctypes.c_float),
        ("snr_threshold_db", ctypes.c_float),
        ("user_malloc", ctypes.c_void_p),
        ("user_free", ctypes.c_void_p),
    ]


class SyllableEvent(ctypes.Structure):
    _fields_ = [
        ("timestamp_samples", ctypes.c_uint64),
        ("time_seconds", ctypes.c_double),
        ("peak_rate", ctypes.c_float),
        ("pr_slope", ctypes.c_float),
        ("energy", ctypes.c_float),
        ("f0", ctypes.c_float),
        ("delta_f0", ctypes.c_float),
        ("duration_s", ctypes.c_float),
        ("spectral_flux", ctypes.c_float),
        ("high_freq_energy", ctypes.c_float),
        ("mfcc_delta", ctypes.c_float),
        ("wavelet_score", ctypes.c_float),
        ("fusion_score", ctypes.c_float),
        ("onset_type", ctypes.c_int),
        ("prominence_score", ctypes.c_float),
        ("is_accented", ctypes.c_int),
    ]


def load_syllable_dll():
    """Load syllable.dll from the build directory."""
    dll_paths = [
        Path(__file__).parent.parent / "PROMINENCE_Detection" / "build" / "Release" / "syllable.dll",
        Path(__file__).parent.parent / "PROMINENCE_Detection" / "build" / "syllable.dll",
    ]
    for p in dll_paths:
        if p.exists():
            dll = ctypes.CDLL(str(p))
            # Set up function signatures
            dll.syllable_default_config.argtypes = [ctypes.c_int]
            dll.syllable_default_config.restype = SyllableConfig

            dll.syllable_create.argtypes = [ctypes.POINTER(SyllableConfig)]
            dll.syllable_create.restype = ctypes.c_void_p

            dll.syllable_process.argtypes = [
                ctypes.c_void_p,
                ctypes.POINTER(ctypes.c_float),
                ctypes.c_int,
                ctypes.POINTER(SyllableEvent),
                ctypes.c_int,
            ]
            dll.syllable_process.restype = ctypes.c_int

            dll.syllable_flush.argtypes = [
                ctypes.c_void_p,
                ctypes.POINTER(SyllableEvent),
                ctypes.c_int,
            ]
            dll.syllable_flush.restype = ctypes.c_int

            dll.syllable_destroy.argtypes = [ctypes.c_void_p]
            dll.syllable_destroy.restype = None

            dll.syllable_reset.argtypes = [ctypes.c_void_p]
            dll.syllable_reset.restype = None

            print(f"[OK] Loaded: {p}")
            return dll

    print("[ERROR] syllable.dll not found. Build PROMINENCE_Detection first.")
    sys.exit(1)


# ═══════════════════════════════════════════════════════════════════
# Audio I/O
# ═══════════════════════════════════════════════════════════════════

def extract_audio_to_wav(input_path: Path, sr: int = SAMPLE_RATE) -> Path:
    """Use ffmpeg to convert any audio/video to mono 48kHz WAV."""
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-ac", "1", "-ar", str(sr), "-sample_fmt", "s16",
        "-f", "wav", tmp.name
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        stderr = result.stderr.decode('utf-8', errors='replace')
        print(f"[ERROR] ffmpeg failed:\n{stderr}")
        sys.exit(1)
    return Path(tmp.name)


def read_wav_mono(path: Path):
    """Read a mono 16-bit WAV file, return (samples_float, sample_rate)."""
    with open(path, "rb") as f:
        data = f.read()

    # Parse RIFF header
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("Not a valid WAV file")

    # Find fmt chunk
    pos = 12
    fmt_found = False
    while pos < len(data) - 8:
        chunk_id = data[pos:pos+4]
        chunk_size = struct.unpack_from("<I", data, pos+4)[0]
        if chunk_id == b"fmt ":
            fmt = struct.unpack_from("<HHIIHH", data, pos+8)
            audio_format, channels, sr, byte_rate, block_align, bps = fmt
            fmt_found = True
        elif chunk_id == b"data" and fmt_found:
            pcm_data = data[pos+8:pos+8+chunk_size]
            break
        pos += 8 + chunk_size
    else:
        raise ValueError("Missing data chunk")

    n_samples = len(pcm_data) // 2
    samples = struct.unpack(f"<{n_samples}h", pcm_data)
    float_samples = [s / 32768.0 for s in samples]
    return float_samples, sr


def write_stereo_wav(path: Path, left: list, right: list, sr: int):
    """Write a stereo 16-bit WAV file."""
    n = min(len(left), len(right))
    # Interleave L, R
    pcm = bytearray(n * 4)  # 2 channels × 2 bytes
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
        1,      # PCM
        2,      # stereo
        sr,
        sr * 4, # byte rate (2ch × 16bit)
        4,      # block align
        16,     # bits per sample
        b"data", data_size
    )

    with open(path, "wb") as f:
        f.write(header)
        f.write(pcm)

    print(f"[OK] Written: {path} ({n} samples, {n/sr:.1f}s)")


# ═══════════════════════════════════════════════════════════════════
# EMS Carrier Synthesis
# ═══════════════════════════════════════════════════════════════════

def generate_ems_channel(n_samples: int, sr: int, events,
                         carrier_freq: float, pulse_ms: float,
                         threshold: float):
    """Generate EMS carrier signal on prominence events."""
    ems = [0.0] * n_samples
    pulse_samples = int(pulse_ms / 1000.0 * sr)
    attack_samples = int(ATTACK_MS / 1000.0 * sr)
    decay_samples = int(DECAY_MS / 1000.0 * sr)
    two_pi = 2.0 * math.pi
    triggered = 0

    for ev in events:
        # Use fusion_score (or prominence_score) as threshold
        score = ev.fusion_score
        if score < threshold:
            continue

        triggered += 1
        center = int(ev.time_seconds * sr)
        start = max(0, center - pulse_samples // 4)  # Slightly before onset
        end = min(n_samples, start + pulse_samples)

        # Intensity scaling: higher prominence → stronger pulse
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
            # Clamp
            if ems[i] > 1.0:
                ems[i] = 1.0
            elif ems[i] < -1.0:
                ems[i] = -1.0

    return ems, triggered


# ═══════════════════════════════════════════════════════════════════
# Main Processing
# ═══════════════════════════════════════════════════════════════════

def process_file(input_path: Path, output_dir: Path, dll,
                 carrier_freq: float, pulse_ms: float, threshold: float):
    """Process a single file: detect prominence → generate stereo WAV."""
    print(f"\n{'='*60}")
    print(f"Processing: {input_path.name}")
    print(f"{'='*60}")

    # 1. Extract audio
    wav_path = extract_audio_to_wav(input_path)
    try:
        samples, sr = read_wav_mono(wav_path)
    finally:
        os.unlink(wav_path)

    n_samples = len(samples)
    print(f"  Samples: {n_samples} ({n_samples/sr:.1f}s @ {sr}Hz)")

    # 2. Detect syllables/prominence via DLL
    config = dll.syllable_default_config(sr)
    detector = dll.syllable_create(ctypes.byref(config))
    if not detector:
        print("[ERROR] Failed to create detector")
        return

    # Convert to ctypes array
    c_samples = (ctypes.c_float * n_samples)(*samples)

    # Process in chunks
    chunk_size = 1024
    max_events_per_chunk = 64
    event_buf = (SyllableEvent * max_events_per_chunk)()
    all_events = []

    for i in range(0, n_samples, chunk_size):
        n = min(chunk_size, n_samples - i)
        ptr = ctypes.cast(ctypes.addressof(c_samples) + i * 4,
                          ctypes.POINTER(ctypes.c_float))
        count = dll.syllable_process(detector, ptr, n, event_buf, max_events_per_chunk)
        for k in range(count):
            all_events.append(SyllableEvent())
            ctypes.memmove(ctypes.addressof(all_events[-1]),
                           ctypes.addressof(event_buf[k]),
                           ctypes.sizeof(SyllableEvent))

    # Flush
    count = dll.syllable_flush(detector, event_buf, max_events_per_chunk)
    for k in range(count):
        all_events.append(SyllableEvent())
        ctypes.memmove(ctypes.addressof(all_events[-1]),
                       ctypes.addressof(event_buf[k]),
                       ctypes.sizeof(SyllableEvent))

    dll.syllable_destroy(detector)

    print(f"  Syllables detected: {len(all_events)}")
    accented = sum(1 for e in all_events if e.is_accented)
    above_thresh = sum(1 for e in all_events if e.fusion_score >= threshold)
    print(f"  Accented syllables: {accented}")
    print(f"  Above threshold ({threshold:.2f}): {above_thresh}")

    # Print top events
    if all_events:
        print(f"\n  {'Time':>8s} {'Fusion':>7s} {'Prom':>6s} {'Acc':>4s}")
        print(f"  {'-'*30}")
        for ev in sorted(all_events, key=lambda e: -e.fusion_score)[:15]:
            print(f"  {ev.time_seconds:8.3f} {ev.fusion_score:7.3f} "
                  f"{ev.prominence_score:6.3f} {'*' if ev.is_accented else ''}")

    # 3. Generate EMS channel
    ems_channel, triggered = generate_ems_channel(
        n_samples, sr, all_events, carrier_freq, pulse_ms, threshold
    )
    print(f"\n  EMS pulses generated: {triggered}")

    # 4. Write stereo WAV
    stem = input_path.stem
    output_path = output_dir / f"{stem}_ems.wav"
    write_stereo_wav(output_path, samples, ems_channel, sr)

    return output_path


def main():
    parser = argparse.ArgumentParser(
        description="Generate stereo WAV (L=audio, R=EMS) from audio/video files",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python prepare_ems.py input.mp4
  python prepare_ems.py rap_clip.mp3 --carrier-freq 3000 --pulse-ms 150
  python prepare_ems.py media_src/ --threshold 0.4

Hardware Setup:
  PC → USB-C audio adapter → stereo splitter cable
    L channel → headphone/speaker (audio)
    R channel → EMS electrode pad (stimulation)
"""
    )
    parser.add_argument("input", help="Input file or directory")
    parser.add_argument("--output-dir", "-o", default=None,
                        help="Output directory (default: ems/media/)")
    parser.add_argument("--carrier-freq", type=float, default=CARRIER_FREQ_DEFAULT,
                        help=f"EMS carrier frequency Hz (default: {CARRIER_FREQ_DEFAULT})")
    parser.add_argument("--pulse-ms", type=float, default=PULSE_DURATION_MS_DEFAULT,
                        help=f"EMS pulse duration ms (default: {PULSE_DURATION_MS_DEFAULT})")
    parser.add_argument("--threshold", type=float, default=PROMINENCE_THRESHOLD,
                        help=f"Fusion score threshold (default: {PROMINENCE_THRESHOLD})")

    args = parser.parse_args()

    # Resolve output directory
    if args.output_dir:
        output_dir = Path(args.output_dir)
    else:
        output_dir = Path(__file__).parent / "media"
    output_dir.mkdir(parents=True, exist_ok=True)

    # Load DLL
    dll = load_syllable_dll()

    # Collect input files
    input_path = Path(args.input)
    if input_path.is_dir():
        files = [f for f in input_path.iterdir()
                 if f.suffix.lower() in SUPPORTED_EXTENSIONS]
        if not files:
            print(f"No supported files in {input_path}")
            sys.exit(1)
        print(f"Found {len(files)} files to process.")
    else:
        if not input_path.exists():
            print(f"File not found: {input_path}")
            sys.exit(1)
        files = [input_path]

    # Process
    results = []
    for f in sorted(files):
        out = process_file(f, output_dir, dll,
                           args.carrier_freq, args.pulse_ms, args.threshold)
        if out:
            results.append(out)

    # Summary
    print(f"\n{'='*60}")
    print(f"Done! Generated {len(results)} stereo WAV file(s) in {output_dir}")
    for r in results:
        print(f"  → {r.name}")

    # Generate manifest.json (for web player library)
    import json
    manifest_files = []
    for wav in sorted(output_dir.glob("*_ems.wav")):
        try:
            samples, sr = read_wav_mono(wav)  # just to get duration
        except Exception:
            sr = SAMPLE_RATE
            samples = []
        manifest_files.append({
            "name": wav.name,
            "size_mb": round(wav.stat().st_size / 1024 / 1024, 1),
            "duration_s": round(len(samples) / sr, 1) if samples else 0,
        })
    manifest_path = output_dir / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as mf:
        json.dump({"files": manifest_files}, mf, indent=2, ensure_ascii=False)
    print(f"\n[OK] Manifest: {manifest_path} ({len(manifest_files)} files)")

    print(f"\nPlayback: Open in any media player, or use the EMS web player.")
    print(f"Hardware: L=audio (headphone), R=EMS (electrode)")


if __name__ == "__main__":
    main()
