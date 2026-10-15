/**
 * Dev-only tuning panel for the cursor bend effect. Writes into the live
 * `BEND` singleton; `useBend` reads it every frame, so there is nothing to
 * subscribe to — the next animation frame just uses the new numbers.
 */
import React, { useMemo, useState } from 'react';
import { CopyButton } from './CopyButton';
import { BEND, BEND_DEFAULTS, resetBendConfig, setBendConfig, type BendConfig } from '../lib/bend';

type NumKey = Exclude<keyof BendConfig, 'enabled' | 'applyTo'>;
type Row = [NumKey, string, number, number, number, string];

const ROWS: Row[] = [
  ['strength', 'Strength', 0, 3, 0.01, 'global multiplier on the whole dent'],
  ['fadeInMs', 'Fade in', 0, 1000, 10, 'ms for the dent to ease in on hover'],
  ['fadeOutMs', 'Fade out', 0, 1500, 10, 'ms to ease out after the cursor leaves'],
  ['smoothMs', 'Target smoothing', 0, 500, 5, 'low-pass on the dent target — kills snapping on fast sweeps'],
  ['reach', 'Reach', 0, 120, 1, 'px beyond the edge the cursor is felt'],
  ['blob', 'Bend area', 2, 40, 0.5, 'σ of the directional dent, px'],
  ['maxDisp', 'Max dent', 0, 30, 0.5, 'px displacement cap'],
  ['gain', 'Speed kick', 0, 5, 0.05, 'transient dent px per 100 px/s cursor speed'],
  ['pressGain', 'Press-in', 0, 2, 0.01, 'dent px per px the cursor is inside the edge — holds'],
  ['pullGain', 'Pull-out', 0, 2, 0.01, 'bulge px per px the cursor is outside the edge — sticky'],
  ['press', 'Press dent', 0, 20, 0.5, 'extra inward dent while held'],
  ['liquid', 'Liquid push', 0, 30, 0.5, 'radial stretch under the cursor — thins the stroke'],
  ['liquidBlob', 'Liquid area', 2, 40, 0.5, 'σ of the liquid push, px'],
  ['liquidReach', 'Liquid reach', 1, 40, 0.5, 'px from the ring the push is felt — big = whole ring scales'],
  ['liquidStiffness', 'Liquid speed', 5, 400, 1, 'spring k for the push — lower = slower swell'],
  ['liquidDamping', 'Liquid damping', 0, 40, 0.5, 'below 2·√k it wobbles on release'],
  ['stiffness', 'Stiffness', 10, 800, 1, 'spring k — snap-back speed'],
  ['damping', 'Damping', 0, 60, 0.1, 'below 2·√(k·m) it wobbles'],
  ['mass', 'Mass', 0.1, 5, 0.05, 'heavier = slower, more overshoot'],
  ['follow', 'Follow', 0.02, 1, 0.01, 'blob lag behind cursor — lower = stickier'],
  ['mapRes', 'Map res', 0.5, 3, 0.5, '"Ring + content" only — texels per CSS px'],
  ['smooth', 'Smooth', 0, 1, 0.05, '"Ring + content" only — post-blur px'],
];

const label = 'text-[11px] leading-[13px] text-(--text-muted)';

function serialize(cfg: BendConfig): string {
  const lines: string[] = [];
  for (const k of Object.keys(BEND_DEFAULTS) as Array<keyof BendConfig>) {
    if (cfg[k] !== BEND_DEFAULTS[k]) lines.push(`  ${k}: ${cfg[k]},`);
  }
  return lines.length ? `setBendConfig({\n${lines.join('\n')}\n});` : '// no changes from BEND_DEFAULTS';
}

export function BendPanel({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<BendConfig>(() => ({ ...BEND }));
  const apply = (next: BendConfig) => { setCfg(next); setBendConfig(next); };
  const set = (k: keyof BendConfig, v: number | boolean | BendConfig['applyTo']) => apply({ ...cfg, [k]: v });
  const reset = () => { resetBendConfig(); setCfg({ ...BEND_DEFAULTS }); };
  const snippet = useMemo(() => serialize(cfg), [cfg]);
  const critical = 2 * Math.sqrt(cfg.stiffness * cfg.mass);

  return (
    <aside
      className="fixed top-4 left-4 bottom-4 z-50 flex w-[300px] flex-col gap-4 overflow-y-auto rounded-[10px] bg-(--panel-bg) p-4 shadow-[0_8px_32px_rgba(0,0,0,0.5)] max-sm:right-4 max-sm:w-auto"
      aria-label="Bend tuning (dev only)"
    >
      <header className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-(--title-color)">Bend</span>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => set('enabled', !cfg.enabled)}
            aria-pressed={cfg.enabled}
            className={`h-7 rounded-md px-2 text-[11px] ${cfg.enabled ? 'bg-(--tab-active-bg) text-(--tab-active-color)' : 'bg-(--tab-bg) text-(--tab-color)'}`}
          >
            {cfg.enabled ? 'On' : 'Off'}
          </button>
          <button type="button" onClick={reset} className="h-7 rounded-md bg-(--tab-bg) px-2 text-[11px] text-(--tab-color) hover:bg-(--tab-hover-bg)">Reset</button>
          <button type="button" onClick={onClose} className="h-7 rounded-md bg-(--tab-bg) px-2 text-[11px] text-(--tab-color) hover:bg-(--tab-hover-bg)" aria-label="Close">×</button>
        </div>
      </header>

      <div className="flex flex-col gap-1.5">
        <span className={label}>Deforms</span>
        <div className="flex gap-1.5">
          {(['ring', 'all'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => set('applyTo', m)}
              aria-pressed={cfg.applyTo === m}
              className={`h-7 rounded-md px-2.5 text-[11px] ${cfg.applyTo === m ? 'bg-(--tab-active-bg) text-(--tab-active-color)' : 'bg-(--tab-bg) text-(--tab-color)'}`}
            >
              {m === 'ring' ? 'Ring only (vector)' : 'Ring + content (filter)'}
            </button>
          ))}
        </div>
      </div>

      <section className="flex flex-col gap-3">
        {ROWS.map(([key, name, min, max, step, hint]) => {
          const v = cfg[key] ?? BEND_DEFAULTS[key];
          const changed = v !== BEND_DEFAULTS[key];
          const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
          return (
            <label key={key} className="flex flex-col gap-1 min-w-0">
              <span className={`${label} flex justify-between gap-2`}>
                <span className={changed ? 'text-(--title-color)' : undefined}>{name}</span>
                <span className="font-[Roboto_Mono,monospace] tabular-nums opacity-80">{v.toFixed(dec)}</span>
              </span>
              <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => set(key, Number(e.target.value))} className="w-full accent-[#8ab4ff] cursor-grab active:cursor-grabbing" />
              <span className={`${label} opacity-60`}>{hint}</span>
            </label>
          );
        })}
      </section>

      <p className={label}>
        Critical damping ≈ <span className="font-[Roboto_Mono,monospace]">{critical.toFixed(1)}</span>.
        Current {cfg.damping < critical ? 'underdamped — wobbles' : 'overdamped — no overshoot'}.
      </p>

      <div className="relative flex items-start overflow-hidden rounded-[8px] bg-(--code-bg) py-1.5 pr-9 pl-2.5">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-[Roboto_Mono,monospace] text-[11px] leading-[16px] text-(--code-text)">{snippet}</code>
        <CopyButton getText={() => snippet} />
      </div>
    </aside>
  );
}
