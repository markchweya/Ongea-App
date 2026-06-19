from __future__ import annotations

import json
import os
import sqlite3
from hashlib import sha256
from functools import lru_cache
from pathlib import Path
from threading import Lock
from typing import Any, Literal


OutputFormat = Literal["wav"]
VoiceRecord = dict[str, str | int | None]
META_TTS_VOICE_ID = "meta-mms-tts-swh"
META_TTS_MODEL_BY_VOICE = {
    "meta-mms-tts-swh": "facebook/mms-tts-swh",
    "meta-mms-tts-deu": "facebook/mms-tts-deu",
    "meta-mms-tts-fra": "facebook/mms-tts-fra",
}
META_TTS_STABILITY_BY_VOICE = {
    "meta-mms-tts-swh": {"noise_scale": 0.28, "noise_scale_duration": 0.35, "seed": 1103},
    "meta-mms-tts-deu": {"noise_scale": 0.0, "noise_scale_duration": 0.0, "seed": 2203},
    "meta-mms-tts-fra": {"noise_scale": 0.24, "noise_scale_duration": 0.28, "seed": 3301},
}
_SYNTHESIS_LOCK = Lock()
META_TTS_VOICES: list[VoiceRecord] = [
    {
        "id": "meta-mms-tts-swh",
        "name": "Meta MMS TTS Swahili",
        "accent": "Kiswahili",
        "language": "sw",
        "locale": "Swahili",
        "tone": "Meta TTS model",
        "clarity": 100,
    },
    {
        "id": "meta-mms-tts-deu",
        "name": "Meta MMS TTS German",
        "accent": "Deutsch",
        "language": "de",
        "locale": "German",
        "tone": "Meta TTS model",
        "clarity": 100,
    },
    {
        "id": "meta-mms-tts-fra",
        "name": "Meta MMS TTS French",
        "accent": "Francais",
        "language": "fr",
        "locale": "French",
        "tone": "Meta TTS model",
        "clarity": 100,
    },
]


def _normalise_voice(row: dict[str, Any]) -> VoiceRecord | None:
    voice_id = row.get("id") or row.get("voice_id") or row.get("slug") or row.get("name")
    if not voice_id:
        return None

    name = row.get("name") or row.get("label") or str(voice_id)
    return {
        "id": str(voice_id),
        "name": str(name),
        "accent": str(row.get("accent") or row.get("language") or row.get("locale") or "Ongea voice"),
        "language": str(row.get("language") or row.get("lang") or row.get("language_code") or ""),
        "locale": str(row.get("locale") or row.get("language_name") or row.get("accent") or ""),
        "tone": str(row.get("tone") or row.get("description") or "Database voice"),
        "clarity": row.get("clarity"),
        "model": str(row.get("model") or row.get("model_id") or ""),
    }


def _voices_from_json(path: Path) -> list[VoiceRecord]:
    data = json.loads(path.read_text(encoding="utf-8"))
    records = data.get("voices", data) if isinstance(data, dict) else data
    if not isinstance(records, list):
        return []

    voices: list[VoiceRecord] = []
    for record in records:
        if isinstance(record, dict):
            voice = _normalise_voice(record)
            if voice:
                voices.append(voice)
    return voices


def _voices_from_sqlite(path: Path) -> list[VoiceRecord]:
    with sqlite3.connect(path) as connection:
        connection.row_factory = sqlite3.Row
        cursor = connection.cursor()
        tables = [row["name"] for row in cursor.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]

        for table_name in ("voices", "tts_voices", "voice_profiles", "speakers"):
            if table_name not in tables:
                continue

            rows = cursor.execute(f'SELECT * FROM "{table_name}"').fetchall()
            voices = [_normalise_voice(dict(row)) for row in rows]
            return [voice for voice in voices if voice]

    return []


