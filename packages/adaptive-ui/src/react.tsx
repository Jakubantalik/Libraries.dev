// Adaptive UI for React: a provider that reads how someone uses the part of the app inside it,
// and a hook that hands its components the reading.

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createAdaptive, type AdaptiveReading, type Mood } from './engine'

type Store = {
  get(): AdaptiveReading
  set(next: AdaptiveReading): void
  subscribe(fn: () => void): () => void
}

const IDLE: AdaptiveReading = { mood: null, reaction: 0, score: 0, probabilities: null, fast: 0, fastKind: null, isModelLoaded: false }

const round = (v: number) => Math.round(v * 100) / 100

/** Holds the latest reading and wakes its readers only when what they see changes. */
function createStore(): Store {
  let value = IDLE
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next) {
      const probabilities = next.probabilities
        ? (Object.fromEntries(Object.entries(next.probabilities).map(([k, v]) => [k, round(v)])) as AdaptiveReading['probabilities'])
        : null
      const r = { ...next, probabilities, reaction: round(next.reaction), score: round(next.score), fast: round(next.fast) }
      if (
        JSON.stringify(r.probabilities) === JSON.stringify(value.probabilities) &&
        r.mood === value.mood &&
        r.reaction === value.reaction &&
        r.score === value.score &&
        r.fast === value.fast &&
        r.fastKind === value.fastKind &&
        r.isModelLoaded === value.isModelLoaded
      ) {
        return
      }
      value = r
      listeners.forEach((fn) => fn())
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

const AdaptiveContext = createContext<Store | null>(null)

export type AdaptiveProviderProps = {
  /** The model, AdaptiveUI.json, imported into your bundle. Without it, only the fast signals and away work. */
  model?: unknown
  children?: ReactNode
  /** localStorage key for the person's own pace; null keeps it in memory only. Default "adaptive-baseline". */
  baselineKey?: string | null
  /** The moods the reaction rises for. Default: frustrated, confused and lost. */
  reactTo?: readonly Mood[]
}

/**
 * Reads how someone uses the page: the pointer, presses, scrolling and typing, never text or
 * field values. It reads the whole page, as the model was trained, wherever the provider sits;
 * mark parts it should skip with data-adaptive-ignore. It renders no box of its own
 * (display: contents) and sets --adaptive, the reaction from 0 to 1, for the CSS inside it.
 */
export function AdaptiveProvider({ model, children, baselineKey, reactTo }: AdaptiveProviderProps) {
  const scope = useRef<HTMLDivElement>(null)
  const [store] = useState(createStore)
  const reacts = reactTo?.join(',')

  useEffect(() => {
    const el = scope.current
    if (!el) return
    const adaptive = createAdaptive({
      model,
      baselineKey,
      reactTo: reacts ? (reacts.split(',') as Mood[]) : undefined,
      onReading(r) {
        store.set(r)
        el.style.setProperty('--adaptive', r.reaction.toFixed(3))
      },
    })
    adaptive.start()
    return () => {
      adaptive.stop()
      el.style.removeProperty('--adaptive')
      store.set(IDLE)
    }
  }, [model, baselineKey, reacts, store])

  return (
    <AdaptiveContext.Provider value={store}>
      <div ref={scope} data-adaptive-root="" style={{ display: 'contents' }}>
        {children}
      </div>
    </AdaptiveContext.Provider>
  )
}

/** The latest reading from the nearest AdaptiveProvider. */
export function useAdaptive(): AdaptiveReading {
  const store = useContext(AdaptiveContext)
  if (!store) throw new Error('useAdaptive needs an <AdaptiveProvider> above it.')
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
