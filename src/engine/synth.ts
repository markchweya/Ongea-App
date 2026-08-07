/**
 * Render a script as Hawi or Lexa, in any of the studio languages.
 *
 * The MMS models Ongea runs on are single-speaker in name only. They were
 * trained on corpora read by several people, and because nothing conditions the
 * model on who is talking, the speaker it settles into is decided by the
 * wording. Measured on the German model, the same settings produced clauses
 * anywhere between 85 Hz and 254 Hz — a man reading one sentence and a woman
 * reading the next.
 *
 * So the model's own register is not trusted. Every clause is measured after it
 * is rendered and moved onto the register of the selected voice, which is what
 * makes the choice of words stop mattering.
 */

import { AutoTokenizer, VitsModel, env } from '@huggingface/transformers'
import asyncifyLoader from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import asyncifyRuntime from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import plainLoader from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'
import plainRuntime from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'

import * as dsp from './dsp'
import { findLanguage, findVoice, type LanguageCode, type VoiceId } from './catalog'
import { paceRate, pauseScale, pitchTrim, type Controls } from './controls'
import { splitIntoClauses } from './phrasing'

/**
 * How far a clause's formants may be moved, and how hard they follow the pitch.
 *
 * Formants carry most of what makes a voice sound male or female, so they have
 * to move — but they cannot move as far as the pitch does. A clause needing a
 * whole octave of pitch gets only about a quarter of that in formant shift; past
 * these bounds the vocal tract stops sounding like a person's.
 */
const FORMANT_FOLLOW = 0.3
const MIN_FORMANT = 0.86
const MAX_FORMANT = 1.22

// Serve the runtime from our own origin. Left alone, transformers.js builds a
// jsdelivr URL out of whichever onnxruntime-web version it depends on, which is
// not always a version published to npm. Importing the binaries as assets hands
// the problem to the bundler, which knows where it put them.
// Safari has no working asyncify build, so it gets the plain one.
const safari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
env.backends.onnx.wasm!.wasmPaths = safari
  ? { mjs: plainLoader, wasm: plainRuntime }
  : { mjs: asyncifyLoader, wasm: asyncifyRuntime }

/** Loading and inference both happen off the main thread, one language at a time. */
const loaders = new Map<string, Promise<LoadedVoice>>()

interface LoadedVoice {
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>
  model: Awaited<ReturnType<typeof VitsModel.from_pretrained>>
  sampleRate: number
}

export interface RenderRequest extends Controls {
  text: string
  voiceId: VoiceId
  languageCode: LanguageCode
}

export interface RenderResult {
  audio: Float32Array
  sampleRate: number
  seconds: number
  clauses: number
}

export type Progress =
  | { stage: 'loading'; ratio: number }
  | { stage: 'speaking'; ratio: number; clause: number; total: number }

export type ProgressHandler = (progress: Progress) => void

async function loadVoice(languageCode: LanguageCode, onProgress: ProgressHandler): Promise<LoadedVoice> {
  const language = findLanguage(languageCode)
  const cached = loaders.get(language.model.id)
  if (cached) return cached

  // Swahili is served from our own bundle, the rest from the Hub. Flipping both
  // switches per load keeps transformers.js from probing the wrong origin and
  // logging a 404 for every file.
  const bundled = language.model.source === 'bundled'
  env.allowLocalModels = bundled
  env.allowRemoteModels = !bundled
  env.localModelPath = `${import.meta.env.BASE_URL}models/`

  const progress_callback = (event: { status: string; progress?: number }) => {
    if (event.status === 'progress' && typeof event.progress === 'number') {
      onProgress({ stage: 'loading', ratio: Math.min(1, event.progress / 100) })
    }
  }

  const pending = (async (): Promise<LoadedVoice> => {
    const [tokenizer, model] = await Promise.all([
      AutoTokenizer.from_pretrained(language.model.id, { progress_callback }),
      VitsModel.from_pretrained(language.model.id, { dtype: 'q8', progress_callback }),
    ])
    const sampleRate = (model.config as { sampling_rate?: number }).sampling_rate ?? 16000
    return { tokenizer, model, sampleRate }
  })()

  loaders.set(language.model.id, pending)
  try {
    return await pending
  } catch (error) {
    loaders.delete(language.model.id)
    throw error
  }
}

/** Render one clause and move it onto the voice's register. */
async function speakClause(
  loaded: LoadedVoice,
  clause: string,
  restingPitch: number,
  targetPitch: number,
  durationRatio: number,
): Promise<Float32Array> {
  const inputs = loaded.tokenizer(clause)
  const { waveform } = await loaded.model(inputs)

  const raw = Float32Array.from(waveform.data as ArrayLike<number>)
  const spoken = dsp.trimSilence(raw, loaded.sampleRate)
  if (!spoken.length) return spoken

  const measured = dsp.medianPitch(spoken, loaded.sampleRate) ?? restingPitch
  const formant = Math.max(
    MIN_FORMANT,
    Math.min(MAX_FORMANT, (targetPitch / measured) ** FORMANT_FOLLOW),
  )
  const moved = dsp.reshape(spoken, measured, targetPitch, formant, durationRatio, loaded.sampleRate)
  return dsp.fadeEdges(moved, loaded.sampleRate)
}

export async function render(request: RenderRequest, onProgress: ProgressHandler): Promise<RenderResult> {
  const language = findLanguage(request.languageCode)
  const voice = findVoice(request.voiceId)

  const clauses = splitIntoClauses(request.text, pauseScale(request.pause))
  if (!clauses.length) throw new Error('Write something first.')

  const loaded = await loadVoice(request.languageCode, onProgress)
  const targetPitch = voice.targetPitch * pitchTrim(request.pitch)
  const durationRatio = 1 / paceRate(request.pace)

  const pieces: Float32Array[] = []
  for (const [index, clause] of clauses.entries()) {
    onProgress({ stage: 'speaking', ratio: index / clauses.length, clause: index + 1, total: clauses.length })

    const spoken = await speakClause(loaded, clause.text, language.restingPitch, targetPitch, durationRatio)
    if (!spoken.length) continue

    pieces.push(spoken)
    pieces.push(dsp.silence(clause.pause, loaded.sampleRate))
  }

  if (!pieces.length) throw new Error('Nothing in this script could be spoken.')

  const audio = dsp.normalisePeak(dsp.concatenate(pieces))
  return {
    audio,
    sampleRate: loaded.sampleRate,
    seconds: audio.length / loaded.sampleRate,
    clauses: clauses.length,
  }
}
