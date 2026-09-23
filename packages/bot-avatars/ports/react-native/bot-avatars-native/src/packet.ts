/* One frame of one avatar, as numbers, in a flat array shared with the UI
   thread: the pose the rig produced, and (plastic) the cap's lighting
   frame the web's `capFrame` gives for it. */

/** floats per avatar in the packed frame array */
export const STRIDE = 40;

/** offsets inside an avatar's packet */
export const PK = {
  yaw: 0, pitch: 1, roll: 2, x: 3, y: 4, sx: 5, sy: 6, eyeOpen: 7, blinkL: 8, blinkR: 9,
  lookX: 10, lookY: 11, breath: 12, laugh: 13, whirl: 14, whirlAngle: 15, w0: 16, w1: 17, w2: 18,
  /** L, V, H, U, W, A, B: seven unit vectors, 21 floats */
  frame: 19,
} as const;

/* The canvas is drawn larger than the avatar's layout box, so a hop or a
   flip can leave the box without being clipped; the body's centre sits
   RISE of the box below the canvas centre. */
export const OVERSCAN = 1.5;
export const RISE = 0.1;
