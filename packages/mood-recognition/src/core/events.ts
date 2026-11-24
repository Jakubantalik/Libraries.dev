// Copied from frustration-ui/src/events.ts by scripts/sync-core.mjs. Edit it there and copy again.

// Raw interaction events. These are the only thing the recorder stores:
// positions, timings and element facts. Never text, never field values.

/** frustrated: plain agitation with no clearer cause, like throwing the pointer back and forth. */
export type LabelType = 'blocked' | 'lost' | 'confused' | 'waiting' | 'frustrated'
export const LABEL_TYPES: readonly LabelType[] = ['blocked', 'lost', 'confused', 'waiting', 'frustrated']
export type LabelSource = 'task' | 'self' | 'skip'

/** Key categories. 'b' Backspace/Delete, 'c' printable, 'n' navigation, 'e' Enter, 'o' other. */
export type KeyCat = 'b' | 'c' | 'n' | 'e' | 'o'

/** Facts about the element under a press. */
export type TargetInfo = {
  /** Stable 32-bit hash of a short selector path, so repeat presses on one element match. */
  id: number
  /** 1 when the element or an ancestor is interactive (link, button, field, role, tabindex). */
  i: 0 | 1
  /** 1 when the element is :disabled or aria-disabled="true". */
  d: 0 | 1
  /** 1 when the element shows cursor: pointer (looks clickable). */
  p: 0 | 1
  /** Distance in px from the press to the nearest interactive element, 0 inside one, capped at 200. */
  n: number
  /** 1 for text fields, selects and contenteditable. */
  f: 0 | 1
}

export type RawEvent =
  /** Pointer move. b = buttons held. */
  | { k: 'm'; t: number; x: number; y: number; b: number }
  /**
   * Press, at the time of pointerup: pointer down and up within 600 ms and 12 px (this also covers
   * disabled controls, which get no click), or any longer or moving press that the browser turned
   * into a click. sel = text got selected. h = ms the pointer was held (missing in early lab sessions).
   */
  | { k: 'c'; t: number; x: number; y: number; tg: TargetInfo; sel: 0 | 1; pt: 0 | 1 | 2; h?: number }
  /** Scroll position of one scroll container (e = container hash, 0 = page). */
  | { k: 's'; t: number; y: number; e: number }
  /** Key press category in field f (0 = not in a field). */
  | { k: 'key'; t: number; c: KeyCat; f: number }
  /** A form control's value changed (checkbox, radio, select, committed text). Native controls change without DOM mutations. */
  | { k: 'chg'; t: number; f: number }
  /** A field became invalid (invalid event or aria-invalid="true"). */
  | { k: 'inv'; t: number; f: number }
  /** DOM changes in one animation frame (n = mutation records). */
  | { k: 'mut'; t: number; n: number }
  /** Focus moved to element f. */
  | { k: 'foc'; t: number; f: number }
  /** A new step or route began. */
  | { k: 'nav'; t: number }
  /** Tab visibility changed. */
  | { k: 'vis'; t: number; v: 0 | 1 }
  /** Label marker, lab and synthetic data only. on = 1 starts, 0 ends. src 'self' = "I'm stuck", 'skip' = skipped the step. */
  | { k: 'lbl'; t: number; on: 0 | 1; y: LabelType; src: LabelSource }

export type Session = {
  id: string
  participant: string
  source: 'lab' | 'synthetic'
  /** Free-form facts: device ('mouse' | 'trackpad' | 'touch'), viewport, user agent family, task order. */
  meta: Record<string, string | number>
  events: RawEvent[]
}

const INTERACTIVE = [
  'a[href]', 'button', 'input', 'select', 'textarea', 'label', 'summary',
  '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]', '[role="checkbox"]',
  '[role="switch"]', '[role="option"]', '[role="radio"]', '[onclick]',
  '[tabindex]:not([tabindex="-1"])', '[contenteditable=""]', '[contenteditable="true"]',
].join(',')
const DISABLED = ':disabled, [aria-disabled="true"]'
const FIELD = 'input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable=""], [contenteditable="true"]'
const IGNORE = '[data-mood-ignore]'

/** FNV-1a 32-bit. */
export function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function pathKey(el: Element | null): string {
  const parts: string[] = []
  for (let i = 0; el && i < 3; i++, el = el.parentElement) {
    let p = el.tagName.toLowerCase()
    if (el.id) p += '#' + el.id
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
    if (cls) p += '.' + cls
    const parent = el.parentElement
    if (parent) p += ':' + Array.prototype.indexOf.call(parent.children, el)
    parts.push(p)
  }
  return parts.join('<')
}

