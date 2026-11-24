// Adaptive UI, without a framework: one reading of how someone is doing, every 66 ms.
//
// Two sources feed it. The model (AdaptiveUI.json) reads the last 8 s of input and says how
// likely each reading is; the fast signals read the last second or two and see shaking,
// circling, rapid presses and presses on disabled controls within a few hundred ms. Away is a
// plain rule. The reading names one mood, holds it a second once it shows, then eases back, and
// turns into one number for the UI, the reaction, which rises within a tenth of a second and
// eases back over a few seconds once calm, so the UI never flickers.
//
// Nothing is recorded or sent: the recorder keeps positions, timings and element facts in
// memory for about half a minute, never text or field values.

import { Recorder } from './core/events'
import { createDetector, type Detector } from './core/detector'
import { CLASSES, predict, type ClassName, type ModelJson } from './core/model'
import { computeFeatures, ERROR_WINDOW_MS, hasInput, POPULATION_BASELINE, type Baseline } from './core/features'
import { fastSignals, type FastKind } from './core/fast'

export type Mood = 'frustrated' | 'confused' | 'lost' | 'away'
export type { FastKind }

export type AdaptiveReading = {
  /** The mood the reading names, or null while calm or without input. Blocked reads as frustrated. */
  mood: Mood | null
  /** How strongly the UI should react, 0..1. */
  reaction: number
  /** The strength behind the mood, 0..1: the higher of the model and the fast signals. */
  score: number
  /** The model's belief in each of its readings, summing to 1; null without input or a model. */
  probabilities: Record<ClassName, number> | null
  /** The fast signals, 0..1, held a little so they do not flicker between presses. */
  fast: number
  fastKind: FastKind | null
  /** Whether the model passed in could be read. Without one, only the fast signals and away work. */
  isModelLoaded: boolean
}

export type AdaptiveOptions = {
  /** The model, AdaptiveUI.json, as imported. Without it, only the fast signals and away work. */
  model?: unknown
  /** Read only what happens inside this element. Default: the whole page, as the model was
   * trained; a scope drops pointer moves over everything else, which can hide a shake. */
  scope?: Element
  /** localStorage key for the person's own pace; null keeps it in memory only. */
  baselineKey?: string | null
  /** The moods the reaction rises for. Default: frustrated, confused and lost. */
  reactTo?: readonly Mood[]
  /** Called with every new reading. */
  onReading?: (reading: AdaptiveReading) => void
}

export const READING_MS = 66
/** The reading's share where the UI starts to react, and where it is at full strength (the alert line). */
export const REACT_FROM = 0.3
export const REACT_FULL = 0.65
/** The reaction rises within about a tenth of a second and eases back over a few seconds once calm. */
const RISE_MS = 120
const FALL_MS = 3400
/** With no input the model says nothing, which is not the same as calm: someone stuck may be
 * reading the screen. Ease back over about half a minute instead. */
const FALL_IDLE_MS = 25_000
/** Below this score the reading is neutral. */
const CALM_BELOW = 0.2
/** A mood holds this long after the reading drops, then eases down with this time constant. */
const MOOD_HOLD_MS = 1000
const MOOD_EASE_MS = 400
/** The fast signals decay with this time constant between presses. */
const INSTANT_HOLD_MS = 600
/** Away: the pointer out of the window or focus lost (full after 1.5 s), or nothing moved,
 * pressed, scrolled or typed for a while (from 5 s, full at 15 s). */
const AWAY_OUT_MS: [number, number] = [300, 1500]
const AWAY_IDLE_MS: [number, number] = [5000, 15_000]

const MOODS: readonly Mood[] = ['lost', 'confused', 'away', 'frustrated']
const DEFAULT_REACT: readonly Mood[] = ['frustrated', 'confused', 'lost']
/** What a fast signal says: circling one spot is confused; the rest are frustrated. */
const FAST_MOOD: Record<FastKind, Mood> = { shake: 'frustrated', orbit: 'confused', rage: 'frustrated', disabled: 'frustrated' }

