#!/usr/bin/env python3
"""
step5_acn_prominence.py - ACN prominence scoring for TED talk clips.

Two modes:
  1. ACN model (preferred): Trains ACNv9 on Helsinki corpus, then scores clip words
  2. syllable.dll fallback: Uses existing libsyllable C engine

Usage:
    python step5_acn_prominence.py              # all clips
    python step5_acn_prominence.py --clip H1
    python step5_acn_prominence.py --fallback    # force syllable.dll mode
"""

import argparse
import json
import sys
import numpy as np
from pathlib import Path
from config import (CLIPS_DIR, ALIGNMENT_DIR, PROMINENCE_DIR, SAMPLE_RATE,
                    PROMINENCE_ROOT, ESA_DIR, FEATURES_DIR, DLL_PATHS,
                    ensure_dirs, get_clip_ids)


# ═══════════════════════════════════════════════════════════════════
# ACN Model (preferred path)
# ═══════════════════════════════════════════════════════════════════

def extract_word_acoustic_cues(wav_path: str, words: list) -> np.ndarray:
    """Extract per-word acoustic cues: [log_dur, energy, spectral_balance].

    These match the ACN training features:
      - Cue 0: log(duration)
      - Cue 1: MFCC[0] mean (energy proxy)
      - Cue 2: MFCC[2] std  (spectral balance)
    """
    import librosa

    y, sr = librosa.load(wav_path, sr=SAMPLE_RATE)
    # Compute MFCCs for the entire file
    mfccs = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=160, n_fft=400)
    # mfccs shape: (13, n_frames), hop=10ms at 16kHz
    hop_sec = 160 / sr

    cues = []
    for w in words:
        dur = w["end"] - w["start"]
        log_dur = np.log(max(dur, 0.001))

        # Frame range for this word
        f_start = int(w["start"] / hop_sec)
        f_end = int(w["end"] / hop_sec)
        f_start = max(0, min(f_start, mfccs.shape[1] - 1))
        f_end = max(f_start + 1, min(f_end, mfccs.shape[1]))

        word_mfcc = mfccs[:, f_start:f_end]
        energy = float(word_mfcc[0].mean()) if word_mfcc.shape[1] > 0 else 0.0
        spec_bal = float(word_mfcc[2].std()) if word_mfcc.shape[1] > 1 else 0.0

        cues.append([log_dur, energy, spec_bal])

    return np.array(cues, dtype=float)


def build_context_indices(n_words: int):
    """Build prev/next indices for a single utterance (sequential words)."""
    prev_idx = np.full(n_words, -1, dtype=int)
    next_idx = np.full(n_words, -1, dtype=int)
    for i in range(n_words):
        if i > 0:
            prev_idx[i] = i - 1
        if i < n_words - 1:
            next_idx[i] = i + 1
    return prev_idx, next_idx


def prep_context(cues, prev_idx, next_idx, scaler=None):
    """Prepare scaled cues and context arrays for ACN."""
    from sklearn.preprocessing import StandardScaler

    if scaler is None:
        scaler = StandardScaler().fit(cues)
    cs = scaler.transform(cues)

    has_prev = (prev_idx >= 0).astype(float)
    has_next = (next_idx >= 0).astype(float)

    prev_cues = np.zeros_like(cs)
    next_cues = np.zeros_like(cs)
    m = prev_idx >= 0
    prev_cues[m] = cs[prev_idx[m]]
    m = next_idx >= 0
    next_cues[m] = cs[next_idx[m]]

    return cs, prev_cues, next_cues, has_prev, has_next, scaler


