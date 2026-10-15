/* Studio agent — the browser's checks on a rebuilt core.
 *
 * The Worker only screens the source statically (size and a blocklist);
 * this is where it is actually parsed or compiled, on a scratch surface,
 * before it is allowed anywhere near the preview. Each check returns a
 * one-line reason on failure, which the chat shows and sends back on the
 * next turn so the model can fix it. */

export type CoreLang = "js" | "css" | "glsl" | "svg" | "path";

/** What a library hands the Agent tab so its core can be rebuilt. */
export interface CoreWiring {
  lang: CoreLang;
  /** The stock core source, as the browser runs it — sent every turn. */
  source: () => string;
  /** Parse / compile the candidate; null when it is fine. */
  check: (code: string) => string | null;
}

/* ── CSS ────────────────────────────────────────────────────────────── */

export function checkCss(code: string): string | null {
  if (/url\s*\(|@import/i.test(code)) return "no url() or @import in a beam stylesheet";
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(code.split("{id}").join("x"));
    if (!sheet.cssRules.length) return "no CSS rules parsed";
  } catch (e) {
    return `CSS did not parse: ${(e as Error).message}`;
  }
  return null;
}

/* ── SVG filter primitives ──────────────────────────────────────────── */

export function checkSvgFilter(code: string): string | null {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg"><filter>${code}</filter></svg>`,
    "image/svg+xml"
  );
  if (doc.querySelector("parsererror")) return "not well-formed SVG";
  const filter = doc.querySelector("filter");
  if (!filter || !filter.children.length) return "no filter primitives";
  for (const el of Array.from(filter.querySelectorAll("*"))) {
    if (!/^fe[A-Z]/.test(el.tagName) || el.tagName === "feImage") {
      return `<${el.tagName}> is not allowed — filter primitives only`;
    }
    for (const a of Array.from(el.attributes)) {
      if (/^on/i.test(a.name) || /href/i.test(a.name)) return `attribute ${a.name} is not allowed`;
    }
  }
  return null;
}

/* ── SVG path outline ───────────────────────────────────────────────── */

/* A bot's body outline: path data in the 100×100 body box. Path2D never
   throws on bad data — it silently drops the rest — so the outline is
   sampled on a grid instead: it must fill a real share of the box, stay
   inside it, and cover the point the face is drawn at. */
let pathCtx: CanvasRenderingContext2D | null | undefined;

export function checkPath(code: string, face: { x: number; y: number }): string | null {
  const bad = code.match(/[^MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]/);
  if (bad) return `${JSON.stringify(bad[0])} is not path data — send the d attribute only`;
  if (!/^\s*M/i.test(code)) return "path data must start with a moveto (M)";
  if (pathCtx === undefined) pathCtx = document.createElement("canvas").getContext("2d");
  const ctx = pathCtx;
  if (!ctx || typeof Path2D === "undefined") return null;
  let p: Path2D;
  try {
    p = new Path2D(code);
  } catch (e) {
    return `path did not parse: ${(e as Error).message}`;
  }
  let inside = 0;
  let outside = 0;
  for (let y = -30; y <= 130; y += 2) {
    for (let x = -30; x <= 130; x += 2) {
      if (!ctx.isPointInPath(p, x, y)) continue;
      if (x >= 0 && x <= 100 && y >= 0 && y <= 100) inside++;
      else outside++;
    }
  }
  if (inside < 250) return "the outline is empty or tiny — draw it roughly 70–90 units across in the 100×100 box";
  if (outside > inside * 0.03) return "the outline spills outside the 100×100 box — keep it inside 2..98";
  if (!ctx.isPointInPath(p, face.x, face.y)) {
    return `the face point (${face.x}, ${face.y}) falls outside the outline — keep the body solid round it`;
  }
  return null;
}

/* ── GLSL ───────────────────────────────────────────────────────────── */

/* three.js compiles GLSL 1.00-style source for WebGL2 by prefixing it: the
   version line, precision, the ES3 aliases for the old sampler and varying
   keywords, and the fragment output. The scratch compile mirrors that so
   what passes here is what three will accept. */
const THREE_ES3_PREFIX = `#version 300 es
precision highp float;
precision highp int;
#define varying in
#define gl_FragDepthEXT gl_FragDepth
#define texture2D texture
#define textureCube texture
#define texture2DProj textureProj
#define texture2DLodEXT textureLod
#define textureCubeLodEXT textureLod
layout(location = 0) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
uniform bool isOrthographic;
`;

let scratch: { gl1?: WebGLRenderingContext | null; gl2?: WebGL2RenderingContext | null } = {};

function scratchGl(webgl2: boolean): WebGLRenderingContext | WebGL2RenderingContext | null {
  const key = webgl2 ? "gl2" : "gl1";
  if (scratch[key] !== undefined) return scratch[key] ?? null;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext(webgl2 ? "webgl2" : "webgl") as
    | WebGLRenderingContext
    | WebGL2RenderingContext
    | null;
  scratch = { ...scratch, [key]: gl };
  return gl;
}

export function checkGlsl(code: string, opts: { three: boolean }): string | null {
  if (opts.three && /^\s*#version/m.test(code)) return "do not write a #version line — three.js adds it";
  if (!opts.three && !/gl_FragColor/.test(code)) return "a WebGL 1 fragment shader must write gl_FragColor";
  const gl = scratchGl(opts.three);
  if (!gl) return null; // no GL here — let the renderer be the judge
  const shader = gl.createShader(gl.FRAGMENT_SHADER);
  if (!shader) return null;
  gl.shaderSource(shader, opts.three ? THREE_ES3_PREFIX + code : code);
  gl.compileShader(shader);
  const ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS) as boolean;
  const log = ok ? "" : (gl.getShaderInfoLog(shader) ?? "").trim();
  gl.deleteShader(shader);
  if (ok) return null;
  /* three's prefix shifts line numbers; give the model the first error
     with the offset undone so it lands on its own source. */
  const offset = opts.three ? THREE_ES3_PREFIX.split("\n").length - 1 : 0;
  const first = log.split("\n")[0] ?? "compile failed";
  const fixed = first.replace(/ERROR: \d+:(\d+)/, (_, n) => `ERROR: line ${Math.max(1, Number(n) - offset)}`);
  return `shader did not compile: ${fixed}`;
}

/* ── snippets ───────────────────────────────────────────────────────── */

/** Indent every line of a block for embedding in a snippet. */
export function indent(code: string, spaces = 2): string {
  const pad = " ".repeat(spaces);
  return code
    .split("\n")
    .map((l) => (l.trim() ? pad + l : l))
    .join("\n");
}

/** Wrap a core in a template literal, escaping what would end it early. */
export function tpl(code: string): string {
  return "`" + code.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`";
}
