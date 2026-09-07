/**
 * Dev-only tuning panel for the glow overlay. Every slider writes straight
 * into the live `GLOW` singleton via `setGlowConfig`; runtime keys take effect
 * next frame, markup keys trigger an SVG rebuild inside MetalFx.
 *
 * The panel is fixed to the viewport's right edge so it stays usable while
 * scrolling between the hero examples and the playground.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { GLOW, GLOW_DEFAULTS, GLOW_MARKUP_KEYS, resetGlowConfig, setGlowConfig, type GlowConfig } from '../../src';
import { CopyButton } from './CopyButton';

type Row = [keyof GlowConfig, string, number, number, number];

const RUNTIME: Row[] = [
  ['haloOpMul', 'Halo opacity ×', 0, 2, 0.01],
  ['extraIntensity', 'Catch-light ×', 0, 8, 0.01],
  ['peakOp', 'Peak opacity', 0, 1, 0.01],
  ['baseOp', 'Base opacity', 0, 1, 0.01],
  ['inset', 'Halo inset', -5, 10, 0.1],
  ['extraOutward', 'Catch-light outward', -5, 10, 0.1],
  ['wanderRange', 'Wander range', 0, 60, 1],
  ['wanderLerp', 'Wander lerp', 0, 0.05, 0.0005],
  ['fadeRate', 'Fade rate', 0, 0.1, 0.0005],
  ['lumLo', 'Lum lo', 0, 1, 0.01],
  ['lumHi', 'Lum hi', 0, 1, 0.01],
  ['minDwellMs', 'Min dwell ms', 0, 10000, 100],
  ['relocFadeMs', 'Appear/disappear ms', 0, 2000, 10],
  ['pointGain', 'Text gain', 0, 6, 0.05],
];

const MARKUP: Row[] = [
  ['haloHalfLen', 'Halo half-length', 0, 30, 0.1],
  ['haloStrokeXl', 'Halo stroke XL', 0, 60, 0.1],
  ['haloStrokeLg', 'Halo stroke LG', 0, 40, 0.1],
  ['haloStrokeMd', 'Halo stroke MD', 0, 20, 0.1],
  ['haloStrokeSm', 'Halo stroke SM', 0, 10, 0.1],
  ['haloBlurXl', 'Halo blur XL', 0, 20, 0.1],
  ['haloBlurLg', 'Halo blur LG', 0, 12, 0.1],
  ['haloBlurMd', 'Halo blur MD', 0, 6, 0.1],
  ['haloBlurSm', 'Halo blur SM', 0, 3, 0.05],
  ['haloOpXl', 'Halo op XL', 0, 1, 0.01],
  ['haloOpLg', 'Halo op LG', 0, 1, 0.01],
  ['haloOpMd', 'Halo op MD', 0, 1, 0.01],
  ['haloOpSm', 'Halo op SM', 0, 1, 0.01],
  ['extraHalfLen', 'Catch half-length', 0, 15, 0.1],
  ['extraStrokeOuter', 'Catch stroke outer', 0, 6, 0.05],
  ['extraStrokeCore', 'Catch stroke core', 0, 4, 0.05],
  ['extraBlurOuter', 'Catch blur outer', 0, 4, 0.05],
  ['extraBlurCore', 'Catch blur core', 0, 3, 0.05],
  ['extraFadeR', 'Catch fade radius', 0, 20, 0.1],
  ['extraOpOuter', 'Catch op outer', 0, 1, 0.01],
];

const label = 'text-[11px] leading-[13px] text-(--text-muted)';

function Slider({ row, value, onChange }: { row: Row; value: number; onChange: (v: number) => void }) {
  const [key, name, min, max, step] = row;
  const changed = value !== GLOW_DEFAULTS[key];
  const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 4;
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className={`${label} flex justify-between gap-2`}>
        <span className={changed ? 'text-(--title-color)' : undefined}>{name}</span>
        <span className="font-[Roboto_Mono,monospace] tabular-nums opacity-80">{value.toFixed(dec)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#8ab4ff] cursor-grab active:cursor-grabbing"
      />
    </label>
  );
}

function serialize(cfg: GlowConfig): string {
  // Only the deltas — a full dump buries the two numbers that were touched.
  const lines: string[] = [];
  for (const k of Object.keys(GLOW_DEFAULTS) as Array<keyof GlowConfig>) {
    if (cfg[k] !== GLOW_DEFAULTS[k]) lines.push(`  ${k}: ${cfg[k]},`);
  }
  return lines.length ? `setGlowConfig({\n${lines.join('\n')}\n});` : '// no changes from GLOW_DEFAULTS';
}

export function GlowPanel({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<GlowConfig>(() => ({ ...GLOW }));

  // Push every change straight into the engine. Runtime keys land next
  // frame; markup keys make MetalFx rebuild its SVG via subscribeGlowConfig.
  useEffect(() => { setGlowConfig(cfg); }, [cfg]);

  const set = (k: keyof GlowConfig, v: number) => setCfg((c) => ({ ...c, [k]: v }));
  const reset = () => { resetGlowConfig(); setCfg({ ...GLOW_DEFAULTS }); };
  const snippet = useMemo(() => serialize(cfg), [cfg]);
  const touched = useMemo(
    () => (Object.keys(GLOW_DEFAULTS) as Array<keyof GlowConfig>).filter((k) => cfg[k] !== GLOW_DEFAULTS[k]).length,
    [cfg]
  );

  return (
    <aside
      className="fixed top-4 right-4 bottom-4 z-50 flex w-[300px] flex-col gap-4 overflow-y-auto rounded-[10px] bg-(--panel-bg) p-4 shadow-[0_8px_32px_rgba(0,0,0,0.5)] max-sm:left-4 max-sm:w-auto"
      aria-label="Glow tuning (dev only)"
    >
      <header className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-(--title-color)">Glow</span>
        <span className={label}>{touched ? `${touched} changed` : 'defaults'}</span>
        <div className="flex gap-1.5">
          <button type="button" onClick={reset} className="h-7 rounded-md bg-(--tab-bg) px-2 text-[11px] text-(--tab-color) hover:bg-(--tab-hover-bg)">Reset</button>
          <button type="button" onClick={onClose} className="h-7 rounded-md bg-(--tab-bg) px-2 text-[11px] text-(--tab-color) hover:bg-(--tab-hover-bg)" aria-label="Close">×</button>
        </div>
      </header>

      <section className="flex flex-col gap-2.5">
        <span className={`${label} uppercase tracking-wide opacity-60`}>Runtime · live</span>
        {RUNTIME.map((r) => <Slider key={r[0]} row={r} value={cfg[r[0]]} onChange={(v) => set(r[0], v)} />)}
      </section>

      <section className="flex flex-col gap-2.5">
        <span className={`${label} uppercase tracking-wide opacity-60`}>Markup · rebuilds SVG</span>
        {MARKUP.map((r) => <Slider key={r[0]} row={r} value={cfg[r[0]]} onChange={(v) => set(r[0], v)} />)}
      </section>

      <div className="relative flex items-start overflow-hidden rounded-[8px] bg-(--code-bg) py-1.5 pr-9 pl-2.5">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-[Roboto_Mono,monospace] text-[11px] leading-[16px] text-(--code-text)">{snippet}</code>
        <CopyButton getText={() => snippet} />
      </div>
      <p className={`${label} opacity-60`}>Deltas only. Keys in {GLOW_MARKUP_KEYS.size} markup fields rebuild the SVG; the rest are per-frame.</p>
    </aside>
  );
}
