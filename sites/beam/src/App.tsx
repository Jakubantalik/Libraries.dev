import { useState, useCallback, useId, useRef, useLayoutEffect, useEffect, type CSSProperties } from 'react';
import { BorderBeam, type BorderBeamSize, type BorderBeamColorVariant } from 'border-beam';
import {
  MockChatInput,
  MockWorkingCard,
  MockSubscribeButton,
  MockIconButton,
  MockSearchBar,
} from './mocks';

function CopyIcon() {
  return (
    <svg className="icon-copy" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="icon-check" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M4.5 2.5v11l9-5.5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <rect x="4" y="3" width="3" height="10" rx="1" />
      <rect x="9" y="3" width="3" height="10" rx="1" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg aria-hidden="true" width="15" height="16" viewBox="0 0 1200 1227">
      <path d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.828Z" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 11L6 8L9 5" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fill="currentColor" d="M6.04458 1.60806C6.1589 1.35528 6.10472 1.05812 5.90855 0.861947C5.71237 0.665775 5.41522 0.611597 5.16244 0.725914C2.51258 1.92428 0.666626 4.59176 0.666626 7.69181C0.666626 11.9121 4.08786 15.3334 8.30817 15.3334C11.4082 15.3334 14.0757 13.4874 15.2741 10.8375C15.3884 10.5848 15.3342 10.2876 15.138 10.0914C14.9419 9.89526 14.6447 9.84108 14.3919 9.9554C13.6009 10.3131 12.7225 10.5126 11.7956 10.5126C8.31168 10.5126 5.4874 7.6883 5.4874 4.20438C5.4874 3.27752 5.68686 2.39905 6.04458 1.60806Z" />
    </svg>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg className={className} aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fill="currentColor" d="M8.66663 1.33333C8.66663 0.965143 8.36815 0.666666 7.99996 0.666666C7.63177 0.666666 7.33329 0.965143 7.33329 1.33333V2.66667C7.33329 3.03486 7.63177 3.33333 7.99996 3.33333C8.36815 3.33333 8.66663 3.03486 8.66663 2.66667V1.33333Z" />
      <path fill="currentColor" d="M8.66663 13.3333C8.66663 12.9651 8.36815 12.6667 7.99996 12.6667C7.63177 12.6667 7.33329 12.9651 7.33329 13.3333V14.6667C7.33329 15.0349 7.63177 15.3333 7.99996 15.3333C8.36815 15.3333 8.66663 15.0349 8.66663 14.6667V13.3333Z" />
      <path fill="currentColor" d="M0.666626 8C0.666626 7.63181 0.965103 7.33333 1.33329 7.33333H2.66663C3.03482 7.33333 3.33329 7.63181 3.33329 8C3.33329 8.36819 3.03482 8.66667 2.66663 8.66667H1.33329C0.965103 8.66667 0.666626 8.36819 0.666626 8Z" />
      <path fill="currentColor" d="M3.73797 2.7952C3.47762 2.53485 3.05551 2.53485 2.79516 2.7952C2.53481 3.05555 2.53481 3.47766 2.79516 3.73801L3.73797 4.68081C3.99831 4.94116 4.42042 4.94116 4.68077 4.68081C4.94112 4.42046 4.94112 3.99836 4.68077 3.73801L3.73797 2.7952Z" />
      <path fill="currentColor" d="M13.2048 2.7952C13.4651 3.05555 13.4651 3.47766 13.2048 3.73801L12.262 4.68081C12.0016 4.94116 11.5795 4.94116 11.3192 4.68081C11.0588 4.42046 11.0588 3.99836 11.3192 3.73801L12.262 2.7952C12.5223 2.53485 12.9444 2.53485 13.2048 2.7952Z" />
      <path fill="currentColor" d="M4.68077 12.2647C4.94112 12.0043 4.94112 11.5822 4.68077 11.3219C4.42042 11.0615 3.99831 11.0615 3.73797 11.3219L2.79516 12.2647C2.53481 12.525 2.53481 12.9472 2.79516 13.2075C3.05551 13.4679 3.47762 13.4679 3.73797 13.2075L4.68077 12.2647Z" />
      <path fill="currentColor" d="M11.3192 11.3219C11.5795 11.0615 12.0016 11.0615 12.262 11.3219L13.2048 12.2647C13.4651 12.525 13.4651 12.9472 13.2048 13.2075C12.9444 13.4679 12.5223 13.4679 12.262 13.2075L11.3192 12.2647C11.0588 12.0043 11.0588 11.5822 11.3192 11.3219Z" />
      <path fill="currentColor" d="M13.3333 7.33333C12.9651 7.33333 12.6666 7.63181 12.6666 8C12.6666 8.36819 12.9651 8.66667 13.3333 8.66667H14.6666C15.0348 8.66667 15.3333 8.36819 15.3333 8C15.3333 7.63181 15.0348 7.33333 14.6666 7.33333H13.3333Z" />
      <path fill="currentColor" d="M7.99996 4C5.79082 4 3.99996 5.79086 3.99996 8C3.99996 10.2091 5.79082 12 7.99996 12C10.2091 12 12 10.2091 12 8C12 5.79086 10.2091 4 7.99996 4Z" />
    </svg>
  );
}

