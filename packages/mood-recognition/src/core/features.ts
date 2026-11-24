// Copied from frustration-ui/src/features.ts by scripts/sync-core.mjs. Edit it there and copy again.

// Feature extraction over a sliding window of RawEvents.
// This file is the single source of truth: training features are computed by
// running this exact code (scripts/featurize.ts), never re-implemented in Python.

import type { RawEvent } from './events'
import { orbitScore, shakeScore } from './fast'

export const WINDOW_MS = 8000
export const SHORT_MS = 2000
export const ERROR_WINDOW_MS = 30_000
/** Where the pointer has been: stops and returns over the last 15 s. */
export const REVISIT_MS = 15_000
/** Trying the same thing again: retyping a field after sending it, over the last minute. */
export const RETRY_MS = 60_000
export const STEP_MS = 250

export const FEATURES = [
  'move_speed', //          path length per second over the window
  'move_speed_p90', //      90th percentile segment speed, px/s
  'move_active', //         share of the window spent moving
  'move_turns', //          sharp turns (>120°) at speed (>600 px/s) per second
  'move_wiggle', //         turns >90° at any speed per second
  'move_straight', //       mean displacement/path of strokes longer than 50 px
  'move_ratio_2s', //       path/displacement over the last 2 s, capped at 20
  'move_jerk', //           log1p(mean speed change rate / 1000)
  'idle_frac', //           share of the window inside gaps longer than 1 s
  'pause_max', //           longest gap without input, s, capped at 8
  'clicks', //              presses in the window (presses that only selected plain text excluded)
  'rage_max', //            largest cluster: presses within 1 s and 30 px (40 px touch), on anything
  'rage_clusters', //       clusters of 3 or more (a double or triple click that selects text is not one)
  'dead_clicks', //         presses on non-interactive elements with no response in 300 ms
  'dead_ptr_clicks', //     dead presses on elements that look clickable
  'disabled_clicks', //     presses on disabled controls
  'near_miss', //           presses on nothing within 16 px of an interactive element
  'same_target_max', //     most presses on one element
  'waiting_s', //           seconds since the last button press with no DOM response, capped at 10
  'since_click', //         log1p(seconds since the last press, capped at 30)
  'scroll_speed', //        scrolled px per second
  'scroll_reversals', //    direction flips between legs of 150 px or more
  'scroll_back', //         share of scrolling that went up
  'keys', //                key presses in the window
  'backspace_frac', //      Backspace/Delete share of editing keys
  'backspace_bursts', //    6+ Backspace/Delete within 2 s in one field
  'invalid_30s', //         invalid fields in the last 30 s
  'invalid_same_max_30s', // most invalid events on one field in the last 30 s
  'step_time', //           log1p(seconds on the current step, capped at 600)
  'mut_rate', //            log1p(DOM changes per second)
  'focus_changes', //       focus moves in the window
  'speed_rel', //           move_speed_p90 relative to this person's baseline
  'click_rel', //           click rate relative to this person's baseline
  'explore_30s', //         different buttons and links pressed since the last progress (page change, value change, typing), 30 s lookback
  'since_progress', //      log1p(seconds since the last progress, capped at 30)
  'active_rel', //          move_active relative to this person's baseline
  'wiggle_rel', //          move_wiggle relative to this person's baseline
  'shake_1s', //            the pointer thrown back and forth over the last 1 s (src/fast.ts), 0..1
  'orbit_2s', //            the pointer circling one spot over the last 2 s (src/fast.ts), 0..1
  'orbit_8s', //            share of the window spent circling one spot (orbit_2s >= 0.5, every 500 ms)
  'revisits_15s', //        returns to a spot the pointer rested on before and left, without pressing there, 15 s lookback
  'spots_15s', //           different spots the pointer rested on without pressing anything there, 15 s lookback
  'retype_60s', //          attempts after the first at typing one field and sending it the same way (one button, or Enter), no new step between, 60 s lookback
] as const

export type FeatureName = (typeof FEATURES)[number]
export const FEATURE_COUNT = FEATURES.length

/**
 * Personal baseline. Starts at population values and adapts over a few minutes. Pointer habits
 * differ a lot between people (a restless mouse or a hovering pen moves most of the time), so
 * the model also sees movement relative to this person's normal.
 */
