/**
 * Piper voices: eSpeak phonemes in, waveform out.
 *
 * Piper models take phoneme ids rather than characters, so text has to be run
 * through eSpeak NG first. That is a heavier dependency than the MMS path — a
 * WASM build of eSpeak, downloaded once — but it buys single-speaker voices,
 * which is the only real cure for the drift documented in `synth.ts`.
 *
 * Licence note: eSpeak NG is GPLv3, so anything shipping this file inherits
 * those terms. The voice weights themselves are fetched from Hugging Face at
 * run time rather than redistributed here; their individual licences are
 * recorded in `catalog.ts`.
 */

import ESpeakNg from 'espeak-ng'
import * as ort from 'onnxruntime-web'

const VOICE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main'

/** Sentinels every Piper phoneme map defines. */
const BOS = '^'
const EOS = '$'
const PAD = '_'

/**
 * eSpeak joins the halves of a diphthong or affricate with a zero-width joiner.
 * Piper's maps hold the halves separately, so the joiner is dropped.
 */
const TIE = '‍'

interface VoiceConfig {
  audio: { sample_rate: number }
  espeak: { voice: string }
  inference: { noise_scale: number; length_scale: number; noise_w: number }
  num_speakers: number
  phoneme_id_map: Record<string, number[]>
}

interface LoadedVoice {
  session: ort.InferenceSession
  config: VoiceConfig
  /** Phoneme keys longest first, so a nasal vowel wins over its bare vowel. */
  symbols: string[]
}

export interface PiperProgress {
  loaded: number
  total: number
}

const voices = new Map<string, Promise<LoadedVoice>>()

export async function phonemize(espeakVoice: string, text: string): Promise<string> {
  const espeak = await ESpeakNg({
    // -q suppresses audio, --ipa=3 gives IPA with no separators, and the result
    // is written to a file in the WASM filesystem rather than to stdout.
    arguments: ['--phonout', 'out', '--sep=""', '-q', '-b=1', '--ipa=3', '-v', espeakVoice, text],
    print: () => {},
    printErr: () => {},
  })
  return (espeak.FS.readFile('out', { encoding: 'utf8' }) as string).trim().replace(/\s+/g, ' ')
}

/** Turn an IPA string into the id sequence a Piper model expects. */
export function toPhonemeIds(ipa: string, config: VoiceConfig, symbols: string[]): number[] {
  const map = config.phoneme_id_map
  const ids = [...map[BOS]]

  let cursor = 0
  while (cursor < ipa.length) {
    if (ipa[cursor] === TIE) {
      cursor += 1
      continue
    }

    const symbol = symbols.find((candidate) => ipa.startsWith(candidate, cursor))
    if (!symbol) {
      // A phoneme this voice was never trained on. Skipping it is better than
      // emitting an id the model has no embedding for.
      cursor += 1
      continue
    }

    // Piper separates every phoneme with the pad symbol.
    ids.push(...map[symbol], ...map[PAD])
    cursor += symbol.length
  }

  ids.push(...map[EOS])
  return ids
}

async function fetchWithProgress(url: string, onProgress?: (progress: PiperProgress) => void) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not fetch the voice model (${response.status})`)

  const total = Number(response.headers.get('content-length') ?? 0)
  if (!response.body || !total || !onProgress) return new Uint8Array(await response.arrayBuffer())

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    onProgress({ loaded, total })
  }

  const bytes = new Uint8Array(loaded)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.length
  }
  return bytes
}

export async function loadVoice(path: string, onProgress?: (progress: PiperProgress) => void) {
  const cached = voices.get(path)
  if (cached) return cached

  const pending = (async (): Promise<LoadedVoice> => {
    const config = (await (await fetch(`${VOICE_BASE}/${path}.onnx.json`)).json()) as VoiceConfig
    const weights = await fetchWithProgress(`${VOICE_BASE}/${path}.onnx`, onProgress)
    const session = await ort.InferenceSession.create(weights)
    const symbols = Object.keys(config.phoneme_id_map).sort((a, b) => b.length - a.length)
    return { session, config, symbols }
  })()

  voices.set(path, pending)
  try {
    return await pending
  } catch (error) {
    voices.delete(path)
    throw error
  }
}

export interface PiperRequest {
  path: string
  speakerId?: number
  text: string
  /** Above one slows the delivery down, which is how Piper spells pace. */
  lengthScale: number
}

export async function speak(request: PiperRequest): Promise<{ audio: Float32Array; sampleRate: number }> {
  const { config, session, symbols } = await loadVoice(request.path)
  const ipa = await phonemize(config.espeak.voice, request.text)
  const ids = toPhonemeIds(ipa, config, symbols)

  const feeds: Record<string, ort.Tensor> = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor(
      'float32',
      Float32Array.from([
        config.inference.noise_scale,
        config.inference.length_scale * request.lengthScale,
        config.inference.noise_w,
      ]),
      [3],
    ),
  }

  if (config.num_speakers > 1) {
    feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(request.speakerId ?? 0)]), [1])
  }

  const result = await session.run(feeds)
  const output = result[session.outputNames[0]]
  return {
    audio: Float32Array.from(output.data as Float32Array),
    sampleRate: config.audio.sample_rate,
  }
}

/** Fetch the weights so the first render is not also the first download. */
export async function warm(path: string, onProgress?: (progress: PiperProgress) => void) {
  await loadVoice(path, onProgress)
}