function HeaderIcon() {
  return (
    <div className="header-icon" aria-hidden="true">
      <img
        className="header-icon-img header-icon-img--dark"
        src={`${import.meta.env.BASE_URL}icon-web.png`}
        alt=""
        width={207}
        height={138}
      />
      <img
        className="header-icon-img header-icon-img--light"
        src={`${import.meta.env.BASE_URL}icon-web-light.png`}
        alt=""
        width={207}
        height={138}
      />
    </div>
  );
}

// Copy button with a dual-icon (copy ⇄ check) crossfade and a "Copy code"
// ⇄ "Copied" tooltip pill whose width tweens between the two labels. The
// label widths are measured once after mount and exposed as --tt-w-a /
// --tt-w-b CSS custom properties so the width transition is exact. Uses a
// hidden-textarea execCommand fallback when navigator.clipboard isn't
// available (insecure contexts / older mobile browsers).
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [swapState, setSwapState] = useState<'copy' | 'copied'>('copy');
  const swapRef = useRef<HTMLSpanElement | null>(null);
  const iconTimerRef = useRef<number | undefined>(undefined);
  const swapTimerRef = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    const swap = swapRef.current;
    if (!swap) return;
    const labels = swap.querySelectorAll<HTMLElement>('.tt-label');
    const widths: number[] = [];
    labels.forEach((lbl) => {
      const prevPos = lbl.style.position;
      const prevDisp = lbl.style.display;
      lbl.style.position = 'static';
      lbl.style.display = 'inline-block';
      widths.push(lbl.getBoundingClientRect().width);
      lbl.style.position = prevPos;
      lbl.style.display = prevDisp;
    });
    if (widths.length >= 2) {
      swap.style.setProperty('--tt-w-a', widths[0] + 'px');
      swap.style.setProperty('--tt-w-b', widths[1] + 'px');
    }
  }, []);

  useEffect(() => {
    return () => {
      window.clearTimeout(iconTimerRef.current);
      window.clearTimeout(swapTimerRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    const writeText = async (value: string): Promise<boolean> => {
      if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(value);
          return true;
        } catch {
          // fall through to the execCommand path
        }
      }
      if (typeof document === 'undefined') return false;
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.width = '1px';
      ta.style.height = '1px';
      ta.style.padding = '0';
      ta.style.border = 'none';
      ta.style.opacity = '0';
      ta.style.pointerEvents = 'none';
      document.body.appendChild(ta);
      const sel = document.getSelection();
      const savedRange = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, value.length);
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      ta.remove();
      if (savedRange && sel) {
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }
      return ok;
    };

    const ok = await writeText(text);
    if (!ok) return;
    setCopied(true);
    setSwapState('copied');
    window.clearTimeout(iconTimerRef.current);
    window.clearTimeout(swapTimerRef.current);
    const isTouch =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(hover: none)').matches;
    const dwell = isTouch ? 2000 : 1600;
    iconTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      swapTimerRef.current = window.setTimeout(() => {
        setSwapState('copy');
      }, 200);
    }, dwell);
  }, [text]);

  return (
    <button
      type="button"
      className="copy-btn"
      onClick={handleCopy}
      data-copied={copied ? 'true' : 'false'}
      aria-label={copied ? 'Copied' : label}
    >
      <CopyIcon />
      <CheckIcon />
      <span className="copy-btn-tooltip" role="tooltip" aria-hidden="true">
        <span className="tt-text">
          <span className="tt-stem">Cop</span>
          <span className="tt-swap" ref={swapRef} data-state={swapState}>
            <span className="tt-label tt-a">y code</span>
            <span className="tt-label tt-b">ied</span>
          </span>
        </span>
      </span>
    </button>
  );
}

