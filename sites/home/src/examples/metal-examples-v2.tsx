import { useEffect, useMemo, useRef } from "react";
import {
  MetalBadge,
  MetalFx,
  MetalText,
  setCursorSprite,
  useMetalBend,
  useMetalTextReflection,
} from "metal-fx";
import { MAC_ARROW, isMacPointer } from "./metal-cursor-sprite";

/* Metal v2 examples — the metal-fx v2 demo page's three cards, on the site's
   mx-* classes. Same presets, strengths and per-card settings as the demo:

   1. Composer: gold circle send button with the inner-shadow rim, the
      cursor-driven liquid bend, reflection onto the Auto chip, and the
      cursor light (the ring lights the pointer; macOS sprite only).
   2. "Plan Pro": metal inside the glyphs of "Pro" (with its inner shadow),
      "Plan" catches the metal on its letterforms.
   3. "Live mode · New": the New badge — white pill, metal rim, clean core. */

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 11L10 8L7 5" />
    </svg>
  );
}

/** The pointer sprite is Apple artwork and macOS-shaped, so it is only
 *  registered on macOS and only while a v2 example is mounted. */
export function useMetalCursorSprite(): void {
  useEffect(() => {
    if (isMacPointer()) setCursorSprite(MAC_ARROW);
    return () => setCursorSprite(null);
  }, []);
}

export function MetalExamplesV2({ strength = 1 }: { strength?: number }) {
  const autoChipRef = useRef<HTMLDivElement>(null);
  const sendRef = useRef<HTMLDivElement>(null);
  useMetalBend(sendRef);
  useMetalCursorSprite();

  const planRef = useRef<HTMLSpanElement>(null);
  useMetalTextReflection(planRef);
  // Stable identity: MetalFx re-registers its reflection wrapper whenever
  // this array's identity changes.
  const planTargets = useMemo(() => [{ ref: planRef, strength: 0.64 }], []);

  return (
    <div className="detail-examples" aria-label="Effect demonstrations">
      {/* Composer */}
      <div className="example-row-full mx-row">
        <div className="mx-chat">
          <textarea
            className="mx-chat-input mx-chat-input--short"
            placeholder="Build anything..."
            rows={1}
            spellCheck={false}
            aria-label="Build anything..."
          />
          <div className="mx-chat-bottom">
            <div className="mx-plus">
              <PlusIcon />
            </div>
            <div className="mx-spacer" />
            <div className="mx-chip">
              <span>Agent</span>
              <ChevronDownIcon />
            </div>
            <div className="mx-chip" ref={autoChipRef}>
              <span>Auto</span>
              <ChevronDownIcon />
            </div>
            <MetalFx
              ref={sendRef}
              preset="chromatic"
              variant="circle"
              theme="dark"
              reflectionTargets={[autoChipRef]}
              innerShadow
              strength={strength * 0.9}
            >
              <button type="button" className="mx-circle mx-circle--send" aria-label="Send">
                <ArrowUpIcon />
              </button>
            </MetalFx>
          </div>
        </div>
      </div>

      {/* Plan · Pro — metal in the glyphs */}
      <div className="example-row-full mx-row mx-row--card">
        <div className="mx-card-line mx-card-line--plan">
          <span ref={planRef} className="mx-plan">Plan</span>
          <MetalText font="500 24px/1.2 Inter, sans-serif" color="#E2E2E2" strength={strength} theme="dark" reflectionTargets={planTargets}>
            Pro
          </MetalText>
        </div>
      </div>

      {/* Live mode · New badge */}
      <div className="example-row-full mx-row mx-row--card">
        <div className="mx-card-line mx-card-line--live">
          <span className="mx-live">Live mode</span>
          <MetalBadge strength={strength} theme="dark">New</MetalBadge>
        </div>
      </div>
    </div>
  );
}
