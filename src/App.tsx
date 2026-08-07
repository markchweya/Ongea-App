import { useMemo, useState } from 'react'

import {
  DEFAULT_LANGUAGE,
  DEFAULT_VOICE,
  LANGUAGES,
  VOICES,
  findLanguage,
  findVoice,
  type LanguageCode,
  type VoiceId,
} from './engine/catalog'
import {
  DEFAULT_CONTROLS,
  paceRate,
  pauseScale,
  pitchSemitones,
  type Controls,
} from './engine/controls'
import { splitIntoClauses } from './engine/phrasing'
import { useOngea, type Status } from './engine/useOngea'

type Scripts = Record<LanguageCode, string>

const STARTING_SCRIPTS = Object.fromEntries(
  LANGUAGES.map((language) => [language.code, language.sampleScript]),
) as Scripts

export default function App() {
  const [languageCode, setLanguageCode] = useState<LanguageCode>(DEFAULT_LANGUAGE)
  const [voiceId, setVoiceId] = useState<VoiceId>(DEFAULT_VOICE)
  const [scripts, setScripts] = useState<Scripts>(STARTING_SCRIPTS)
  const [controls, setControls] = useState<Controls>(DEFAULT_CONTROLS)

  const { clip, speak, status, busy } = useOngea()

  const language = findLanguage(languageCode)
  const voice = findVoice(voiceId)
  const script = scripts[languageCode]

  const clauses = useMemo(
    () => splitIntoClauses(script, pauseScale(controls.pause)),
    [script, controls.pause],
  )

  function updateScript(next: string) {
    setScripts((current) => ({ ...current, [languageCode]: next }))
  }

  function updateControl(key: keyof Controls, value: number) {
    setControls((current) => ({ ...current, [key]: value }))
  }

  return (
    <div className="page">
      <header className="masthead">
        <div className="wordmark">
          <h1>Ongea</h1>
          <p className="byline">OngeaLabs</p>
        </div>
        <p>
          Two voices, three languages, one register throughout. Everything is rendered on this
          device — nothing you write is uploaded.
        </p>
      </header>

      <main className="studio">
        <section className="composer">
          <nav className="languages" aria-label="Language">
            {LANGUAGES.map((entry) => (
              <button
                key={entry.code}
                type="button"
                className="language"
                aria-current={entry.code === languageCode || undefined}
                onClick={() => setLanguageCode(entry.code)}
              >
                {entry.nativeName}
              </button>
            ))}
          </nav>

          <textarea
            className="script"
            value={script}
            spellCheck={false}
            placeholder={language.placeholder}
            aria-label={`Script in ${language.englishName}`}
            onChange={(event) => updateScript(event.target.value)}
          />

          <Phrasing clauses={clauses} />
        </section>

        <aside className="settings">
          <fieldset className="voices">
            <legend>Voice</legend>
            {VOICES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="voice"
                aria-pressed={entry.id === voiceId}
                onClick={() => setVoiceId(entry.id)}
              >
                <strong>{entry.name}</strong>
                <span>{entry.summary}</span>
              </button>
            ))}
          </fieldset>

          <fieldset className="dials">
            <legend>Delivery</legend>
            <Dial
              label="Pace"
              hint="How quickly the words are spoken"
              reading={`${paceRate(controls.pace).toFixed(2)}×`}
              value={controls.pace}
              onChange={(value) => updateControl('pace', value)}
            />
            <Dial
              label="Pitch"
              hint={`Trim around ${voice.name}'s register`}
              reading={formatSemitones(pitchSemitones(controls.pitch))}
              value={controls.pitch}
              onChange={(value) => updateControl('pitch', value)}
            />
            <Dial
              label="Pause"
              hint="Length of every punctuation break"
              reading={`${(0.44 * pauseScale(controls.pause)).toFixed(2)} s`}
              value={controls.pause}
              onChange={(value) => updateControl('pause', value)}
            />
          </fieldset>
        </aside>
      </main>

      <footer className="transport">
        <button
          type="button"
          className="speak"
          disabled={busy || !clauses.length}
          onClick={() => speak({ text: script, voiceId, languageCode, ...controls })}
        >
          <PlayMark />
          {busy ? 'Working' : `Speak as ${voice.name}`}
        </button>

        <div className="readout">
          <Report status={status} clip={clip} voiceName={voice.name} />
          {clip && !busy && <audio controls src={clip.url} />}
        </div>

        <a
          className="download"
          href={clip?.url ?? undefined}
          download={`ongea-${voiceId}-${languageCode}.wav`}
          aria-disabled={!clip || busy || undefined}
        >
          Download WAV
        </a>
      </footer>
    </div>
  )
}

