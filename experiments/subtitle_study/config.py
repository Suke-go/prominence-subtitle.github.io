"""
config.py — Central configuration for the TED Talk subtitle study pipeline.

All directory paths, talk definitions, and subtitle parameters in one place.
"""

from pathlib import Path

# ── Directories ──
BASE_DIR = Path(__file__).resolve().parent
DOWNLOADS_DIR = BASE_DIR / "downloads"
CLIPS_DIR = BASE_DIR / "clips"
ALIGNMENT_DIR = BASE_DIR / "alignment"
POS_DIR = BASE_DIR / "pos"
PROMINENCE_DIR = BASE_DIR / "prominence"
SUBTITLES_DIR = BASE_DIR / "subtitles"
PREVIEW_DIR = BASE_DIR / "preview"

ALL_DIRS = [DOWNLOADS_DIR, CLIPS_DIR, ALIGNMENT_DIR, POS_DIR,
            PROMINENCE_DIR, SUBTITLES_DIR, PREVIEW_DIR]

# ── PROMINENCE_Detection paths (for ACN model & features) ──
PROMINENCE_ROOT = BASE_DIR.parent.parent / "PROMINENCE_Detection"
ESA_DIR = PROMINENCE_ROOT / "experiments" / "esa_teo_detector"
FEATURES_DIR = ESA_DIR / "results" / "features"
DLL_PATHS = [
    PROMINENCE_ROOT / "build" / "Release" / "syllable.dll",
    PROMINENCE_ROOT / "build" / "syllable.dll",
]

# ── TED Talk Definitions ──
# High prosodic contrast group
# Low prosodic contrast group
TALKS = {
    # ─── High group (韻律コントラスト高群) ───
    "H1": {
        "url": "https://www.ted.com/talks/ken_robinson_do_schools_kill_creativity",
        "speaker": "Ken Robinson",
        "title": "Do Schools Kill Creativity?",
        "year": 2006,
        "start": 180.0,    # ~3:00
        "end": 270.0,      # ~4:30
        "note": "小学校エピソード、ユーモア・皮肉の交替、対比構文",
    },
    "H2": {
        "url": "https://www.ted.com/talks/brene_brown_the_power_of_vulnerability",
        "speaker": "Brené Brown",
        "title": "The Power of Vulnerability",
        "year": 2010,
        "start": 480.0,    # ~8:00
        "end": 570.0,      # ~9:30
        "note": "感情的語り、引用会話、自己言及強調",
    },
    "H3": {
        "url": "https://www.ted.com/talks/kelly_mcgonigal_how_to_make_stress_your_friend",
        "speaker": "Kelly McGonigal",
        "title": "How to Make Stress Your Friend",
        "year": 2013,
        "start": 30.0,     # ~0:30
        "end": 120.0,      # ~2:00
        "note": "冒頭の告白、修辞的問いかけ、対比強勢",
    },
    # ─── Low group (韻律コントラスト低群) ───
    "L1": {
        "url": "https://www.ted.com/talks/hans_rosling_the_best_stats_you_ve_ever_seen",
        "speaker": "Hans Rosling",
        "title": "The Best Stats You've Ever Seen",
        "year": 2006,
        "start": 240.0,    # ~4:00
        "end": 330.0,      # ~5:30
        "note": "数値・国名の列挙、平坦",
    },
    "L2": {
        "url": "https://www.ted.com/talks/david_christian_the_history_of_our_world_in_18_minutes",
        "speaker": "David Christian",
        "title": "History of Our World in 18 Minutes",
        "year": 2011,
        "start": 120.0,    # ~2:00
        "end": 210.0,      # ~3:30
        "note": "叙述的歴史説明",
    },
    "L3": {
        "url": "https://www.ted.com/talks/al_gore_averting_the_climate_crisis",
        "speaker": "Al Gore",
        "title": "Averting the Climate Crisis",
        "year": 2006,
        "start": 300.0,    # ~5:00
        "end": 390.0,      # ~6:30
        "note": "政策説明調、グラフ解説",
    },
}

# ── Audio parameters ──
SAMPLE_RATE = 16000     # 16kHz mono for Whisper & ACN features
WHISPER_MODEL = "medium"

# ── Subtitle parameters ──
CONTENT_POS = {"NOUN", "VERB", "ADJ", "ADV"}
PROM_LOW = 0.33
PROM_MID = 0.66
CONDITIONS = ["normal", "syntactic", "prosody", "syn_prosody"]
CHUNK_INTERVAL_S = 0.5  # Subtitle chunk split interval


def ensure_dirs():
    """Create all output directories."""
    for d in ALL_DIRS:
        d.mkdir(parents=True, exist_ok=True)


def get_clip_ids(clip_filter=None):
    """Return list of clip IDs, optionally filtered."""
    if clip_filter:
        ids = [c.strip() for c in clip_filter.split(",")]
        for cid in ids:
            if cid not in TALKS:
                raise ValueError(f"Unknown clip ID: {cid}. Available: {list(TALKS.keys())}")
        return ids
    return list(TALKS.keys())
