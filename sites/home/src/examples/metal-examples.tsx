import { useRef } from "react";
import { MetalFx } from "metal-fx-v1";

/* The metal-fx demo page's own examples (demo/components/Examples.tsx),
   ported from its Tailwind to the mx-* classes in assets/examples.css.
   Same two rows, same presets, same per-example strength baselines, and
   the same reflectionTargets — the rim picks up light from the chips and
   controls beside it, which is the point of the demo.

   Uses metal-fx v1 as published; no newer engine features. */

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

function SearchIcon18() {
  return (
    <svg viewBox="0 0 18 18" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="m16 16-3.5-3.5" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <circle cx="4.167" cy="10" r="1.667" />
      <circle cx="10" cy="10" r="1.667" />
      <circle cx="15.833" cy="10" r="1.667" />
    </svg>
  );
}

export function MetalExamples({ strength = 1 }: { strength?: number }) {
  const searchRef = useRef<HTMLLabelElement>(null);
  const dotsRef = useRef<HTMLButtonElement>(null);
  const autoChipRef = useRef<HTMLDivElement>(null);

  return (
    <div className="detail-examples" aria-label="Effect demonstrations">
      {/* Chat input mock */}
      <div className="example-row-full mx-row">
        <div className="mx-chat">
          <textarea
            className="mx-chat-input"
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
              preset="gold"
              variant="circle"
              theme="dark"
              reflectionTargets={[autoChipRef]}
              /* Demo baseline: the circle peaks at 90% so the gold rim
                 does not fully saturate; the chromatic pill uses 0.7. */
              strength={strength * 0.9}
            >
              <button type="button" className="mx-circle" aria-label="Send">
                <ArrowUpIcon />
              </button>
            </MetalFx>
          </div>
        </div>
      </div>

      {/* Toolbar row */}
      <div className="example-row-full mx-row mx-row--toolbar">
        {/* The card backdrop is anchored to the toolbar, not the row, so the
            composition holds at any panel width. */}
        <div className="mx-toolbar-wrap">
        <div className="mx-toolbar-backdrop" aria-hidden="true" />
        <div className="mx-toolbar" role="group" aria-label="Hero toolbar">
          <label className="mx-search" ref={searchRef}>
            <SearchIcon18 />
            <input
              className="mx-search-input"
              type="search"
              placeholder="Search"
              spellCheck={false}
              aria-label="Search"
            />
          </label>

          <MetalFx
            preset="chromatic"
            theme="dark"
            reflectionTargets={[searchRef, dotsRef]}
            strength={strength * 0.7}
          >
            <button type="button" className="mx-pill">
              Upgrade to Pro
            </button>
          </MetalFx>

          <button className="mx-dots" type="button" ref={dotsRef} aria-label="More options">
            <DotsIcon />
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