/**
 * Shows how the script was cut up before it was spoken. This is the punctuation
 * doing its work: each block is one clause, and the gap after it is the rest the
 * mark earned.
 */
function Phrasing({ clauses }: { clauses: { text: string; pause: number }[] }) {
  if (!clauses.length) {
    return <p className="phrasing empty">Nothing to say yet.</p>
  }

  return (
    <div className="phrasing">
      <h2>
        Phrasing
        <span>
          {clauses.length} {clauses.length === 1 ? 'clause' : 'clauses'}
        </span>
      </h2>
      <ol>
        {clauses.map((clause, index) => (
          <li key={`${index}-${clause.text}`}>
            <span className="clause">{clause.text}</span>
            {clause.pause > 0.13 && <span className="rest">{Math.round(clause.pause * 1000)} ms</span>}
          </li>
        ))}
      </ol>
    </div>
  )
}

function Dial({
  hint,
  label,
  onChange,
  reading,
  value,
}: {
  hint: string
  label: string
  onChange: (value: number) => void
  reading: string
  value: number
}) {
  return (
    <label className="dial">
      <span className="dial-head">
        <strong>{label}</strong>
        <output>{reading}</output>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <small>{hint}</small>
    </label>
  )
}

function Report({
  clip,
  status,
  voiceName,
}: {
  clip: { seconds: number; clauses: number } | null
  status: Status
  voiceName: string
}) {
  if (status.kind === 'loading') {
    return (
      <Progress
        ratio={status.ratio}
        label={status.ratio > 0 ? `Fetching the voice model — ${Math.round(status.ratio * 100)}%` : 'Preparing'}
      />
    )
  }

  if (status.kind === 'speaking') {
    return (
      <Progress
        ratio={status.clause / status.total}
        label={`Speaking clause ${status.clause} of ${status.total}`}
      />
    )
  }

  if (status.kind === 'failed') {
    return <p className="report failed">{status.message}</p>
  }

  if (status.kind === 'ready' && clip) {
    return (
      <p className="report">
        {voiceName} read {clip.clauses} {clip.clauses === 1 ? 'clause' : 'clauses'} in{' '}
        {clip.seconds.toFixed(1)} seconds.
      </p>
    )
  }

  return <p className="report muted">The first render downloads the voice model, around 38 MB. After that it is cached.</p>
}

function Progress({ label, ratio }: { label: string; ratio: number }) {
  return (
    <p className="report">
      <span className="bar" role="progressbar" aria-valuenow={Math.round(ratio * 100)}>
        <span style={{ width: `${Math.max(3, ratio * 100)}%` }} />
      </span>
      {label}
    </p>
  )
}

function formatSemitones(value: number): string {
  if (Math.abs(value) < 0.05) return 'centred'
  return `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(1)} st`
}

function PlayMark() {
  return (
    <svg viewBox="0 0 12 14" width="12" height="14" aria-hidden="true">
      <path d="M1 1.4v11.2a.6.6 0 0 0 .93.5l8.4-5.6a.6.6 0 0 0 0-1L1.93.9A.6.6 0 0 0 1 1.4Z" />
    </svg>
  )
}
