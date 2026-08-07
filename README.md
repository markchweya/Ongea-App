# Ongea

Ongea is the text-to-speech studio by OngeaLabs. Write a script in Kiswahili,
Deutsch or Francais, pick a voice, and export a WAV.

Synthesis runs in the browser. There is no API to deploy and no server to pay
for, and nothing anyone types is uploaded.

## Run it

```bash
npm install
npm run dev
```

The first render of a given voice downloads its model — 38 MB for Swahili, 63 to
77 MB for the German and French voices — and the browser caches it from then on.

## Deploy

The whole app is static, so `npm run build` and any static host will do. The
repo is already configured for Vercel — no environment variables are needed.

Note that `dist` comes to about 90 MB: the Swahili model, the eSpeak NG WASM
binaries dominate it, and both are served from the deployment.

## The two voices

Ongea has one male voice, **Hawi**, and one female voice, **Lexa**. Which model
answers to those names depends on the language, and the two cases are handled
very differently.

**German and French use Piper voices**, each trained on a single person reading.
They sound like that person whatever the script says, so the engine renders them
and leaves the pitch alone. This is the arrangement to prefer.

**Swahili uses Meta's MMS model**, which is single-speaker in name only: it was
trained on a corpus read by several people, and because nothing conditions the
model on who is talking, the wording decides. Across the clauses of one short
script it ranged from 75 Hz to 176 Hz — a man reading one clause and a woman the
next. So its register is not trusted. Every clause is measured after rendering
and moved onto the selected voice's pitch, Hawi near 112 Hz and Lexa near
196 Hz.

That move is done with PSOLA, which cuts a grain around each glottal pulse and
re-spaces them, so the vocal tract resonances survive. Resampling — the obvious
approach — scales the formants by the same ratio as the pitch, and a clause that
had to travel an octave comes back sounding like a chipmunk or a giant. The
formants do shift, because pitch alone does not carry gender, but only about a
third as far as the pitch and never beyond the bounds in `src/engine/synth.ts`.

The second path exists only because no clearly licensed single-speaker Swahili
voice was available. When one is, Swahili should move to the first path and the
register locking can go.

## Punctuation

MMS tokenizers have no symbol for a comma or a full stop. Punctuation is
stripped before the model sees it, which is why a paragraph read straight
through comes back as one unbroken run of words.

`src/engine/phrasing.ts` cuts the script on its punctuation first, renders each
clause separately, and rebuilds the rests as real silence — shorter for a comma,
longer for a full stop, longer still for a paragraph break. The Phrasing panel
under the editor is folded away by default; opening it shows how the script was
divided and, during a render, which clause is being spoken.

## Layout

```
src/engine/catalog.ts   voices, languages, and the model behind each
src/engine/phrasing.ts  punctuation to clauses
src/engine/piper.ts     eSpeak phonemes and Piper inference
src/engine/synth.ts     picks a path per model and joins the clauses
src/engine/dsp.ts       pitch measurement, PSOLA, resampling
src/App.tsx             the studio
public/models/          the Swahili model
tools/                  one build-time script, described below
```

Synthesis runs in a Web Worker so the interface stays responsive while a render
is in flight.

## Voice models

| Language | Hawi | Lexa |
| --- | --- | --- |
| Kiswahili | `facebook/mms-tts-swh` | same model, register locked |
| Deutsch | Piper `de_DE-thorsten-medium` | Piper `de_DE-kerstin-low` |
| Francais | Piper `fr_FR-upmc-medium` (pierre) | Piper `fr_FR-siwis-medium` |

Piper weights are fetched from the `rhasspy/piper-voices` repo on Hugging Face
when a voice is first used, so they are not redistributed here.

Two other single-speaker French voices, `gilles` and `mls_1840`, look like
candidates and are not: their phoneme maps have no combining tilde, so every
French nasal vowel comes out denasalised. Check the phoneme map covers real
eSpeak output before adding a voice.

Swahili has no published ONNX conversion, so it is converted here and served
from `public/models`:

```bash
pip install torch transformers onnx onnxruntime
python tools/export_onnx_voice.py facebook/mms-tts-swh public/models/mms-tts-swh
```

That is the only Python left in the project and nothing in the shipped app runs
it.

## Licensing

Three separate things carry terms, and they are worth keeping straight.

**The Swahili weights.** `facebook/mms-tts-*` is **CC-BY-NC-4.0: non-commercial
use only**, and `public/models/mms-tts-swh` is a conversion of it, so this repo
redistributes non-commercial weights. That needs resolving before Ongea is used
commercially, and swapping in a fine-tune does not resolve it: the Swahili
fine-tunes on the Hub (`FarmerlineML/swahili-tts-2025`,
`Benjamin-png/…mozilla-lady-voice-finetuned`, `khof312/mms-tts-swh-female-*`)
state no licence at all, and at least one is explicitly an MMS derivative.

**The Piper weights**, fetched at run time rather than redistributed:

| Voice | Licence | Credit |
| --- | --- | --- |
| `de_DE-thorsten-medium` | CC0 | Thorsten Müller |
| `de_DE-kerstin-low` | CC0 | Kerstin |
| `fr_FR-siwis-medium` | CC-BY 4.0 | SIWIS corpus |
| `fr_FR-upmc-medium` | CC-BY-SA 4.0 | UPMC Pierre, MaryTTS |

Avoid `fr_FR-tom`, which is AGPLv3.

**eSpeak NG**, which Piper needs for phonemisation, is **GPLv3**, and it is
bundled into the build. Anything shipping this inherits those terms. The
alternative is a dictionary-based phonemiser, at some accuracy cost.

## Known limits

- **Swahili is the weak language**, which is awkward for a product named in it.
  It is the only one still on a drifting model, and the only one with no
  clearly licensed voice. Piper's one Swahili voice, `sw_CD-lanfrica`, gives its
  dataset licence as "See URL" and is fine-tuned from an English voice. Getting
  an explicit licence for one of the Hub fine-tunes would be the cheapest fix:
  `FarmerlineML/swahili-tts-2025` measured 0.8 semitones of drift, which is as
  steady as any Piper voice.
- Numbers are read as separate digits. There is no number-to-words expansion
  for any of the three languages.
- Piper weights are the full-precision files, 63 to 77 MB. Quantising them to
  int8 would cut that to roughly a third, as it did for Swahili.
```
