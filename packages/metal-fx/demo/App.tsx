import React, { useEffect, useState } from 'react';
import { CopyButton } from './components/CopyButton';
import { Examples } from './components/Examples';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { Playground } from './components/Playground';
import { GlowPanel } from './components/GlowPanel';
import { BendPanel } from './components/BendPanel';
import { OccluderPanel } from './components/OccluderPanel';
import { ShaderPanel } from './components/ShaderPanel';
import { CursorPanel } from './components/CursorPanel';
import { setCursorSprite } from '../src';
import { MAC_ARROW, isMacPointer } from './lib/cursorSprite';
import { useTheme } from './hooks/useTheme';

export function App() {
  const [theme, toggleTheme] = useTheme();
  // Strength lives on App so the Playground slider drives both the playground
  // preview AND the hero examples above. Stored as 0..100 to match the slider
  // range; consumers convert to 0..1 via `strength / 100`. Default 90% leaves
  // a bit of headroom so the metal effect feels lively without saturating the
  // ring on first paint.
  const [strength, setStrength] = useState(90);
  // Dev-only: strip the gray hero card fills and flatten the page to #101010
  // so the rings can be judged against a plain ground. Button is gated on
  // import.meta.env.DEV so none of this reaches the production build.
  //   1 = BG  — cards + composer mock lose their fill
  //   2 = BG2 — cards lose their fill, composer mock keeps it
  const [debugMode, setDebugMode] = useState<0 | 1 | 2>(0);
  const debug = debugMode > 0;
  // Dev-only, independent of BG/BG2: render only the composer example, and
  // inside it only the bare metal circle — no textarea, chips, or arrow icon.
  const [isolate, setIsolate] = useState(false);
  // Dev-only: floating glow tuning panel. Writes into the live GLOW config.
  const [glowPanel, setGlowPanel] = useState(false);
  // Dev-only: floating bend (cursor rubber) tuning panel.
  const [bendPanel, setBendPanel] = useState(false);
  // Dev-only: cursor-occluder tuning for proximity reflections.
  const [occPanel, setOccPanel] = useState(false);
  // Dev-only: shader tint tuning (global — one shared renderer).
  const [shaderPanel, setShaderPanel] = useState(false);
  // Dev-only: cursor light (glint under the pointer + catch-light facing it).
  const [curPanel, setCurPanel] = useState(false);
  // The cursor-light needs the platform's real pointer to redraw; only the
  // macOS arrow is bundled, so elsewhere the effect stays off.
  useEffect(() => {
    if (isMacPointer()) setCursorSprite(MAC_ARROW);
    return () => setCursorSprite(null);
  }, []);
  useEffect(() => {
    if (!debug) return;
    const prev = document.body.style.backgroundColor;
    document.body.style.backgroundColor = '#101010';
    return () => { document.body.style.backgroundColor = prev; };
  }, [debug]);

  return (
    <main className="flex flex-col items-center max-w-[883px] mx-auto w-full px-6 pb-16 max-sm:px-4 max-sm:pb-12">
      <Header theme={theme} onToggleTheme={toggleTheme} debugMode={debugMode} onSetDebugMode={setDebugMode} isolate={isolate} onToggleIsolate={() => setIsolate((v) => !v)} glowPanel={glowPanel} onToggleGlowPanel={() => setGlowPanel((v) => !v)} bendPanel={bendPanel} onToggleBendPanel={() => setBendPanel((v) => !v)} occPanel={occPanel} onToggleOccPanel={() => setOccPanel((v) => !v)} shaderPanel={shaderPanel} onToggleShaderPanel={() => setShaderPanel((v) => !v)} curPanel={curPanel} onToggleCurPanel={() => setCurPanel((v) => !v)} />

      <Examples theme={theme} strength={strength / 100} debug={debug} keepMockFill={debugMode === 2} isolate={isolate} />

      <section className="w-full mb-6" aria-label="Installation">
        <h2 className="text-base font-normal leading-[34px] text-(--section-title-color) mb-1">Installation</h2>
        <div className="flex items-center h-10 bg-(--code-bg) rounded-[10px] py-0.5 pr-10 pl-3 overflow-hidden relative">
          <code className="font-[Roboto_Mono,monospace] text-sm leading-[22px] text-(--code-text) whitespace-pre overflow-x-auto min-w-0 flex-1">npm install metal-fx</code>
          <CopyButton getText={() => 'npm install metal-fx'} />
        </div>
      </section>

      <section className="w-full mb-6" aria-label="Usage">
        <h2 className="text-base font-normal leading-[34px] text-(--section-title-muted) mb-1">Usage</h2>
        <div className="flex items-start h-auto bg-(--code-bg) rounded-[10px] py-1.5 pr-10 pl-3 overflow-hidden relative">
          <code className="font-[Roboto_Mono,monospace] text-sm leading-[22px] text-(--code-text) whitespace-pre overflow-x-auto min-w-0 flex-1">{`import { MetalFx } from 'metal-fx';\n\n<MetalFx preset="chromatic" strength={1}>\n  <button>Upgrade to Pro</button>\n</MetalFx>`}</code>
          <CopyButton getText={() => `import { MetalFx } from 'metal-fx';\n\n<MetalFx preset="chromatic" strength={1}>\n  <button>Upgrade to Pro</button>\n</MetalFx>`} />
        </div>
      </section>

      <Playground theme={theme} strength={strength} onStrengthChange={setStrength} />

      <Footer />
      {import.meta.env.DEV && glowPanel && <GlowPanel onClose={() => setGlowPanel(false)} />}
      {import.meta.env.DEV && bendPanel && <BendPanel onClose={() => setBendPanel(false)} />}
      {import.meta.env.DEV && occPanel && <OccluderPanel onClose={() => setOccPanel(false)} />}
      {import.meta.env.DEV && shaderPanel && <ShaderPanel onClose={() => setShaderPanel(false)} />}
      {import.meta.env.DEV && curPanel && <CursorPanel onClose={() => setCurPanel(false)} />}
    </main>
  );
}
