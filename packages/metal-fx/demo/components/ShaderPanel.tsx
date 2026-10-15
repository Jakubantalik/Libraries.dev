/**
 * Dev-only tuning panel for the shader's tint. Paper's liquidMetal has a
 * fixed silver material; all colour comes from `colorTint` (colour-burn,
 * alpha = amount) plus the R/B channel dispersion. The renderer is shared, so
 * this edits the one preset every instance on the page is drawing with.
 */
import React, { useMemo, useState } from 'react';
import { getSharedPreset, setSharedPresetMode, type PresetMode } from '../../src';
import { BADGE, BADGE_DEFAULTS, setBadgeConfig } from '../lib/badge';
import { CopyButton } from './CopyButton';

const label = 'text-[11px] leading-[13px] text-(--text-muted)';

type NumKey = 'shiftRed' | 'shiftBlue' | 'repetition' | 'softness' | 'scale';
const ROWS: Array<[NumKey, string, number, number, number, string]> = [
  ['shiftRed', 'Shift red', -1, 1, 0.01, 'R-channel dispersion — colour fringing'],
  ['shiftBlue', 'Shift blue', -1, 1, 0.01, 'B-channel dispersion — the blue fringe'],
  ['repetition', 'Repetition', 1, 10, 0.1, 'stripe density'],
  ['softness', 'Softness', 0, 1, 0.01, 'stripe edge blur'],
  ['scale', 'Scale', 0.1, 4, 0.01, 'overall zoom of the pattern (Paper u_scale)'],
];

function splitHex(v: string): { rgb: string; a: number } {
  const rgb = v.slice(0, 7);
  const a = v.length >= 9 ? parseInt(v.slice(7, 9), 16) / 255 : 1;
  return { rgb, a };
}
function joinHex(rgb: string, a: number): string {
  return rgb + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
}

