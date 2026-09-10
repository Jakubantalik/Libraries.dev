import React from 'react';
import type { Theme } from '../hooks/useTheme';
import { GitHubIcon, XIcon } from './icons';

const iconBtnClass = 'flex items-center justify-center size-9 border-none rounded-full bg-(--icon-btn-bg) text-inherit cursor-pointer no-underline transition-[background-color] duration-200 [-webkit-tap-highlight-color:transparent] hover:bg-(--icon-btn-hover) focus-visible:outline-2 focus-visible:outline-(--icon-btn-outline) focus-visible:outline-offset-2 [&_svg]:block [&_svg]:shrink-0 [&_svg]:fill-(--icon-btn-fill) [&_svg]:opacity-60 [&_svg]:transition-opacity [&_svg]:duration-200 hover:[&_svg]:opacity-100';

export function Header({
  theme,
  onToggleTheme,
  debugMode = 0,
  onSetDebugMode,
  isolate = false,
  onToggleIsolate,
  glowPanel = false,
  onToggleGlowPanel,
  bendPanel = false,
  onToggleBendPanel,
  occPanel = false,
  onToggleOccPanel,
  shaderPanel = false,
  onToggleShaderPanel,
  curPanel = false,
  onToggleCurPanel,
}: {
  theme: Theme;
  onToggleTheme: () => void;
  /** 0 off · 1 BG (strip all fills) · 2 BG2 (strip cards, keep composer). */
  debugMode?: 0 | 1 | 2;
  onSetDebugMode?: (mode: 0 | 1 | 2) => void;
  /** Composer example only, bare metal circle only. Combines with BG/BG2. */
  isolate?: boolean;
  onToggleIsolate?: () => void;
  /** Floating glow tuning panel. */
  glowPanel?: boolean;
  onToggleGlowPanel?: () => void;
  /** Floating bend (cursor rubber) tuning panel. */
  bendPanel?: boolean;
  onToggleBendPanel?: () => void;
  /** Cursor-occluder tuning panel for reflections. */
  occPanel?: boolean;
  onToggleOccPanel?: () => void;
  /** Cursor light (spill + catch-light) tuning panel. */
  curPanel?: boolean;
  onToggleCurPanel?: () => void;
  /** Shader tint tuning panel. */
  shaderPanel?: boolean;
  onToggleShaderPanel?: () => void;
}) {
  const devBtn = (mode: 1 | 2, label: string, title: string) => {
    const active = debugMode === mode;
    return (
      <button
        type="button"
        onClick={() => onSetDebugMode?.(active ? 0 : mode)}
        aria-pressed={active}
        className={`${iconBtnClass} font-[Roboto_Mono,monospace] text-[11px] ${active ? 'bg-(--icon-btn-hover) text-(--title-color)' : 'text-(--footer-muted)'}`}
        title={title}
      >
        {label}
      </button>
    );
  };
  return (
    <header className="relative w-full h-[218px] text-center flex flex-col items-center justify-end pb-[53px] max-sm:h-auto max-sm:min-h-[180px] max-sm:pt-[60px] max-sm:pb-8">
      <nav className="absolute top-4 right-0 z-10 flex items-center gap-4 max-sm:top-3" aria-label="External links">
        {/* Dev-only: strip hero card fills + flatten page bg. Removed from
            production builds via import.meta.env.DEV. */}
        {import.meta.env.DEV && onSetDebugMode && (
          <>
            {devBtn(1, 'BG', 'Strip card + composer fills, page #101010 (dev only)')}
            {devBtn(2, 'BG2', 'Strip card fills only, page #101010 (dev only)')}
            {onToggleIsolate && (
              <button
                type="button"
                onClick={onToggleIsolate}
                aria-pressed={isolate}
                className={`${iconBtnClass} font-[Roboto_Mono,monospace] text-[11px] ${isolate ? 'bg-(--icon-btn-hover) text-(--title-color)' : 'text-(--footer-muted)'}`}
                title="Composer example only, bare metal circle only (dev only)"
              >
                ISO
              </button>
            )}
            {onToggleGlowPanel && (
              <button
                type="button"
                onClick={onToggleGlowPanel}
                aria-pressed={glowPanel}
                className={`${iconBtnClass} font-[Roboto_Mono,monospace] text-[11px] ${glowPanel ? 'bg-(--icon-btn-hover) text-(--title-color)' : 'text-(--footer-muted)'}`}
                title="Glow tuning panel (dev only)"
              >
                GLW
              </button>
            )}
            {onToggleBendPanel && (
              <button
                type="button"
                onClick={onToggleBendPanel}
                aria-pressed={bendPanel}
                className={`${iconBtnClass} font-[Roboto_Mono,monospace] text-[11px] ${bendPanel ? 'bg-(--icon-btn-hover) text-(--title-color)' : 'text-(--footer-muted)'}`}
                title="Bend tuning panel (dev only)"
              >
                BND
              </button>
            )}
            {onToggleOccPanel && (
              <button
                type="button"
                onClick={onToggleOccPanel}
                aria-pressed={occPanel}
                className={`${iconBtnClass} font-[Roboto_Mono,monospace] text-[11px] ${occPanel ? 'bg-(--icon-btn-hover) text-(--title-color)' : 'text-(--footer-muted)'}`}
                title="Cursor occluder tuning (dev only)"
              >
                OCC
              </button>
            )}
            {onToggleShaderPanel && (
              <button
                type="button"
                onClick={onToggleShaderPanel}
                aria-pressed={shaderPanel}
                className={`${iconBtnClass} font-[Roboto_Mono,monospace] text-[11px] ${shaderPanel ? 'bg-(--icon-btn-hover) text-(--title-color)' : 'text-(--footer-muted)'}`}
                title="Shader tint tuning (dev only)"
              >
                SHD
              </button>
            )}
            {onToggleCurPanel && (
              <button
                type="button"
                onClick={onToggleCurPanel}
                aria-pressed={curPanel}
                className={`${iconBtnClass} font-[Roboto_Mono,monospace] text-[11px] ${curPanel ? 'bg-(--icon-btn-hover) text-(--title-color)' : 'text-(--footer-muted)'}`}
                title="Cursor light tuning (dev only)"
              >
                CUR
              </button>
            )}
          </>
        )}
        <a className={iconBtnClass} href="https://github.com/Jakubantalik/metal-fx" target="_blank" rel="noopener noreferrer" aria-label="GitHub repository">
          <GitHubIcon />
        </a>
        <a className={iconBtnClass} href="https://x.com/jakubantalik" target="_blank" rel="noopener noreferrer" aria-label="Follow on X (Twitter)">
          <XIcon />
        </a>
      </nav>
      <div className="relative -mt-[190px] -mb-5 cursor-pointer group pointer-events-none" aria-hidden="true">
        <img
          className="block relative transition-[filter,transform] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-[filter,transform] motion-reduce:!transition-none group-hover:[filter:hue-rotate(45deg)_brightness(1.1)] group-hover:[transform:rotate(8deg)_scale(1.06)]"
          src={theme === 'dark' ? '/header.png' : '/header-light.png'}
          alt=""
          width="207"
          height="138"
          decoding="async"
        />
      </div>
      <h1 className="text-[22px] font-medium leading-[30px] text-(--title-color)">Liquid metal</h1>
      <p className="text-sm font-normal leading-[21px] text-(--subtitle-color) opacity-50">Animated liquid metal border component</p>
    </header>
  );
}
