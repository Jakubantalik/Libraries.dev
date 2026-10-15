import { useEffect, useState } from "react";

/* The demo dev switches, shared between the panel that sets them and the
   rows that read them. Two of the three only write an attribute on
   <html> for the CSS; "arrange" needs React state in the row itself, so
   this little store carries all three. Dev only — the panel never
   renders on the public site. */

export type DemoFlagKey = "fill" | "names" | "arrange";

const state: Record<DemoFlagKey, boolean> = { fill: true, names: true, arrange: false };
/* bumped by the panel's Reset, so a row can drop what was dragged */
let resetAt = 0;
const subs = new Set<() => void>();

function announce() {
  for (const f of subs) f();
}

export const demoFlags = {
  read: (k: DemoFlagKey) => state[k],
  resetCount: () => resetAt,
  set(k: DemoFlagKey, on: boolean) {
    state[k] = on;
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute(`data-demo-${k}`, on ? "on" : "off");
    }
    announce();
  },
  reset() {
    resetAt += 1;
    this.set("fill", true);
    this.set("names", true);
    this.set("arrange", false);
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};

/** The flag's value, re-rendering the caller whenever the panel moves it. */
export function useDemoFlag(k: DemoFlagKey): boolean {
  const [on, setOn] = useState(() => state[k]);
  useEffect(() => demoFlags.subscribe(() => setOn(state[k])), [k]);
  return on;
}

/** How many times Reset has been pressed — a row clears its own state on a change. */
export function useDemoReset(): number {
  const [n, setN] = useState(() => resetAt);
  useEffect(() => demoFlags.subscribe(() => setN(resetAt)), []);
  return n;
}