export type Baseline = { speed: number; clicks: number; active: number; wiggle: number; n: number }
export const POPULATION_BASELINE: Readonly<Baseline> = { speed: 900, clicks: 0.35, active: 0.13, wiggle: 0.1, n: 0 }
export function newBaseline(): Baseline {
  return { ...POPULATION_BASELINE }
}

/** First index with t >= value. Events must be sorted by t. */
export function lowerBound(events: readonly RawEvent[], t: number): number {
  let lo = 0
  let hi = events.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (events[mid].t < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** First index with t > value. */
export function upperBound(events: readonly RawEvent[], t: number): number {
  let lo = 0
  let hi = events.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (events[mid].t <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

type Move = { t: number; x: number; y: number }
type Press = Extract<RawEvent, { k: 'c' }>

const STROKE_GAP = 150
const ANCHOR_PX = 8

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const i = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
  return sorted[i]
}

function angleBetween(ax: number, ay: number, bx: number, by: number): number {
  const dot = ax * bx + ay * by
  const den = Math.hypot(ax, ay) * Math.hypot(bx, by)
  if (den === 0) return 0
  return (Math.acos(Math.max(-1, Math.min(1, dot / den))) * 180) / Math.PI
}

function movementFeatures(moves: Move[], now: number, out: Record<FeatureName, number>): number[] {
  const W = WINDOW_MS / 1000
  let path = 0
  let active = 0
  const speeds: number[] = []
  const speedSeq: { v: number; dt: number }[] = []
  for (let i = 1; i < moves.length; i++) {
    const a = moves[i - 1]
    const b = moves[i]
    const dt = b.t - a.t
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    path += d
    if (dt > 0 && dt <= STROKE_GAP) {
      const v = (d / dt) * 1000
      speeds.push(v)
      speedSeq.push({ v, dt })
      if (v > 50) active += dt
    } else {
      speedSeq.push({ v: -1, dt })
    }
  }
  out.move_speed = path / W
  const sorted = speeds.slice().sort((a, b) => a - b)
  out.move_speed_p90 = speeds.length >= 5 ? percentile(sorted, 0.9) : 0
  out.move_active = active / WINDOW_MS

  // Turns on a path resampled every 8 px, broken at pauses.
  let sharp = 0
  let wiggle = 0
  let anchor: Move | null = null
  let prevDir: { dx: number; dy: number } | null = null
  let last: Move | null = null
  for (const m of moves) {
    if (last && m.t - last.t > STROKE_GAP) {
      anchor = null
      prevDir = null
    }
    last = m
    if (!anchor) {
      anchor = m
      continue
    }
    const dx = m.x - anchor.x
    const dy = m.y - anchor.y
    const d = Math.hypot(dx, dy)
    if (d < ANCHOR_PX) continue
    const dt = Math.max(1, m.t - anchor.t)
    const v = (d / dt) * 1000
    if (prevDir) {
      const ang = angleBetween(prevDir.dx, prevDir.dy, dx, dy)
      if (ang > 90) wiggle++
      if (ang > 120 && v > 600) sharp++
    }
    prevDir = { dx, dy }
    anchor = m
  }
  out.move_turns = sharp / W
  out.move_wiggle = wiggle / W

  // Strokes.
  let sum = 0
  let count = 0
  let start = 0
  for (let i = 1; i <= moves.length; i++) {
    if (i === moves.length || moves[i].t - moves[i - 1].t > STROKE_GAP) {
      let p = 0
      for (let j = start + 1; j < i; j++) p += Math.hypot(moves[j].x - moves[j - 1].x, moves[j].y - moves[j - 1].y)
      if (p > 50) {
        const disp = Math.hypot(moves[i - 1].x - moves[start].x, moves[i - 1].y - moves[start].y)
        sum += disp / p
        count++
      }
      start = i
    }
  }
  out.move_straight = count ? sum / count : 1

  // Path over displacement in the last 2 s.
  const s0 = moves.findIndex((m) => m.t >= now - SHORT_MS)
  if (s0 >= 0 && moves.length - s0 >= 2) {
    let p = 0
    for (let j = s0 + 1; j < moves.length; j++) p += Math.hypot(moves[j].x - moves[j - 1].x, moves[j].y - moves[j - 1].y)
    const disp = Math.hypot(moves[moves.length - 1].x - moves[s0].x, moves[moves.length - 1].y - moves[s0].y)
    out.move_ratio_2s = p < 100 ? 1 : Math.min(20, p / Math.max(disp, 1))
  } else {
    out.move_ratio_2s = 1
  }

  // Jerk: how abruptly speed changes between consecutive segments.
  let jerkSum = 0
  let jerkN = 0
  for (let i = 1; i < speedSeq.length; i++) {
    const a = speedSeq[i - 1]
    const b = speedSeq[i]
    if (a.v < 0 || b.v < 0) continue
    const dt = (a.dt + b.dt) / 2 / 1000
    jerkSum += Math.abs(b.v - a.v) / dt
    jerkN++
  }
  out.move_jerk = jerkN ? Math.log1p(jerkSum / jerkN / 1000) : 0

  return speeds
}

/** A pointer resting within STOP_PX for this long is a stop: looking at something. */
const STOP_MS = 300
const STOP_PX = 12
/** Stops this close together are one spot. */
const SPOT_PX = 60
/** A spot was left when the pointer went at least this far from it. */
const AWAY_PX = 150
/** A press this close to a stop, during it, means the spot was used, not just looked at. */
const PRESS_PX = 40

/**
 * Where the pointer rests, and whether it keeps coming back. Stops are found on unbroken
 * positions (a resting pointer sends no moves, so a gap counts as resting). A revisit is a stop
 * on a spot rested on before, after the pointer went at least AWAY_PX away, with no press there:
 * looking at the same places again without doing anything, the way people search for something.
 */
function revisitFeatures(events: readonly RawEvent[], now: number, out: Record<FeatureName, number>): void {
  const from = lowerBound(events, now - REVISIT_MS)
  const end = upperBound(events, now)
  const presses: Press[] = []
  for (let i = from; i < end; i++) {
    const e = events[i]
    if (e.k === 'c') presses.push(e)
  }
  type Spot = { x: number; y: number; away: number; pressed: boolean }
  const spots: Spot[] = []
  let revisits = 0
  const addStop = (x: number, y: number, t0: number, t1: number) => {
    const pressed = presses.some((p) => p.t >= t0 - 100 && p.t <= t1 + 100 && Math.hypot(p.x - x, p.y - y) <= PRESS_PX)
    let best: Spot | null = null
    let bestD = SPOT_PX
    for (const s of spots) {
      const d = Math.hypot(s.x - x, s.y - y)
      if (d <= bestD) {
        best = s
        bestD = d
      }
    }
    if (!best) {
      spots.push({ x, y, away: 0, pressed })
      return
    }
    if (!pressed && best.away >= AWAY_PX) revisits++
    best.away = 0
    best.pressed ||= pressed
  }
  let sx = NaN
  let sy = NaN
  let st = 0
  let lx = NaN
  let ly = NaN
  for (let i = from; i < end; i++) {
    const e = events[i]
    if (e.k !== 'm' || e.b !== 0) continue
    if (Number.isNaN(sx)) {
      sx = e.x
      sy = e.y
      st = e.t
      continue
    }
    if (Math.hypot(e.x - sx, e.y - sy) <= STOP_PX) continue
    if (e.t - st >= STOP_MS) addStop(sx, sy, st, e.t)
    sx = e.x
    sy = e.y
    st = e.t
    // How far the pointer has gone from each spot, on a path resampled every 8 px.
    if (Number.isNaN(lx) || Math.hypot(e.x - lx, e.y - ly) >= ANCHOR_PX) {
      lx = e.x
      ly = e.y
      for (const s of spots) s.away = Math.max(s.away, Math.hypot(e.x - s.x, e.y - s.y))
    }
  }
  if (!Number.isNaN(sx) && now - st >= STOP_MS) addStop(sx, sy, st, now)
  out.revisits_15s = revisits
  out.spots_15s = spots.filter((s) => !s.pressed).length
}

/**
 * Trying again after it did not work: the same field typed into and sent the same way (the same
 * button, or Enter) again and again, with no new step in between. A discount code that keeps
 * failing, a password that is not accepted, a date in the wrong format. Counts the attempts after
 * the first, for the field and button used most. Filling a form and sending it once counts 0, and
 * so does typing between presses on different controls (a toolbar, switches).
 */
function retypes(events: readonly RawEvent[], now: number): number {
  const end = upperBound(events, now)
  let typed = 0
  const tries = new Map<string, number>()
  let max = 0
  for (let i = lowerBound(events, now - RETRY_MS); i < end; i++) {
    const e = events[i]
    let via: number | 'enter' | null = null
    if (e.k === 'nav') {
      tries.clear()
      typed = 0
      max = 0
    } else if (e.k === 'key' && e.f !== 0) {
      if (e.c === 'c' || e.c === 'b') typed = e.f
      else if (e.c === 'e') via = 'enter'
    } else if (e.k === 'c' && e.tg.i && !e.tg.d && !e.tg.f && !plainSelect(e)) {
      via = e.tg.id
    }
    if (via === null) continue
    if (typed) {
      const key = `${typed}:${via}`
      const n = (tries.get(key) ?? 0) + 1
      tries.set(key, n)
      if (n - 1 > max) max = n - 1
    }
    typed = 0
  }
  return max
}

/** Share of the window spent circling one spot, sampled every 500 ms. */
function orbitShare(events: readonly RawEvent[], now: number): number {
  let n = 0
  let k = 0
  for (let t = now; t > now - WINDOW_MS; t -= 500, k++) if (orbitScore(events, t) >= 0.5) n++
  return n / k
}

/**
 * A press that only selected text: a selection on a non-interactive element. A selection on a
 * control (a summary, a button label) is a side effect of pressing fast, so it still counts.
 */
function plainSelect(p: Press): boolean {
  return p.sel === 1 && p.tg.i === 0
}

/**
 * Rage clusters over every press, text selections included: pressing anything fast selects
 * text, and rage on a working control or on plain text is still rage. Only a cluster of 3 or
 * fewer is read as a double or triple click, where presses that selected text do not count.
 */
function clusters(presses: Press[]): { max: number; count: number } {
  let max = 0
  let count = 0
  let i = 0
  while (i < presses.length) {
    const a = presses[i]
    const radius = a.pt === 2 ? 40 : 30
    let j = i + 1
    while (j < presses.length && presses[j].t - a.t <= 1000 && Math.hypot(presses[j].x - a.x, presses[j].y - a.y) <= radius) j++
    let size = j - i
    if (size <= 3) {
      size = 0
      for (let k = i; k < j; k++) if (!presses[k].sel) size++
    }
    if (size > max) max = size
    if (size >= 3) {
      count++
      i = j
    } else {
      i++
    }
  }
  return { max, count }
}

/** Hold time assumed for presses recorded before the recorder stored it. */
const DEFAULT_HOLD_MS = 120

/**
 * Did the page react to press p by `to`? Counts from pointerdown, because focus and many UI
 * reactions happen before pointerup. Focus landing on the pressed element itself is not a
 * reaction (browsers focus a button on pointerdown), but focus moving elsewhere is.
 * A value change counts only from pointerup: at pointerdown it is the text field the person
 * just left committing its value (blur), not the page answering the press.
 */
function responded(events: readonly RawEvent[], p: Press, to: number): boolean {
  const from = p.t - (p.h ?? DEFAULT_HOLD_MS)
  for (let i = lowerBound(events, from); i < events.length && events[i].t <= to; i++) {
    const e = events[i]
    if (e.k === 'mut' || e.k === 'nav') return true
    if (e.k === 'chg' && e.t >= p.t) return true
    if (e.k === 'foc' && e.f !== p.tg.id) return true
  }
  return false
}

/** Progress: a new step, a committed value, or typing into a field. */
function isProgress(e: RawEvent): boolean {
  return e.k === 'nav' || e.k === 'chg' || (e.k === 'key' && e.c === 'c' && e.f !== 0)
}

/**
 * Computes the feature vector at time `now` from events sorted by t.
 * Only events with t <= now are used.
 */
export function computeFeatures(events: readonly RawEvent[], now: number, base: Baseline): Float64Array {
  const W = WINDOW_MS / 1000
  const out = {} as Record<FeatureName, number>
  const end = upperBound(events, now)
  const w0 = lowerBound(events, now - WINDOW_MS)
  const e0 = lowerBound(events, now - ERROR_WINDOW_MS)

  const moves: Move[] = []
  const presses: Press[] = []
  const allPresses: Press[] = []
  const inputTimes: number[] = []
  let mutN = 0
  let focus = 0
  let keys = 0
  let back = 0
  let chars = 0
  const backTimes = new Map<number, number[]>()
  const scrolls = new Map<number, number[]>()

  for (let i = w0; i < end; i++) {
    const e = events[i]
    switch (e.k) {
      case 'm':
        inputTimes.push(e.t)
        if (e.b === 0) moves.push(e)
        break
      case 'c':
        inputTimes.push(e.t)
        allPresses.push(e)
        if (!plainSelect(e)) presses.push(e)
        break
      case 's': {
        inputTimes.push(e.t)
        const list = scrolls.get(e.e)
        if (list) list.push(e.y)
        else scrolls.set(e.e, [e.y])
        break
      }
      case 'key':
        inputTimes.push(e.t)
        if (e.c === 'b') {
          back++
          const list = backTimes.get(e.f)
          if (list) list.push(e.t)
          else backTimes.set(e.f, [e.t])
        } else if (e.c === 'c') {
          chars++
        }
        if (e.c === 'b' || e.c === 'c' || e.c === 'e') keys++
        break
      case 'mut':
        mutN += e.n
        break
      case 'foc':
        focus++
        break
    }
  }

  const speeds = movementFeatures(moves, now, out)

  // Gaps.
  let idle = 0
  let pauseMax = 0
  let prev = now - WINDOW_MS
  for (const t of [...inputTimes, now]) {
    const gap = t - prev
    if (gap > 1000) idle += gap - 1000
    if (gap > pauseMax) pauseMax = gap
    prev = t
  }
  out.idle_frac = idle / WINDOW_MS
  out.pause_max = Math.min(8, pauseMax / 1000)

  // Presses.
  out.clicks = presses.length
  const cl = clusters(allPresses)
  out.rage_max = cl.max
  out.rage_clusters = cl.count
  let dead = 0
  let deadPtr = 0
  let disabled = 0
  let near = 0
  const perTarget = new Map<number, number>()
  for (const p of presses) {
    if (p.tg.d) disabled++
    if (!p.tg.i && !p.tg.d) {
      if (p.tg.n > 0 && p.tg.n <= 16) near++
      if (p.t <= now - 300 && !responded(events, p, p.t + 300)) {
        dead++
        if (p.tg.p) deadPtr++
      }
    }
    if (p.tg.id) perTarget.set(p.tg.id, (perTarget.get(p.tg.id) ?? 0) + 1)
  }
  out.dead_clicks = dead
  out.dead_ptr_clicks = deadPtr
  out.disabled_clicks = disabled
  out.near_miss = near
  out.same_target_max = perTarget.size ? Math.max(...perTarget.values()) : 0

  // Waiting and time since the last press (30 s lookback).
  let lastPress: Press | null = null
  let lastButton: Press | null = null
  for (let i = end - 1; i >= e0; i--) {
    const e = events[i]
    if (e.k !== 'c' || plainSelect(e)) continue
    if (!lastPress) lastPress = e
    if (e.tg.i && !e.tg.d && !e.tg.f) {
      lastButton = e
      break
    }
  }
  out.waiting_s = 0
  if (lastButton && now - lastButton.t >= 1000 && !responded(events, lastButton, now)) {
    out.waiting_s = Math.min(10, (now - lastButton.t) / 1000)
  }
  out.since_click = Math.log1p(lastPress ? Math.min(30, (now - lastPress.t) / 1000) : 30)

  // Scrolling, per container.
  let scrolled = 0
  let up = 0
  let reversals = 0
  for (const ys of scrolls.values()) {
    const legs: number[] = []
    for (let i = 1; i < ys.length; i++) {
      const d = ys[i] - ys[i - 1]
      if (d === 0) continue
      scrolled += Math.abs(d)
      if (d < 0) up += -d
      const lastLeg = legs[legs.length - 1]
      if (lastLeg !== undefined && Math.sign(lastLeg) === Math.sign(d)) legs[legs.length - 1] += d
      else legs.push(d)
    }
    // Drop jitter legs, merge neighbours that now share a direction.
    const clean: number[] = []
    for (const l of legs) {
      if (Math.abs(l) < 20) continue
      const lastLeg = clean[clean.length - 1]
      if (lastLeg !== undefined && Math.sign(lastLeg) === Math.sign(l)) clean[clean.length - 1] += l
      else clean.push(l)
    }
    for (let i = 1; i < clean.length; i++) {
      if (Math.abs(clean[i - 1]) >= 150 && Math.abs(clean[i]) >= 150) reversals++
    }
  }
  out.scroll_speed = scrolled / W
  out.scroll_reversals = reversals
  out.scroll_back = scrolled >= 1 ? up / scrolled : 0

  // Keys.
  out.keys = keys
  out.backspace_frac = back / Math.max(1, back + chars)
  let bursts = 0
  for (const times of backTimes.values()) {
    let i = 0
    while (i < times.length) {
      let j = i
      while (j < times.length && times[j] - times[i] <= 2000) j++
      if (j - i >= 6) {
        bursts++
        i = j
      } else {
        i++
      }
    }
  }
  out.backspace_bursts = bursts

  // Validation errors, 30 s lookback.
  let invalid = 0
  const perField = new Map<number, number>()
  let lastNav = -1
  for (let i = e0; i < end; i++) {
    const e = events[i]
    if (e.k === 'inv') {
      invalid++
      perField.set(e.f, (perField.get(e.f) ?? 0) + 1)
    }
  }
  for (let i = end - 1; i >= 0; i--) {
    if (events[i].k === 'nav') {
      lastNav = events[i].t
      break
    }
  }
  out.invalid_30s = invalid
  out.invalid_same_max_30s = perField.size ? Math.max(...perField.values()) : 0

  // Exploring without progress, 30 s lookback: someone looking for a setting opens section
  // after section, and every press gets a response, but nothing gets done.
  let lastProgress = -1
  for (let i = end - 1; i >= e0; i--) {
    if (isProgress(events[i])) {
      lastProgress = i
      break
    }
  }
  const explored = new Set<number>()
  for (let i = Math.max(lastProgress + 1, e0); i < end; i++) {
    const e = events[i]
    if (e.k === 'c' && e.tg.i && !e.tg.d && !e.tg.f && !plainSelect(e)) explored.add(e.tg.id)
  }
  out.explore_30s = explored.size
  out.since_progress = Math.log1p(lastProgress >= 0 ? Math.min(30, (now - events[lastProgress].t) / 1000) : 30)

  // Context.
  out.step_time = Math.log1p(Math.min(600, (now - (lastNav >= 0 ? lastNav : 0)) / 1000))
  out.mut_rate = Math.log1p(mutN / W)
  out.focus_changes = focus

  // Relative to this person's normal.
  out.speed_rel = out.move_speed_p90 > 0 ? out.move_speed_p90 / base.speed : 1
  out.click_rel = (presses.length / W + 0.1) / (base.clicks + 0.1)
  out.active_rel = (out.move_active + 0.05) / (base.active + 0.05)
  out.wiggle_rel = (out.move_wiggle + 0.2) / (base.wiggle + 0.2)
  // The window above is 8 s; a shake needs a short one to be seen while it happens.
  out.shake_1s = shakeScore(events, now, base.speed)
  out.orbit_2s = orbitScore(events, now)
  out.orbit_8s = orbitShare(events, now)
  revisitFeatures(events, now, out)
  out.retype_60s = retypes(events, now)

  const vec = new Float64Array(FEATURE_COUNT)
  for (let i = 0; i < FEATURE_COUNT; i++) vec[i] = out[FEATURES[i]]
  void speeds
  return vec
}

/** True when the window holds any user input. Windows without input are skipped. */
export function hasInput(events: readonly RawEvent[], now: number): boolean {
  for (let i = lowerBound(events, now - WINDOW_MS), end = upperBound(events, now); i < end; i++) {
    const k = events[i].k
    if (k === 'm' || k === 'c' || k === 's' || k === 'key') return true
  }
  return false
}

const I_SPEED_P90 = FEATURES.indexOf('move_speed_p90')
const I_IDLE = FEATURES.indexOf('idle_frac')
const I_CLICKS = FEATURES.indexOf('clicks')
const I_ACTIVE = FEATURES.indexOf('move_active')
const I_WIGGLE = FEATURES.indexOf('move_wiggle')

/**
 * Updates the baseline after a step. Called once per STEP_MS tick, in time order,
 * both live and offline, so both sides see identical baselines.
 */
export function updateBaseline(base: Baseline, features: Float64Array): void {
  const p90 = features[I_SPEED_P90]
  const idle = features[I_IDLE]
  const clicks = features[I_CLICKS]
  // Only windows where the person is mostly active. A window with no input at all still has an
  // idle_frac of 0.875 (the first second is not idle), so a higher cut never skipped anything
  // and idle stretches pulled every baseline toward zero.
  if (idle > 0.5) return
  const alpha = Math.max(1 / (base.n + 40), 1 / 720)
  if (p90 > 0) base.speed += alpha * (p90 - base.speed)
  base.clicks += alpha * (clicks / (WINDOW_MS / 1000) - base.clicks)
  base.active += alpha * (features[I_ACTIVE] - base.active)
  base.wiggle += alpha * (features[I_WIGGLE] - base.wiggle)
  base.n++
}
