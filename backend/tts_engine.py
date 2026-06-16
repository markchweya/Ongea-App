from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from typing import Any, Literal


OutputFormat = Literal["wav"]
VoiceRecord = dict[str, str | int | None]
META_TTS_VOICE_ID = "meta-mms-tts-swh"
META_TTS_MODEL_ID = "facebook/mms-tts-swh"
META_TTS_VOICE: VoiceRecord = {
    "id": META_TTS_VOICE_ID,
    "name": "Meta MMS TTS Swahili",
    "accent": "Kiswahili",
    "tone": "Meta TTS model",
    "clarity": 100,
}


def _normalise_voice(row: dict[str, Any]) -> VoiceRecord | None:
    voice_id = row.get("id") or row.get("voice_id") or row.get("slug") or row.get("name")
    if not voice_id:
        return None

    name = row.get("name") or row.get("label") or str(voice_id)
    return {
        "id": str(voice_id),
        "name": str(name),
        "accent": str(row.get("accent") or row.get("language") or row.get("locale") or "Ongea voice"),
        "tone": str(row.get("tone") or row.get("description") or "Database voice"),
        "clarity": row.get("clarity"),
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
        return voices or [META_TTS_VOICE]

    return [META_TTS_VOICE]


def _synthesize_with_meta_mms(text: str, output_path: Path) -> bool:
    try:
        import torch
        from scipy.io.wavfile import write as write_wav
        from transformers import VitsModel, AutoTokenizer
    except Exception:
        return False

    tokenizer = AutoTokenizer.from_pretrained(META_TTS_MODEL_ID)
    model = VitsModel.from_pretrained(META_TTS_MODEL_ID)
    inputs = tokenizer(text, return_tensors="pt")

    with torch.no_grad():
        waveform = model(**inputs).waveform

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

    if voice == META_TTS_VOICE_ID and _synthesize_with_meta_mms(text, output_path):
        return output_path

    payload = {
        "brand": "OngeaLabs",
        "product": "Ongea",
        "text": text,
        "voice": voice,
        "model": META_TTS_MODEL_ID if voice == META_TTS_VOICE_ID else None,
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