export function elementId(el: Element | null): number {
  return el ? hash(pathKey(el)) : 0
}

function distToRect(x: number, y: number, r: DOMRect): number {
  const dx = Math.max(r.left - x, 0, x - r.right)
  const dy = Math.max(r.top - y, 0, y - r.bottom)
  return Math.hypot(dx, dy)
}

export function describeTarget(x: number, y: number, fallback: Element | null): TargetInfo {
  const stack = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : []
  const top = stack[0] ?? fallback
  // A disabled control under the pointer wins, even when the event landed on an ancestor.
  const disabled = stack.find((e) => e.matches(DISABLED)) ?? top?.closest(DISABLED) ?? null
  const el = disabled ?? top
  const interactive = el?.closest(INTERACTIVE) ?? null
  let n = 0
  if (!interactive) {
    n = 200
    const all = document.querySelectorAll(INTERACTIVE)
    for (let i = 0; i < all.length && i < 400; i++) {
      const d = distToRect(x, y, all[i].getBoundingClientRect())
      if (d < n) n = d
    }
    n = Math.round(n)
  }
  return {
    id: elementId(interactive ?? el),
    i: interactive ? 1 : 0,
    d: disabled ? 1 : 0,
    p: el && getComputedStyle(el).cursor === 'pointer' ? 1 : 0,
    n,
    f: el?.closest(FIELD) ? 1 : 0,
  }
}

function keyCat(e: KeyboardEvent): KeyCat {
  if (e.key === 'Backspace' || e.key === 'Delete') return 'b'
  if (e.key === 'Enter') return 'e'
  if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) return 'c'
  if (/^(Arrow|Tab|Home|End|Page)/.test(e.key)) return 'n'
  return 'o'
}

type Down = { t: number; x: number; y: number; tg: TargetInfo; pt: 0 | 1 | 2 }

/** A tap: down and up within this time and distance. Anything longer counts only if it clicks. */
const TAP_MS = 600
const TAP_PX = 12
/** How long after pointerup a click may arrive and still belong to that press. */
const CLICK_AFTER_UP_MS = 400

export type RecorderOptions = {
  root?: Document
  /** Keep events newer than this (ms). Infinity keeps everything (lab). */
  keepMs?: number
  onEvent?: (e: RawEvent) => void
  /** Read only events whose target is inside this element (the page's own scroll still counts). */
  scope?: Element
}

/**
 * Listens to the page and records RawEvents with times relative to start().
 * All listeners are passive and capture-phase on document.
 */
export class Recorder {
  events: RawEvent[] = []
  private t0 = 0
  private keepMs: number
  private onEvent?: (e: RawEvent) => void
  private scope?: Element
  private off: (() => void)[] = []
  private down: Down | null = null
  /** A press too slow or too far for a tap, kept until the click that may follow its pointerup. */
  private longUp: { d: Down; t: number } | null = null
  private mutCount = 0
  private mutRaf = 0

  constructor(opts: RecorderOptions = {}) {
    this.keepMs = opts.keepMs ?? 60_000
    this.onEvent = opts.onEvent
    this.scope = opts.scope
  }

  now(): number {
    return Math.round(performance.now() - this.t0)
  }

  push(e: RawEvent): void {
    // Presses are pushed one frame late; keep the log sorted by time.
    let i = this.events.length
    while (i > 0 && this.events[i - 1].t > e.t) i--
    if (i === this.events.length) this.events.push(e)
    else this.events.splice(i, 0, e)
    if (this.keepMs !== Infinity && this.events.length > 4096) {
      const cutoff = e.t - this.keepMs
      let i = 0
      while (i < this.events.length && this.events[i].t < cutoff) i++
      if (i > 0) this.events.splice(0, i)
    }
    this.onEvent?.(e)
  }

  private ignored(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false
    if (this.scope && !this.scope.contains(target)) return true
    return target.closest(IGNORE) !== null
  }

