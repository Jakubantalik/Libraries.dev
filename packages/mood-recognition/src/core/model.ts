// Copied from frustration-ui/src/model.ts by scripts/sync-core.mjs. Edit it there and copy again.

// Tiny evaluator for gradient-boosted trees exported by training/train.py.
// No dependencies. One model call is a few hundred comparisons.

export const CLASSES = ['none', 'blocked', 'lost', 'confused', 'waiting', 'frustrated'] as const
export type ClassName = (typeof CLASSES)[number]

/** One tree as flat arrays. Node i is a leaf when f[i] < 0; its value is v[i]. */
export type Tree = {
  /** Output class this tree adds to. */
  c: number
  /** Split feature index, -1 for leaves. */
  f: number[]
  /** Threshold: go left when x <= t. */
  t: number[]
  l: number[]
  r: number[]
  /** Leaf values (0 for split nodes). */
  v: number[]
  /** 1 when a missing (NaN) value goes left. */
  m: number[]
}

export type ModelJson = {
  format: 'fx-gbdt-1'
  name: string
  version: string
  /** What the model was trained on, e.g. "synthetic" or "lab, 24 people". */
  data: string
  features: string[]
  classes: string[]
  windowMs: number
  stepMs: number
  trees: Tree[]
}

export type Prediction = {
  probs: Float64Array
  /** 1 - P(none). */
  score: number
  /** Most likely frustration type, or null when 'none' wins. */
  type: Exclude<ClassName, 'none'> | null
}

function evalTree(tree: Tree, x: Float64Array): number {
  let i = 0
  const { f, t, l, r, v, m } = tree
  while (f[i] >= 0) {
    const val = x[f[i]]
    i = val <= t[i] || (val !== val && m[i] === 1) ? l[i] : r[i]
  }
  return v[i]
}

export function rawScores(model: ModelJson, x: Float64Array): Float64Array {
  const out = new Float64Array(model.classes.length)
  for (const tree of model.trees) out[tree.c] += evalTree(tree, x)
  return out
}

export function softmax(z: Float64Array): Float64Array {
  let max = -Infinity
  for (const v of z) if (v > max) max = v
  const out = new Float64Array(z.length)
  let sum = 0
  for (let i = 0; i < z.length; i++) {
    out[i] = Math.exp(z[i] - max)
    sum += out[i]
  }
  for (let i = 0; i < z.length; i++) out[i] /= sum
  return out
}

export function predict(model: ModelJson, x: Float64Array): Prediction {
  const probs = softmax(rawScores(model, x))
  let best = 1
  for (let i = 2; i < probs.length; i++) if (probs[i] > probs[best]) best = i
  const score = 1 - probs[0]
  const type = probs[0] >= probs[best] ? null : (model.classes[best] as Exclude<ClassName, 'none'>)
  return { probs, score, type }
}

/** Checks that a model matches the feature list this build computes. */
export function checkModel(model: ModelJson, features: readonly string[]): void {
  if (model.format !== 'fx-gbdt-1') throw new Error(`Unknown model format: ${model.format}`)
  if (model.features.length !== features.length || model.features.some((f, i) => f !== features[i])) {
    throw new Error('Model features do not match this build. Retrain or update the model.')
  }
  // Callers index probabilities by CLASSES, so a model with other classes would be misread.
  if (model.classes.length !== CLASSES.length || model.classes.some((c, i) => c !== CLASSES[i])) {
    throw new Error(`Model classes do not match this build (${model.classes.join(', ')}). Retrain or update the model.`)
  }
}
