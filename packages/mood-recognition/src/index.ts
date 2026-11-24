// Mood recognition React kit (beta) — https://libraries.dev/mood-recognition
//
// The kit's code is MIT (LICENSE). The model, MoodRecognition.json, is a separate download under the
// Libraries.dev Model License: free for development and non-commercial apps; a commercial release
// needs Libraries.dev Pro or Business. Ship it inside your app's bundle only.

export { MoodProvider, useMood, type MoodProviderProps } from './react'
export { createMoodReader, REACT_FROM, REACT_FULL, READING_MS, type MoodReader, type MoodOptions, type MoodReading, type Mood, type FastKind } from './engine'
export type { ClassName, ModelJson } from './core/model'
