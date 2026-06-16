from __future__ import annotations

from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .tts_engine import get_available_voices, synthesize


ROOT = Path(__file__).resolve().parent
GENERATED_DIR = ROOT / "generated"

app = FastAPI(title="OngeaLabs Voice API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:5288",
        "http://127.0.0.1:5288",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SynthesisRequest(BaseModel):
    text: str = Field(min_length=1)
    voice: str = Field(min_length=1)
    language: str = "sw"
    output_format: Literal["wav"] = "wav"
    pace: int = Field(default=52, ge=0, le=100)
    pitch: int = Field(default=44, ge=0, le=100)
    warmth: int = Field(default=68, ge=0, le=100)
    clarity: int = Field(default=82, ge=0, le=100)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ready", "brand": "OngeaLabs", "product": "Ongea"}


@app.get("/api/voices")
def list_voices() -> dict[str, object]:
    return {"voices": get_available_voices()}


@app.post("/api/synthesize")
def create_speech(request: SynthesisRequest) -> FileResponse:
    available_voices = get_available_voices()
    voice_ids = {voice["id"] for voice in available_voices}
    if not voice_ids:
        raise HTTPException(status_code=503, detail="No TTS voices are available in the configured voice database.")
    if request.voice not in voice_ids:
        raise HTTPException(status_code=400, detail="Selected voice is not available in the configured voice database.")

    output_path = synthesize(
        text=request.text,
        voice=request.voice,
        language=request.language,
        output_format=request.output_format,
        pace=request.pace,
        pitch=request.pitch,
        warmth=request.warmth,
        clarity=request.clarity,
        output_dir=GENERATED_DIR,
    )
    return FileResponse(
        output_path,
        filename=output_path.name,
        media_type="audio/wav",
    )
