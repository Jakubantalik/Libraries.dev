import React, { useMemo, useRef } from 'react';
import { useBend } from '../hooks/useBend';
import { MetalText } from './MetalText';
import { NewBadge } from './NewBadge';
import { useTextReflection } from '../hooks/useTextReflection';
import { MetalFx } from '../../src';
import type { Theme } from '../hooks/useTheme';
import { ArrowUpIcon, ChevronDownIcon, PlusIcon } from './icons';

const pillBaseClass = 'h-10 rounded-[20px] border border-(--pill-border) bg-(--pill-bg) text-(--pill-fg) shadow-(--pill-shadow) cursor-default flex items-center justify-center p-0';
const demoCircleClass = `${pillBaseClass} w-10`;
// Figma 1471:40925 — two 835×170 cards, r 36, centred content.
const exampleCardClass = 'relative w-full h-[170px] rounded-[36px] flex items-center justify-center px-10 overflow-hidden max-sm:h-auto max-sm:min-h-[140px] max-sm:px-5 max-sm:py-8 max-sm:rounded-[20px]';
const chipClass = 'inline-flex items-center gap-1 h-9 pl-3.5 pr-2.5 rounded-full bg-(--chip-bg) shadow-(--chip-shadow) text-(--chip-color) text-xs leading-[14px] font-inherit cursor-default [&_svg]:size-4 [&_svg]:text-(--chip-icon) [&_svg]:rotate-90';

export function Examples({
  theme,
  scaleFactor = 1,
  strength = 1,
  debug = false,
  keepMockFill = false,
  isolate = false,
}: {
  theme: Theme;
  /** Forwarded to <MetalFx scale={scaleFactor}/> so that, when these examples
   *  are rendered inside a CSS-zoomed container (Hero2x), the entire metal
   *  effect — shader pattern, ring thickness, glow halo, and reflections —
   *  grows proportionally instead of staying at the 1× pixel size. */
  scaleFactor?: number;
  /** Forwarded to <MetalFx strength={...}/> on every wrapped element so the
   *  Playground's strength slider can drive these hero buttons too. 0..1,
   *  defaults to 1 for the standalone 2x hero where there's no slider. */
  strength?: number;
  /** Dev-only: drop the card surface fill so the rings sit on the bare page. */
  debug?: boolean;
  /** With `debug`, leave the chat composer mock's own fill in place. */
  keepMockFill?: boolean;
  /** Dev-only: render only the composer example, and inside it only the bare
   *  metal circle — no textarea, plus, chips, or arrow icon. */
  isolate?: boolean;
}) {
  // ISO pins the card to a flat #0E0E0E so ring + glow read against one
  // known value. The circle gets the same tone via MetalFx's `style` —
  // normalizeHostStyles forces the button itself transparent, and the
  // wrapper background is the documented single-surface override point.
  const surface = isolate ? 'bg-[#0E0E0E]' : debug ? 'bg-transparent' : 'bg-(--surface)';
  const autoChipRef = useRef<HTMLDivElement>(null);
  const sendRef = useRef<HTMLDivElement>(null);
  useBend(sendRef);
  // "Plan" catches the metal "Pro"'s light on its right-hand glyphs.
  const planRef = useRef<HTMLSpanElement>(null);
  useTextReflection(planRef);
  // Stable identity: MetalFx re-registers (tears down + rebuilds the
  // reflection wrapper) whenever this array's identity changes.
  const planTargets = useMemo(() => [{ ref: planRef, strength: 1.6 }], []);
  // Same for "Live mode" and the New badge.
  const liveRef = useRef<HTMLSpanElement>(null);
  useTextReflection(liveRef);
  const liveTargets = useMemo(() => [{ ref: liveRef, strength: 2.5 }], []);

  return (
    <section className="w-full flex flex-col gap-3 mb-12" aria-label="Effect demonstrations">
      {/* Chat input mock */}
      <div className={`relative w-full h-[314px] rounded-[30px] ${surface} flex items-center justify-center px-10 py-12 overflow-hidden max-sm:h-auto max-sm:min-h-[200px] max-sm:px-5 max-sm:py-8 max-sm:rounded-[20px]`}>
        {isolate ? (
          // Bare circle, full strength, no composer box — nothing else in frame.
          <MetalFx preset="gold" variant="circle" theme={theme} scale={scaleFactor} strength={1} innerShadow style={{ background: '#0E0E0E' }}>
            <button type="button" className={demoCircleClass} aria-label="Send" />
          </MetalFx>
        ) : (
        <div className={`w-[448px] max-w-full rounded-[20px] ${debug && !keepMockFill ? 'bg-transparent' : 'bg-(--mock-chat-bg)'} pt-5 px-4 pb-4 flex flex-col max-sm:w-full`}>
          <textarea
            className="border-none bg-transparent text-(--text) text-sm leading-4 font-inherit outline-none w-[70%] p-0 mb-4 resize-none overflow-hidden placeholder:text-(--mock-chat-placeholder)"
            placeholder="Build anything..."
            rows={1}
            spellCheck={false}
            aria-label="Build anything..."
          />
          <div className="flex items-center gap-3 mt-auto">
            <div className="size-9 min-w-9 rounded-full bg-(--chip-bg) shadow-(--chip-shadow) border-none text-(--chip-color) text-base cursor-default flex items-center justify-center">
              <PlusIcon />
            </div>
            <div className="flex-1" />
            <div className={chipClass}><span>Agent</span><ChevronDownIcon /></div>
            <div className={chipClass} ref={autoChipRef}><span>Auto</span><ChevronDownIcon /></div>
            <MetalFx
              ref={sendRef}
              preset="gold"
              variant="circle"
              theme={theme}
              reflectionTargets={[autoChipRef]}
              scale={scaleFactor}
              innerShadow
              // Dev-only: BG/BG2 strip the send button's fill. The host button
              // is already forced transparent by normalizeHostStyles; the
              // visible fill is the wrapper background, so that's what goes.
              style={debug ? { background: 'transparent' } : undefined}
              // Per-example baseline multiplier so the slider still drives
              // the circle, but its rim peaks at 90% rather than full
              // saturation. Pair: chromatic pill below uses 0.7.
              strength={strength * 0.9}
            >
              <button type="button" className={demoCircleClass}>
                <ArrowUpIcon />
              </button>
            </MetalFx>
          </div>
        </div>
        )}
      </div>

      {/* Plan · Pro — metal in the glyphs (Figma 1471:40925) */}
      {!isolate && (
      <div className={`${exampleCardClass} ${surface}`}>
        <div className="flex items-baseline gap-1.5">
          <span
            ref={planRef}
            className="whitespace-nowrap text-[#999999]"
            style={{ font: '500 24px/1.2 Inter, sans-serif' }}
          >
            Plan
          </span>
          <MetalText font="500 24px/1.2 Inter, sans-serif" color="#8C8C8C" strength={strength} theme={theme} reflectionTargets={planTargets}>
            Pro
          </MetalText>
        </div>
      </div>
      )}

      {/* Live mode · New badge (Figma 1471:40925) */}
      {!isolate && (
      <div className={`${exampleCardClass} ${surface}`}>
        <div className="flex items-center gap-3">
          <span ref={liveRef} className="whitespace-nowrap text-[#999999]" style={{ font: '400 20px/1.2 Inter, sans-serif' }}>
            Live mode
          </span>
          <NewBadge strength={strength} theme={theme} reflectionTargets={liveTargets} />
        </div>
      </div>
      )}
    </section>
  );
}
