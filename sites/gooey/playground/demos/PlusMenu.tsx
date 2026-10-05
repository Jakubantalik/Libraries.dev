import { Liquid } from 'liquid-gooey'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { DemoProps } from '../App'

const SATELLITES = [
  {
    label: 'New file',
    x: -54,
    y: -34,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 1.5H4A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8a1.5 1.5 0 0 0 1.5-1.5V6z" />
        <path d="M9 1.5V6h4.5" />
      </svg>
    ),
  },
  {
    label: 'Add image',
    x: 0,
    y: -64,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
        <circle cx="5.5" cy="5.5" r="1.25" />
        <path d="M14.5 10.5L11 7l-7.5 7.5" />
      </svg>
    ),
  },
  {
    label: 'New folder',
    x: 54,
    y: -34,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 12.5A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5V3A1.5 1.5 0 0 1 3 1.5h3L7.5 4H13a1.5 1.5 0 0 1 1.5 1.5z" />
      </svg>
    ),
  },
]

const EASES: Record<string, string> = {
  Bouncy: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  Smooth: 'cubic-bezier(0.3, 1.05, 0.4, 1)',
  Snappy: 'cubic-bezier(0.22, 1, 0.36, 1)',
  'Ease in-out': 'ease-in-out',
  Linear: 'linear',
}

interface MenuState {
  openDur: number
  openEase: string
  openStagger: number
  closeDur: number
  closeEase: string
  closeStagger: number
  spread: number
  iconDur: number
  iconDelay: number
  anticipDist: number
  anticipDur: number
}

const DEFAULTS: MenuState = {
  openDur: 550,
  openEase: 'Bouncy',
  openStagger: 0,
  closeDur: 250,
  closeEase: 'Snappy',
  closeStagger: 0,
  spread: 1,
  iconDur: 180,
  iconDelay: 120,
  anticipDist: 5,
  anticipDur: 700,
}

function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}) {
  return (
    <div className="cp-row">
      <span className="cp-label">{label}</span>
      <span className="cp-slider">
        <input
          type="range"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={e => onChange(Number(e.target.value))}
        />
        <span className="cp-val">{value}</span>
      </span>
    </div>
  )
}

function EaseRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="cp-row">
      <span className="cp-label">{label}</span>
      <select className="cp-ease" value={value} onChange={e => onChange(e.target.value)}>
        {Object.keys(EASES).map(name => (
          <option key={name}>{name}</option>
        ))}
      </select>
    </div>
  )
}

function Subhead({ children }: { children: ReactNode }) {
  return <div className="cp-subhead">{children}</div>
}

function menuSnippet(s: MenuState): string {
  return [
    '// liquid-gooey — Menu values',
    `open: { duration: ${s.openDur}, easing: '${EASES[s.openEase]}', stagger: ${s.openStagger} },`,
    `close: { duration: ${s.closeDur}, easing: '${EASES[s.closeEase]}', stagger: ${s.closeStagger} },`,
    `anticipation: { distance: ${s.anticipDist}, duration: ${s.anticipDur} },`,
    `spread: ${s.spread}, iconFade: ${s.iconDur}, iconDelay: ${s.iconDelay},`,
  ].join('\n')
}

