import {
  AudioLines,
  Building2,
  Download,
  FileAudio,
  FlaskConical,
  Globe2,
  LayoutDashboard,
  ListChecks,
  Mic2,
  Play,
  Settings,
  SlidersHorizontal,
  Upload,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import './App.css'

type View = 'labs' | 'studio' | 'batch' | 'voices' | 'settings'
type OutputFormat = 'wav'
type Voice = {
  id: string
  name: string
  accent: string
  tone: string
  clarity?: number | null
}

const API_BASE_URL = 'http://127.0.0.1:8000'
const META_TTS_VOICE_ID = 'meta-mms-tts-swh'

const batchItems = [
  'Karibu Ongea. Sauti za Afrika, tayari kwa bidhaa zako.',
  'Habari ya leo? Tengeneza sauti kwa lugha yako kwa sekunde chache.',
  'OngeaLabs builds voice tools for teams shipping across African markets.',
]

function App() {
  const [view, setView] = useState<View>('studio')
  const [voices, setVoices] = useState<Voice[]>([])
  const [voice, setVoice] = useState(META_TTS_VOICE_ID)
  const [format, setFormat] = useState<OutputFormat>('wav')
  const [text, setText] = useState('Habari, karibu Ongea. Andika maandishi yako ya Kiswahili hapa, kisha tengeneza sauti.')
  const [settings, setSettings] = useState({ pace: 52, pitch: 44, warmth: 68, clarity: 82 })
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewStatus, setPreviewStatus] = useState('Ready to generate with Meta MMS TTS.')
  const activeVoice = voices.find((item) => item.id === voice) ?? null

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
        setPreviewStatus(nextVoices.length ? 'Meta TTS voice loaded.' : 'Using Meta MMS TTS.')
      } catch {
        if (!isMounted) return
        setVoices([])
        setVoice(META_TTS_VOICE_ID)
        setPreviewStatus('Using Meta MMS TTS.')
      }
    }

    loadVoices()
    const retryTimer = window.setInterval(loadVoices, 5000)
    return () => {
      isMounted = false
      window.clearInterval(retryTimer)
    }
  }, [])

  const navItems = [
    { id: 'labs' as const, label: 'OngeaLabs', icon: Building2 },
    { id: 'studio' as const, label: 'Ongea Studio', icon: LayoutDashboard },
    { id: 'batch' as const, label: 'Batch', icon: ListChecks },
    { id: 'voices' as const, label: 'Speakers', icon: Mic2 },
    { id: 'settings' as const, label: 'Settings', icon: Settings },
  ]

  function updateSetting(key: keyof typeof settings, value: number) {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  async function requestSynthesis(nextFormat: OutputFormat) {
    const selectedVoice = voice || META_TTS_VOICE_ID

    const response = await fetch(`${API_BASE_URL}/api/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
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
    const extension = 'wav'
    try {
      const blob = await requestSynthesis(nextFormat)

      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `ongealabs.${extension}`
      link.click()
      URL.revokeObjectURL(link.href)
      setPreviewStatus(`Exported with ${activeVoice?.name ?? 'Meta MMS TTS Swahili'}.`)
    } catch (error) {
      setPreviewStatus(error instanceof Error ? error.message : 'Unable to export from the TTS engine.')
    }
  }

  async function previewVoice() {
    try {
      setPreviewStatus('Generating preview with Meta MMS TTS...')
      const blob = await requestSynthesis('wav')
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      const nextUrl = URL.createObjectURL(blob)
      setPreviewUrl(nextUrl)
      setPreviewStatus('Preview loaded from the Python TTS route.')
    } catch (error) {
      setPreviewStatus(error instanceof Error ? error.message : 'Unable to generate preview from the TTS engine.')
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
                className={view === item.id ? 'nav-item active' : 'nav-item'}
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
        <div className="system-card">
          <p>Engine</p>
          <strong>Python TTS</strong>
          <span>Voice IDs preserved</span>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">Ongea by OngeaLabs</span>
            <h1>{view === 'labs' ? 'Voice infrastructure for African languages' : 'Swahili text to speech'}</h1>
          </div>
          <div className="topbar-actions">
            <button className="primary-action" onClick={() => downloadOutput(format)} type="button">
              <Download size={18} />
              Export {format.toUpperCase()}
            </button>
          </div>
        </header>

        {view === 'labs' && <LabsWebsite onLaunch={() => setView('studio')} />}
        {view === 'studio' && (
          <Studio
            activeVoice={activeVoice}
            format={format}
            previewVoice={previewVoice}
            setFormat={setFormat}
            setText={setText}
            setVoice={setVoice}
            voices={voices}
            settings={settings}
            text={text}
            updateSetting={updateSetting}
            voice={voice}
            downloadOutput={downloadOutput}
            previewStatus={previewStatus}
            previewUrl={previewUrl}
          />
        )}
        {view === 'batch' && <Batch downloadOutput={downloadOutput} />}
        {view === 'voices' && <Voices selectedVoice={voice} setVoice={setVoice} voices={voices} />}
        {view === 'settings' && <SettingsPanel settings={settings} updateSetting={updateSetting} />}
      </section>
    </main>
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

function LabsWebsite({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="labs-page">
      <section className="hero-band">
        <div className="hero-copy">
          <BrandMark compact />
          <h2>OngeaLabs</h2>
          <p>Swahili text-to-speech tooling for teams turning scripts into clean audio.</p>
          <div className="hero-actions">
            <button className="primary-action" onClick={onLaunch} type="button">
              Open Ongea
            </button>
            <button className="secondary-action" type="button">
              Voice API
            </button>
          </div>
        </div>
        <div className="signal-board">
          <div>
            <span className="eyebrow">Stack</span>
            <h3>Minimal interface. Local speech engine.</h3>
            <p>Ongea keeps the voices and pronunciations in Python while React handles the workspace.</p>
          </div>
          <div className="metric-grid">
            <Metric label="Language" value="Swahili" />
            <Metric label="Exports" value="MP3/MP4" />
            <Metric label="Mode" value="Local" />
          </div>
        </div>
      </section>
      <section className="feature-strip">
        {[
          ['Paste', 'Drop in a Swahili script.', AudioLines],
          ['Tune', 'Pace, pitch, warmth, and clarity.', SlidersHorizontal],
          ['Export', 'Predictable OngeaLabs files.', Download],
        ].map(([title, copy, Icon]) => (
          <article className="feature-tile" key={title as string}>
            <Icon size={22} />
            <h3>{title as string}</h3>
            <p>{copy as string}</p>
          </article>
        ))}
      </section>
    </div>
  )
}

function Studio(props: {
  activeVoice: Voice | null
  downloadOutput: (format?: OutputFormat) => void | Promise<void>
  format: OutputFormat
  previewVoice: () => void
  setFormat: (format: OutputFormat) => void
  setText: (text: string) => void
  setVoice: (voice: string) => void
  settings: { pace: number; pitch: number; warmth: number; clarity: number }
  text: string
  updateSetting: (key: 'pace' | 'pitch' | 'warmth' | 'clarity', value: number) => void
  voice: string
  voices: Voice[]
  previewStatus: string
  previewUrl: string | null
}) {
  return (
    <div className="studio-grid">
      <section className="composer-panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">Swahili script</span>
            <h2>Text to speech</h2>
          </div>
          <div className="format-switch" aria-label="Output format">
            {(['wav'] as OutputFormat[]).map((item) => (
              <button className={props.format === item ? 'active' : ''} onClick={() => props.setFormat(item)} key={item} type="button">
                <FileAudio size={16} />
                {item.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <textarea
          aria-label="Swahili text for TTS"
          placeholder="Bandika maandishi ya Kiswahili hapa..."
          value={props.text}
          onChange={(event) => props.setText(event.target.value)}
          spellCheck="false"
        />

        <div className="action-row">
          <button className="primary-action" onClick={props.previewVoice} type="button">
            <Play size={18} />
            Preview
          </button>
          <button className="secondary-action" type="button">
            Clean Script
          </button>
          <button className="secondary-action" onClick={() => props.downloadOutput('wav')} type="button">
            <Download size={18} />
            ongealabs.wav
          </button>
        </div>
        <div className="preview-strip">
          <span>{props.previewStatus}</span>
          {props.previewUrl && <audio controls src={props.previewUrl} />}
        </div>
      </section>

      <aside className="right-rail">
        <section className="voice-card">
          <div className="speaker-avatar">
            <AudioLines size={36} />
          </div>
          <span className="eyebrow">Speaker</span>
          <h2>{props.activeVoice?.name ?? 'Meta MMS TTS Swahili'}</h2>
          <p>{props.activeVoice?.accent ?? 'Kiswahili'}</p>
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

        <section className="wave-panel">
          <span className="eyebrow">Pronunciation</span>
          <p>Preview and export call the Python TTS route so Swahili pronunciation stays with the selected Ongea voice.</p>
        </section>

        <section className="tuning-panel">
          <h3>Tone</h3>
          <ToneSlider label="Pace" value={props.settings.pace} onChange={(value) => props.updateSetting('pace', value)} />
          <ToneSlider label="Pitch" value={props.settings.pitch} onChange={(value) => props.updateSetting('pitch', value)} />
          <ToneSlider label="Warmth" value={props.settings.warmth} onChange={(value) => props.updateSetting('warmth', value)} />
          <ToneSlider label="Clarity" value={props.settings.clarity} onChange={(value) => props.updateSetting('clarity', value)} />
        </section>
      </aside>
    </div>
  )
}

function ToneSlider({ label, onChange, value }: { label: string; onChange: (value: number) => void; value: number }) {
  return (
    <label className="tone-slider">
      <span>
        {label}
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
          <span className="eyebrow">Speakers</span>
          <h2>Clear voice library</h2>
        </div>
        <button className="secondary-action" type="button">
          <Upload size={18} />
          Add voice
        </button>
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
              {typeof item.clarity === 'number' && <strong>{item.clarity}%</strong>}
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

function Batch({ downloadOutput }: { downloadOutput: (format?: OutputFormat) => void | Promise<void> }) {
  return (
    <section className="content-panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">Batch</span>
          <h2>Batch audio production</h2>
        </div>
        <button className="primary-action" onClick={() => downloadOutput('wav')} type="button">
          <Download size={18} />
          Export all
        </button>
      </div>
      <div className="batch-list">
        {batchItems.map((item, index) => (
          <article className="batch-row" key={item}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <p>{item}</p>
            <button className="icon-button" title="Generate" type="button">
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
  settings: { pace: number; pitch: number; warmth: number; clarity: number }
  updateSetting: (key: 'pace' | 'pitch' | 'warmth' | 'clarity', value: number) => void
}) {
  return (
    <section className="settings-layout">
      <div className="content-panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">Settings</span>
            <h2>Engine profile</h2>
          </div>
          <FlaskConical size={24} />
        </div>
        <div className="settings-grid">
          <SettingBlock title="Backend" value="Python FastAPI" />
          <SettingBlock title="Default filename" value="ongealabs.wav" />
          <SettingBlock title="Model" value="Meta MMS TTS" />
          <SettingBlock title="Processing" value="Local RAM/CPU" />
        </div>
      </div>
      <div className="content-panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">Voice defaults</span>
            <h2>Global tone</h2>
          </div>
        </div>
        <ToneSlider label="Pace" value={settings.pace} onChange={(value) => updateSetting('pace', value)} />
        <ToneSlider label="Pitch" value={settings.pitch} onChange={(value) => updateSetting('pitch', value)} />
        <ToneSlider label="Warmth" value={settings.warmth} onChange={(value) => updateSetting('warmth', value)} />
        <ToneSlider label="Clarity" value={settings.clarity} onChange={(value) => updateSetting('clarity', value)} />
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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
