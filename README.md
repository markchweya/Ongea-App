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

The first render downloads a voice model, roughly 38 MB, and the browser caches
it from then on.

## Deploy

The whole app is static, so `npm run build` and any static host will do. The
repo is already configured for Vercel — no environment variables are needed.

Note that `dist` comes to about 70 MB: the Swahili model and the ONNX Runtime
binaries dominate it, and both are served from the deployment.

## The two voices

Ongea has one male voice, **Hawi**, and one female voice, **Lexa**. A voice is
not a separate model — it is a target vocal register that holds across every
language and every phrase.

That indirection is not decoration. The MMS models underneath are single-speaker
in name only: they were trained on corpora read by several people, and because
nothing conditions the model on who is talking, the speaker it settles into is
decided by the wording. Measured on the German model, identical settings
produced clauses anywhere from 85 Hz to 254 Hz — a man reading one sentence and
a woman reading the next.

So the model's register is not trusted. Every clause is measured after it is
rendered and moved onto the selected voice's register by resampling, which
carries the formants along with the fundamental and is what makes the result
read as a different speaker rather than as the same speaker sped up. Hawi lands
near 112 Hz and Lexa near 196 Hz, whatever the words.

The bounds in `src/engine/synth.ts` cap how far a clause may be moved. A clause
that had to travel a long way is audibly more processed than one that barely
moved; the alternative is letting the gender wander, which is worse.

## Punctuation

MMS tokenizers have no symbol for a comma or a full stop. Punctuation is
stripped before the model sees it, which is why a paragraph read straight
through comes back as one unbroken run of words.

`src/engine/phrasing.ts` cuts the script on its punctuation first, renders each
clause separately, and rebuilds the rests as real silence — shorter for a comma,
longer for a full stop, longer still for a paragraph break. The Phrasing strip
under the editor shows exactly how a script was divided, so the effect of a mark
is visible before anything is rendered.

## Layout

```
src/engine/    catalog, phrasing, DSP, synthesis, worker
src/App.tsx    the studio
tools/         one build-time script, described below
public/models/ the Swahili model
```

Synthesis runs in a Web Worker so the interface stays responsive while a render
is in flight.

## Voice models

German and French load `Xenova/mms-tts-deu` and `Xenova/mms-tts-fra` from the
Hugging Face CDN. Swahili has no published ONNX conversion, so it is converted
here and served from `public/models`:

```bash
pip install torch transformers onnx onnxruntime
python tools/export_onnx_voice.py facebook/mms-tts-swh public/models/mms-tts-swh
```

That is the only Python left in the project and nothing in the shipped app runs
it. Re-run it only when adding a language with no published conversion. To add a
language that does have one, a new entry in `src/engine/catalog.ts` is enough.

## Licensing of the voice models

This matters more than it looks, because the repo redistributes model weights.

`facebook/mms-tts-*` — which all three languages currently run on — is
**CC-BY-NC-4.0: non-commercial use only**. `public/models/mms-tts-swh` is a
conversion of those weights and carries the same restriction, so this repo is
currently redistributing non-commercial weights. That needs resolving before
Ongea is used commercially, and it is not resolved by swapping in a fine-tune:
the Swahili fine-tunes on the Hub (`FarmerlineML/swahili-tts-2025`,
`Benjamin-png/…mozilla-lady-voice-finetuned`, `khof312/mms-tts-swh-female-*`)
state no licence at all, and at least one is explicitly an MMS derivative.

Voices with licences clean enough to build a product on, checked against their
model cards:

| Language | Male | Female |
| --- | --- | --- |
| German | Piper `de_DE-thorsten` — CC0 | Piper `de_DE-kerstin` — CC0 |
| French | Piper `fr_FR-gilles` — CC0 | Piper `fr_FR-siwis` — CC-BY 4.0 |
| Swahili | nothing clearly licensed found | nothing clearly licensed found |

Avoid `fr_FR-tom`, which is AGPLv3. Piper's one Swahili voice,
`sw_CD-lanfrica`, gives its dataset licence only as "See URL" and is fine-tuned
from an English voice.

Piper voices need eSpeak-NG for phonemisation, and eSpeak-NG is **GPLv3** — so
adopting them puts GPL obligations on whatever ships it, unless a
dictionary-based phonemiser is used instead.

## Known limits

- Numbers are read as separate digits. There is no number-to-words expansion
  for any of the three languages.
- Swahili could do better than a pitch-shifted single model. There are
  fine-tuned female Swahili checkpoints on the Hub, such as
  `khof312/mms-tts-swh-female-1`, that would give Lexa a real voice rather than
  a shifted one, at the cost of a second model download per language.
```