type BeamFamily = 'rotate' | 'pulse';

const FAMILY_OPTIONS: { value: BeamFamily; label: string }[] = [
  { value: 'rotate', label: 'Rotate' },
  { value: 'pulse', label: 'Pulse' },
];

const ROTATE_SIZE_OPTIONS: { value: BorderBeamSize; label: string }[] = [
  { value: 'md', label: 'Large' },
  { value: 'sm', label: 'Small' },
  { value: 'line', label: 'Line' },
];

const PULSE_SIZE_OPTIONS: { value: BorderBeamSize; label: string }[] = [
  { value: 'pulse-inner', label: 'Pulse Inner' },
  { value: 'pulse-outside', label: 'Pulse Outside' },
];

const SIZE_OPTIONS_BY_FAMILY: Record<BeamFamily, { value: BorderBeamSize; label: string }[]> = {
  rotate: ROTATE_SIZE_OPTIONS,
  pulse: PULSE_SIZE_OPTIONS,
};

const DEFAULT_SIZE_BY_FAMILY: Record<BeamFamily, BorderBeamSize> = {
  rotate: 'md',
  pulse: 'pulse-inner',
};

// URL <-> tab mapping. `/pulse` deep-links to the Pulse tab; everything else
// (including `/`) is Rotate. GitHub Pages serves the SPA fallback (404.html)
// so a direct visit to /pulse resolves before React mounts.
// The playground lives under /demo/ now (the root is the "moved to
// libraries.dev" page), so the family rides in the hash rather than the
// path: /demo/#pulse. A hash needs no SPA fallback on GitHub Pages.
function familyFromPath(hash: string): BeamFamily {
  return /^#pulse$/i.test(hash) ? 'pulse' : 'rotate';
}

function pathForFamily(family: BeamFamily): string {
  return family === 'pulse' ? '#pulse' : window.location.pathname;
}

type ThemeMode = 'dark' | 'light';

// Light mode is a dev-only affordance: the live site ships dark-only, so the
// toggle is hidden and the theme is forced to dark in production builds.
const LIGHT_MODE_ENABLED = !import.meta.env.PROD;

// Initial theme: respect the value the inline boot script already wrote to
// <html data-theme> (avoids a flash), then localStorage, defaulting to dark.
function getInitialTheme(): ThemeMode {
  if (!LIGHT_MODE_ENABLED) return 'dark';
  const fromAttr = document.documentElement.dataset.theme;
  if (fromAttr === 'light' || fromAttr === 'dark') return fromAttr;
  const stored = localStorage.getItem('theme');
  return stored === 'light' ? 'light' : 'dark';
}

/* Platform tabs for the install/usage snippets. The web package is published;
   the native ports live in the same repo under ports/ and are not on a registry
   yet, so they install from source. */
type Platform = 'react' | 'swiftui' | 'native';

const PLATFORM_OPTIONS: { value: Platform; label: string }[] = [
  { value: 'react', label: 'React' },
  { value: 'swiftui', label: 'SwiftUI' },
  { value: 'native', label: 'React Native' },
];

const INSTALL_BY_PLATFORM: Record<Platform, string> = {
  react: 'npm install border-beam',
  swiftui: '.package(url: "https://github.com/Jakubantalik/Libraries.dev.git", from: "1.4.0")',
  native: 'npm install @shopify/react-native-skia react-native-reanimated',
};

const USAGE_BY_PLATFORM: Record<Platform, string> = {
  react: `import { BorderBeam } from 'border-beam';

<BorderBeam>
  <YourCard>Content</YourCard>
</BorderBeam>`,
  swiftui: `import BorderBeamKit

BorderBeam(size: .md) {
    YourCard()
}

// or as a modifier
YourCard().borderBeam(.md, colorVariant: .ocean)`,
  native: `import { BorderBeam } from 'border-beam-native';

<BorderBeam size="md" colorVariant="colorful" borderRadius={16}>
  <YourCard />
</BorderBeam>`,
};

