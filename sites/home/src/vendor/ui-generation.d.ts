/* Types for the vendored transitions.dev UI-generation runtime
   (ui-generation.js, copied unchanged from transitions.dev's
   assets/ui-generation). */
export interface GenerateOptions {
  mode?: "skeleton" | "skeleton-texts";
  duration?: number;
  delay?: number;
  reveal?: "scan" | "fade";
  fadeDuration?: number | null;
  revealAt?: number | null;
  onDone?: ((el: Element) => void) | null;
}
export interface GenerateRun {
  finished: Promise<Element>;
  cancel: () => void;
  element: Element;
}
export function generate(el: Element | string, options?: GenerateOptions): GenerateRun;
export function auto(root?: ParentNode): void;
