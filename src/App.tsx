import {
  Activity,
  AudioLines,
  BadgeCheck,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  FileAudio,
  FlaskConical,
  Gauge,
  Globe2,
  Headphones,
  Languages,
  LayoutDashboard,
  ListChecks,
  Mic2,
  Play,
  Radio,
  Settings,
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
  tone: string
  clarity?: number | null
}
type ToneKey = 'pace' | 'pitch' | 'warmth' | 'clarity'
type ToneSettings = Record<ToneKey, number>

const API_BASE_URL = 'http://127.0.0.1:8000'
const META_TTS_VOICE_ID = 'meta-mms-tts-swh'
const waveformBars = [36, 64, 42, 78, 50, 92, 58, 74, 46, 82, 40, 66]

const sampleScripts = [
  {
    title: 'Welcome cue',
    tone: 'Warm product intro',
    text: 'Karibu Ongea. Sauti za Afrika, tayari kwa bidhaa zako.',
  },
  {
    title: 'Daily greeting',
    tone: 'Natural spoken line',
    text: 'Habari ya leo? Tengeneza sauti kwa lugha yako kwa sekunde chache.',
  },
  {
    title: 'Team narration',
    tone: 'Confident brand voice',
    text: 'OngeaLabs builds voice tools for teams shipping across African markets.',
  },
]

const viewMeta: Record<View, { eyebrow: string; title: string; subtitle: string }> = {
  studio: {
    eyebrow: 'Studio',
    title: 'Swahili voice production',
    subtitle: 'Draft the line, shape the voice, preview the take, export a clean WAV.',
  },
  batch: {
    eyebrow: 'Queue',
    title: 'Reusable production lines',
    subtitle: 'Keep frequent prompts and narration snippets close, then open any line in the studio.',
  },
  voices: {
    eyebrow: 'Voices',
    title: 'Speaker library',
    subtitle: 'Only voices returned by the local API appear here, so export options stay honest.',
  },
  settings: {
    eyebrow: 'Settings',
    title: 'Engine profile',
    subtitle: 'Review backend routing, output naming, model family, and shared tone defaults.',
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
  const [voices, setVoices] = useState<Voice[]>([])
  const [voice, setVoice] = useState(META_TTS_VOICE_ID)
  const [format] = useState<OutputFormat>('wav')
  const [text, setText] = useState('Habari, karibu Ongea. Andika maandishi yako ya Kiswahili hapa, kisha tengeneza sauti.')
  const [settings, setSettings] = useState<ToneSettings>({ pace: 52, pitch: 44, warmth: 68, clarity: 82 })
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewStatus, setPreviewStatus] = useState('Checking voice API...')
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking')
  const [isGenerating, setIsGenerating] = useState(false)

  const activeVoice = useMemo(() => voices.find((item) => item.id === voice) ?? null, [voice, voices])
  const currentView: View = (view as string) in viewMeta ? view : 'studio'
  const meta = viewMeta[currentView]

  useEffect(() => {
    let isMounted = true

    async function loadVoices() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/voices`)
        if (!response.ok) throw new Error(`Ongea API returned ${response.status}`)
        const data = (await response.json()) as { voices?: Voice[] }
        const nextVoices = data.voices ?? []
        if (!isMounted) return

        setVoices(nextVoices)
        setVoice((current) => (nextVoices.some((item) => item.id === current) ? current : nextVoices[0]?.id ?? META_TTS_VOICE_ID))
        setApiStatus('ready')
        setPreviewStatus((current) =>
          current === 'Checking voice API...' || current === 'Voice API is offline.' ? 'Voice ready.' : current,
        )
      } catch {
        if (!isMounted) return
        setVoices([])
        setVoice(META_TTS_VOICE_ID)
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
    { id: 'studio' as const, label: 'Studio', icon: LayoutDashboard },
    { id: 'batch' as const, label: 'Queue', icon: ListChecks },
    { id: 'voices' as const, label: 'Voices', icon: Mic2 },
    { id: 'settings' as const, label: 'Settings', icon: Settings },
  ]

  function updateSetting(key: ToneKey, value: number) {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  function cleanScript() {
    const polished = text
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n')

    setText(polished)
    setPreviewStatus(polished ? 'Script polished and ready for preview.' : 'Add a script before polishing.')
  }

  async function copyScript() {
    try {
      await navigator.clipboard.writeText(text)
      setPreviewStatus('Script copied.')
    } catch {
      setPreviewStatus('Unable to copy from this browser context.')
    }
  }

  function openSampleScript(nextText: string) {
    setText(nextText)
    setView('studio')
    setPreviewStatus('Script loaded into the studio.')
  }

  async function requestSynthesis(nextFormat: OutputFormat) {
    const selectedVoice = voice || META_TTS_VOICE_ID
    const script = text.trim()
    if (!script) throw new Error('Add a script before generating audio.')

    const response = await fetch(`${API_BASE_URL}/api/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: script,
        voice: selectedVoice,
        language: 'sw',
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
      setPreviewStatus('Rendering preview take...')
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
      <aside className="sidebar" aria-label="Ongea navigation">
        <BrandMark compact={false} />
        <nav className="nav-stack">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                aria-current={currentView === item.id ? 'page' : undefined}
                className={currentView === item.id ? 'nav-item active' : 'nav-item'}
                key={item.id}
                onClick={() => setView(item.id)}
                type="button"
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>
        <div className={`system-card ${apiStatus}`}>
          <span className="status-dot" aria-hidden="true" />
          <p>Voice API</p>
          <strong>{apiStatus === 'ready' ? 'Connected' : apiStatus === 'checking' ? 'Checking' : 'Offline'}</strong>
          <span>{activeVoice?.name ?? 'Meta MMS TTS Swahili'}</span>
        </div>
      </aside>

      <section className="workspace">
        <header className={currentView === 'studio' ? 'topbar studio-topbar' : 'topbar'}>
          <div>
            <span className="eyebrow">{meta.eyebrow}</span>
            <h1>{meta.title}</h1>
            <p>{meta.subtitle}</p>
          </div>
          <div className="topbar-actions">
            <StatusBadge status={apiStatus} />
            <button className="primary-action" disabled={isGenerating} onClick={() => downloadOutput(format)} type="button">
              <Download size={18} />
              Export WAV
            </button>
          </div>
        </header>

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
            setVoice={setVoice}
            settings={settings}
            text={text}
            updateSetting={updateSetting}
            voice={voice}
            voices={voices}
          />
        )}
        {currentView === 'batch' && <Batch onUseLine={openSampleScript} />}
        {currentView === 'voices' && <Voices selectedVoice={voice} setVoice={setVoice} voices={voices} />}
        {currentView === 'settings' && <SettingsPanel settings={settings} updateSetting={updateSetting} />}
      </section>
    </main>
  )
}

