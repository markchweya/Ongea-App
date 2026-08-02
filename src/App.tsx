import {
  Activity,
  AudioLines,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  FileAudio,
  FlaskConical,
  Globe2,
  Languages,
  ListChecks,
  Mic2,
  Play,
  Settings,
  SlidersHorizontal,
  Wand2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import './App.css'

type View = 'studio' | 'batch' | 'voices' | 'settings'
type OutputFormat = 'wav'
type ApiStatus = 'checking' | 'ready' | 'offline'
type Voice = {
  id: string
  name: string
  accent: string
  language?: string
  locale?: string
  model?: string
  tone: string
  clarity?: number | null
}
type ToneKey = 'pace' | 'pitch' | 'warmth' | 'clarity'
type ToneSettings = Record<ToneKey, number>

const LOCAL_API_BASE_URL = 'http://127.0.0.1:8001'
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? LOCAL_API_BASE_URL : '')
const META_TTS_VOICE_ID = 'meta-mms-tts-swh'
const BUILT_IN_VOICES: Voice[] = [
  {
    id: 'meta-mms-tts-swh',
    name: 'Meta MMS TTS Swahili',
    accent: 'Kiswahili',
    language: 'sw',
    locale: 'Swahili',
    model: 'facebook/mms-tts-swh',
    tone: 'Stable OngeaLabs preview voice',
    clarity: 100,
  },
  {
    id: 'meta-mms-tts-deu',
    name: 'Meta MMS TTS German',
    accent: 'Deutsch',
    language: 'de',
    locale: 'German',
    model: 'facebook/mms-tts-deu',
    tone: 'Stable OngeaLabs preview voice',
    clarity: 100,
  },
  {
    id: 'meta-mms-tts-fra',
    name: 'Meta MMS TTS French',
    accent: 'Francais',
    language: 'fr',
    locale: 'French',
    model: 'facebook/mms-tts-fra',
    tone: 'Stable OngeaLabs preview voice',
    clarity: 100,
  },
]
const defaultScriptByLanguage: Record<string, string> = {
  sw: 'Habari, karibu Ongea. Andika maandishi yako ya Kiswahili hapa, kisha tengeneza sauti.',
  de: 'Hallo, willkommen bei Ongea. Schreibe deinen deutschen Text hier und erstelle daraus eine klare Sprachaufnahme.',
  fr: 'Bonjour, bienvenue sur Ongea. Ecrivez votre texte en francais ici, puis creez une voix claire et naturelle.',
}
const placeholderByLanguage: Record<string, string> = {
  sw: 'Bandika maandishi ya Kiswahili hapa...',
  de: 'Schreibe oder fuege deinen deutschen Text hier ein...',
  fr: 'Ecrivez ou collez votre texte en francais ici...',
}

const sampleScripts = [
  {
    title: 'Welcome cue',
    tone: 'Warm Swahili product intro',
    voiceId: 'meta-mms-tts-swh',
    text: 'Karibu Ongea. Sauti za Afrika, tayari kwa bidhaa zako.',
  },
  {
    title: 'German onboarding',
    tone: 'Clear German product line',
    voiceId: 'meta-mms-tts-deu',
    text: 'Willkommen bei Ongea. Erstelle klare Sprachaufnahmen fuer deine naechste Produktidee.',
  },
  {
    title: 'French narration',
    tone: 'Friendly French narration',
    voiceId: 'meta-mms-tts-fra',
    text: 'Bonjour et bienvenue sur Ongea. Transformez vos idees en voix naturelle en quelques secondes.',
  },
]

const viewMeta: Record<View, { title: string; subtitle: string }> = {
  studio: {
    title: 'Voice studio',
    subtitle: 'Write once, choose a language, and export a clean WAV from the local OngeaLabs voice API.',
  },
  batch: {
    title: 'Production queue',
    subtitle: 'Reusable lines for demos, product prompts, and narration.',
  },
  voices: {
    title: 'Voice library',
    subtitle: 'The voices currently available through the connected local API.',
  },
  settings: {
    title: 'Settings',
    subtitle: 'Engine defaults, output details, and voice tone controls.',
  },
}