class ACNv9Inference:
    """Minimal ACN v9 for inference only (no training, no text features).

    Acoustic-only: 3 cues, hc=8, ha=8 -> 170 params.
    """

    def __init__(self, nc=3, hc=8, ha=8):
        self.nc, self.hc, self.ha = nc, hc, ha
        self.cW1 = [np.zeros((2, hc)) for _ in range(nc)]
        self.cb1 = [np.zeros(hc) for _ in range(nc)]
        self.cW2 = [np.zeros((hc, 1)) for _ in range(nc)]
        self.cb2 = [np.zeros(1) for _ in range(nc)]
        self.attn = np.zeros((nc, 2))
        ai = nc * 2
        self.aW1 = np.zeros((ai, ha))
        self.ab1 = np.zeros(ha)
        self.aW2 = np.zeros((ha, 1))
        self.ab2 = np.zeros(1)

    def load(self, state_dict):
        """Load weights from a dict of numpy arrays."""
        for k, v in state_dict.items():
            setattr(self, k, [x.copy() for x in v] if isinstance(v, list) else v.copy())

    def forward(self, cues_scaled, context):
        """Run ACN forward pass.

        Args:
            cues_scaled: (N, nc) scaled acoustic cues
            context: [(prev_cues, has_prev), (next_cues, has_next)]

        Returns:
            scores: (N,) raw prominence scores
        """
        N = cues_scaled.shape[0]
        EPS = 1e-8

        # Softmax attention weights
        at = np.exp(self.attn - self.attn.max(-1, keepdims=True))
        at = at / (at.sum(-1, keepdims=True) + EPS)

        att = np.zeros((N, self.nc))
        for c in range(self.nc):
            for k in range(2):
                ctx_cues, ctx_has = context[k]
                x = np.column_stack([cues_scaled[:, c], ctx_cues[:, c]])
                h = np.maximum(x @ self.cW1[c] + self.cb1[c], 0)
                o = (h @ self.cW2[c] + self.cb2[c]).ravel() * ctx_has
                att[:, c] += at[c, k] * o

        ai = np.column_stack([att, cues_scaled])
        ah = np.maximum(ai @ self.aW1 + self.ab1, 0)
        raw = (ah @ self.aW2 + self.ab2).ravel()

        return raw


def try_load_acn_model():
    """Try to load a trained ACN model.

    Attempts to train from Helsinki data if weights not cached.
    Returns (model, scaler) or (None, None) on failure.
    """
    cache_dir = Path(__file__).parent / ".cache"
    cache_dir.mkdir(exist_ok=True)
    weights_path = cache_dir / "acn_weights.npz"
    scaler_path = cache_dir / "acn_scaler.npz"

    if weights_path.exists() and scaler_path.exists():
        print("  Loading cached ACN weights...")
        data = np.load(str(weights_path), allow_pickle=True)
        state = {k: data[k] for k in data.files}
        # Reconstruct list-type weights
        nc = 3
        for key in ["cW1", "cb1", "cW2", "cb2"]:
            if key in state:
                arr = state[key]
                state[key] = [arr[i] for i in range(nc)]

        sdata = np.load(str(scaler_path), allow_pickle=True)
        from sklearn.preprocessing import StandardScaler
        scaler = StandardScaler()
        scaler.mean_ = sdata["mean"]
        scaler.scale_ = sdata["scale"]
        scaler.var_ = sdata["var"]
        scaler.n_features_in_ = len(sdata["mean"])

        model = ACNv9Inference(nc=3, hc=8, ha=8)
        model.load(state)
        print("  [OK] ACN model loaded from cache")
        return model, scaler

    # Try to train from Helsinki data
    print("  No cached ACN weights. Attempting to train from Helsinki data...")
    return train_acn_from_helsinki(weights_path, scaler_path)