  start(): void {
    this.t0 = performance.now()
    const doc = document
    const on = <K extends keyof DocumentEventMap>(type: K, fn: (e: DocumentEventMap[K]) => void) => {
      doc.addEventListener(type, fn as EventListener, { capture: true, passive: true })
      this.off.push(() => doc.removeEventListener(type, fn as EventListener, { capture: true }))
    }

    on('pointermove', (e) => {
      if (this.ignored(e.target)) return
      this.push({ k: 'm', t: this.now(), x: Math.round(e.clientX), y: Math.round(e.clientY), b: e.buttons })
    })
    const press = (d: Down, t: number) => {
      // Wait one frame so a triple-click selection is visible.
      requestAnimationFrame(() => {
        const s = doc.getSelection()
        const sel: 0 | 1 = s && !s.isCollapsed && s.toString().length > 0 ? 1 : 0
        this.push({ k: 'c', t, x: Math.round(d.x), y: Math.round(d.y), tg: d.tg, sel, pt: d.pt, h: Math.round(t - d.t) })
      })
    }
    on('pointerdown', (e) => {
      this.longUp = null
      if (this.ignored(e.target)) return
      const pt = e.pointerType === 'touch' ? 2 : e.pointerType === 'pen' ? 1 : 0
      // Describe the target now: a button that disables itself on click must still count as enabled.
      this.down = { t: this.now(), x: e.clientX, y: e.clientY, tg: describeTarget(e.clientX, e.clientY, e.target as Element | null), pt }
    })
    on('pointerup', (e) => {
      const d = this.down
      this.down = null
      if (!d) return
      const t = this.now()
      if (t - d.t <= TAP_MS && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= TAP_PX) press(d, t)
      // A slow or sliding press still clicks the button under it. Drags that end on another
      // element and touch scrolls produce no click, so they never become presses.
      else this.longUp = { d, t }
    })
    on('pointercancel', () => {
      this.down = null
      this.longUp = null
    })
    on('click', (e) => {
      const up = this.longUp
      this.longUp = null
      // detail 0 is a click from the keyboard, not from this press.
      if (!up || e.detail === 0 || this.now() - up.t > CLICK_AFTER_UP_MS) return
      press(up.d, up.t)
    })
    on('scroll', (e) => {
      const target = e.target
      if (this.ignored(target)) return
      const isPage = target === doc || target === doc.documentElement || target === doc.body
      const y = isPage ? window.scrollY : (target as Element).scrollTop
      this.push({ k: 's', t: this.now(), y: Math.round(y), e: isPage ? 0 : elementId(target as Element) })
    })
    on('keydown', (e) => {
      if (this.ignored(e.target)) return
      const el = e.target instanceof Element ? e.target.closest(FIELD) : null
      this.push({ k: 'key', t: this.now(), c: keyCat(e), f: el ? elementId(el) : 0 })
    })
    on('change', (e) => {
      if (this.ignored(e.target)) return
      this.push({ k: 'chg', t: this.now(), f: elementId(e.target as Element) })
    })
    on('invalid' as keyof DocumentEventMap, (e) => {
      if (this.ignored(e.target)) return
      this.push({ k: 'inv', t: this.now(), f: elementId(e.target as Element) })
    })
    on('focusin', (e) => {
      if (this.ignored(e.target)) return
      this.push({ k: 'foc', t: this.now(), f: elementId(e.target as Element) })
    })
    on('visibilitychange', () => {
      this.push({ k: 'vis', t: this.now(), v: doc.visibilityState === 'visible' ? 1 : 0 })
    })

    const mo = new MutationObserver((records) => {
      for (const r of records) {
        if (this.ignored(r.target)) continue
        if (r.type === 'attributes') {
          if (r.attributeName === 'style') continue
          if (r.attributeName === 'aria-invalid') {
            const el = r.target as Element
            if (el.getAttribute('aria-invalid') === 'true') this.push({ k: 'inv', t: this.now(), f: elementId(el) })
          }
        }
        this.mutCount++
      }
      if (this.mutCount && !this.mutRaf) {
        this.mutRaf = requestAnimationFrame(() => {
          this.push({ k: 'mut', t: this.now(), n: this.mutCount })
          this.mutCount = 0
          this.mutRaf = 0
        })
      }
    })
    mo.observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true })
    this.off.push(() => mo.disconnect())
  }

  /** Call when the app moves to a new step or route. */
  markNav(): void {
    this.push({ k: 'nav', t: this.now() })
  }

  /** Lab only: start or end a labeled friction interval. */
  label(on: 0 | 1, y: LabelType, src: LabelSource = 'task'): void {
    this.push({ k: 'lbl', t: this.now(), on, y, src })
  }

  stop(): void {
    this.off.forEach((f) => f())
    this.off = []
    cancelAnimationFrame(this.mutRaf)
  }
}
