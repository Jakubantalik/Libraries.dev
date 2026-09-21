// Imported first from index.ts so early (module-evaluation) errors log their stack.
const EU = (global as unknown as { ErrorUtils?: { getGlobalHandler?: () => ((e: Error, fatal?: boolean) => void) | undefined; setGlobalHandler?: (h: (e: Error, fatal?: boolean) => void) => void } }).ErrorUtils;
const previous = EU?.getGlobalHandler?.();
EU?.setGlobalHandler?.((e, fatal) => {
  console.log(`MFX_ERR fatal=${fatal} ${e?.message}\n${e?.stack}`);
  previous?.(e, fatal);
});
export {};