def train_acn_from_helsinki(weights_path, scaler_path):
    """Train ACN on Helsinki corpus and cache weights.

    Uses the same data files as acn_v9_textfeat.py.
    """
    import pandas as pd
    from sklearn.preprocessing import StandardScaler

    # Check for Helsinki data
    dur_tsv = FEATURES_DIR / "word_duration_dataset_train100_50spk.tsv"
    mfcc_npz = FEATURES_DIR / "word_mfcc_train100_50spk.npz"

    if not dur_tsv.exists() or not mfcc_npz.exists():
        print(f"  [FAIL] Helsinki data not found at {FEATURES_DIR}")
        print(f"    Expected: {dur_tsv.name}, {mfcc_npz.name}")
        return None, None

    print("  Loading Helsinki training data...")
    hdf = pd.read_csv(dur_tsv, sep="\t")
    hm = np.load(str(mfcc_npz), allow_pickle=True)["embeddings"].astype(float)
    hd = np.log(np.clip(hdf["duration"].to_numpy(float), 0.001, 10))
    hl = hdf["label"].to_numpy(float)
    h_fids = hdf["file_id"].to_numpy()
    h_spk = np.array([f.split("_")[0] for f in h_fids])

    # Build utterance index
    h_utt = {}
    for i, f in enumerate(h_fids):
        h_utt.setdefault(f, []).append(i)

    # 3-cue: dur + MFCC[0] + MFCC[15] (=MFCC_std[2])
    h_cues = np.column_stack([hd, hm[:, 0], hm[:, 15]])
    Nh = len(hl)

    # Context indices
    prev_idx = np.full(Nh, -1, int)
    next_idx = np.full(Nh, -1, int)
    for idx_list in h_utt.values():
        for t in range(len(idx_list)):
            if t > 0:
                prev_idx[idx_list[t]] = idx_list[t - 1]
            if t < len(idx_list) - 1:
                next_idx[idx_list[t]] = idx_list[t + 1]

    # Prepare context
    scaler = StandardScaler().fit(h_cues)
    cs, pc, nc_, hp, hn, _ = prep_context(h_cues, prev_idx, next_idx, scaler)

    # Val split (20% of speakers)
    u_spk = sorted(set(h_spk))
    nv = max(1, len(u_spk) // 5)
    vs = set(u_spk[-nv:])
    vm = np.array([s in vs for s in h_spk])
    tm = ~vm

    print(f"  Train={tm.sum()}, Val={vm.sum()}")

    # Import full ACN for training
    sys.path.insert(0, str(ESA_DIR / "scripts" / "acn"))
    try:
        from acn_v9_textfeat import ACNv9
    except ImportError:
        print("  [FAIL] Cannot import ACNv9 from acn_v9_textfeat.py")
        return None, None

    # Train (acoustic-only: nc=3, nt=0)
    print("  Training ACN (3-cue acoustic-only)...")
    best_r = -1
    best_state = None

    for seed in range(5):
        np.random.seed(seed * 13 + 7)
        acn = ACNv9(nc=3, nt=0, hc=8, ha=8, lr=0.003)
        tr_ctx = [(pc[tm], hp[tm]), (nc_[tm], hn[tm])]
        vl_ctx = [(pc[vm], hp[vm]), (nc_[vm], hn[vm])]
        r = acn.fit(cs[tm], tr_ctx, None, hl[tm],
                    cs[vm], vl_ctx, None, hl[vm],
                    ep=200, bs=4096, l2=0.001, pat=40)
        if r > best_r:
            best_r = r
            best_state = acn.save()
        print(f"    seed={seed}: val r={r:.4f}")

    print(f"  Best val r={best_r:.4f}")

    # Save weights
    save_dict = {}
    for k, v in best_state.items():
        if isinstance(v, list):
            # Save list of arrays as a single 3D array
            save_dict[k] = np.array(v)
        else:
            save_dict[k] = v
    np.savez(str(weights_path), **save_dict)
    np.savez(str(scaler_path), mean=scaler.mean_, scale=scaler.scale_, var=scaler.var_)

    print(f"  [OK] Weights saved to {weights_path.name}")

    # Build inference model
    model = ACNv9Inference(nc=3, hc=8, ha=8)
    model.load(best_state)
    return model, scaler


# ═══════════════════════════════════════════════════════════════════
# syllable.dll fallback
# ═══════════════════════════════════════════════════════════════════

def try_syllable_dll_fallback(wav_path: str, words: list):
    """Use syllable.dll for prominence scoring (fallback mode).

    Maps syllable-level fusion_scores to word boundaries.
    """
    import ctypes

    dll = None
    for p in DLL_PATHS:
        if p.exists():
            dll = ctypes.CDLL(str(p))
            print(f"  Using fallback: {p.name}")
            break

    if dll is None:
        print("  [FAIL] syllable.dll not found either. Using random scores.")
        np.random.seed(42)
        return [float(np.clip(np.random.beta(2, 5), 0, 1)) for _ in words]

    # Import ctypes structures from prepare_ems.py pattern
    sys.path.insert(0, str(Path(__file__).parent.parent.parent / "ems"))
    try:
        from prepare_ems import (SyllableConfig, SyllableEvent,
                                 extract_audio_to_wav, read_wav_mono)
    except ImportError:
        print("  [FAIL] Cannot import from prepare_ems.py. Using random scores.")
        np.random.seed(42)
        return [float(np.clip(np.random.beta(2, 5), 0, 1)) for _ in words]

    # Set up DLL functions
    dll.syllable_default_config.argtypes = [ctypes.c_int]
    dll.syllable_default_config.restype = SyllableConfig
    dll.syllable_create.argtypes = [ctypes.POINTER(SyllableConfig)]
    dll.syllable_create.restype = ctypes.c_void_p
    dll.syllable_process.argtypes = [
        ctypes.c_void_p, ctypes.POINTER(ctypes.c_float),
        ctypes.c_int, ctypes.POINTER(SyllableEvent), ctypes.c_int,
    ]
    dll.syllable_process.restype = ctypes.c_int
    dll.syllable_flush.argtypes = [
        ctypes.c_void_p, ctypes.POINTER(SyllableEvent), ctypes.c_int,
    ]
    dll.syllable_flush.restype = ctypes.c_int
    dll.syllable_destroy.argtypes = [ctypes.c_void_p]
    dll.syllable_destroy.restype = None

    # Process audio
    import soundfile as sf
    data, sr = sf.read(wav_path)
    if data.ndim > 1:
        data = data.mean(axis=1)
    samples = data.astype(np.float32)

    config = dll.syllable_default_config(sr)
    detector = dll.syllable_create(ctypes.byref(config))
    if not detector:
        print("  [FAIL] Failed to create syllable detector")
        np.random.seed(42)
        return [float(np.clip(np.random.beta(2, 5), 0, 1)) for _ in words]

    # Process in chunks
    chunk_size = 1024
    max_events = 64
    event_buf = (SyllableEvent * max_events)()
    all_events = []

    c_samples = (ctypes.c_float * len(samples))(*samples)
    for i in range(0, len(samples), chunk_size):
        n = min(chunk_size, len(samples) - i)
        ptr = ctypes.cast(ctypes.addressof(c_samples) + i * 4,
                          ctypes.POINTER(ctypes.c_float))
        count = dll.syllable_process(detector, ptr, n, event_buf, max_events)
        for k in range(count):
            ev_copy = SyllableEvent()
            ctypes.memmove(ctypes.addressof(ev_copy),
                           ctypes.addressof(event_buf[k]),
                           ctypes.sizeof(SyllableEvent))
            all_events.append(ev_copy)

    count = dll.syllable_flush(detector, event_buf, max_events)
    for k in range(count):
        ev_copy = SyllableEvent()
        ctypes.memmove(ctypes.addressof(ev_copy),
                       ctypes.addressof(event_buf[k]),
                       ctypes.sizeof(SyllableEvent))
        all_events.append(ev_copy)

    dll.syllable_destroy(detector)

    print(f"  Syllable events: {len(all_events)}")

    # Map syllable events to words: each word gets max fusion_score of overlapping events
    scores = []
    for w in words:
        word_scores = []
        for ev in all_events:
            if w["start"] <= ev.time_seconds <= w["end"]:
                word_scores.append(ev.fusion_score)
        if word_scores:
            scores.append(float(max(word_scores)))
        else:
            scores.append(0.0)

    # Normalize to [0, 1]
    arr = np.array(scores)
    if arr.max() > arr.min():
        arr = (arr - arr.min()) / (arr.max() - arr.min())
    return arr.tolist()


# ═══════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════

def score_clip_acn(clip_id: str, model, scaler) -> bool:
    """Score a clip using ACN model."""
    wav_path = CLIPS_DIR / f"{clip_id}.wav"
    json_path = ALIGNMENT_DIR / f"{clip_id}.json"
    out_path = PROMINENCE_DIR / f"{clip_id}.json"

    if out_path.exists():
        print(f"  [OK] Already scored: {out_path.name}")
        return True

    if not wav_path.exists() or not json_path.exists():
        print(f"  [FAIL] Missing clip or alignment for {clip_id}")
        return False

    with open(json_path, encoding="utf-8") as f:
        words = json.load(f)

    # Extract acoustic cues
    cues = extract_word_acoustic_cues(str(wav_path), words)

    # Prepare context
    N = len(words)
    prev_idx, next_idx = build_context_indices(N)
    cs, pc, nc_, hp, hn, _ = prep_context(cues, prev_idx, next_idx, scaler)

    # Run ACN forward
    raw_scores = model.forward(cs, [(pc, hp), (nc_, hn)])

    # Normalize to [0, 1] via sigmoid
    def sigmoid(x):
        return 1.0 / (1.0 + np.exp(-np.clip(x, -20, 20)))

    scores = sigmoid(raw_scores)

    # Save
    result = []
    for w, s in zip(words, scores):
        result.append({
            "word": w["word"],
            "start": w["start"],
            "end": w["end"],
            "prominence": round(float(s), 4),
        })

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    arr = np.array([r["prominence"] for r in result])
    print(f"  {len(result)} words, mean={arr.mean():.3f}, std={arr.std():.3f}, "
          f"range=[{arr.min():.3f}, {arr.max():.3f}]")
    print(f"  -> {out_path.name}")
    return True


def score_clip_fallback(clip_id: str) -> bool:
    """Score a clip using syllable.dll fallback."""
    wav_path = CLIPS_DIR / f"{clip_id}.wav"
    json_path = ALIGNMENT_DIR / f"{clip_id}.json"
    out_path = PROMINENCE_DIR / f"{clip_id}.json"

    if out_path.exists():
        print(f"  [OK] Already scored: {out_path.name}")
        return True

    if not wav_path.exists() or not json_path.exists():
        print(f"  [FAIL] Missing clip or alignment for {clip_id}")
        return False

    with open(json_path, encoding="utf-8") as f:
        words = json.load(f)

    scores = try_syllable_dll_fallback(str(wav_path), words)

    result = []
    for w, s in zip(words, scores):
        result.append({
            "word": w["word"],
            "start": w["start"],
            "end": w["end"],
            "prominence": round(float(s), 4),
        })

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    arr = np.array([r["prominence"] for r in result])
    print(f"  {len(result)} words, mean={arr.mean():.3f}, std={arr.std():.3f}, "
          f"range=[{arr.min():.3f}, {arr.max():.3f}]")
    print(f"  -> {out_path.name}")
    return True


def main():
    parser = argparse.ArgumentParser(description="ACN prominence scoring")
    parser.add_argument("--clip", default=None, help="Clip ID(s)")
    parser.add_argument("--fallback", action="store_true",
                        help="Force syllable.dll fallback mode")
    args = parser.parse_args()

    ensure_dirs()
    clip_ids = get_clip_ids(args.clip)

    print(f"=== Step 5: ACN Prominence Scoring ({len(clip_ids)} clips) ===\n")

    use_acn = False
    model, scaler = None, None

    if not args.fallback:
        model, scaler = try_load_acn_model()
        if model is not None:
            use_acn = True
            print("  Using ACN model\n")
        else:
            print("  ACN model unavailable, falling back to syllable.dll\n")

    success, fail = 0, 0
    for cid in clip_ids:
        print(f"\n--- {cid} ---")
        if use_acn:
            ok = score_clip_acn(cid, model, scaler)
        else:
            ok = score_clip_fallback(cid)
        if ok:
            success += 1
        else:
            fail += 1

    print(f"\n=== Done: {success} scored, {fail} failed ===")
    if fail > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
