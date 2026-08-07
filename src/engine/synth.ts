/**
 * Render a script as Hawi or Lexa, in any of the studio languages.
 *
 * Two kinds of model sit behind this, and they need opposite treatment.
 *
 * German and French use Piper voices, each trained on one person reading. They
 * sound like that person whatever the script says, so the engine takes what the
 * model gives it and only applies the studio's own controls.
 *
 * Swahili uses Meta's MMS model, which is single-speaker in name only: it was
 * trained on a corpus read by several people, and because nothing conditions it
 * on who is talking, the wording decides. Measured across clauses of one script
 * it ranged from 75 Hz to 176 Hz — a man reading one clause and a woman the
 * next. For those models the register is not trusted: every clause is measured
 * and moved onto the selected voice's pitch, formants held back so the result
 * still sounds like a person rather than a chipmunk.
 *
 * The second path exists because no clearly licensed single-speaker Swahili
 * voice was available. When one is, Swahili should move to the first path and
 * this can go.
 */

import './runtime'

import { AutoTokenizer, VitsModel, env } from '@huggingface/transformers'

import * as dsp from './dsp'
import * as piper from './piper'
import { findLanguage, findVoice, type LanguageCode, type Model, type VoiceId } from './catalog'
import { paceRate, pauseScale, pitchTrim, type Controls } from './controls'
import { splitIntoClauses } from './phrasing'

/**
 * How far a clause's formants may be moved, and how hard they follow the pitch.
 *
 * Formants carry most of what makes a voice read as male or female, so they have
 * to move — but they cannot move as far as the pitch does. A clause needing a
 * whole octave of pitch gets about a quarter of that in formant shift; past
 * these bounds a vocal tract stops sounding like a person's.
 */
const FORMANT_FOLLOW = 0.3
const MIN_FORMANT = 0.86
const MAX_FORMANT = 1.22

/** Below this the pitch trim is not worth the resynthesis it would cost. */
const TRIM_DEADZONE = 0.02

interface LoadedMms {
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>
  model: Awaited<ReturnType<typeof VitsModel.from_pretrained>>
  sampleRate: number
}

const mmsModels = new Map<string, Promise<LoadedMms>>()

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

async function loadMms(model: Model & { runtime: 'mms' }, onProgress: ProgressHandler): Promise<LoadedMms> {
  const cached = mmsModels.get(model.id)
  if (cached) return cached

  // Swahili is served from our own bundle. Flipping both switches per load keeps
  // transformers.js from probing the wrong origin and 404ing on every file.
  const bundled = model.source === 'bundled'
  env.allowLocalModels = bundled
  env.allowRemoteModels = !bundled
  env.localModelPath = `${import.meta.env.BASE_URL}models/`

  const progress_callback = (event: { status: string; progress?: number }) => {
    if (event.status === 'progress' && typeof event.progress === 'number') {
      onProgress({ stage: 'loading', ratio: Math.min(1, event.progress / 100) })
    }
  }

  const pending = (async (): Promise<LoadedMms> => {
    const [tokenizer, model_] = await Promise.all([
      AutoTokenizer.from_pretrained(model.id, { progress_callback }),
      VitsModel.from_pretrained(model.id, { dtype: 'q8', progress_callback }),
    ])
    const sampleRate = (model_.config as { sampling_rate?: number }).sampling_rate ?? 16000
    return { tokenizer, model: model_, sampleRate }
  })()

  mmsModels.set(model.id, pending)
  try {
    return await pending
  } catch (error) {
    mmsModels.delete(model.id)
    throw error
  }
}

/** One clause from a single-speaker Piper voice, pitch left where the model put it. */
async function speakPiper(
  model: Model & { runtime: 'piper' },
  clause: string,
  trim: number,
  durationRatio: number,
): Promise<{ audio: Float32Array; sampleRate: number }> {
  // Piper takes pace natively, which beats stretching the waveform afterwards.
  const { audio, sampleRate } = await piper.speak({
    path: model.path,
    speakerId: model.speakerId,
    text: clause,
    lengthScale: durationRatio,
  })

  const spoken = dsp.trimSilence(audio, sampleRate)
  if (!spoken.length || Math.abs(trim - 1) < TRIM_DEADZONE) {
    return { audio: dsp.fadeEdges(spoken, sampleRate), sampleRate }
  }

  const measured = dsp.medianPitch(spoken, sampleRate)
  if (!measured) return { audio: dsp.fadeEdges(spoken, sampleRate), sampleRate }

  const trimmed = dsp.repitch(spoken, measured, trim, 1, sampleRate)
  return { audio: dsp.fadeEdges(trimmed, sampleRate), sampleRate }
}

/** One clause from a drifting MMS model, moved onto the voice's register. */
async function speakMms(
  loaded: LoadedMms,
  model: Model & { runtime: 'mms' },
  clause: string,
  targetPitch: number,
  durationRatio: number,
): Promise<{ audio: Float32Array; sampleRate: number }> {
  const inputs = loaded.tokenizer(clause)
  const { waveform } = await loaded.model(inputs)

  const spoken = dsp.trimSilence(Float32Array.from(waveform.data as ArrayLike<number>), loaded.sampleRate)
  if (!spoken.length) return { audio: spoken, sampleRate: loaded.sampleRate }

  const measured = dsp.medianPitch(spoken, loaded.sampleRate) ?? model.restingPitch
  const formant = Math.max(MIN_FORMANT, Math.min(MAX_FORMANT, (targetPitch / measured) ** FORMANT_FOLLOW))
  const moved = dsp.reshape(spoken, measured, targetPitch, formant, durationRatio, loaded.sampleRate)
  return { audio: dsp.fadeEdges(moved, loaded.sampleRate), sampleRate: loaded.sampleRate }
}

export async function render(request: RenderRequest, onProgress: ProgressHandler): Promise<RenderResult> {
  const language = findLanguage(request.languageCode)
  const voice = findVoice(request.voiceId)
  const model = language.models[request.voiceId]

  const clauses = splitIntoClauses(request.text, pauseScale(request.pause))
  if (!clauses.length) throw new Error('Write something first.')

  const trim = pitchTrim(request.pitch)
  const durationRatio = 1 / paceRate(request.pace)

  onProgress({ stage: 'loading', ratio: 0 })
  const loaded =
    model.runtime === 'mms'
      ? await loadMms(model, onProgress)
      : await piper
          .warm(model.path, ({ loaded: got, total }) =>
            onProgress({ stage: 'loading', ratio: total ? got / total : 0 }),
          )
          .then(() => null)

  const pieces: Float32Array[] = []
  let sampleRate = 16000

  for (const [index, clause] of clauses.entries()) {
    onProgress({ stage: 'speaking', ratio: index / clauses.length, clause: index + 1, total: clauses.length })

    const spoken =
      model.runtime === 'piper'
        ? await speakPiper(model, clause.text, trim, durationRatio)
        : await speakMms(loaded!, model, clause.text, voice.targetPitch * trim, durationRatio)

    sampleRate = spoken.sampleRate
    if (!spoken.audio.length) continue

    pieces.push(spoken.audio)
    pieces.push(dsp.silence(clause.pause, sampleRate))
  }

  if (!pieces.length) throw new Error('Nothing in this script could be spoken.')

  const audio = dsp.normalisePeak(dsp.concatenate(pieces))
  return { audio, sampleRate, seconds: audio.length / sampleRate, clauses: clauses.length }
}