def get_available_voices() -> list[VoiceRecord]:
    """Return voices from the configured TTS voice database.

    Supported database sources:
    - ONGEA_TTS_VOICES_JSON: JSON list or {"voices": [...]}.
    - ONGEA_TTS_DB / VOICE_DATABASE_PATH: SQLite database with a voices-like table.
    - backend/voices.json for local development.
    """
    candidates = [
        os.getenv("ONGEA_TTS_VOICES_JSON"),
        os.getenv("ONGEA_TTS_DB"),
        os.getenv("VOICE_DATABASE_PATH"),
    ]

    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate)
        if not path.exists():
            continue
        if path.suffix.lower() == ".json":
            return _voices_from_json(path)
        if path.suffix.lower() in {".db", ".sqlite", ".sqlite3"}:
            return _voices_from_sqlite(path)

    local_json = Path(__file__).resolve().parent / "voices.json"
    if local_json.exists():
        voices = _voices_from_json(local_json)
        return voices or META_TTS_VOICES

    return META_TTS_VOICES


@lru_cache(maxsize=4)
def _load_meta_mms(model_id: str):
    from transformers import AutoTokenizer, VitsModel

    tokenizer = AutoTokenizer.from_pretrained(model_id)
    model = VitsModel.from_pretrained(model_id)
    model.eval()
    return tokenizer, model


def _stable_seed_for_voice(voice: str) -> int:
    configured = META_TTS_STABILITY_BY_VOICE.get(voice, {}).get("seed")
    if isinstance(configured, int):
        return configured
    return int.from_bytes(sha256(voice.encode("utf-8")).digest()[:4], "big")


def _speaking_rate_from_pace(pace: int) -> float:
    """Map the UI pace slider to VITS speaking_rate without extreme jumps."""
    clamped = max(0, min(100, pace))
    return 0.84 + (clamped / 100) * 0.32


def _synthesize_with_meta_mms(text: str, voice: str, output_path: Path, pace: int) -> bool:
    model_id = META_TTS_MODEL_BY_VOICE.get(voice)
    if not model_id:
        return False

    try:
        import torch
        from scipy.io.wavfile import write as write_wav
        tokenizer, model = _load_meta_mms(model_id)
    except Exception:
        return False

    stability = META_TTS_STABILITY_BY_VOICE.get(voice, {})
    inputs = tokenizer(text, return_tensors="pt")

    # MMS/VITS samples latent audio, so lock and seed each render to keep one
    # selected voice from drifting between different phrases.
    with _SYNTHESIS_LOCK:
        model.noise_scale = float(stability.get("noise_scale", 0.25))
        model.noise_scale_duration = float(stability.get("noise_scale_duration", 0.25))
        torch.manual_seed(_stable_seed_for_voice(voice))
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(_stable_seed_for_voice(voice))

        with torch.inference_mode():
            waveform = model(**inputs, speaking_rate=_speaking_rate_from_pace(pace)).waveform

    audio = waveform.squeeze().cpu().numpy()
    write_wav(output_path, rate=model.config.sampling_rate, data=audio)
    return True


def synthesize(
    *,
    text: str,
    voice: str,
    language: str,
    output_format: OutputFormat,
    pace: int,
    pitch: int,
    warmth: int,
    clarity: int,
    output_dir: Path,
) -> Path:
    """Adapter boundary for the real Ongea TTS model.

    Replace the adapter payload below with your current Python model call.
    Keep the returned filename as ongealabs.wav so exports stay branded.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "ongealabs.wav"
    model_id = META_TTS_MODEL_BY_VOICE.get(voice)

    if _synthesize_with_meta_mms(text, voice, output_path, pace):
        return output_path

    payload = {
        "brand": "OngeaLabs",
        "product": "Ongea",
        "text": text,
        "voice": voice,
        "model": model_id,
        "language": language,
        "tone": {
            "pace": pace,
            "pitch": pitch,
            "warmth": warmth,
            "clarity": clarity,
        },
        "adapter_note": "Install torch and transformers to enable the Meta MMS TTS model.",
    }

    output_path.write_bytes(json.dumps(payload, indent=2).encode("utf-8"))
    return output_path
