// Run from the repository root: npx tsx --test packages/thinking-orbs/scripts/performance-regression.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { MODE_FRAMES, resolvePreset } from '../src/engine';

const states = ['working', 'searching', 'solving', 'listening', 'connecting', 'composing', 'breathing', 'weaving', 'shaping'] as const;

test('all 54 sampled frames remain byte-for-byte identical to the unmodified engine', () => {
  const frames = [];
  for (const state of states) for (const size of [20, 64] as const) for (const t of [0, 0.75, 2.25]) {
    const { mode, speed, opts } = resolvePreset(state, size);
    frames.push({ state, size, t, frame: MODE_FRAMES[mode](size, t * speed, opts) });
  }
  // Captured from the unchanged engine at b7f44b8, before the optimization.
  const hash = createHash('sha256').update(JSON.stringify(frames)).digest('hex');
  assert.equal(hash, 'a5bc7a4daea8924aa96ca44b74cc38285a8b839cc8d9e876a45dda6fc90756ca');
});

for (const [state, budget] of [['working', 1132], ['composing', 2198], ['breathing', 1945]] as const) {
  test(`${state}: repeated coordinates do not repeat trigonometric evaluations`, () => {
    const sin = Math.sin, cos = Math.cos;
    let calls = 0;
    Math.sin = (angle) => { calls++; return sin(angle); };
    Math.cos = (angle) => { calls++; return cos(angle); };
    try {
      const { mode, speed, opts } = resolvePreset(state, 64);
      MODE_FRAMES[mode](64, 0.5 * speed, opts);
      assert.ok(calls <= budget, `${calls} trigonometric calls exceeds ${budget}`);
    } finally {
      Math.sin = sin;
      Math.cos = cos;
    }
  });
}
