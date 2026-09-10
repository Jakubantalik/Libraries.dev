/**
 * Dev-only tuning panel for the cursor-as-occluder behaviour on proximity
 * reflections. Writes into the live `REFLECTION_OCCLUDER` singleton; the
 * engine repaints on the next pointer tick.
 */
import React, { useMemo, useState } from 'react';
import {
  REFLECTION_OCCLUDER,
  REFLECTION_OCCLUDER_DEFAULTS,
  resetReflectionOccluderConfig,
  setReflectionOccluderConfig,
  type ReflectionOccluderConfig,
} from '../../src';
import { CopyButton } from './CopyButton';

type NumKey = Exclude<keyof ReflectionOccluderConfig, 'enabled'>;
type Row = [NumKey, string, number, number, number, string];

const ROWS: Row[] = [
  ['radius', 'Radius', 2, 40, 0.5, 'px — how big the cursor is as a blocker'],
  ['strength', 'Depth', 0, 1, 0.01, 'shadow depth with cursor at the target edge'],
  ['falloff', 'Source falloff', 0, 1, 0.01, 'depth lost moving toward the light source'],
  ['penumbra', 'Penumbra', 0, 4, 0.05, 'band widening toward the source'],
  ['softness', 'Softness', 0, 1, 0.01, '1 = smooth, 0 = hard-edged band'],
  ['edgeFade', 'Edge fade', 0.1, 4, 0.1, 'fade-in at gap ends, × radius'],
  ['repaintMs', 'Repaint ms', 8, 100, 1, 'throttle while the pointer moves'],
];

const label = 'text-[11px] leading-[13px] text-(--text-muted)';

function serialize(cfg: ReflectionOccluderConfig): string {
  const lines: string[] = [];
  for (const k of Object.keys(REFLECTION_OCCLUDER_DEFAULTS) as Array<keyof ReflectionOccluderConfig>) {
    if (cfg[k] !== REFLECTION_OCCLUDER_DEFAULTS[k]) lines.push(`  ${k}: ${cfg[k]},`);
  }
  return lines.length
    ? `setReflectionOccluderConfig({\n${lines.join('\n')}\n});`
    : '// no changes from REFLECTION_OCCLUDER_DEFAULTS';
}

export function OccluderPanel({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<ReflectionOccluderConfig>(() => ({ ...REFLECTION_OCCLUDER }));
  const apply = (next: ReflectionOccluderConfig) => { setCfg(next); setReflectionOccluderConfig(next); };
  const set = (k: keyof ReflectionOccluderConfig, v: number | boolean) => apply({ ...cfg, [k]: v });
  const reset = () => { resetReflectionOccluderConfig(); setCfg({ ...REFLECTION_OCCLUDER_DEFAULTS }); };
  const snippet = useMemo(() => serialize(cfg), [cfg]);

  return (
    <aside
      className="fixed top-4 left-4 bottom-4 z-50 flex w-[300px] flex-col gap-4 overflow-y-auto rounded-[10px] bg-(--panel-bg) p-4 shadow-[0_8px_32px_rgba(0,0,0,0.5)] max-sm:right-4 max-sm:w-auto"
      aria-label="Occluder tuning (dev only)"
    >
      <header className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-(--title-color)">Cursor occluder</span>
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

      <p className={`${label} opacity-70`}>
        Move the cursor into the gap between the send button and the Auto chip. The shadow is cut where the cursor sits.
      </p>

      <section className="flex flex-col gap-3">
        {ROWS.map(([key, name, min, max, step, hint]) => {
          const v = cfg[key] ?? REFLECTION_OCCLUDER_DEFAULTS[key];
          const changed = v !== REFLECTION_OCCLUDER_DEFAULTS[key];
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

      <div className="relative flex items-start overflow-hidden rounded-[8px] bg-(--code-bg) py-1.5 pr-9 pl-2.5">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-[Roboto_Mono,monospace] text-[11px] leading-[16px] text-(--code-text)">{snippet}</code>
        <CopyButton getText={() => snippet} />
      </div>
    </aside>
  );
}