export function ShaderPanel({ onClose }: { onClose: () => void }) {
  // Snapshot of whatever the page was drawing with when the panel opened —
  // Reset returns here, not to a named preset, since instances may disagree.
  const [base] = useState<PresetMode | null>(() => getSharedPreset());
  const [cfg, setCfg] = useState<PresetMode | null>(() => getSharedPreset());
  const [badgeScale, setBadgeScale] = useState(BADGE.shaderScale);
  const applyBadgeScale = (v: number) => { setBadgeScale(v); setBadgeConfig({ shaderScale: v }); };
  const [badgeOpacity, setBadgeOpacity] = useState(BADGE.opacity);
  const applyBadgeOpacity = (v: number) => { setBadgeOpacity(v); setBadgeConfig({ opacity: v }); };
  const [textGlow, setTextGlow] = useState(BADGE.textGlow);
  const applyTextGlow = (v: number) => { setTextGlow(v); setBadgeConfig({ textGlow: v }); };
  const [newOpacity, setNewOpacity] = useState(BADGE.newOpacity);
  const applyNewOpacity = (v: number) => { setNewOpacity(v); setBadgeConfig({ newOpacity: v }); };
  const [newScale, setNewScale] = useState(BADGE.newShaderScale);
  const applyNewScale = (v: number) => { setNewScale(v); setBadgeConfig({ newShaderScale: v }); };
  const [core, setCore] = useState({ r: BADGE.newCore, blur: BADGE.newCoreBlur, a: BADGE.newCoreStrength, size: BADGE.newCoreSize });
  const applyCore = (k: 'r' | 'blur' | 'a' | 'size', v: number) => {
    const next = { ...core, [k]: v };
    setCore(next);
    setBadgeConfig({ newCore: next.r, newCoreBlur: next.blur, newCoreStrength: next.a, newCoreSize: next.size });
  };
  const [layers, setLayers] = useState({ gradient: BADGE.newGradient, glow: BADGE.newGlow });
  const applyLayer = (k: 'gradient' | 'glow', v: number) => {
    const next = { ...layers, [k]: v };
    setLayers(next);
    setBadgeConfig({ newGradient: next.gradient, newGlow: next.glow });
  };
  const layerRows: Array<['gradient' | 'glow', string, number, string]> = [
    ['gradient', 'Top gradient', BADGE_DEFAULTS.newGradient, 'white top→bottom wash over the metal — Figma 0.6'],
    ['glow', 'Inner glow', BADGE_DEFAULTS.newGlow, 'the two 8.33px inset white glows — biggest metal killer'],
  ];
  const coreRows: Array<['r' | 'blur' | 'a' | 'size', string, number, number, number, number, string]> = [
    ['size', 'Core size', 5, 100, 1, BADGE_DEFAULTS.newCoreSize, 'ellipse radius, % of the badge — 100 = edge to edge'],
    ['r', 'White core', 0, 100, 1, BADGE_DEFAULTS.newCore, '% of the ellipse that is solid white'],
    ['blur', 'Core blur', 0, 100, 1, BADGE_DEFAULTS.newCoreBlur, 'ramp from white to clear, % of the ellipse (clamped to its edge)'],
    ['a', 'Core strength', 0, 1, 0.01, BADGE_DEFAULTS.newCoreStrength, 'opacity of the white core'],
  ];
  if (!base || !cfg) {
    return (
      <aside className="fixed top-4 left-4 z-50 rounded-[10px] bg-(--panel-bg) p-4 text-[12px] text-(--text-muted)">
        No renderer yet — mount a MetalFx first.
        <button type="button" onClick={onClose} className="ml-3 rounded-md bg-(--tab-bg) px-2 py-1 text-[11px] text-(--tab-color)">×</button>
      </aside>
    );
  }
  const apply = (next: PresetMode) => { setCfg(next); setSharedPresetMode(next); };
  const set = <K extends keyof PresetMode>(k: K, v: PresetMode[K]) => apply({ ...cfg, [k]: v });
  const reset = () => apply({ ...base });
  const tint = splitHex(cfg.colorTint);

  const snippet = useMemo(() => {
    const lines: string[] = [];
    for (const k of Object.keys(base) as Array<keyof PresetMode>) {
      if (cfg[k] !== base[k]) lines.push(`  ${k}: ${typeof cfg[k] === 'string' ? `'${cfg[k]}'` : cfg[k]},`);
    }
    return lines.length ? `// preset mode overrides\n{\n${lines.join('\n')}\n}` : '// no changes';
  }, [cfg, base]);

  return (
    <aside
      className="fixed top-4 left-4 bottom-4 z-50 flex w-[300px] flex-col gap-4 overflow-y-auto rounded-[10px] bg-(--panel-bg) p-4 shadow-[0_8px_32px_rgba(0,0,0,0.5)] max-sm:right-4 max-sm:w-auto"
      aria-label="Shader tint tuning (dev only)"
    >
      <header className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-(--title-color)">Shader tint</span>
        <div className="flex gap-1.5">
          <button type="button" onClick={reset} className="h-7 rounded-md bg-(--tab-bg) px-2 text-[11px] text-(--tab-color) hover:bg-(--tab-hover-bg)">Reset</button>
          <button type="button" onClick={onClose} className="h-7 rounded-md bg-(--tab-bg) px-2 text-[11px] text-(--tab-color) hover:bg-(--tab-hover-bg)" aria-label="Close">×</button>
        </div>
      </header>

      <p className={`${label} opacity-70`}>
        Global — one shared renderer draws every ring on the page. Tint is a colour-burn over the fixed silver; intensity is its alpha.
      </p>

      <div className="flex flex-col gap-1.5">
        <span className={`${label} flex justify-between`}>
          <span>Tint colour</span>
          <span className="font-[Roboto_Mono,monospace] opacity-80">{cfg.colorTint}</span>
        </span>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={tint.rgb}
            onChange={(e) => set('colorTint', joinHex(e.target.value, tint.a))}
            className="size-8 shrink-0 cursor-pointer rounded-lg border border-(--pill-border) bg-transparent p-0"
            aria-label="Tint colour"
          />
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={`${label} flex justify-between`}>
              <span>Tint intensity</span>
              <span className="font-[Roboto_Mono,monospace] tabular-nums opacity-80">{tint.a.toFixed(2)}</span>
            </span>
            <input
              type="range" min={0} max={1} step={0.01} value={tint.a}
              onChange={(e) => set('colorTint', joinHex(tint.rgb, Number(e.target.value)))}
              className="w-full accent-[#8ab4ff] cursor-grab active:cursor-grabbing"
              aria-label="Tint intensity"
            />
          </label>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        {ROWS.map(([key, name, min, max, step, hint]) => {
          const v = cfg[key];
          const changed = v !== base[key];
          return (
            <label key={key} className="flex flex-col gap-1 min-w-0">
              <span className={`${label} flex justify-between gap-2`}>
                <span className={changed ? 'text-(--title-color)' : undefined}>{name}</span>
                <span className="font-[Roboto_Mono,monospace] tabular-nums opacity-80">{v.toFixed(2)}</span>
              </span>
              <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => set(key, Number(e.target.value))} className="w-full accent-[#8ab4ff] cursor-grab active:cursor-grabbing" />
              <span className={`${label} opacity-60`}>{hint}</span>
            </label>
          );
        })}
      </section>

      <section className="flex flex-col gap-2">
        <span className={`${label} uppercase tracking-wide opacity-60`}>Pro badge · per-instance</span>
        <label className="flex flex-col gap-1 min-w-0">
          <span className={`${label} flex justify-between gap-2`}>
            <span className={badgeScale !== BADGE_DEFAULTS.shaderScale ? 'text-(--title-color)' : undefined}>Badge shader scale</span>
            <span className="font-[Roboto_Mono,monospace] tabular-nums opacity-80">{badgeScale.toFixed(2)}</span>
          </span>
          <input type="range" min={0.2} max={6} step={0.05} value={badgeScale} onChange={(e) => applyBadgeScale(Number(e.target.value))} className="w-full accent-[#8ab4ff] cursor-grab active:cursor-grabbing" />
          <span className={`${label} opacity-60`}>zoom of the metal inside the glyphs — MetalFx `shaderScale`, this instance only</span>
        </label>
        <label className="flex flex-col gap-1 min-w-0">
          <span className={`${label} flex justify-between gap-2`}>
            <span className={badgeOpacity !== BADGE_DEFAULTS.opacity ? 'text-(--title-color)' : undefined}>Badge shader opacity</span>
            <span className="font-[Roboto_Mono,monospace] tabular-nums opacity-80">{badgeOpacity.toFixed(2)}</span>
          </span>
          <input type="range" min={0} max={1} step={0.01} value={badgeOpacity} onChange={(e) => applyBadgeOpacity(Number(e.target.value))} className="w-full accent-[#8ab4ff] cursor-grab active:cursor-grabbing" />
          <span className={`${label} opacity-60`}>MetalFx `strength` on the badge — how much metal shows through the glyphs</span>
        </label>
        <label className="flex flex-col gap-1 min-w-0">
          <span className={`${label} flex justify-between gap-2`}>
            <span className={textGlow !== BADGE_DEFAULTS.textGlow ? 'text-(--title-color)' : undefined}>Pro text glow</span>
            <span className="font-[Roboto_Mono,monospace] tabular-nums opacity-80">{textGlow.toFixed(2)}</span>
          </span>
          <input type="range" min={0} max={6} step={0.05} value={textGlow} onChange={(e) => applyTextGlow(Number(e.target.value))} className="w-full accent-[#8ab4ff] cursor-grab active:cursor-grabbing" />
          <span className={`${label} opacity-60`}>glow gain on the bare "Pro" text — MetalFx `glowGain`, on top of strength × opacity</span>
        </label>
      </section>

      <section className="flex flex-col gap-2">
        <span className={`${label} uppercase tracking-wide opacity-60`}>New badge · per-instance</span>
        <label className="flex flex-col gap-1 min-w-0">
          <span className={`${label} flex justify-between gap-2`}>
            <span className={newOpacity !== BADGE_DEFAULTS.newOpacity ? 'text-(--title-color)' : undefined}>New badge metal opacity</span>
            <span className="font-[Roboto_Mono,monospace] tabular-nums opacity-80">{newOpacity.toFixed(2)}</span>
          </span>
          <input type="range" min={0} max={1} step={0.01} value={newOpacity} onChange={(e) => applyNewOpacity(Number(e.target.value))} className="w-full accent-[#8ab4ff] cursor-grab active:cursor-grabbing" />
          <span className={`${label} opacity-60`}>metal fill opacity over the badge background</span>
        </label>
        <label className="flex flex-col gap-1 min-w-0">
          <span className={`${label} flex justify-between gap-2`}>
            <span className={newScale !== BADGE_DEFAULTS.newShaderScale ? 'text-(--title-color)' : undefined}>New badge shader scale</span>
            <span className="font-[Roboto_Mono,monospace] tabular-nums opacity-80">{newScale.toFixed(2)}</span>
          </span>
          <input type="range" min={0.2} max={6} step={0.05} value={newScale} onChange={(e) => applyNewScale(Number(e.target.value))} className="w-full accent-[#8ab4ff] cursor-grab active:cursor-grabbing" />
          <span className={`${label} opacity-60`}>zoom of the metal in the fill — MetalFx `shaderScale`, this instance only</span>
        </label>
        {layerRows.map(([k, name, def, hint]) => (
          <label key={k} className="flex flex-col gap-1 min-w-0">
            <span className={`${label} flex justify-between gap-2`}>
              <span className={layers[k] !== def ? 'text-(--title-color)' : undefined}>{name}</span>
              <span className="font-[Roboto_Mono,monospace] tabular-nums opacity-80">{layers[k].toFixed(2)}</span>
            </span>
            <input type="range" min={0} max={1} step={0.01} value={layers[k]} onChange={(e) => applyLayer(k, Number(e.target.value))} className="w-full accent-[#8ab4ff] cursor-grab active:cursor-grabbing" />
            <span className={`${label} opacity-60`}>{hint}</span>
          </label>
        ))}
        {coreRows.map(([k, name, min, max, step, def, hint]) => (
          <label key={k} className="flex flex-col gap-1 min-w-0">
            <span className={`${label} flex justify-between gap-2`}>
              <span className={core[k] !== def ? 'text-(--title-color)' : undefined}>{name}</span>
              <span className="font-[Roboto_Mono,monospace] tabular-nums opacity-80">{step < 1 ? core[k].toFixed(2) : core[k]}</span>
            </span>
            <input type="range" min={min} max={max} step={step} value={core[k]} onChange={(e) => applyCore(k, Number(e.target.value))} className="w-full accent-[#8ab4ff] cursor-grab active:cursor-grabbing" />
            <span className={`${label} opacity-60`}>{hint}</span>
          </label>
        ))}
      </section>

      <div className="relative flex items-start overflow-hidden rounded-[8px] bg-(--code-bg) py-1.5 pr-9 pl-2.5">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-[Roboto_Mono,monospace] text-[11px] leading-[16px] text-(--code-text)">{snippet}</code>
        <CopyButton getText={() => snippet} />
      </div>
      <p className={`${label} opacity-60`}>Paste into the matching mode in <code className="font-[Roboto_Mono,monospace]">src/engine/presets.ts</code>.</p>
    </aside>
  );
}