const toneControls: { key: ToneKey; label: string; detail: string }[] = [
  { key: 'pace', label: 'Pace', detail: 'Delivery speed' },
  { key: 'pitch', label: 'Pitch', detail: 'Voice height' },
  { key: 'warmth', label: 'Warmth', detail: 'Softness' },
  { key: 'clarity', label: 'Clarity', detail: 'Definition' },
]

function App() {
  const [view, setView] = useState<View>('studio')
  const [voices, setVoices] = useState<Voice[]>(BUILT_IN_VOICES)
  const [voice, setVoice] = useState(META_TTS_VOICE_ID)
  const [format] = useState<OutputFormat>('wav')
  const [text, setText] = useState(defaultScriptByLanguage.sw)
  const [settings, setSettings] = useState<ToneSettings>({ pace: 52, pitch: 44, warmth: 68, clarity: 82 })
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewStatus, setPreviewStatus] = useState('Checking voice API...')
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking')
  const [isGenerating, setIsGenerating] = useState(false)

  const activeVoice = useMemo(() => voices.find((item) => item.id === voice) ?? null, [voice, voices])
  const currentView: View = (view as string) in viewMeta ? view : 'studio'
  const meta = viewMeta[currentView]
  const activeLanguage = activeVoice?.language || 'sw'

  useEffect(() => {
    let isMounted = true

    async function loadVoices() {
      if (!API_BASE_URL) {
        if (!isMounted) return
        setVoices(BUILT_IN_VOICES)
        setVoice((current) => (BUILT_IN_VOICES.some((item) => item.id === current) ? current : META_TTS_VOICE_ID))
        setApiStatus('offline')
        setPreviewStatus((current) =>
          current === 'Checking voice API...' || current === 'Voice ready.' ? 'Connect a hosted voice API to render audio.' : current,
        )
        return
      }

      try {
        const response = await fetch(`${API_BASE_URL}/api/voices`)
        if (!response.ok) throw new Error(`Ongea API returned ${response.status}`)
        const data = (await response.json()) as { voices?: Voice[] }
        const nextVoices = data.voices?.length ? data.voices : BUILT_IN_VOICES
        if (!isMounted) return

        setVoices(nextVoices)
        setVoice((current) => (nextVoices.some((item) => item.id === current) ? current : nextVoices[0]?.id ?? META_TTS_VOICE_ID))
        setApiStatus('ready')
        setPreviewStatus((current) =>
          current === 'Checking voice API...' || current === 'Voice API is offline.' ? 'Voice ready.' : current,
        )
      } catch {
        if (!isMounted) return
        setVoices(BUILT_IN_VOICES)
        setVoice((current) => (BUILT_IN_VOICES.some((item) => item.id === current) ? current : META_TTS_VOICE_ID))
        setApiStatus('offline')
        setPreviewStatus((current) => (current === 'Checking voice API...' || current === 'Voice ready.' ? 'Voice API is offline.' : current))
      }
    }

    loadVoices()
    const retryTimer = window.setInterval(loadVoices, 10000)
    return () => {
      isMounted = false
      window.clearInterval(retryTimer)
    }
  }, [])

  const navItems = [
    { id: 'studio' as const, label: 'Studio', icon: AudioLines },
    { id: 'batch' as const, label: 'Queue', icon: ListChecks },
    { id: 'voices' as const, label: 'Voices', icon: Mic2 },
    { id: 'settings' as const, label: 'Settings', icon: Settings },
  ]

  function updateSetting(key: ToneKey, value: number) {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  function isStarterScript(script: string) {
    return Object.values(defaultScriptByLanguage).includes(script.trim())
  }

  function selectVoice(nextVoice: string) {
    const nextRecord = voices.find((item) => item.id === nextVoice)
    setVoice(nextVoice)
    const nextLanguage = nextRecord?.language || 'sw'
    const nextScript = defaultScriptByLanguage[nextLanguage]
    if (nextScript && (!text.trim() || isStarterScript(text))) {
      setText(nextScript)
    }
  }

  function cleanScript() {
    const polished = text
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n')

    setText(polished)
    setPreviewStatus(polished ? 'Script polished.' : 'Add a script before polishing.')
  }

  async function copyScript() {
    try {
      await navigator.clipboard.writeText(text)
      setPreviewStatus('Script copied.')
    } catch {
      setPreviewStatus('Unable to copy from this browser context.')
    }
  }

  function openSampleScript(nextText: string, nextVoice?: string) {
    if (nextVoice) setVoice(nextVoice)
    setText(nextText)
    setView('studio')
    setPreviewStatus('Script loaded.')
  }

  async function requestSynthesis(nextFormat: OutputFormat) {
    const selectedVoice = voice || META_TTS_VOICE_ID
    const script = text.trim()
    if (!script) throw new Error('Add a script before generating audio.')
    if (!API_BASE_URL) throw new Error('Connect a hosted voice API before rendering audio on Vercel.')

    const response = await fetch(`${API_BASE_URL}/api/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: script,
        voice: selectedVoice,
        language: activeLanguage,
        output_format: nextFormat,
        ...settings,
      }),
    })
    if (!response.ok) throw new Error(`Ongea API returned ${response.status}`)
    return await response.blob()
  }

  async function downloadOutput(nextFormat: OutputFormat = format) {
    try {
      setIsGenerating(true)
      setPreviewStatus('Rendering WAV export...')
      const blob = await requestSynthesis(nextFormat)

      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = 'ongealabs.wav'
      link.click()
      URL.revokeObjectURL(link.href)
      setPreviewStatus(`Exported with ${activeVoice?.name ?? 'Meta MMS TTS Swahili'}.`)
    } catch (error) {
      setPreviewStatus(error instanceof Error ? error.message : 'Unable to export from the TTS engine.')
    } finally {
      setIsGenerating(false)
    }
  }

  async function previewVoice() {
    try {
      setIsGenerating(true)
      setPreviewStatus('Rendering preview...')
      const blob = await requestSynthesis('wav')
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      const nextUrl = URL.createObjectURL(blob)
      setPreviewUrl(nextUrl)
      setPreviewStatus('Preview ready.')
    } catch (error) {
      setPreviewStatus(error instanceof Error ? error.message : 'Unable to generate preview from the TTS engine.')
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <button className="brand-lockup" onClick={() => setView('studio')} type="button">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 64 64">
              <path d="M13 33C13 18.6 22.4 8 34.3 8c9.1 0 16.7 6.5 16.7 15.4 0 14.3-14.5 19.7-23.1 30.6C19.6 49.2 13 42.8 13 33Z" />
              <path d="M25 34c0-6.9 4.4-12.5 9.8-12.5 4.2 0 7.7 3.2 7.7 7.4 0 6.7-6.8 9.3-10.9 14.4C27.7 41.1 25 38 25 34Z" />
            </svg>
          </span>
          <span>
            <strong>OngeaLabs</strong>
            <small>Voice studio</small>
          </span>
        </button>

        <nav className="app-nav" aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                aria-current={currentView === item.id ? 'page' : undefined}
                className={currentView === item.id ? 'nav-tab active' : 'nav-tab'}
                key={item.id}
                onClick={() => setView(item.id)}
                type="button"
              >
                <Icon size={16} />
                {item.label}
              </button>
            )
          })}
        </nav>

        <div className="header-actions">
          <StatusBadge status={apiStatus} />
          <button className="primary-action" disabled={isGenerating} onClick={() => downloadOutput(format)} type="button">
            <Download size={17} />
            Export
          </button>
        </div>
      </header>

      <section className="page-shell">
        <PageHeader title={meta.title} subtitle={meta.subtitle} />
        {currentView === 'studio' && (
          <Studio
            activeVoice={activeVoice}
            cleanScript={cleanScript}
            copyScript={copyScript}
            downloadOutput={downloadOutput}
            isGenerating={isGenerating}
            previewStatus={previewStatus}
            previewUrl={previewUrl}
            previewVoice={previewVoice}
            setText={setText}
            setVoice={selectVoice}
            settings={settings}
            text={text}
            updateSetting={updateSetting}
            voice={voice}
            voices={voices}
          />
        )}
        {currentView === 'batch' && <Batch onUseLine={openSampleScript} />}
        {currentView === 'voices' && <Voices selectedVoice={voice} setVoice={selectVoice} voices={voices} />}
        {currentView === 'settings' && <SettingsPanel settings={settings} updateSetting={updateSetting} />}
      </section>
    </main>
  )
}

function StatusBadge({ status }: { status: ApiStatus }) {
  return (
    <span className={`status-badge ${status}`}>
      <span aria-hidden="true" />
      {status === 'ready' ? 'API ready' : status === 'checking' ? 'Checking' : 'Offline'}
    </span>
  )
}

function PageHeader({ subtitle, title }: { subtitle: string; title: string }) {
  return (
    <div className="page-header">
      <span>OngeaLabs</span>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>
  )
}

function Studio(props: {
  activeVoice: Voice | null
  cleanScript: () => void
  copyScript: () => void
  downloadOutput: (format?: OutputFormat) => void | Promise<void>
  isGenerating: boolean
  previewStatus: string
  previewUrl: string | null
  previewVoice: () => void
  setText: (text: string) => void
  setVoice: (voice: string) => void
  settings: ToneSettings
  text: string
  updateSetting: (key: ToneKey, value: number) => void
  voice: string
  voices: Voice[]
}) {
  const characterCount = props.text.length
  const wordCount = props.text.trim() ? props.text.trim().split(/\s+/).length : 0
  const estimatedSeconds = Math.max(2, Math.round(wordCount / 2.4))
  const activeLanguage = props.activeVoice?.language || 'sw'
  const languageLabel = props.activeVoice?.locale || props.activeVoice?.accent || 'Swahili'
  const activeModel = props.activeVoice?.model?.replace('facebook/', '') || 'mms-tts-swh'

  return (
    <div className="studio-layout">
      <section className="studio-main">
        <div className="language-tabs" aria-label="Select language">
          {props.voices.length ? (
            props.voices.map((item) => {
              const language = item.language || 'sw'
              const isSelected = props.voice === item.id
              return (
                <button className={isSelected ? 'language-tab active' : 'language-tab'} key={item.id} onClick={() => props.setVoice(item.id)} type="button">
                  <span>{language.toUpperCase()}</span>
                  {item.locale || item.accent}
                </button>
              )
            })
          ) : (
            <button className="language-tab active" onClick={() => props.setVoice(META_TTS_VOICE_ID)} type="button">
              <span>SW</span>
              Swahili
            </button>
          )}
        </div>

        <section className="editor-card">
          <div className="editor-card-header">
            <div>
              <span className="section-label">Script</span>
              <h2>{languageLabel} take</h2>
            </div>
            <div className="editor-actions">
              <button className="secondary-action" onClick={props.copyScript} type="button">
                <Copy size={16} />
                Copy
              </button>
              <button className="secondary-action" onClick={props.cleanScript} type="button">
                <Wand2 size={16} />
                Polish
              </button>
            </div>
          </div>

          <textarea
            aria-label={`${languageLabel} text for TTS`}
            className="script-input"
            placeholder={placeholderByLanguage[activeLanguage] ?? 'Write or paste your script here...'}
            value={props.text}
            onChange={(event) => props.setText(event.target.value)}
            spellCheck="false"
          />

          <div className="editor-meta">
            <MetricPill icon={Activity} label="Words" value={String(wordCount)} />
            <MetricPill icon={AudioLines} label="Characters" value={String(characterCount)} />
            <MetricPill icon={Clock3} label="Estimate" value={`~${estimatedSeconds}s`} />
          </div>
        </section>

        <section className="player-bar" aria-label="Audio preview and export">
          <button className="play-action" disabled={props.isGenerating} onClick={props.previewVoice} type="button">
            <Play size={18} />
            Preview
          </button>
          <div className="preview-status">
            <span>{props.previewStatus}</span>
            {props.previewUrl && <audio controls src={props.previewUrl} />}
          </div>
          <button className="primary-action" disabled={props.isGenerating} onClick={() => props.downloadOutput('wav')} type="button">
            <Download size={17} />
            WAV
          </button>
        </section>
      </section>

      <aside className="studio-aside">
        <section className="inspector-card voice-card">
          <span className="section-label">Voice</span>
          <div className="voice-summary">
            <span>{activeLanguage.toUpperCase()}</span>
            <div>
              <h2>{languageLabel}</h2>
              <p>{props.activeVoice?.name ?? 'Meta MMS TTS Swahili'}</p>
            </div>
          </div>
          <div className="model-list">
            <InfoRow label="Provider" value="Meta MMS" />
            <InfoRow label="Model" value={activeModel} />
            <InfoRow label="Output" value="WAV" />
          </div>
        </section>

        <section className="inspector-card">
          <div className="inspector-title">
            <span className="section-label">Tone</span>
            <SlidersHorizontal size={18} />
          </div>
          {toneControls.map((control) => (
            <ToneSlider
              detail={control.detail}
              key={control.key}
              label={control.label}
              value={props.settings[control.key]}
              onChange={(value) => props.updateSetting(control.key, value)}
            />
          ))}
        </section>
      </aside>
    </div>
  )
}

function MetricPill({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof AudioLines
  label: string
  value: string
}) {
  return (
    <div className="metric-pill">
      <Icon size={15} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function ToneSlider({
  detail,
  label,
  onChange,
  value,
}: {
  detail: string
  label: string
  onChange: (value: number) => void
  value: number
}) {
  return (
    <label className="tone-slider">
      <span>
        <span>
          <strong>{label}</strong>
          <small>{detail}</small>
        </span>
        <strong>{value}</strong>
      </span>
      <input max="100" min="0" onChange={(event) => onChange(Number(event.target.value))} type="range" value={value} />
    </label>
  )
}

function Voices({ selectedVoice, setVoice, voices }: { selectedVoice: string; setVoice: (voice: string) => void; voices: Voice[] }) {
  return (
    <section className="simple-panel">
      <div className="voice-grid">
        {voices.length ? (
          voices.map((item) => (
            <button className={selectedVoice === item.id ? 'voice-option active' : 'voice-option'} key={item.id} onClick={() => setVoice(item.id)} type="button">
              <span className="voice-option-code">{(item.language || 'sw').toUpperCase()}</span>
              <h3>{item.locale || item.accent}</h3>
              <p>{item.name}</p>
              <small>{item.model?.replace('facebook/', '') || item.id}</small>
              {selectedVoice === item.id && <CheckCircle2 size={18} />}
            </button>
          ))
        ) : (
          <article className="voice-option active">
            <span className="voice-option-code">SW</span>
            <h3>Swahili</h3>
            <p>Meta MMS TTS Swahili</p>
            <small>mms-tts-swh</small>
          </article>
        )}
      </div>
    </section>
  )
}

function Batch({ onUseLine }: { onUseLine: (line: string, voiceId?: string) => void }) {
  return (
    <section className="simple-panel">
      <div className="batch-list">
        {sampleScripts.map((item, index) => (
          <article className="batch-row" key={item.title}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <div>
              <strong>{item.title}</strong>
              <p>{item.text}</p>
              <small>{item.tone}</small>
            </div>
            <button className="secondary-action" onClick={() => onUseLine(item.text, item.voiceId)} type="button">
              <Play size={16} />
              Open
            </button>
          </article>
        ))}
      </div>
    </section>
  )
}

function SettingsPanel({
  settings,
  updateSetting,
}: {
  settings: ToneSettings
  updateSetting: (key: ToneKey, value: number) => void
}) {
  return (
    <section className="settings-layout">
      <div className="simple-panel">
        <div className="settings-grid">
          <SettingBlock icon={FlaskConical} title="Backend" value="FastAPI" />
          <SettingBlock icon={FileAudio} title="Default file" value="ongealabs.wav" />
          <SettingBlock icon={Globe2} title="Engine" value="Meta MMS TTS" />
          <SettingBlock icon={Languages} title="Languages" value="SW, DE, FR" />
        </div>
      </div>
      <div className="simple-panel tone-defaults">
        {toneControls.map((control) => (
          <ToneSlider
            detail={control.detail}
            key={control.key}
            label={control.label}
            value={settings[control.key]}
            onChange={(value) => updateSetting(control.key, value)}
          />
        ))}
      </div>
    </section>
  )
}

function SettingBlock({
  icon: Icon,
  title,
  value,
}: {
  icon: typeof AudioLines
  title: string
  value: string
}) {
  return (
    <article className="setting-block">
      <Icon size={18} />
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  )
}

export default App
