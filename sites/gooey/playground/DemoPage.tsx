import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { DemoProps } from './App'
import { DragCard } from './demos/DragCard'
import { EmailInput } from './demos/EmailInput'
import { MeltPair } from './demos/MeltPair'
import { PlusMenu } from './demos/PlusMenu'
import { Slider } from './demos/Slider'
import { SplitPair } from './demos/SplitPair'
import { SHADOWS, getSystemTheme, type Theme } from './theme'

/* Structure, classes and behaviors ported 1:1 from the img-fx demo page
 * (Image loader/img-fx/demo) — the template the marketing pages share.
 * Only `.header` is renamed to `.dm-header` (the lab stylesheet already
 * owns `.header`), and the img-fx shader cards are replaced by the
 * library's own liquid demos. */

const DEV = new URLSearchParams(window.location.search).has('dev')

function CopyIcon(): JSX.Element {
  return (
    <svg
      className="icon-copy"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function CheckIcon(): JSX.Element {
  return (
    <svg
      className="icon-check"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

/* Stroked, not filled — `.icon-btn svg` sets `fill: currentColor`, which
   would flood a chevron drawn as a path into a solid wedge. */
function ChevronLeftIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 11L6 8L9 5" />
    </svg>
  )
}

function GitHubIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

function XIcon(): JSX.Element {
  return (
    <svg
      className="icon-x"
      aria-hidden="true"
      width="16"
      height="17"
      viewBox="0 0 16 17"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="currentColor"
        d="M12.4041 1.39726H14.6953L9.69087 7.2591L15.5781 15.2368H10.9696L7.35741 10.3996L3.22921 15.2368H0.934687L6.28641 8.96575L0.642598 1.39726H5.36795L8.62962 5.81859L12.4041 1.39726ZM11.5992 13.8329H12.8682L4.67667 2.72798H3.31359L11.5992 13.8329Z"
      />
    </svg>
  )
}

function MoonIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      className={className}
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="currentColor"
        d="M6.04458 1.60806C6.1589 1.35528 6.10472 1.05812 5.90855 0.861947C5.71237 0.665775 5.41522 0.611597 5.16244 0.725914C2.51258 1.92428 0.666626 4.59176 0.666626 7.69181C0.666626 11.9121 4.08786 15.3334 8.30817 15.3334C11.4082 15.3334 14.0757 13.4874 15.2741 10.8375C15.3884 10.5848 15.3342 10.2876 15.138 10.0914C14.9419 9.89526 14.6447 9.84108 14.3919 9.9554C13.6009 10.3131 12.7225 10.5126 11.7956 10.5126C8.31168 10.5126 5.4874 7.6883 5.4874 4.20438C5.4874 3.27752 5.68686 2.39905 6.04458 1.60806Z"
      />
    </svg>
  )
}

function SunIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      className={className}
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path fill="currentColor" d="M8.66663 1.33333C8.66663 0.965143 8.36815 0.666666 7.99996 0.666666C7.63177 0.666666 7.33329 0.965143 7.33329 1.33333V2.66667C7.33329 3.03486 7.63177 3.33333 7.99996 3.33333C8.36815 3.33333 8.66663 3.03486 8.66663 2.66667V1.33333Z" />
      <path fill="currentColor" d="M8.66663 13.3333C8.66663 12.9651 8.36815 12.6667 7.99996 12.6667C7.63177 12.6667 7.33329 12.9651 7.33329 13.3333V14.6667C7.33329 15.0349 7.63177 15.3333 7.99996 15.3333C8.36815 15.3333 8.66663 15.0349 8.66663 14.6667V13.3333Z" />
      <path fill="currentColor" d="M0.666626 8C0.666626 7.63181 0.965103 7.33333 1.33329 7.33333H2.66663C3.03482 7.33333 3.33329 7.63181 3.33329 8C3.33329 8.36819 3.03482 8.66667 2.66663 8.66667H1.33329C0.965103 8.66667 0.666626 8.36819 0.666626 8Z" />
      <path fill="currentColor" d="M3.73797 2.7952C3.47762 2.53485 3.05551 2.53485 2.79516 2.7952C2.53481 3.05555 2.53481 3.47766 2.79516 3.73801L3.73797 4.68081C3.99831 4.94116 4.42042 4.94116 4.68077 4.68081C4.94112 4.42046 4.94112 3.99836 4.68077 3.73801L3.73797 2.7952Z" />
      <path fill="currentColor" d="M13.2048 2.7952C13.4651 3.05555 13.4651 3.47766 13.2048 3.73801L12.262 4.68081C12.0016 4.94116 11.5795 4.94116 11.3192 4.68081C11.0588 4.42046 11.0588 3.99836 11.3192 3.73801L12.262 2.7952C12.5223 2.53485 12.9444 2.53485 13.2048 2.7952Z" />
      <path fill="currentColor" d="M4.68077 12.2647C4.94112 12.0043 4.94112 11.5822 4.68077 11.3219C4.42042 11.0615 3.99831 11.0615 3.73797 11.3219L2.79516 12.2647C2.53481 12.525 2.53481 12.9472 2.79516 13.2075C3.05551 13.4679 3.47762 13.4679 3.73797 13.2075L4.68077 12.2647Z" />
      <path fill="currentColor" d="M11.3192 11.3219C11.5795 11.0615 12.0016 11.0615 12.262 11.3219L13.2048 12.2647C13.4651 12.525 13.4651 12.9472 13.2048 13.2075C12.9444 13.4679 12.5223 13.4679 12.262 13.2075L11.3192 12.2647C11.0588 12.0043 11.0588 11.5822 11.3192 11.3219Z" />
      <path fill="currentColor" d="M13.3333 7.33333C12.9651 7.33333 12.6666 7.63181 12.6666 8C12.6666 8.36819 12.9651 8.66667 13.3333 8.66667H14.6666C15.0348 8.66667 15.3333 8.36819 15.3333 8C15.3333 7.63181 15.0348 7.33333 14.6666 7.33333H13.3333Z" />
      <path fill="currentColor" d="M7.99996 4C5.79082 4 3.99996 5.79086 3.99996 8C3.99996 10.2091 5.79082 12 7.99996 12C10.2091 12 12 10.2091 12 8C12 5.79086 10.2091 4 7.99996 4Z" />
    </svg>
  )
}

/** Copy button + animated tooltip — verbatim port from the template. */
function CopyButton({ text, label }: { text: string; label: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const [swapState, setSwapState] = useState<'copy' | 'copied'>('copy')
  const swapRef = useRef<HTMLSpanElement | null>(null)
  const iconTimerRef = useRef<number | undefined>(undefined)
  const swapTimerRef = useRef<number | undefined>(undefined)

  useLayoutEffect(() => {
    const swap = swapRef.current
    if (!swap) return
    const labels = swap.querySelectorAll<HTMLElement>('.tt-label')
    const widths: number[] = []
    labels.forEach(lbl => {
      const prevPos = lbl.style.position
      const prevDisp = lbl.style.display
      lbl.style.position = 'static'
      lbl.style.display = 'inline-block'
      widths.push(lbl.getBoundingClientRect().width)
      lbl.style.position = prevPos
      lbl.style.display = prevDisp
    })
    if (widths.length >= 2) {
      swap.style.setProperty('--tt-w-a', widths[0] + 'px')
      swap.style.setProperty('--tt-w-b', widths[1] + 'px')
    }
  }, [])

  useEffect(() => {
    return () => {
      window.clearTimeout(iconTimerRef.current)
      window.clearTimeout(swapTimerRef.current)
    }
  }, [])

  const handleCopy = useCallback(async () => {
    const writeText = async (value: string): Promise<boolean> => {
      if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(value)
          return true
        } catch {
          /* fall through to the execCommand path */
        }
      }
      if (typeof document === 'undefined') return false
      const ta = document.createElement('textarea')
      ta.value = value
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.top = '0'
      ta.style.left = '0'
      ta.style.width = '1px'
      ta.style.height = '1px'
      ta.style.padding = '0'
      ta.style.border = 'none'
      ta.style.opacity = '0'
      ta.style.pointerEvents = 'none'
      document.body.appendChild(ta)
      const sel = document.getSelection()
      const savedRange = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null
      ta.focus()
      ta.select()
      ta.setSelectionRange(0, value.length)
      let ok = false
      try {
        ok = document.execCommand('copy')
      } catch {
        ok = false
      }
      ta.remove()
      if (savedRange && sel) {
        sel.removeAllRanges()
        sel.addRange(savedRange)
      }
      return ok
    }

    const ok = await writeText(text)
    if (!ok) return
    setCopied(true)
    setSwapState('copied')
    window.clearTimeout(iconTimerRef.current)
    window.clearTimeout(swapTimerRef.current)
    const isTouch =
      typeof window.matchMedia === 'function' && window.matchMedia('(hover: none)').matches
    const dwell = isTouch ? 2000 : 1600
    iconTimerRef.current = window.setTimeout(() => {
      setCopied(false)
      swapTimerRef.current = window.setTimeout(() => {
        setSwapState('copy')
      }, 200)
    }, dwell)
  }, [text])

  return (
    <button
      type="button"
      className="copy-btn"
      onClick={handleCopy}
      data-copied={copied ? 'true' : 'false'}
      aria-label={copied ? 'Copied' : label}
    >
      <CopyIcon />
      <CheckIcon />
      <span className="copy-btn-tooltip" role="tooltip" aria-hidden="true">
        <span className="tt-text">
          <span className="tt-stem">Cop</span>
          <span className="tt-swap" ref={swapRef} data-state={swapState}>
            <span className="tt-label tt-a">y code</span>
            <span className="tt-label tt-b">ied</span>
          </span>
        </span>
      </span>
    </button>
  )
}

