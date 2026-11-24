// Copied from frustration-ui/src/detector.ts by scripts/sync-core.mjs. Edit it there and copy again.

// Live detector: records events, computes features every 250 ms and runs the model.

import { Recorder } from './events'
import {
  computeFeatures, ERROR_WINDOW_MS, FEATURES, hasInput, newBaseline, POPULATION_BASELINE, STEP_MS, updateBaseline,
  type Baseline,
} from './features'
import { checkModel, predict, type ClassName, type ModelJson } from './model'

export type DetectorState = {
  /** 0..1, the model's 1 - P(none). 0 while there is no input. */
  score: number
  type: Exclude<ClassName, 'none'> | null
  probs: Float64Array | null
  features: Float64Array
  t: number
}

export type DetectorOptions = {
  model: ModelJson
  /** Called after every step. */
  onUpdate?: (state: DetectorState) => void
  /** localStorage key for the personal baseline; null keeps it in memory only. */
  baselineKey?: string | null
  /** Reuse an existing recorder (the lab records the full session with its own). */
  recorder?: Recorder
}

function loadBaseline(key: string | null): Baseline {
  if (!key) return newBaseline()
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (saved && typeof saved.speed === 'number' && typeof saved.clicks === 'number') {
      // A new session starts trusted but not frozen: cap the weight so it keeps adapting.
      // Baselines saved before a field existed start that field at the population value.
      const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
      return {
        speed: saved.speed,
        clicks: saved.clicks,
        active: num(saved.active, POPULATION_BASELINE.active),
        wiggle: num(saved.wiggle, POPULATION_BASELINE.wiggle),
        n: Math.min(saved.n ?? 0, 200),
      }
    }
  } catch {
    // Storage blocked or corrupt: fall back to population values.
  }
  return newBaseline()
}

function saveBaseline(key: string | null, base: Baseline): void {
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify(base))
  } catch {
    // Ignore: the baseline is a convenience.
  }
}

export function createDetector(opts: DetectorOptions) {
  checkModel(opts.model, FEATURES)
  const key = opts.baselineKey === undefined ? 'mood-baseline' : opts.baselineKey
  const owned = !opts.recorder
  const recorder = opts.recorder ?? new Recorder({ keepMs: ERROR_WINDOW_MS + 5000 })
  const base = loadBaseline(key)
  let state: DetectorState = { score: 0, type: null, probs: null, features: new Float64Array(FEATURES.length), t: 0 }
  let timer = 0
  let ticks = 0

  function step(): void {
    const now = recorder.now()
    const x = computeFeatures(recorder.events, now, base)
    updateBaseline(base, x)
    if (hasInput(recorder.events, now)) {
      const p = predict(opts.model, x)
      state = { score: p.score, type: p.type, probs: p.probs, features: x, t: now }
    } else {
      state = { score: 0, type: null, probs: null, features: x, t: now }
    }
    if (++ticks % 40 === 0) saveBaseline(key, base)
    opts.onUpdate?.(state)
  }

  return {
    recorder,
    start(): void {
      if (owned) recorder.start()
      timer = window.setInterval(step, STEP_MS)
    },
    stop(): void {
      clearInterval(timer)
      saveBaseline(key, base)
      if (owned) recorder.stop()
    },
    get state(): DetectorState {
      return state
    },
    get baseline(): Readonly<Baseline> {
      return base
    },
  }
}

export type Detector = ReturnType<typeof createDetector>
