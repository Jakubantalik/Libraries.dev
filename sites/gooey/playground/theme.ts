/** Theme plumbing shared by the marketing demo page and the lab grid. */

export type Theme = 'light' | 'dark'

/** Wider-gamut colours when the browser has them, matching how the Logram
 *  design ships a `color(display-p3 ...)` variant beside every rgba one.
 *  The library parses the shadow string into filter primitives, so the swap
 *  has to happen here rather than in a stylesheet @supports block. */
const P3 =
  typeof CSS !== 'undefined' && CSS.supports?.('color', 'color(display-p3 0 0 0 / 0.2)')
const p3 = (tpl: string) =>
  tpl
    .replace(/\{w4\}/g, P3 ? 'color(display-p3 1 1 1 / 0.04)' : 'rgba(255, 255, 255, 0.04)')
    .replace(/\{w3\}/g, P3 ? 'color(display-p3 1 1 1 / 0.03)' : 'rgba(255, 255, 255, 0.03)')
    .replace(/\{k6\}/g, P3 ? 'color(display-p3 0 0 0 / 0.06)' : 'rgba(0, 0, 0, 0.06)')
    .replace(/\{k5\}/g, P3 ? 'color(display-p3 0 0 0 / 0.05)' : 'rgba(0, 0, 0, 0.05)')
    .replace(/\{k24\}/g, P3 ? 'color(display-p3 0 0 0 / 0.24)' : 'rgba(0, 0, 0, 0.24)')

/** Light keeps the prototype's Figma elevation. Dark is the Logram dropdown
 *  spec (Figma 2572:83262), verbatim and in the design's layer order: two
 *  light inset layers (inner hairline + top highlight), then the black outer
 *  chain — rendered on the merged liquid silhouette by the engine's inset
 *  support. */
export const SHADOWS: Record<Theme, Record<string, string>> = {
  light: {
    'Figma soft': '0 0 0 1px rgba(0, 0, 0, 0.06) inset',
    Floating: '',
    None: '',
  },
  dark: {
    'Figma soft': p3(
      '0 0 0 1px {w4} inset, 0 1px 0 0 {w3} inset',
    ),
    Floating: '',
    None: '',
  },
}

/** OS colour preference; 'dark' when matchMedia is unavailable — matching
 *  the synchronous pre-React stamp in index.html. */
export function getSystemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}
