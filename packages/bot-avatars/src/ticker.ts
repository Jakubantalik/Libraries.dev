/* One animation frame loop for every avatar on the page. Subscribers get
   the seconds since their last tick; the loop stops while the tab is
   hidden and while nobody is subscribed. */

type Tick = (dt: number) => void;

/** The last pointer position on the page, NaN while it is away. */
export const pointer = { x: NaN, y: NaN };

const subs = new Set<Tick>();
let raf = 0;
let last = 0;

function frame(now: number) {
  raf = 0;
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  subs.forEach((fn) => fn(dt));
  if (subs.size) raf = requestAnimationFrame(frame);
}

function start() {
  if (raf || typeof document === 'undefined' || document.hidden) return;
  last = 0;
  raf = requestAnimationFrame(frame);
}

let wired = false;
function wire() {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  document.addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; }, { passive: true });
  document.addEventListener('pointerleave', () => { pointer.x = NaN; pointer.y = NaN; });
  window.addEventListener('blur', () => { pointer.x = NaN; pointer.y = NaN; });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else if (subs.size) start();
  });
}

export function subscribe(fn: Tick): () => void {
  wire();
  subs.add(fn);
  start();
  return () => {
    subs.delete(fn);
    if (!subs.size && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}
