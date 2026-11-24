// Copied from frustration-ui/src/fast.ts by scripts/sync-core.mjs. Edit it there and copy again.

// Fast signals: plain rules over the last second or so of input, for the obvious cases the model
// is slow to see. The model reads an 8 s window, so a burst of frustrated movement takes seconds
// to outweigh the calm movement before it; these rules see it within a few hundred ms.
//
// - shake: the pointer thrown back and forth at speed (quick swings that turn back)
// - orbit: the pointer circling one spot, like hesitating around a button
// - rage: three or more presses within 1 s on one element and spot, or on no control anywhere
// - disabled: presses on a disabled control
//
// They only look at recorder events, so they cost a fraction of a millisecond per call and need
// no model. Use the result next to the model's score, not instead of it: the rules know nothing
// about lost or waiting, and orbit is only a hint of confused.

import type { RawEvent } from './events'

export type FastKind = 'shake' | 'orbit' | 'rage' | 'disabled'

export type FastSignal = {
  /** 0..1, the strongest of the parts. */
  score: number
  /** Which part is strongest, or null when all are 0. */
  kind: FastKind | null
  parts: Record<FastKind, number>
}

const SHAKE_WINDOW_MS = 1000
/** A swing has to travel this far before its end counts as a turn, so tremor and jitter never do. */
const SWING_PX = 20
/** A swing slower than this is a stroke, not a shake: moving between two buttons with a stop. */
const SWING_MAX_MS = 450
/** A swing needs this many pointer samples: a real hand is sampled all along the way, while a
 * pointer that jumps (a teleport, a remote desktop, automation) is not shaking. */
const SWING_MIN_SAMPLES = 3
/** A gap this long between moves ends the movement: a stroke, a pause and a stroke back is not a shake. */
const MAX_GAP_MS = 150
/** Movement is rated over at least this long, so one flick is never a shake. */
const MIN_SPAN_S = 0.35
/** Circling is judged over the last 2 s of unbroken movement. */
const ORBIT_WINDOW_MS = 2000
/** A circle this small is tremor; one this wide is sweeping the page, not hovering one spot. */
const ORBIT_MIN_R = 6
const ORBIT_MAX_R = 90
/** Turns around the centre that start and complete a circling score. */
const ORBIT_TURNS_FROM = 0.8
const ORBIT_TURNS_FULL = 1.6
const RAGE_WINDOW_MS = 1000
const RAGE_RADIUS_PX = 40
const DISABLED_WINDOW_MS = 1500

const ramp = (v: number, from: number, to: number) => Math.min(1, Math.max(0, (v - from) / (to - from)))

