/**
 * The two Ongea voices, the languages they speak, and the model behind each.
 *
 * Two different kinds of model are in play, and the difference matters:
 *
 * - `piper` models are single-speaker. They were each trained on one person
 *   reading, so they sound like that person no matter what the script says, and
 *   the engine leaves their pitch alone.
 * - `mms` models are single-speaker in name only, and the wording decides who
 *   is talking. Those need the register locking in `synth.ts`.
 *
 * Swahili is still on MMS because no clearly licensed single-speaker Swahili
 * voice exists yet. German and French are not, which is why they sound better.
 */

export type VoiceId = 'hawi' | 'lexa'
export type LanguageCode = 'sw' | 'de' | 'fr'

/** Where the weights come from and how they are driven. */
export type Model =
  | {
      runtime: 'piper'
      /** Path within the rhasspy/piper-voices repo, without the extension. */
      path: string
      /** Only set for the multi-speaker voices. */
      speakerId?: number
      licence: string
      credit: string
    }
  | {
      runtime: 'mms'
      id: string
      source: 'hub' | 'bundled'
      /** Median pitch the model tends to return, used when a clause is too short to measure. */
      restingPitch: number
      licence: string
      credit: string
    }

export interface Voice {
  id: VoiceId
  name: string
  /**
   * Register the MMS languages are moved onto. Piper voices already have a
   * register of their own and ignore this.
   */
  targetPitch: number
  summary: string
}

export interface Language {
  code: LanguageCode
  nativeName: string
  englishName: string
  models: Record<VoiceId, Model>
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
    models: {
      hawi: {
        runtime: 'mms',
        id: 'mms-tts-swh',
        source: 'bundled',
        restingPitch: 145,
        licence: 'CC-BY-NC-4.0',
        credit: 'Meta MMS',
      },
      lexa: {
        runtime: 'mms',
        id: 'mms-tts-swh',
        source: 'bundled',
        restingPitch: 145,
        licence: 'CC-BY-NC-4.0',
        credit: 'Meta MMS',
      },
    },
    sampleScript:
      'Habari, karibu Ongea. Andika maandishi yako hapa, kisha sikiliza. Sauti moja, thabiti, kwa kila neno.',
    placeholder: 'Andika au bandika maandishi yako ya Kiswahili hapa',
  },
  {
    code: 'de',
    nativeName: 'Deutsch',
    englishName: 'German',
    models: {
      hawi: {
        runtime: 'piper',
        path: 'de/de_DE/thorsten/medium/de_DE-thorsten-medium',
        licence: 'CC0',
        credit: 'Thorsten Müller',
      },
      lexa: {
        runtime: 'piper',
        path: 'de/de_DE/kerstin/low/de_DE-kerstin-low',
        licence: 'CC0',
        credit: 'Kerstin (Piper)',
      },
    },
    sampleScript:
      'Hallo, willkommen bei Ongea. Schreibe deinen Text hier, und hoere zu. Eine Stimme, die gleich bleibt.',
    placeholder: 'Schreibe oder fuege deinen deutschen Text hier ein',
  },
  {
    code: 'fr',
    nativeName: 'Francais',
    englishName: 'French',
    models: {
      // `gilles` and `mls_1840` are the other single-speaker French voices, but
      // their phoneme sets have no combining tilde, so every nasal vowel comes
      // out denasalised. Neither is usable.
      hawi: {
        runtime: 'piper',
        path: 'fr/fr_FR/upmc/medium/fr_FR-upmc-medium',
        speakerId: 1,
        licence: 'CC-BY-SA-4.0',
        credit: 'UPMC Pierre (MaryTTS)',
      },
      lexa: {
        runtime: 'piper',
        path: 'fr/fr_FR/siwis/medium/fr_FR-siwis-medium',
        licence: 'CC-BY-4.0',
        credit: 'SIWIS',
      },
    },
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
