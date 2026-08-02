# OngeaLabs

Ongea is the multilingual TTS studio owned by OngeaLabs. The React app contains the product UI, speaker library, batch production view, and settings page.

## Current local studio

- Frontend: `http://127.0.0.1:5173`
- Voice API: `http://127.0.0.1:8001`
- Product surface: OngeaLabs Voice Studio
- Supported local preview voices: Swahili, German, and French

## Run the app

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Run the Python voice API

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r backend\requirements.txt
npm run api
```

The frontend calls `http://127.0.0.1:8001/api/voices` for the speaker list and `http://127.0.0.1:8001/api/synthesize` when previewing or exporting. The UI does not include fallback sample voices; only voices returned by the API are shown.

## Connect the existing TTS models

The backend uses Meta MMS TTS for Swahili, German, and French:

- `facebook/mms-tts-swh`
- `facebook/mms-tts-deu`
- `facebook/mms-tts-fra`

The MMS adapter runs voice previews in inference mode with stable per-voice generation settings so short German, Swahili, and French phrases keep a consistent selected voice between renders.

Keep the returned filename as:

- `ongealabs.wav`

The request already passes language, speaker, and tone controls:

- `language`
- `voice`
- `pace`
- `pitch`
- `warmth`
- `clarity`

Voice options come from `get_available_voices()` in `backend/tts_engine.py`. Configure one of:

- `ONGEA_TTS_VOICES_JSON`: JSON list or `{ "voices": [...] }`
- `ONGEA_TTS_DB` or `VOICE_DATABASE_PATH`: SQLite database with a `voices`, `tts_voices`, `voice_profiles`, or `speakers` table
- `backend/voices.json` for local development
