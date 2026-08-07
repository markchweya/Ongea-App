/**
 * The two Ongea voices and the languages they speak.
 *
 * A voice is a target vocal register, not a separate model. Whichever language
 * is selected, every clause is measured and moved onto the chosen voice's
 * register before it leaves the engine, so the wording can no longer decide who
 * is speaking. See `synth.ts` for why that is necessary.
 */

export type VoiceId = 'hawi' | 'lexa'
export type LanguageCode = 'sw' | 'de' | 'fr'

export interface Voice {
  id: VoiceId
  name: string
  /** Median fundamental every clause is moved onto, in hertz. */
  targetPitch: number
  summary: string
}

export interface Language {
  code: LanguageCode
  /** What the language calls itself. */
  nativeName: string
  englishName: string
  /**
   * Where the ONNX weights live. Most MMS languages are published under the
   * Xenova namespace; Swahili has no published conversion, so it is exported by
   * `tools/export_onnx_voice.py` and served from `public/models`.
   */
  model: { id: string; source: 'hub' | 'bundled' }
  /**
   * Median pitch this model tends to return. Only used when a clause is too
   * short or too quiet to measure on its own.
   */
  restingPitch: number
  sampleScript: string
  placeholder: string
}

export const VOICES: Voice[] = [
  {
    id: 'hawi',
    name: 'Hawi',
    targetPitch: 112,
    summary: 'Low and unhurried. Built for narration and walkthroughs.',
  },
  {
    id: 'lexa',
    name: 'Lexa',
    targetPitch: 196,
    summary: 'Bright and forward. Built for prompts, cues and adverts.',
  },
]

export const LANGUAGES: Language[] = [
  {
    code: 'sw',
    nativeName: 'Kiswahili',
    englishName: 'Swahili',
    model: { id: 'mms-tts-swh', source: 'bundled' },
    restingPitch: 145,
    sampleScript:
      'Habari, karibu Ongea. Andika maandishi yako hapa, kisha sikiliza. Sauti moja, thabiti, kwa kila neno.',
    placeholder: 'Andika au bandika maandishi yako ya Kiswahili hapa',
  },
  {
    code: 'de',
    nativeName: 'Deutsch',
    englishName: 'German',
    model: { id: 'Xenova/mms-tts-deu', source: 'hub' },
    restingPitch: 120,
    sampleScript:
      'Hallo, willkommen bei Ongea. Schreibe deinen Text hier, und hoere zu. Eine Stimme, die gleich bleibt.',
    placeholder: 'Schreibe oder fuege deinen deutschen Text hier ein',
  },
  {
    code: 'fr',
    nativeName: 'Francais',
    englishName: 'French',
    model: { id: 'Xenova/mms-tts-fra', source: 'hub' },
    restingPitch: 110,
    sampleScript:
      'Bonjour, bienvenue sur Ongea. Ecrivez votre texte ici, puis ecoutez. Une voix qui ne change jamais.',
    placeholder: 'Ecrivez ou collez votre texte en francais ici',
  },
]

export const DEFAULT_VOICE: VoiceId = 'hawi'
export const DEFAULT_LANGUAGE: LanguageCode = 'sw'

export function findVoice(id: VoiceId): Voice {
  const voice = VOICES.find((candidate) => candidate.id === id)
  if (!voice) throw new Error(`Unknown voice: ${id}`)
  return voice
}

export function findLanguage(code: LanguageCode): Language {
  const language = LANGUAGES.find((candidate) => candidate.code === code)
  if (!language) throw new Error(`Unknown language: ${code}`)
  return language
}