/* Shown under the install block for ports that aren't on a registry yet. */
const INSTALL_NOTE_BY_PLATFORM: Record<Platform, string | null> = {
  react: null,
  swiftui: 'Swift Package Manager · requires iOS 17+ · Add via File \u203a Add Package Dependencies in Xcode.',
  native: 'In beta \u2014 not yet published. Copy packages/border-beam/ports/react-native/border-beam-native from the repo, then install the two peer dependencies above.',
};

const COLOR_OPTIONS: { value: BorderBeamColorVariant; label: string }[] = [
  { value: 'colorful', label: 'Colorful' },
  { value: 'mono', label: 'Mono' },
  { value: 'ocean', label: 'Ocean' },
  { value: 'sunset', label: 'Sunset' },
  { value: 'forest', label: 'Forest' },
  { value: 'candy', label: 'Candy' },
  { value: 'ice', label: 'Ice' },
  { value: 'gold', label: 'Gold' },
];

export default function App() {
  const [family, setFamily] = useState<BeamFamily>(() => familyFromPath(window.location.hash));
  const [playgroundActive, setPlaygroundActive] = useState(true);
  const [playgroundSize, setPlaygroundSize] = useState<BorderBeamSize>(
    () => DEFAULT_SIZE_BY_FAMILY[familyFromPath(window.location.hash)]
  );
  const [playgroundColorVariant, setPlaygroundColorVariant] = useState<BorderBeamColorVariant>('colorful');
  const [playgroundStrength, setPlaygroundStrength] = useState(70);
  const [platform, setPlatform] = useState<Platform>('react');
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const strengthId = useId();

  // Reflect the active theme on <html> and persist the choice.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const sizeOptions = SIZE_OPTIONS_BY_FAMILY[family];
  const isPulse = family === 'pulse';
  const rotateTabActive = family === 'rotate';
  const pulseTabActive = family === 'pulse';

  const handleFamilyChange = useCallback((next: BeamFamily) => {
    setFamily(next);
    setPlaygroundSize(DEFAULT_SIZE_BY_FAMILY[next]);
    const path = pathForFamily(next);
    if (window.location.pathname + window.location.hash !== path) {
      window.history.pushState(null, '', path);
    }
  }, []);

  // Keep the tab in sync with browser back/forward navigation.
  useEffect(() => {
    const onPopState = () => {
      const next = familyFromPath(window.location.hash);
      setFamily(next);
      setPlaygroundSize(DEFAULT_SIZE_BY_FAMILY[next]);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Sliding tab pill (transitions.dev — tabs sliding). animate=false snaps
  // without a transition (first paint / resize); animate=true tweens.
  const tabListRef = useRef<HTMLElement>(null);
  const tabPillRef = useRef<HTMLSpanElement>(null);
  const tabPillReady = useRef(false);

  const moveTabPill = useCallback((animate: boolean) => {
    const pill = tabPillRef.current;
    const list = tabListRef.current;
    if (!pill || !list) return;
    const activeTab = list.querySelector<HTMLButtonElement>('.tab-btn[data-active="true"]');
    if (!activeTab) return;
    if (!animate) {
      const prev = pill.style.transition;
      pill.style.transition = 'none';
      pill.style.transform = `translateX(${activeTab.offsetLeft}px)`;
      pill.style.width = `${activeTab.offsetWidth}px`;
      void pill.offsetWidth; // force reflow before restoring
      pill.style.transition = prev;
    } else {
      pill.style.transform = `translateX(${activeTab.offsetLeft}px)`;
      pill.style.width = `${activeTab.offsetWidth}px`;
    }
  }, []);

  useLayoutEffect(() => {
    moveTabPill(tabPillReady.current);
    tabPillReady.current = true;
  }, [family, moveTabPill]);

  useEffect(() => {
    const onResize = () => moveTabPill(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [moveTabPill]);

  const installCmd = INSTALL_BY_PLATFORM[platform];
  const usageCode = USAGE_BY_PLATFORM[platform];
  const installNote = INSTALL_NOTE_BY_PLATFORM[platform];
  const playgroundCode = `<BorderBeam size="${playgroundSize}" colorVariant="${playgroundColorVariant}"${playgroundStrength < 100 ? ` strength={${playgroundStrength / 100}}` : ''}>
  <Card>Content</Card>
</BorderBeam>`;

  const rotateExamples = (
    <>
      <div className="example-row-full">
        <BorderBeam className="beam-host" size="md" colorVariant="colorful" theme={theme} active={rotateTabActive}>
          <MockChatInput />
        </BorderBeam>
      </div>
      <div className="example-row-split">
        <div className="example-cell">
          <BorderBeam className="beam-host" size="sm" colorVariant="colorful" theme={theme} active={rotateTabActive}>
            <MockIconButton />
          </BorderBeam>
        </div>
        <div className="example-cell">
          <BorderBeam
            className="beam-host"
            size="line"
            colorVariant="colorful"
            theme={theme}
            active={rotateTabActive}
            duration={3.1}
            borderRadius={20}
          >
            <MockSearchBar />
          </BorderBeam>
        </div>
      </div>
    </>
  );

  const pulseExamples = (
    <>
      <div className="example-row-full">
        <BorderBeam className="beam-host beam-host--soft" size="pulse-inner" colorVariant="colorful" theme={theme} active={pulseTabActive}>
          <MockWorkingCard />
        </BorderBeam>
      </div>
      <div className="example-row-split">
        <div className="example-cell">
          <BorderBeam className="beam-host beam-host--pill" size="pulse-inner" colorVariant="colorful" theme={theme} active={pulseTabActive}>
            <MockSubscribeButton />
          </BorderBeam>
        </div>
        <div className="example-cell">
          <BorderBeam className="beam-host beam-host--pulse-outside-tuned" size="pulse-outside" colorVariant="colorful" theme={theme} active={pulseTabActive}>
            <MockChatInput />
          </BorderBeam>
        </div>
      </div>
    </>
  );

  // Keep pulse-outside tuning in sync with the subscribe control defaults.
  const pulseOutsideTunedVars = {
    '--sub-glow-offset-x': '1px',
    '--sub-glow-offset-y': '0px',
    '--sub-core-blur': '10px',
    '--sub-bloom-blur': '19px',
    '--sub-glow-opacity-mul': 1.71,
  } as CSSProperties;

  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      <main id="main-content" className="app">
        <header className="header">
          <a
            className="top-bar-back"
            href="https://www.jakubantalik.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="top-bar-back-inner">
              <ChevronLeftIcon />
              jakubantalik.com
            </span>
          </a>
          <nav aria-label="External links" className="top-bar-links">
            {LIGHT_MODE_ENABLED && (
              <button
                type="button"
                className="icon-btn theme-toggle"
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                <span
                  className="theme-icon-stack"
                  data-active={theme === 'dark' ? 'sun' : 'moon'}
                  aria-hidden="true"
                >
                  <MoonIcon className="theme-icon theme-icon-moon" />
                  <SunIcon className="theme-icon theme-icon-sun" />
                </span>
              </button>
            )}
            <a className="icon-btn" href="https://github.com/Jakubantalik/Libraries.dev" target="_blank" rel="noopener noreferrer" aria-label="GitHub repository">
              <GitHubIcon />
            </a>
            <a className="icon-btn" href="https://x.com/jakubantalik" target="_blank" rel="noopener noreferrer" aria-label="Follow on X (Twitter)">
              <XIcon />
            </a>
          </nav>
          <HeaderIcon />
          <h1 className="title">Border beam</h1>
          <p className="subtitle-sm">Animated border beam component</p>
        </header>

        <nav className="tab-nav" role="tablist" aria-label="Effect family" ref={tabListRef}>
          <span className="tab-nav-pill" aria-hidden="true" ref={tabPillRef} />
          {FAMILY_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              className="tab-btn"
              role="tab"
              aria-selected={family === value}
              data-active={family === value}
              onClick={() => handleFamilyChange(value)}
            >
              {label}
            </button>
          ))}
        </nav>

        <section
          className="examples-section t-page-slide"
          data-page={family === 'rotate' ? '1' : '2'}
          aria-label="Effect demonstrations"
        >
          <div
            className="t-page examples-page examples-page--rotate"
            data-page-id="1"
            aria-hidden={family !== 'rotate'}
          >
            {rotateExamples}
          </div>
          <div
            className="t-page examples-page examples-page--pulse"
            data-page-id="2"
            aria-hidden={family !== 'pulse'}
          >
            {pulseExamples}
          </div>
        </section>

        <section className="section" aria-label="Installation">
          <div className="section-head">
            <h2 className="section-title">Installation</h2>
            <div className="platform-tabs" role="radiogroup" aria-label="Platform">
              {PLATFORM_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  className="tab-btn"
                  role="radio"
                  aria-checked={platform === value}
                  data-active={platform === value}
                  onClick={() => setPlatform(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="code-block">
            <code>{installCmd}</code>
            <CopyButton text={installCmd} label="Copy install command" />
          </div>
          {installNote && <p className="install-note">{installNote}</p>}
        </section>

        <section className="section" aria-label="Usage">
          <h2 className="section-title section-title--muted">Usage</h2>
          <div className="code-block code-block--multi">
            <code>{usageCode}</code>
            <CopyButton text={usageCode} label="Copy usage example" />
          </div>
        </section>

        <section className="playground-section" aria-label="Interactive playground">
          <h2 className="section-title">Playground</h2>

          <div className="playground-controls">
            <div className="control-group" role="radiogroup" aria-label="Effect type">
              <span className="control-label">Type</span>
              <div className="control-options">
                {sizeOptions.map(({ value, label }) => (
                  <button
                    key={value}
                    className="tab-btn"
                    role="radio"
                    aria-checked={playgroundSize === value}
                    data-active={playgroundSize === value}
                    onClick={() => setPlaygroundSize(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="control-group" role="radiogroup" aria-label="Color variant">
              <span className="control-label">Color</span>
              <div className="control-options">
                {COLOR_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    className="tab-btn"
                    role="radio"
                    aria-checked={playgroundColorVariant === value}
                    data-active={playgroundColorVariant === value}
                    onClick={() => setPlaygroundColorVariant(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="control-group control-group--strength">
              <span className="control-label">Strength</span>
              <div className="strength-track">
                {playgroundStrength > 0 && (
                  <div
                    className="strength-fill"
                    style={{ width: `${playgroundStrength}%` }}
                  />
                )}
                <span className="strength-value">{playgroundStrength}%</span>
                <input
                  id={strengthId}
                  type="range"
                  className="strength-input"
                  value={playgroundStrength}
                  onChange={(e) => setPlaygroundStrength(parseInt(e.target.value, 10))}
                  min={0}
                  max={100}
                  step={1}
                  aria-label="Effect strength"
                />
              </div>
            </div>
          </div>

          <div className={`playground-preview${isPulse ? ' playground-preview--pulse' : ''}`}>
            <BorderBeam
              className={playgroundSize === 'pulse-outside' ? 'beam-host--pulse-outside-tuned' : undefined}
              size={playgroundSize}
              colorVariant={playgroundColorVariant}
              theme={theme}
              active={playgroundActive}
              strength={playgroundStrength / 100}
              style={playgroundSize === 'pulse-outside' ? pulseOutsideTunedVars : undefined}
            >
              <div className={`card ${playgroundSize === 'sm' ? 'card-sm' : 'card-md'}`}>
                <p className="card-text">
                  {playgroundSize === 'sm' ? '' : 'Build anything...'}
                </p>
              </div>
            </BorderBeam>

            <div className="playground-toolbar">
              <button
                type="button"
                className="playground-toggle"
                onClick={() => setPlaygroundActive((p) => !p)}
                aria-pressed={playgroundActive}
                aria-label={playgroundActive ? 'Pause animation' : 'Play animation'}
                title={playgroundActive ? 'Pause' : 'Play'}
              >
                {playgroundActive ? <PauseIcon /> : <PlayIcon />}
              </button>
            </div>
          </div>

          <div className="code-block code-block--multi">
            <code>{playgroundCode}</code>
            <CopyButton text={playgroundCode} label="Copy playground code" />
          </div>
        </section>

        <footer className="footer">
          <span className="footer-muted">Made by</span>{' '}
          <a className="footer-name" href="https://x.com/jakubantalik" target="_blank" rel="noopener noreferrer">Jakub Antalik</a>
        </footer>
      </main>
    </>
  );
}