export function PlusMenu({ blur, contrast, shadow, pro, bare }: DemoProps) {
  const [open, setOpen] = useState(false)
  const [anticipating, setAnticipating] = useState(false)
  const [st, setSt] = useState<MenuState>(DEFAULTS)
  const set =
    <K extends keyof MenuState>(k: K) =>
    (v: MenuState[K]) =>
      setSt(prev => ({ ...prev, [k]: v }))
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])
  const copyValues = () => {
    navigator.clipboard.writeText(menuSnippet(st)).then(() => {
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1400)
    })
  }

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const toggle = () => {
    // Closing plays the anticipation nudge: the whole liquid layer (and the
    // main button riding it) dips toward the returning satellites' momentum
    // and settles back — the PRO7 move that sells the retraction as weight.
    // Side effects stay OUT of the state updater: StrictMode double-invokes
    // updaters, which would start the timer twice.
    if (open && st.anticipDist > 0) {
      if (timer.current) clearTimeout(timer.current)
      setAnticipating(false)
      // Restart cleanly so a rapid re-close replays the nudge from zero.
      requestAnimationFrame(() => setAnticipating(true))
      timer.current = setTimeout(() => setAnticipating(false), st.anticipDur)
    }
    setOpen(o => !o)
  }

  const vars = {
    '--pm-anticip': `${st.anticipDist}px`,
    '--pm-anticip-dur': `${st.anticipDur}ms`,
    '--pm-icon-dur': `${st.iconDur}ms`,
  } as CSSProperties

  const phase = open
    ? { dur: st.openDur, ease: EASES[st.openEase], stagger: st.openStagger }
    : { dur: st.closeDur, ease: EASES[st.closeEase], stagger: st.closeStagger }

  const stage = (
        <Liquid
          blur={blur}
          contrast={contrast}
          fill="var(--modal-bg)"
          shadow={shadow}
          className={`pm ${open ? 'pm-open' : ''} ${anticipating ? 'pm-anticipating' : ''}`}
          style={vars}
        >
          {SATELLITES.map((s, i) => (
            <Liquid.Item
              key={s.label}
              className="pm-slot"
              x={open ? s.x * st.spread : 0}
              y={open ? s.y * st.spread : 0}
              transition={{ duration: phase.dur, ease: phase.ease }}
              delay={i * phase.stagger}
            >
              <button
                type="button"
                className="pm-btn pm-sat"
                aria-label={s.label}
                tabIndex={open ? 0 : -1}
                onClick={toggle}
              >
                <span
                  className="pm-sat-icon"
                  style={{
                    transitionDelay: open ? `${st.iconDelay + i * phase.stagger}ms` : '0ms',
                  }}
                >
                  {s.icon}
                </span>
              </button>
            </Liquid.Item>
          ))}
          <Liquid.Item className="pm-slot">
            <button
              type="button"
              className="pm-btn pm-main"
              aria-expanded={open}
              aria-label={open ? 'Close menu' : 'Open menu'}
              onClick={toggle}
            >
              <span className="pm-plus">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                  <path d="M10 4V16M4 10H16" />
                </svg>
              </span>
            </button>
          </Liquid.Item>
        </Liquid>
  )
  if (bare) return stage

  return (
    <div className="pm-wrap">
      <div className="stage">{stage}</div>

      {!pro && (
        <div className="cp-panel">
          <div className="cp-section">
            <div className="cp-section-head">
              <span className="cp-section-title">Morph</span>
            </div>
            {/* The public knobs for a component-driven morph item: the
                `transition` duration and the per-item `delay` stagger. */}
            <SliderRow label="Duration (ms)" value={st.openDur} min={80} max={1200} step={10} onChange={set('openDur')} />
            <SliderRow label="Stagger (ms)" value={st.openStagger} min={0} max={200} step={5} onChange={set('openStagger')} />
          </div>
        </div>
      )}
      {pro && (
      <div className="cp-panel">
        <div className="cp-section">
          <div className="cp-section-head">
            <span className="cp-section-title">Menu controls</span>
            <span className="cp-actions">
              <button
                type="button"
                className={`cp-export ${copied ? 'is-copied' : ''}`}
                onClick={copyValues}
              >
                {copied ? 'Copied' : 'Copy values'}
              </button>
              <button type="button" className="cp-export" onClick={() => setSt(DEFAULTS)}>
                Reset
              </button>
            </span>
          </div>
          <Subhead>Open</Subhead>
          <SliderRow label="Duration (ms)" value={st.openDur} min={80} max={1200} step={10} onChange={set('openDur')} />
          <EaseRow label="Easing" value={st.openEase} onChange={set('openEase')} />
          <SliderRow label="Stagger (ms)" value={st.openStagger} min={0} max={200} step={5} onChange={set('openStagger')} />
          <Subhead>Close</Subhead>
          <SliderRow label="Duration (ms)" value={st.closeDur} min={80} max={1200} step={10} onChange={set('closeDur')} />
          <EaseRow label="Easing" value={st.closeEase} onChange={set('closeEase')} />
          <SliderRow label="Stagger (ms)" value={st.closeStagger} min={0} max={200} step={5} onChange={set('closeStagger')} />
          <Subhead>Anticipation (on close)</Subhead>
          <SliderRow label="Distance (px)" value={st.anticipDist} min={0} max={24} step={1} onChange={set('anticipDist')} />
          <SliderRow label="Duration (ms)" value={st.anticipDur} min={120} max={1400} step={20} onChange={set('anticipDur')} />
          <Subhead>Layout & icons</Subhead>
          <SliderRow label="Spread" value={st.spread} min={0.4} max={2} step={0.05} onChange={set('spread')} />
          <SliderRow label="Icon fade (ms)" value={st.iconDur} min={0} max={600} step={10} onChange={set('iconDur')} />
          <SliderRow label="Icon delay (ms)" value={st.iconDelay} min={0} max={600} step={10} onChange={set('iconDelay')} />
        </div>
      </div>
      )}
    </div>
  )
}