function StatusBadge({ status }: { status: ApiStatus }) {
  return (
    <div className={`status-badge ${status}`}>
      <span />
      {status === 'ready' ? 'API ready' : status === 'checking' ? 'Checking API' : 'API offline'}
    </div>
  )
}

function BrandMark({ compact }: { compact: boolean }) {
  return (
    <div className={compact ? 'brand compact' : 'brand'}>
      <div className="logo-mark" aria-hidden="true">
        <svg viewBox="0 0 64 64" role="img">
          <path d="M13 33C13 18.6 22.4 8 34.3 8c9.1 0 16.7 6.5 16.7 15.4 0 14.3-14.5 19.7-23.1 30.6C19.6 49.2 13 42.8 13 33Z" />
          <path d="M25 34c0-6.9 4.4-12.5 9.8-12.5 4.2 0 7.7 3.2 7.7 7.4 0 6.7-6.8 9.3-10.9 14.4C27.7 41.1 25 38 25 34Z" />
        </svg>
      </div>
      <div>
        <strong>Ongea</strong>
        {!compact && <span>by OngeaLabs</span>}
      </div>
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
  const lineCount = Math.max(1, props.text.split('\n').length)
  const estimatedSeconds = Math.max(2, Math.round(wordCount / 2.4))

  return (
    <div className="studio-board">
      <section className="script-workbench" aria-busy={props.isGenerating}>
        <div className="workbench-header">
          <div>
            <span className="eyebrow">Composer</span>
            <h2>Script take</h2>
          </div>
          <div className="editor-actions">
            <button className="tool-button" onClick={props.copyScript} type="button">
              <Copy size={16} />
              Copy
            </button>
            <button className="tool-button" onClick={props.cleanScript} type="button">
              <Wand2 size={16} />
              Polish
            </button>
          </div>
        </div>

        <div className="editor-shell">
          <div className="editor-toolbar">
            <div className="mini-chip">
              <Languages size={14} />
              Kiswahili
            </div>
            <div className="mini-chip coral">
              <Clock3 size={14} />
              ~{estimatedSeconds}s
            </div>
            <div className="mini-chip indigo">
              <FileAudio size={14} />
              WAV
            </div>
          </div>
          <div className="editor-body">
            <div className="line-gutter" aria-hidden="true">
              {Array.from({ length: lineCount }).map((_, index) => (
                <span key={index}>{index + 1}</span>
              ))}
            </div>
            <textarea
              aria-label="Swahili text for TTS"
              placeholder="Bandika maandishi ya Kiswahili hapa..."
              value={props.text}
              onChange={(event) => props.setText(event.target.value)}
              spellCheck="false"
            />
          </div>
        </div>

        <div className="studio-metrics">
          <MetricPill icon={AudioLines} label="Characters" value={String(characterCount)} />
          <MetricPill icon={Activity} label="Words" value={String(wordCount)} />
          <MetricPill icon={BadgeCheck} label="Voice" value={props.activeVoice?.accent ?? 'Kiswahili'} />
        </div>

        <div className="transport-panel">
          <button className="transport-play" disabled={props.isGenerating} onClick={props.previewVoice} type="button">
            <Play size={19} />
            Preview take
          </button>
          <div className="transport-status">
            <span>{props.previewStatus}</span>
            {props.previewUrl && <audio controls src={props.previewUrl} />}
          </div>
          <button className="transport-export" disabled={props.isGenerating} onClick={() => props.downloadOutput('wav')} type="button">
            <Download size={18} />
            Export
          </button>
        </div>
      </section>

      <aside className="studio-console">
        <section className="voice-console">
          <div className="console-topline">
            <span className="eyebrow">Active voice</span>
            <Headphones size={20} />
          </div>
          <div className="voice-hero">
            <div className="voice-ring">
              <Radio size={30} />
            </div>
            <div>
              <h2>{props.activeVoice?.name ?? 'Meta MMS TTS Swahili'}</h2>
              <p>{props.activeVoice?.tone ?? 'Meta TTS model'}</p>
            </div>
          </div>
          <div className="waveform-signature" aria-hidden="true">
            {waveformBars.map((height, index) => (
              <span key={index} style={{ height: `${height}%` }} />
            ))}
          </div>
          <select value={props.voice || META_TTS_VOICE_ID} onChange={(event) => props.setVoice(event.target.value)}>
            {props.voices.length ? (
              props.voices.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} - {item.accent}
                </option>
              ))
            ) : (
              <option value={META_TTS_VOICE_ID}>Meta MMS TTS Swahili - Kiswahili</option>
            )}
          </select>
        </section>

        <section className="tone-console">
          <div className="console-topline">
            <span className="eyebrow">Voice feel</span>
            <Gauge size={20} />
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

        <section className="route-console">
          <CheckCircle2 size={20} />
          <div>
            <strong>Same route for preview and export</strong>
            <p>The audio you hear is rendered by the local FastAPI synthesis endpoint.</p>
          </div>
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
      <Icon size={16} />
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
      <span className="tone-slider-label">
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
    <section className="content-panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">Available speakers</span>
          <h2>Voice library</h2>
        </div>
        <div className="output-pill">
          <Mic2 size={16} />
          API voices
        </div>
      </div>
      <div className="voice-grid">
        {voices.length ? (
          voices.map((item) => (
            <button className={selectedVoice === item.id ? 'voice-option active' : 'voice-option'} key={item.id} onClick={() => setVoice(item.id)} type="button">
              <div className="mini-avatar">
                <Mic2 size={22} />
              </div>
              <h3>{item.name}</h3>
              <p>{item.accent}</p>
              <span>{item.tone}</span>
              {typeof item.clarity === 'number' && <strong>{item.clarity}% clarity</strong>}
            </button>
          ))
        ) : (
          <article className="voice-option">
            <div className="mini-avatar">
              <Mic2 size={22} />
            </div>
            <h3>Meta MMS TTS Swahili</h3>
            <p>Kiswahili</p>
            <span>Meta TTS model</span>
          </article>
        )}
      </div>
    </section>
  )
}

