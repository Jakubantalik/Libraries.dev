/* Build-time switch for the extra looks (`look="mosaic"` / `"dither"` /
   `"dots"` / `"lines"`). On by default since 0.4.0, for npm and the site;
   `VOICE_SURFACE=0 npm run build:voice` compiles them out (vite.config.ts). */
declare const __VOICE_SURFACE__: boolean;