/** Track-wide drag, rather than leaning on the native range input.
 *
 *  A native `<input type="range">` only responds to a press that LANDS ON THE
 *  THUMB — on iOS there is no jump-to-position on tap either — so with the
 *  input invisible over a 36px-wide thumb, dragging anywhere else on the
 *  track silently did nothing on a phone. Handling pointer events on the
 *  track means tap-anywhere and drag-from-anywhere behave the same on touch
 *  and mouse. The input stays for keyboard and screen readers (arrows still
 *  work); it is just no longer the pointer target. */
function StrengthSlider({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const dragging = useRef(false)
  const setFromX = (clientX: number) => {
    const el = trackRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (!r.width) return
    const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    const snapped = Math.round((min + p * (max - min)) / step) * step
    // Re-round after the step multiply: 0.5-steps accumulate float dust that
    // would render as "6.000000000000001".
    onChange(Math.min(max, Math.max(min, Math.round(snapped / step) * step)))
  }
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="control-group control-group--strength">
      <label className="control-label" htmlFor={id}>
        {label}
      </label>
      <div
        ref={trackRef}
        className="strength-track"
        onPointerDown={e => {
          dragging.current = true
          // Capture keeps the drag alive past the track's edges. Guarded: it
          // throws for a pointer id the element never really owned, and an
          // exception here would abort the press entirely.
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            /* not a live pointer — the drag flag still tracks it */
          }
          setFromX(e.clientX)
        }}
        onPointerMove={e => {
          if (dragging.current) setFromX(e.clientX)
        }}
        onPointerUp={() => {
          dragging.current = false
        }}
        onPointerCancel={() => {
          dragging.current = false
        }}
      >
        {pct > 0 && <div className="strength-fill" style={{ width: `${pct}%` }} />}
        <span className="strength-value">{value}</span>
        <input
          id={id}
          type="range"
          className="strength-input"
          value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          min={min}
          max={max}
          step={step}
          aria-label={label}
        />
      </div>
    </div>
  )
}

/** The playground's two types — the library's two effects. */
type EffectType = 'morph' | 'move'
const TYPE_OPTIONS: Array<{ value: EffectType; label: string }> = [
  { value: 'morph', label: 'Morph' },
  { value: 'move', label: 'Move' },
]