function Batch({ onUseLine }: { onUseLine: (line: string) => void }) {
  return (
    <section className="content-panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">Reusable lines</span>
          <h2>Production queue</h2>
        </div>
        <button className="primary-action" onClick={() => onUseLine(sampleScripts[0].text)} type="button">
          <Play size={18} />
          Open first line
        </button>
      </div>
      <div className="batch-list">
        {sampleScripts.map((item, index) => (
          <article className="batch-row" key={item.title}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <div>
              <strong>{item.title}</strong>
              <p>{item.text}</p>
              <small>{item.tone}</small>
            </div>
            <button className="icon-button" onClick={() => onUseLine(item.text)} title={`Open ${item.title}`} type="button">
              <Play size={17} />
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
      <div className="content-panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">Engine</span>
            <h2>Local profile</h2>
          </div>
          <FlaskConical size={24} />
        </div>
        <div className="settings-grid">
          <SettingBlock title="Backend" value="FastAPI" />
          <SettingBlock title="Default file" value="ongealabs.wav" />
          <SettingBlock title="Model" value="Meta MMS TTS" />
          <SettingBlock title="Processing" value="Local CPU" />
        </div>
      </div>
      <div className="content-panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">Defaults</span>
            <h2>Global tone</h2>
          </div>
        </div>
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

function SettingBlock({ title, value }: { title: string; value: string }) {
  return (
    <article className="setting-block">
      <Globe2 size={20} />
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  )
}

export default App