type Reading = { score: number; lead: Mood | null; probs: number[] | null; instant: number; kind: FastKind | null }

const ramp = (v: number, [from, to]: [number, number]) => Math.min(1, Math.max(0, (v - from) / (to - from)))

/** Time of the latest pointer move, press, scroll or key, or -1 when there has been none. */
function lastInputAt(events: readonly { k: string; t: number }[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const k = events[i].k
    if (k === 'm' || k === 'c' || k === 's' || k === 'key') return events[i].t
  }
  return -1
}

function asModel(model: unknown): ModelJson | null {
  if (!model || typeof model !== 'object') return null
  return (model as { format?: unknown }).format === 'fx-gbdt-1' ? (model as ModelJson) : null
}

export function createAdaptive(opts: AdaptiveOptions = {}) {
  const reactTo = opts.reactTo ?? DEFAULT_REACT
  const recorder = new Recorder({ keepMs: ERROR_WINDOW_MS + 5000, scope: opts.scope })
  const baselineKey = opts.baselineKey === undefined ? 'adaptive-baseline' : opts.baselineKey

  let model: ModelJson | null = asModel(opts.model)
  let detector: Detector | null = null
  if (model) {
    try {
      // The detector's 250 ms step keeps the person's own pace current; readings come from sample().
      detector = createDetector({ model, recorder, baselineKey })
    } catch (err) {
      console.error('adaptive-ui: this model does not match the kit, so only the fast signals run.', err)
      model = null
    }
  } else if (opts.model) {
    console.error('adaptive-ui: the model is not an AdaptiveUI.json file, so only the fast signals run.')
  }

  let timer = 0
  let lastSample = 0
  let instant = 0
  let instantKind: FastKind | null = null
  let shown: Reading | null = null
  let shownPeakAt = 0
  let level = 0
  let levelPeakAt = 0
  let outAt: number | null = null
  let reading: AdaptiveReading = {
    mood: null,
    reaction: 0,
    score: 0,
    probabilities: null,
    fast: 0,
    fastKind: null,
    isModelLoaded: !!model,
  }

  const out = () => (outAt ??= recorder.now())
  const back = () => (outAt = null)
  const root = document.documentElement

  function awayScore(events: readonly { k: string; t: number }[], now: number): number {
    if (document.visibilityState === 'hidden') return 1
    const last = lastInputAt(events)
    const idle = last < 0 ? 0 : ramp(now - last, AWAY_IDLE_MS)
    const gone = outAt === null ? 0 : ramp(now - outAt, AWAY_OUT_MS)
    return Math.max(idle, gone)
  }

  /** One reading: the higher of the model and the fast signals, named by whichever leads. */
  function makeReading(probs: number[] | null, modelScore: number, input: boolean, away: number, ever: boolean): Reading {
    const base = { probs, instant, kind: instantKind }
    if (!ever) return { ...base, score: 0, lead: null }
    if (away >= CALM_BELOW && away >= modelScore && away >= instant) return { ...base, score: away, lead: 'away' }
    if (!input && instant === 0) return { ...base, score: 0, lead: null }
    const score = Math.max(modelScore, instant)
    if (instantKind && instant > modelScore && instant >= CALM_BELOW) return { ...base, score, lead: FAST_MOOD[instantKind] }
    if (!probs || score < CALM_BELOW) return { ...base, score, lead: null }
    let best = -1
    for (let i = 0; i < probs.length; i++) if (MOODS[i] !== 'away' && (best < 0 || probs[i] > probs[best])) best = i
    return { ...base, score, lead: MOODS[best] }
  }

  /** A rise or a stronger mood shows at once; a mood never drops straight back to calm. */
  function hold(r: Reading, now: number, dt: number): Reading {
    if (!shown?.lead || r.score >= shown.score) {
      shown = r
      shownPeakAt = now
      return r
    }
    const score = now - shownPeakAt < MOOD_HOLD_MS ? shown.score : r.score + (shown.score - r.score) * Math.exp(-dt / MOOD_EASE_MS)
    if (score < CALM_BELOW || (r.lead && score - r.score < 0.02)) {
      shown = r
      return r
    }
    shown = { ...shown, score, probs: r.probs, instant: r.instant, kind: r.kind }
    return shown
  }

  /** The reading's share for the moods the UI reacts to, mapped onto 0..1. */
  function target(r: Reading): number {
    let p = 0
    if (r.probs) for (const m of reactTo) p += r.probs[MOODS.indexOf(m)]
    const f = r.kind && reactTo.includes(FAST_MOOD[r.kind]) ? r.instant : 0
    return Math.min(1, Math.max(0, (Math.max(p, f) - REACT_FROM) / (REACT_FULL - REACT_FROM)))
  }

  function sample(): void {
    const now = recorder.now()
    const dt = lastSample ? Math.max(1, now - lastSample) : READING_MS
    lastSample = now
    const events = recorder.events
    const base: Readonly<Baseline> = detector?.baseline ?? POPULATION_BASELINE

    const fast = fastSignals(events, now, base.speed)
    const held = instant * Math.exp(-dt / INSTANT_HOLD_MS)
    if (fast.score >= held) {
      instant = fast.score
      instantKind = fast.kind
    } else {
      instant = held < 0.01 ? 0 : held
      if (!instant) instantKind = null
    }

    const input = hasInput(events, now)
    const away = awayScore(events, now)
    let raw: Float64Array | null = null
    let probs: number[] | null = null
    let modelScore = 0
    if (model && input) {
      raw = predict(model, computeFeatures(events, now, base as Baseline)).probs
      const at = (c: ClassName) => raw![CLASSES.indexOf(c)]
      // Blocked counts as frustrated; the model's waiting is not a mood.
      probs = MOODS.map((m) => (m === 'away' ? away : m === 'frustrated' ? at('frustrated') + at('blocked') : at(m)))
      modelScore = at('lost') + at('confused') + at('frustrated') + at('blocked')
    } else if (away > 0) {
      probs = MOODS.map((m) => (m === 'away' ? away : 0))
    }
    const live = makeReading(probs, modelScore, input, away, lastInputAt(events) >= 0)
    const r = hold(live, now, dt)

    // The reaction rises at once and, like the mood, waits a second before it eases back.
    const want = target(live)
    if (want >= level) levelPeakAt = now
    if (want >= level || now - levelPeakAt >= MOOD_HOLD_MS) {
      const tau = want > level ? RISE_MS : input ? FALL_MS : FALL_IDLE_MS
      level += (want - level) * (1 - Math.exp(-dt / tau))
    }
    if (want === 0 && level < 0.02) level = 0

    reading = {
      mood: r.lead,
      reaction: level,
      score: r.score,
      probabilities: raw ? (Object.fromEntries(CLASSES.map((c, i) => [c, raw![i]])) as Record<ClassName, number>) : null,
      fast: instant,
      fastKind: instantKind,
      isModelLoaded: !!model,
    }
    opts.onReading?.(reading)
  }

  return {
    start(): void {
      if (timer) return
      recorder.start()
      detector?.start()
      root.addEventListener('pointerleave', out)
      root.addEventListener('pointerenter', back)
      window.addEventListener('blur', out)
      window.addEventListener('focus', back)
      document.addEventListener('pointermove', back, { passive: true })
      timer = window.setInterval(sample, READING_MS)
    },
    stop(): void {
      if (!timer) return
      clearInterval(timer)
      timer = 0
      detector?.stop()
      recorder.stop()
      root.removeEventListener('pointerleave', out)
      root.removeEventListener('pointerenter', back)
      window.removeEventListener('blur', out)
      window.removeEventListener('focus', back)
      document.removeEventListener('pointermove', back)
    },
    get reading(): AdaptiveReading {
      return reading
    },
    /** Call when the app moves to a new step or route: the model reads it as progress. */
    markStep(): void {
      recorder.markNav()
    },
  }
}

export type Adaptive = ReturnType<typeof createAdaptive>
