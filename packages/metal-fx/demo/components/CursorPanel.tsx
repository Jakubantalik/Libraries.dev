/**
 * Dev-only tuning panel for the cursor light — the glint under the pointer
 * (spill) and the ring's catch-light facing the pointer (catch). Writes into
 * the live `CURSOR_LIGHT` singleton; the tracker reads it every frame.
 */
import React, { useMemo, useState } from 'react';
import {
  CURSOR_LIGHT,
  CURSOR_LIGHT_DEFAULTS,
  resetCursorLightConfig,
  setCursorLightConfig,
  type CursorLightConfig,
} from '../../src';
import { CopyButton } from './CopyButton';

type NumKey = Exclude<keyof CursorLightConfig, 'enabled' | 'spill' | 'catchLight' | 'cursor'>;
type Row = [NumKey, string, number, number, number, string];

const SHARED_ROWS: Row[] = [
  ['reach', 'Reach', 4, 120, 1, 'px from the ring edge (either side) where the pointer is felt'],
  ['fadeMs', 'Fade', 0, 800, 10, 'ms envelope on enter / leave'],
];

const CURSOR_ROWS: Row[] = [
  ['cursorDistance', 'Distance', 4, 200, 1, 'px from the ring edge the pointer is still lit (last third ramps out)'],
  ['cursorStrength', 'Specular', 0, 4, 0.05, 'mirrored ring intensity (>1 stacks passes)'],
  ['cursorDiffuse', 'Diffuse', 0, 2, 0.05, 'lit rim on the face toward the ring, in the ring’s colour'],
  ['cursorFalloff', 'Falloff', 2, 60, 1, 'px from the ring edge where light is half — inverse square'],
  ['cursorZoom', 'Zoom', 1, 5, 0.1, 'magnification of the mirrored ring'],
  ['cursorDepth', 'Depth', 0.1, 1, 0.01, 'compression of the mirrored ring — lower keeps it on the edge'],
  ['cursorEdge', 'Edge', -4, 6, 0.5, 'mirror plane offset from the silhouette edge, px'],
  ['cursorReach', 'Reach', 1, 30, 0.5, 'px the light spreads across the cursor from the facing edge — 20+ covers the whole arrow'],
  ['cursorBlur', 'Blur', 0, 4, 0.1, 'blur on the mirrored ring, px'],
];

const SPILL_ROWS: Row[] = [
  ['spillRadius', 'Radius', 8, 160, 1, 'px — size of the glint'],
  ['spillStrength', 'Strength', 0, 1, 0.01, 'peak opacity with the pointer on the ring'],
  ['spillOffset', 'Toward ring', 0, 1, 0.01, '0 = under the pointer, 1 = on the ring point'],
  ['spillLumGain', 'Brightness link', 0, 1, 0.01, 'how much the ring’s brightness there drives the glint'],
  ['spillSaturation', 'Saturation', 0, 2.5, 0.05, 'tint saturation multiplier'],
  ['spillInside', 'Inside', 0, 1, 0.01, 'strength multiplier with the pointer over the button'],
  ['spillBlur', 'Blur', 0, 24, 0.5, 'extra blur px (0 = gradient only, cheapest)'],
];

const CATCH_ROWS: Row[] = [
  ['catchFollow', 'Follow', 0.02, 1, 0.01, 'hotspot tracking — lower = lags the pointer more'],
  ['catchGain', 'Gain', 0, 2, 0.01, 'opacity multiplier on the cursor-driven catch-light'],
];

const label = 'text-[11px] leading-[13px] text-(--text-muted)';

function serialize(cfg: CursorLightConfig): string {
  const lines: string[] = [];
  for (const k of Object.keys(CURSOR_LIGHT_DEFAULTS) as Array<keyof CursorLightConfig>) {
    if (cfg[k] !== CURSOR_LIGHT_DEFAULTS[k]) lines.push(`  ${k}: ${cfg[k]},`);
  }
  return lines.length ? `setCursorLightConfig({\n${lines.join('\n')}\n});` : '// no changes from CURSOR_LIGHT_DEFAULTS';
}

export function CursorPanel({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<CursorLightConfig>(() => ({ ...CURSOR_LIGHT }));
  const apply = (next: CursorLightConfig) => { setCfg(next); setCursorLightConfig(next); };
  const set = (k: keyof CursorLightConfig, v: number | boolean) => apply({ ...cfg, [k]: v });
  const reset = () => { resetCursorLightConfig(); setCfg({ ...CURSOR_LIGHT_DEFAULTS }); };
  const snippet = useMemo(() => serialize(cfg), [cfg]);

  const toggle = (k: 'enabled' | 'spill' | 'catchLight' | 'cursor', text: string) => (
    <button
      type="button"
      onClick={() => set(k, !cfg[k])}
      aria-pressed={cfg[k]}
      className={`h-7 rounded-md px-2 text-[11px] ${cfg[k] ? 'bg-(--tab-active-bg) text-(--tab-active-color)' : 'bg-(--tab-bg) text-(--tab-color)'}`}
    >
      {text}
    </button>
  );

  const rows = (list: Row[]) => list.map(([key, name, min, max, step, hint]) => {
    const v = cfg[key] ?? CURSOR_LIGHT_DEFAULTS[key];
    const changed = v !== CURSOR_LIGHT_DEFAULTS[key];
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
  });

  return (
    <aside
      className="fixed top-4 left-4 bottom-4 z-50 flex w-[300px] flex-col gap-4 overflow-y-auto rounded-[10px] bg-(--panel-bg) p-4 shadow-[0_8px_32px_rgba(0,0,0,0.5)] max-sm:right-4 max-sm:w-auto"
      aria-label="Cursor light tuning (dev only)"
    >
      <header className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-(--title-color)">Cursor light</span>
        <div className="flex gap-1.5">
          {toggle('enabled', cfg.enabled ? 'On' : 'Off')}
          <button type="button" onClick={reset} className="h-7 rounded-md bg-(--tab-bg) px-2 text-[11px] text-(--tab-color) hover:bg-(--tab-hover-bg)">Reset</button>
          <button type="button" onClick={onClose} className="h-7 rounded-md bg-(--tab-bg) px-2 text-[11px] text-(--tab-color) hover:bg-(--tab-hover-bg)" aria-label="Close">×</button>
        </div>
      </header>

      <p className={`${label} opacity-70`}>
        Bring the pointer near any ring. Cursor = the real macOS pointer, re-drawn and lit by the ring (plain-arrow areas only). Spill = tinted glint under the pointer. Catch = the ring’s catch-light faces the pointer.
      </p>

      <section className="flex flex-col gap-3">{rows(SHARED_ROWS)}</section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-(--title-color)">Cursor reflection</span>
          {toggle('cursor', cfg.cursor ? 'On' : 'Off')}
        </div>
        {rows(CURSOR_ROWS)}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-(--title-color)">Spill</span>
          {toggle('spill', cfg.spill ? 'On' : 'Off')}
        </div>
        {rows(SPILL_ROWS)}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-(--title-color)">Catch-light</span>
          {toggle('catchLight', cfg.catchLight ? 'On' : 'Off')}
        </div>
        {rows(CATCH_ROWS)}
      </section>

      <div className="relative flex items-start overflow-hidden rounded-[8px] bg-(--code-bg) py-1.5 pr-9 pl-2.5">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-[Roboto_Mono,monospace] text-[11px] leading-[16px] text-(--code-text)">{snippet}</code>
        <CopyButton getText={() => snippet} />
      </div>
    </aside>
  );
}