/** First index with t >= value. Events must be sorted by t. */
function lowerBound(events: readonly RawEvent[], t: number): number {
  let lo = 0
  let hi = events.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (events[mid].t < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

type Pt = { x: number; y: number; t: number }

/** The window's moves up to now, cut at the last pause, so only unbroken movement counts. */
function recentMoves(events: readonly RawEvent[], now: number, windowMs: number): Pt[] {
  const pts: Pt[] = []
  for (let i = lowerBound(events, now - windowMs); i < events.length; i++) {
    const e = events[i]
    if (e.t > now) break
    if (e.k !== 'm') continue
    const last = pts[pts.length - 1]
    if (last && e.t - last.t > MAX_GAP_MS) pts.length = 0
    pts.push({ x: e.x, y: e.y, t: e.t })
  }
  return pts
}

/**
 * How many times the points wind around their centre, and their mean distance from it. Steps
 * that jump more than 90° (passing close to the centre, as a back-and-forth line does) are left
 * out, so only a steady sweep around the centre adds up; a shake along a line winds about 0.
 */
export function winding(pts: readonly { x: number; y: number }[]): { turns: number; radius: number } {
  if (pts.length < 3) return { turns: 0, radius: 0 }
  let cx = 0
  let cy = 0
  for (const p of pts) {
    cx += p.x
    cy += p.y
  }
  cx /= pts.length
  cy /= pts.length
  let radius = 0
  for (const p of pts) radius += Math.hypot(p.x - cx, p.y - cy)
  radius /= pts.length
  let sum = 0
  let prev: number | null = null
  for (const p of pts) {
    if (Math.hypot(p.x - cx, p.y - cy) < radius * 0.3) {
      prev = null
      continue
    }
    const a = Math.atan2(p.y - cy, p.x - cx)
    if (prev !== null) {
      let d = a - prev
      if (d > Math.PI) d -= 2 * Math.PI
      else if (d < -Math.PI) d += 2 * Math.PI
      if (Math.abs(d) <= Math.PI / 2) sum += d
    }
    prev = a
  }
  return { turns: Math.abs(sum) / (2 * Math.PI), radius }
}

/** Circling is looked for in the most recent part of the window too, so the stroke that brought
 * the pointer to the spot does not hide the circle until it drops out of the window. */
const ORBIT_SPANS_MS = [750, 1000, 1500, ORBIT_WINDOW_MS]

/**
 * The pointer circling one spot without going anywhere: about a turn or more around a centre
 * 6 to 90 px away, in the last 0.75 to 2 s of unbroken movement. People do this around a button
 * they are unsure about. 0..1.
 */
export function orbitScore(events: readonly RawEvent[], now: number): number {
  const pts = recentMoves(events, now, ORBIT_WINDOW_MS)
  let best = 0
  for (const span of ORBIT_SPANS_MS) {
    let i = 0
    while (i < pts.length && pts[i].t < now - span) i++
    const part = i === 0 ? pts : pts.slice(i)
    if (part.length < 8) continue
    const { turns, radius } = winding(part)
    if (radius < ORBIT_MIN_R || radius > ORBIT_MAX_R) continue
    best = Math.max(best, ramp(turns, ORBIT_TURNS_FROM, ORBIT_TURNS_FULL))
    if (best === 1) break
  }
  return best
}

/**
 * The pointer thrown back and forth: quick swings that turn back, counted on each axis. A real hand
 * slows down and rounds off at each end, so turns are found as swings (20 px one way, then 20 px
 * back), not as one sharp angle between two samples.
 *
 * baseSpeed is this person's usual fast speed (the detector's baseline p90, px/s): a restless hand
 * has to move a bit more before it counts. The adjustment stops early, because the baseline also
 * learns from frustrated stretches and a long shake must not teach the rule to ignore shaking.
 */
export function shakeScore(events: readonly RawEvent[], now: number, baseSpeed = 900): number {
  const speedFrom = Math.min(550, Math.max(300, 0.35 * baseSpeed))
  const pts = recentMoves(events, now, SHAKE_WINDOW_MS)
  if (pts.length < 4) return 0
  const span = Math.max(MIN_SPAN_S, (pts[pts.length - 1].t - pts[0].t) / 1000)

  let path = 0
  for (let i = 1; i < pts.length; i++) path += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)

  // Turns per axis: a zig-zag with a SWING_PX threshold. A turn counts when the swing before it was quick.
  const turns = (axis: 'x' | 'y') => {
    let n = 0
    let dir = 0
    let ext = pts[0][axis]
    let extT = pts[0].t
    let lastTurnT = pts[0].t
    let samples = 0
    for (const p of pts) {
      samples++
      const v = p[axis]
      if (dir >= 0 && v > ext) {
        ext = v
        extT = p.t
        if (dir === 0 && v - pts[0][axis] >= SWING_PX) dir = 1
      } else if (dir <= 0 && v < ext) {
        ext = v
        extT = p.t
        if (dir === 0 && pts[0][axis] - v >= SWING_PX) dir = -1
      }
      if ((dir === 1 && ext - v >= SWING_PX) || (dir === -1 && v - ext >= SWING_PX)) {
        if (extT - lastTurnT <= SWING_MAX_MS && samples >= SWING_MIN_SAMPLES) n++
        lastTurnT = extT
        samples = 0
        dir = -dir
        ext = v
        extT = p.t
      }
    }
    return n
  }
  const rate = Math.max(turns('x'), turns('y')) / span
  // Circling also turns back on each axis; a steady circle is orbit, not shake.
  const round = ramp(winding(pts).turns / span, 0.6, 1.2)
  return ramp(rate, 2.5, 6) * ramp(path / span, speedFrom, speedFrom + 450) * (1 - round)
}

/** Three or more presses within 1 s, either on the same element and spot as the latest one, or on
 * no control at all, anywhere. Pressing through neighbouring menu items is moving on, not rage.
 * Rapid presses on text select it, so selecting does not rule a press out; it only takes one more
 * press, so a triple-click that selects a paragraph is not rage. */
export function rageScore(events: readonly RawEvent[], now: number): number {
  let latest: { x: number; y: number; id: number } | null = null
  let spot = 0
  let dead = 0
  let selected = false
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.t > now) continue
    if (now - e.t > RAGE_WINDOW_MS) break
    if (e.k !== 'c') continue
    latest ??= { x: e.x, y: e.y, id: e.tg.id }
    if (e.sel) selected = true
    if (e.tg.id === latest.id && Math.hypot(e.x - latest.x, e.y - latest.y) <= RAGE_RADIUS_PX) spot++
    if (!e.tg.i) dead++
  }
  const need = selected ? 4 : 3
  const n = Math.max(spot, dead)
  return n >= need ? Math.min(1, 0.55 + (n - need) * 0.25) : 0
}

/** Presses on disabled controls in the last 1.5 s. */
export function disabledScore(events: readonly RawEvent[], now: number): number {
  let n = 0
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.t > now) continue
    if (now - e.t > DISABLED_WINDOW_MS) break
    if (e.k === 'c' && e.tg.d) n++
  }
  return n === 0 ? 0 : n === 1 ? 0.6 : 0.9
}

export function fastSignals(events: readonly RawEvent[], now: number, baseSpeed = 900): FastSignal {
  const parts: Record<FastKind, number> = {
    shake: shakeScore(events, now, baseSpeed),
    orbit: orbitScore(events, now),
    rage: rageScore(events, now),
    disabled: disabledScore(events, now),
  }
  let kind: FastKind | null = null
  let score = 0
  for (const k of ['shake', 'orbit', 'rage', 'disabled'] as const) {
    if (parts[k] > score) {
      score = parts[k]
      kind = k
    }
  }
  return { score, kind, parts }
}
