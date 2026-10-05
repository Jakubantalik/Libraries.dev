/* Build-time switch for the surface looks (`look="dots"` / `"lines"`).
   Off in the default build — npm and the libraries.dev site — so the looks
   are compiled out until they ship; `VOICE_SURFACE=1 npm run build:voice`
   turns them on for local work (see vite.config.ts and LOOKS.md). */
declare const __VOICE_SURFACE__: boolean;
