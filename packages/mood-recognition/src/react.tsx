// Mood recognition for React: a provider that reads how someone uses the part of the app inside it,
// and a hook that hands its components the reading.

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createMoodReader, type MoodReading, type Mood } from './engine'

type Store = {
  get(): MoodReading
  set(next: MoodReading): void
  subscribe(fn: () => void): () => void
}

const IDLE: MoodReading = { mood: null, reaction: 0, score: 0, probabilities: null, fast: 0, fastKind: null, isModelLoaded: false }

const round = (v: number) => Math.round(v * 100) / 100

/** Holds the latest reading and wakes its readers only when what they see changes. */
function createStore(): Store {
  let value = IDLE
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next) {
      const probabilities = next.probabilities
        ? (Object.fromEntries(Object.entries(next.probabilities).map(([k, v]) => [k, round(v)])) as MoodReading['probabilities'])
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

const MoodContext = createContext<Store | null>(null)

export type MoodProviderProps = {
  /** The model, MoodRecognition.json, imported into your bundle. Without it, only the fast signals and away work. */
  model?: unknown
  children?: ReactNode
  /** localStorage key for the person's own pace; null keeps it in memory only. Default "mood-baseline". */
  baselineKey?: string | null
  /** The moods the reaction rises for. Default: frustrated, confused and lost. */
  reactTo?: readonly Mood[]
}

/**
 * Reads how someone uses the page: the pointer, presses, scrolling and typing, never text or
 * field values. It reads the whole page, as the model was trained, wherever the provider sits;
 * mark parts it should skip with data-mood-ignore. It renders no box of its own
 * (display: contents) and sets --mood, the reaction from 0 to 1, for the CSS inside it.
 */
export function MoodProvider({ model, children, baselineKey, reactTo }: MoodProviderProps) {
  const scope = useRef<HTMLDivElement>(null)
  const [store] = useState(createStore)
  const reacts = reactTo?.join(',')

  useEffect(() => {
    const el = scope.current
    if (!el) return
    const reader = createMoodReader({
      model,
      baselineKey,
      reactTo: reacts ? (reacts.split(',') as Mood[]) : undefined,
      onReading(r) {
        store.set(r)
        el.style.setProperty('--mood', r.reaction.toFixed(3))
      },
    })
    reader.start()
    return () => {
      reader.stop()
      el.style.removeProperty('--mood')
      store.set(IDLE)
    }
  }, [model, baselineKey, reacts, store])

  return (
    <MoodContext.Provider value={store}>
      <div ref={scope} data-mood-root="" style={{ display: 'contents' }}>
        {children}
      </div>
    </MoodContext.Provider>
  )
}

/** The latest reading from the nearest MoodProvider. */
export function useMood(): MoodReading {
  const store = useContext(MoodContext)
  if (!store) throw new Error('useMood needs an <MoodProvider> above it.')
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