export function DemoPage(): JSX.Element {
  // ?dev is a DARK recording ground: it paints the page #101010, and the
  // light theme's logo is a JPG with a white field — left to the system
  // preference it drew a white box behind the icon. Force dark.
  const [theme, setTheme] = useState<Theme>(() => (DEV ? 'dark' : getSystemTheme()))
  const userOverrodeThemeRef = useRef(false)
  const [effect, setEffect] = useState<EffectType>('morph')
  const [gooBlur, setGooBlur] = useState(6)
  const [contrast, setContrast] = useState(18)
  const blurId = useId()
  const contrastId = useId()

  const handleToggleTheme = useCallback(() => {
    userOverrodeThemeRef.current = true
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))
  }, [])

  // Live-follow the OS theme until the user opts out via the toggle.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia('(prefers-color-scheme: light)')
    const onSystemThemeChange = (e: MediaQueryListEvent) => {
      if (userOverrodeThemeRef.current) return
      setTheme(e.matches ? 'light' : 'dark')
    }
    mql.addEventListener('change', onSystemThemeChange)
    return () => mql.removeEventListener('change', onSystemThemeChange)
  }, [])

  // Sync the page theme attribute so background + chrome match.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const dark = theme === 'dark'
  const heroProps: DemoProps = {
    blur: 6,
    contrast: 18,
    shadow: SHADOWS[theme]['Figma soft'],
    dark,
    pro: false,
    bare: true,
  }
  const playgroundProps: DemoProps = {
    ...heroProps,
    blur: gooBlur,
    contrast,
  }

  const installCmd = 'npm install liquid-gooey'
  const usageCode = `import { Liquid } from 'liquid-gooey'

export function Menu({ open }: { open: boolean }) {
  return (
    <Liquid blur={6} contrast={18} fill="#fff" shadow="0 2px 6px rgba(0,0,0,.08)">
      <Liquid.Item x={open ? -54 : 0} y={open ? -34 : 0} transition="bouncy">
        <button className="round-btn">…</button>
      </Liquid.Item>
      <Liquid.Item x={0} y={open ? -64 : 0} transition="bouncy" delay={40}>
        <button className="round-btn">…</button>
      </Liquid.Item>
    </Liquid>
  )
}`
  const playgroundCode =
    effect === 'morph'
      ? `import { Liquid } from 'liquid-gooey'

export function PlusMenu({ open }: { open: boolean }) {
  return (
    <Liquid blur={${gooBlur}} contrast={${contrast}} fill="#fff">
      <Liquid.Item x={open ? -54 : 0} y={open ? -34 : 0} transition="bouncy">
        <button className="round-btn">…</button>
      </Liquid.Item>
      <Liquid.Item x={0} y={open ? -64 : 0} transition="bouncy" delay={40}>
        <button className="round-btn">…</button>
      </Liquid.Item>
      <Liquid.Item>
        <button className="round-btn">+</button>
      </Liquid.Item>
    </Liquid>
  )
}`
      : `import { Liquid } from 'liquid-gooey'

export function SliderThumb({ x }: { x: number }) {
  return (
    <Liquid blur={${gooBlur}} contrast={${contrast}} fill="#fff">
      <Liquid.Item effect="move" move={{ springiness: 0.5, trail: 0.35 }}>
        <div className="thumb" style={{ transform: \`translateX(\${x}px)\` }} />
      </Liquid.Item>
    </Liquid>
  )
}`

  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      <main id="main-content" className="app">
        <header className="dm-header">
          <a
            className="top-bar-back"
            href="https://www.jakubantalik.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            {/* One span so chevron and label share a single opacity fade —
                muted at rest, full on hover, like the icon buttons opposite. */}
            <span className="top-bar-back-inner">
              <ChevronLeftIcon />
              jakubantalik.com
            </span>
          </a>
          <nav aria-label="External links" className="top-bar-links">
            <button
              type="button"
              className="icon-btn theme-toggle"
              onClick={handleToggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              <span
                className="theme-icon-stack"
                data-active={theme === 'dark' ? 'sun' : 'moon'}
                aria-hidden="true"
              >
                <MoonIcon className="theme-icon theme-icon-moon" />
                <SunIcon className="theme-icon theme-icon-sun" />
              </span>
            </button>
            <a
              className="icon-btn"
              href="https://github.com/Jakubantalik/Libraries.dev/tree/main/packages/liquid-gooey"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub repository"
            >
              <GitHubIcon />
            </a>
            <a
              className="icon-btn"
              href="https://x.com/jakubantalik"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Follow on X (Twitter)"
            >
              <XIcon />
            </a>
          </nav>
          {/* Both theme variants decode up front and CSS crossfades them —
              a single <img> with a conditional src re-decodes on every
              toggle, which reads as a flash. */}
          <div className="header-icon" aria-hidden="true">
            <img
              className="header-icon-img header-icon-img--dark"
              src="/icon-main-2x-dark.jpg"
              alt=""
              width={207}
              height={138}
              decoding="async"
            />
            <img
              className="header-icon-img header-icon-img--light"
              src="/icon-main-2x-light.jpg"
              alt=""
              width={207}
              height={138}
              decoding="async"
            />
          </div>
          <h1 className="title">Liquid Gooey</h1>
          <p className="subtitle-sm">Liquid effects for React UI</p>
        </header>

        <section className="examples-section" aria-label="Effect demonstrations">
          <div className="example-row-split">
            <div className="example-cell">
              <PlusMenu {...heroProps} />
            </div>
            <div className="example-cell">
              <EmailInput {...heroProps} />
            </div>
          </div>
          {/* The plus menu's sibling: the same morph, reduced to one blank
              circle dividing into two. */}
          <div className="example-row-full example-row-short">
            <SplitPair {...heroProps} />
          </div>
          {/* Melt's showcase: two photos running molten into each other —
              the full-width slot, since the effect needs room to be dragged. */}
          <div className="example-row-full example-cell--drag">
            <MeltPair {...heroProps} />
          </div>
          {/* Move's showcase: the one hero piece that isn't a morph. */}
          <div className="example-row-full example-row-short">
            <Slider {...heroProps} />
          </div>
          {/* Bend: the body deforms with the drag. */}
          <div className="example-row-full example-row-short example-cell--drag">
            <DragCard {...heroProps} />
          </div>
        </section>

        <section className="section" aria-label="Installation">
          <h2 className="section-title">Installation</h2>
          <div className="code-block">
            <code>{installCmd}</code>
            <CopyButton text={installCmd} label="Copy install command" />
          </div>
        </section>

        <section className="section" aria-label="Usage">
          <h2 className="section-title section-title--muted">Usage</h2>
          <div className="code-block code-block--multi">
            <code>{usageCode}</code>
            <CopyButton text={usageCode} label="Copy usage example" />
          </div>
        </section>

        <section className="playground-section" aria-label="Interactive playground">
          <h2 className="section-title">Playground</h2>

          <div className="playground-controls">
            <div className="control-group" role="radiogroup" aria-label="Type">
              <span className="control-label">Type</span>
              <div className="control-options">
                {TYPE_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    className="tab-btn"
                    role="radio"
                    aria-checked={effect === value}
                    data-active={effect === value}
                    onClick={() => setEffect(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <StrengthSlider
              id={blurId}
              label="Goo blur"
              value={gooBlur}
              min={0}
              max={16}
              step={0.5}
              onChange={setGooBlur}
            />

            <StrengthSlider
              id={contrastId}
              label="Contrast"
              value={contrast}
              min={4}
              max={40}
              step={1}
              onChange={setContrast}
            />
          </div>

          <div className="playground-preview">
            {effect === 'morph' ? (
              <PlusMenu {...playgroundProps} />
            ) : (
              <Slider {...playgroundProps} />
            )}
          </div>

          <div className="code-block code-block--multi">
            <code>{playgroundCode}</code>
            <CopyButton text={playgroundCode} label="Copy playground code" />
          </div>
        </section>

        <footer className="footer">
          <span className="footer-muted">Made by</span>{' '}
          <a
            className="footer-name"
            href="https://x.com/jakubantalik"
            target="_blank"
            rel="noopener noreferrer"
          >
            Jakub Antalik
          </a>
        </footer>
      </main>
    </>
  )
}
