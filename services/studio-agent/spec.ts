/* Studio agent — the parameter surface the agent is allowed to touch.
 *
 * One spec per library. It is the single source of truth for three things
 * that must never drift apart: the JSON Schema handed to the model, the
 * server-side validation of what comes back, and the prose the model reads
 * to know what a prop *means* ("duration" is not self-explanatory when the
 * request is "calmer").
 *
 * Ranges here mirror the Studio's own sliders exactly (see
 * sites/home/src/studio/beam.tsx). A range that drifts wider than the knob
 * lets the agent set a value the user cannot then nudge by hand.
 */

export type ParamSpec =
  | {
      kind: "number";
      /** Inclusive bounds, matching the knob. */
      min: number;
      max: number;
      /** Knob step. Applied values are snapped to it. */
      step: number;
      /** What this prop does, in the vocabulary a designer would use. */
      describe: string;
      /** Only meaningful while this predicate holds; see `relevant`. */
      when?: string;
    }
  | { kind: "enum"; values: readonly string[]; describe: string; when?: string }
  | { kind: "boolean"; describe: string; when?: string }
  /** Any #rgb / #rrggbb colour. The knob offers swatches plus a picker, so
      the agent gets the same reach: name a few good swatches in `describe`
      but accept any hex the request calls for. */
  | { kind: "color"; describe: string; when?: string }
  /** The library's core, as source the agent may rewrite: the orb's frame
      function, the beam's stylesheet, the goo filter chain, a fragment
      shader. `contract` is the whole brief for writing one — what it
      receives, what it must return, what it must keep. An empty string
      restores the stock core. Validation is static (size and a hygiene
      blocklist); the browser compiles it and reports a failure back on the
      next turn. */
  | { kind: "code"; lang: CodeLang; describe: string; contract: string; when?: string };

export type CodeLang = "js" | "css" | "glsl" | "svg";

export interface LibrarySpec {
  /** Display name, used in the system prompt. */
  label: string;
  /** One paragraph on what the library renders, so the model can reason
      about which props serve a mood word. */
  about: string;
  params: Record<string, ParamSpec>;
  /** Which params actually do something given the current settings. A prop
      that is inert right now is dropped from the schema entirely, so the
      model never spends a turn setting something with no visible effect. */
  relevant: (params: Record<string, unknown>) => string[];
}

export const BEAM_SPEC: LibrarySpec = {
  label: "Beam",
  about:
    "BorderBeam draws an animated light beam travelling around a card's border. " +
    "The 'rotate' family (types md, sm, line) sweeps a gradient around the edge; " +
    "the 'pulse' family (pulse-inner, pulse-outside) breathes a glow in or out from it. " +
    "Perceived calm comes mostly from duration (longer is calmer) and strength; " +
    "perceived warmth or coolness comes from hueShift and colorVariant; " +
    "perceived weight comes from brightness, saturation and the glow spreads. " +
    "Every type is built from three stacked layers, each with its own opacity multiplier: the stroke " +
    "(a crisp 1px hairline running along the card's edge), the inner glow (soft light hugging the edge) " +
    "and the bloom (the wide, diffuse outer halo). A request about one part of the glow — 'drop the thin " +
    "line', 'less halo', 'only the hairline' — is a per-layer move on those multipliers, not a strength change.",
  params: {
    size: {
      kind: "enum",
      values: ["md", "sm", "line", "pulse-inner", "pulse-outside"],
      describe:
        "Beam type. md = large rotating sweep, sm = small dot-lit card, line = thin travelling line, " +
        "pulse-inner = glow breathing inward, pulse-outside = glow blooming outward. " +
        "Changing this also switches family, so pick it first when the request is about the effect's character.",
    },
    colorVariant: {
      kind: "enum",
      values: ["colorful", "mono", "ocean", "sunset"],
      describe:
        "Palette. colorful = full spectrum, mono = single neutral, ocean = blues/teals (reads cool), " +
        "sunset = oranges/pinks (reads warm).",
    },
    strength: {
      kind: "number",
      min: 0,
      max: 100,
      step: 1,
      describe: "Overall intensity of the beam, in percent. Lower reads subtler and calmer.",
    },
    duration: {
      kind: "number",
      min: 0.5,
      max: 6,
      step: 0.02,
      describe:
        "Seconds for one full travel. This is the strongest lever on how frantic or calm the effect feels — " +
        "raise it for 'calmer', 'slower', 'more relaxed'; lower it for 'snappier', 'more urgent'.",
    },
    glowSize: {
      kind: "number",
      min: 0.25,
      max: 3,
      step: 0.05,
      describe:
        "Multiplies the blur radius of every glow layer. Below 1 reads tighter and crisper; above 1 the halo " +
        "spreads wider and softer.",
    },
    strokeOpacity: {
      kind: "number",
      min: 0,
      max: 2,
      step: 0.05,
      describe:
        "Opacity multiplier for the stroke layer — the crisp 1px hairline along the card's edge. " +
        "0 removes the hairline entirely and leaves only the soft glow; above 1 hardens the edge.",
    },
    innerOpacity: {
      kind: "number",
      min: 0,
      max: 2,
      step: 0.05,
      describe:
        "Opacity multiplier for the inner glow — the soft light hugging the edge just inside the hairline. " +
        "0 removes it; above 1 makes the edge read lit from within.",
    },
    bloomOpacity: {
      kind: "number",
      min: 0,
      max: 2,
      step: 0.05,
      describe:
        "Opacity multiplier for the bloom — the wide, diffuse outer halo. 0 removes the halo and keeps the " +
        "beam tight to the edge; above 1 spills more light onto the surroundings.",
    },
    brightness: {
      kind: "number",
      min: 0.5,
      max: 2.2,
      step: 0.05,
      describe: "Glow brightness multiplier. Above ~1.6 reads hot and attention-grabbing.",
    },
    saturation: {
      kind: "number",
      min: 0.4,
      max: 2.2,
      step: 0.05,
      describe: "Colour saturation multiplier. Low values read muted and expensive; high values read neon.",
    },
    hueRange: {
      kind: "number",
      min: 0,
      max: 120,
      step: 1,
      describe:
        "Degrees of hue the gradient spans. Narrow (under ~20) reads as one considered colour; " +
        "wide reads rainbow.",
      when: "staticColors is false",
    },
    hueShift: {
      kind: "number",
      min: -180,
      max: 180,
      step: 5,
      describe:
        "Rotates the whole palette, in degrees. Negative shifts toward cool blues/violets, " +
        "positive toward warm oranges/reds. The main lever for 'cooler' or 'warmer'.",
      when: "staticColors is false",
    },
    staticColors: {
      kind: "boolean",
      describe: "Freeze the palette instead of cycling hues. Reads calmer and more restrained.",
    },
    radius: {
      kind: "number",
      min: 0,
      max: 32,
      step: 1,
      describe: "Card corner radius in px. Higher reads softer and friendlier; 0 reads technical.",
    },
    spikes: {
      kind: "number",
      min: 0,
      max: 2,
      step: 0.05,
      describe: "How pronounced the line's leading spike is. 0 is a flat line, 2 is a sharp comet head.",
      when: "size is line",
    },
    glowSx: {
      kind: "number",
      min: 0.5,
      max: 2,
      step: 0.05,
      describe: "Horizontal spread of the pulse glow.",
      when: "size is pulse-inner or pulse-outside",
    },
    glowSy: {
      kind: "number",
      min: 0.5,
      max: 2,
      step: 0.05,
      describe: "Vertical spread of the pulse glow.",
      when: "size is pulse-inner or pulse-outside",
    },
    glowBoost: {
      kind: "number",
      min: 0.5,
      max: 2,
      step: 0.05,
      describe: "Overall gain on the pulse glow.",
      when: "size is pulse-inner or pulse-outside",
    },
    core: {
      kind: "code",
      lang: "css",
      describe:
        "The beam's stylesheet, rebuilt. Use it when the request changes what the beam IS — a different " +
        "shape of light, a layer the library does not draw, motion the knobs cannot express — while keeping " +
        "the selected type.",
      contract:
        "Write CSS that is appended after the library's generated stylesheet for this instance, so it can " +
        "override any rule or add new ones. Write {id} wherever the instance id belongs and it is " +
        "substituted per instance: the root is [data-beam=\"{id}\"], the light layers are its ::before " +
        "and ::after pseudo-elements plus the child [data-beam-bloom], and every keyframe is named " +
        "<name>-{id}. The stock stylesheet you are shown uses the same {id} placeholder. Keep the " +
        "--beam-* custom properties meaningful where you can (strength, hue, the per-layer opacities), " +
        "keep the layers pointer-events: none and inside the root, and keep to plain CSS: no url(), " +
        "@import or vendor hacks. Redefine a keyframe under the same name to change its motion.",
    },
    cardScale: {
      kind: "enum",
      values: ["s", "m", "l"],
      describe: "Preview card size. Cosmetic to the preview only — it is not a library prop.",
      when: "size is not sm",
    },
    active: {
      kind: "boolean",
      describe: "Whether the animation is running. Set false only if the user asks to pause or freeze it.",
    },
  },
  relevant(params) {
    const size = String(params.size ?? "md");
    const isPulse = size === "pulse-inner" || size === "pulse-outside";
    const staticColors = params.staticColors === true;
    const keys: string[] = [
      "size",
      "colorVariant",
      "strength",
      "duration",
      "glowSize",
      "strokeOpacity",
      "innerOpacity",
      "bloomOpacity",
      "brightness",
      "saturation",
      "staticColors",
      "radius",
      "active",
    ];
    keys.push("core");
    if (!staticColors) keys.push("hueRange", "hueShift");
    if (size === "line") keys.push("spikes");
    if (isPulse) keys.push("glowSx", "glowSy", "glowBoost");
    if (size !== "sm") keys.push("cardScale");
    return keys;
  },
};

export const ORB_SPEC: LibrarySpec = {
  label: "Orb",
  about:
    "ThinkingOrb is the small animated blob an assistant shows while it is working. " +
    "Nine hand-authored states each have their own character — the state is the effect, " +
    "not a parameter of it, so a request about what the orb is 'doing' usually means changing state. " +
    "Speed governs urgency, ink governs mood, dots governs how dense and busy it reads. " +
    "Beyond those, each state exposes its own engine knobs (listed with the state they apply to): the " +
    "orbit paths and particle count of working, the scan of searching, the wiring of connecting, the " +
    "plait of weaving, the sash of composing and breathing, and the outline of shaping — which can hold " +
    "a circle, triangle or square instead of cycling. A request for a shape the orb does not have " +
    "('square', 'triangle') means switching to shaping and holding that shape, in one call.",
  params: {
    state: {
      kind: "enum",
      values: [
        "working", "searching", "solving", "listening",
        "connecting", "weaving", "composing", "breathing", "shaping",
      ],
      describe:
        "The orb's animation. breathing is the calmest and most idle; listening is attentive and gentle; " +
        "working and solving read busy and effortful; searching and connecting sweep outward; " +
        "weaving, composing and shaping are the more intricate, crafted-looking ones. " +
        "Pick the state first when the request describes a mood or an activity.",
    },
    size: {
      kind: "enum",
      values: ["64", "32", "20"],
      describe:
        "Pixel size. 64 is the standalone orb and 20 the inline-with-text size, each hand-tuned; " +
        "32 is the compact avatar size interpolated between them. Nothing in between these three.",
    },
    speed: {
      kind: "number",
      min: 25,
      max: 300,
      step: 5,
      describe:
        "Animation speed as a percentage of normal. Below ~70 reads calm and deliberate, " +
        "above ~150 reads urgent or frantic. The main lever for 'calmer' and 'more energetic'.",
    },
    ink: {
      kind: "color",
      describe:
        "Ink colour as a hex value; the depth shading is kept on top of it. The panel's swatches are " +
        "#ededed neutral grey (stock, most restrained), #7cd4ff sky blue (cool, technical), #ffd28f amber (warm), " +
        "#ff9ec9 pink (playful), #9fe8a8 mint (fresh, calm) — but any hex works, so a named colour " +
        "('deep purple', 'brand red') gets the hex that matches it, not the nearest swatch.",
    },
    dots: {
      kind: "number",
      min: 0.4,
      max: 2,
      step: 0.05,
      describe:
        "Density multiplier for the particles. Below 1 reads sparse and minimal; above 1 reads dense and busy.",
    },
    dotSize: {
      kind: "number",
      min: 0.5,
      max: 2,
      step: 0.05,
      describe:
        "Radius multiplier for every dot. Below 1 reads finer and more delicate; above 1 reads bolder " +
        "and heavier. Independent of dots, which sets how many there are.",
    },
    shape: {
      kind: "enum",
      values: ["cycle", "circle", "triangle", "square"],
      describe:
        "What the dotted outline holds. cycle is the tuned circle → triangle → square loop; the other " +
        "three freeze on that one shape (it still breathes). The only way to get a square or triangle orb.",
      when: "state is shaping",
    },
    spread: {
      kind: "number",
      min: 0.8,
      max: 2,
      step: 0.05,
      describe: "How far the figure spreads from the centre — its overall footprint inside the canvas.",
      when: "state is shaping or connecting",
    },
    ghostOpacity: {
      kind: "number",
      min: 0,
      max: 1,
      step: 0.05,
      describe:
        "Opacity of the faint orbit paths the particles run on. 0 leaves only the moving particles, " +
        "which reads sparser and more mysterious; 1 draws the full cage of rings.",
      when: "state is working",
    },
    particles: {
      kind: "number",
      min: 1,
      max: 8,
      step: 1,
      describe: "Particles per orbit. More reads busier and more effortful.",
      when: "state is working",
    },
    scanSpeed: {
      kind: "number",
      min: 0.5,
      max: 8,
      step: 0.1,
      describe: "How fast the scan meridian sweeps the globe relative to its spin. Higher reads more urgent.",
      when: "state is searching",
    },
    scanDim: {
      kind: "number",
      min: 0.1,
      max: 1,
      step: 0.05,
      describe:
        "Brightness of the dots the scan is not touching. Low values fade the globe so only the sweep " +
        "reads; 1 shows the whole globe evenly.",
      when: "state is searching",
    },
    linkThreshold: {
      kind: "number",
      min: 0.3,
      max: 1.2,
      step: 0.02,
      describe:
        "How close two nodes must be to grow an edge. Low values give a sparse, barely-connected " +
        "constellation; high values a dense mesh.",
      when: "state is connecting",
    },
    signals: {
      kind: "number",
      min: 0,
      max: 12,
      step: 1,
      describe: "Bright packets running along the wiring. 0 is a still constellation.",
      when: "state is connecting",
    },
    lineWidth: {
      kind: "number",
      min: 0.3,
      max: 2.5,
      step: 0.1,
      describe: "Thickness of the edges between nodes.",
      when: "state is connecting",
    },
    turns: {
      kind: "number",
      min: 1,
      max: 6,
      step: 0.5,
      describe: "How many times each strand wraps pole to pole. Fewer reads looser; more reads tightly plaited.",
      when: "state is weaving",
    },
    wobble: {
      kind: "number",
      min: 0,
      max: 2.5,
      step: 0.05,
      describe:
        "Depth of the undulation running through the band. 0 is a clean, still band or ring; " +
        "high values read stormy.",
      when: "state is composing or breathing",
    },
    bandWidth: {
      kind: "number",
      min: 1,
      max: 6,
      step: 0.1,
      describe: "Width of the band, as a multiplier on its lanes. Narrow reads as a thin ring; wide as a sash.",
      when: "state is composing or breathing",
    },
    spin: {
      kind: "number",
      min: 0,
      max: 2,
      step: 0.05,
      describe:
        "3D tumble of the band's plane. 0 (the tuned default) keeps it fixed with only the undulation " +
        "travelling; above 0 sets the whole band precessing.",
      when: "state is composing or breathing",
    },
    paused: {
      kind: "boolean",
      describe: "Freeze the animation. Set true only if the user asks to pause or stop it.",
    },
    gravity: {
      kind: "boolean",
      describe:
        "The orb pulls at the pointer: as the cursor nears, the side of it facing the orb trails toward the " +
        "orb's centre — the pointer itself stays exactly where it is, nothing rotates or scales. An interaction " +
        "effect, not a look — turn it on when the request is about the cursor, hover, or the orb feeling " +
        "physical or magnetic.",
    },
    gravityReach: {
      kind: "number", min: 24, max: 240, step: 4,
      describe: "How far outside the orb's edge the pull is felt, in px.",
      when: "gravity is true",
    },
    gravityPull: {
      kind: "number", min: 0, max: 48, step: 1,
      describe: "How far the pointer trails toward the orb on contact, in px. The pointer itself never moves.",
      when: "gravity is true",
    },
    gravityBend: {
      kind: "number", min: 0, max: 24, step: 0.5,
      describe: "How far the pointer's body leans toward the orb on contact, in px. The tip stays pinned.",
      when: "gravity is true",
    },
    gravityTaper: {
      kind: "number", min: 1, max: 4, step: 0.05,
      describe: "How the bend is spread along the body: 1 bends evenly from the tip out; higher keeps the tip end firm and bends the far end hardest.",
      when: "gravity is true",
    },
    gravityCurve: {
      kind: "number", min: 1, max: 4, step: 0.05,
      describe: "How late the pull builds: higher keeps the pointer free until it is close, then grabs.",
      when: "gravity is true",
    },
    gravityFalloff: {
      kind: "number", min: 2, max: 120, step: 2,
      describe: "Width in px of the band across the pointer over which the tail fades from the side facing the orb to the far side: small keeps it to the facing edge, large lets the whole body trail.",
      when: "gravity is true",
    },
    gravityInertia: {
      kind: "number", min: 0, max: 1, step: 0.05,
      describe: "How much the pointer lags behind the pull. 0 follows instantly; higher reads heavier.",
      when: "gravity is true",
    },
    gravityHandover: {
      kind: "number", min: 0, max: 1, step: 0.05,
      describe: "How slowly the pull swings to the next orb when the nearest changes. 0 flips at once; higher glides.",
      when: "gravity is true",
    },
    gravitySquash: {
      kind: "number", min: 0, max: 3, step: 0.05,
      describe: "Extra bend and tail when the orb lies off the pointer tip's side (up-left), where the pull shortens the body and reads weaker than a stretch. 0 leaves both sides equal in pixels; higher evens the feel.",
      when: "gravity is true",
    },
    gravityBlur: {
      kind: "number", min: 0, max: 24, step: 0.5,
      describe: "Progressive blur along the pointer's tail, in px: crisp at the pointer, this soft at the far end. 0 keeps the tail sharp.",
      when: "gravity is true",
    },
    core: {
      kind: "code",
      lang: "js",
      describe:
        "The selected state's geometry, rebuilt as a new frame function. Use it when the request changes " +
        "what the orb IS — a cube instead of a sphere, a spiral, a different figure — while keeping the " +
        "selected state's character and motion. Prefer this over switching state.",
      contract:
        "Write the BODY of a JavaScript function with the signature (size, t, o, h): `size` is the canvas " +
        "size in CSS px, `t` the animation clock in seconds (already multiplied by the state's speed), `o` " +
        "the resolved draw options (the same keys the stock function reads — keep honouring them), and `h` " +
        "a helper object with finalizeFrame(dots, lines, rMin), makeProj(yaw, tilt, cx, cy, scale) -> " +
        "(x, y, z) => [px, py, z], radiusScale(size, pow), fibDir(i, n), hashD(a, b), vnoise(x, y), " +
        "lerp(a, b, f), frac(x) and angleDelta(a, b) — exactly the toolkit the stock function is written " +
        "with, called as h.finalizeFrame(...) and so on. Return h.finalizeFrame(dots, lines, o.rMin), where " +
        "each dot is {x, y, z, r, white, a?} in canvas pixels (white 0..1 is the ink value, 0 darkest on " +
        "paper; a is optional alpha) and each line is {x1, y1, x2, y2, white, a?, w}. Plain JavaScript, " +
        "no types, no imports, no DOM or globals, Math only; keep it under ~120 lines and start from the " +
        "stock source you are shown so the state's motion survives the new geometry.",
    },
  },
  relevant(params) {
    const state = String(params.state ?? "working");
    const keys = ["state", "size", "speed", "ink", "dots", "dotSize", "paused", "core", "gravity"];
    if (params.gravity === true) keys.push("gravityReach", "gravityPull", "gravityBend", "gravityTaper", "gravityCurve", "gravityFalloff", "gravityInertia", "gravityHandover", "gravitySquash", "gravityBlur");
    if (state === "shaping") keys.push("shape", "spread");
    if (state === "connecting") keys.push("spread", "linkThreshold", "signals", "lineWidth");
    if (state === "working") keys.push("ghostOpacity", "particles");
    if (state === "searching") keys.push("scanSpeed", "scanDim");
    if (state === "weaving") keys.push("turns");
    if (state === "composing" || state === "breathing") keys.push("wobble", "bandWidth", "spin");
    return keys;
  },
};

export const METAL_SPEC: LibrarySpec = {
  label: "Metal",
  about:
    "MetalFx renders a liquid-metal shader behind a button or a circular icon button, with a glow and " +
    "a reflection of nearby elements. Perceived expense comes from restraint — lower strength and glow " +
    "read more premium than the maximum, which reads like a demo.",
  params: {
    variant: {
      kind: "enum",
      values: ["button", "circle"],
      describe:
        "Shape. button is a wide pill with a label; circle is a round icon button. " +
        "Changing this resets shaderScale and ringCssPx to that shape's tuned baseline, so if you are " +
        "changing both, send the variant and the values you want in the same call.",
    },
    preset: {
      kind: "enum",
      values: ["chromatic", "silver", "gold"],
      describe:
        "Metal colour. chromatic is iridescent and colourful, silver is neutral and restrained (the most " +
        "'premium' of the three), gold is warm and showy.",
    },
    strength: {
      kind: "number",
      min: 0,
      max: 100,
      step: 1,
      describe:
        "Intensity of the metal effect, in percent. The single strongest lever on how loud the whole thing " +
        "reads — drop it for 'subtler', 'calmer', 'more premium'.",
    },
    shaderScale: {
      kind: "number",
      min: 0.6,
      max: 3,
      step: 0.05,
      describe:
        "Zoom on the shader pattern. Low values give large, slow, liquid shapes; high values give a fine, " +
        "busy, metallic grain. Baselines are 1.6 for button and 1.3 for circle.",
    },
    ring: {
      kind: "number",
      min: 0.5,
      max: 4,
      step: 0.25,
      describe:
        "Width of the bright rim around the edge, in px. Thicker reads chunkier and more toy-like; " +
        "thinner reads sharper. Baselines are 1 for button and 2 for circle.",
    },
    disableGlow: {
      kind: "boolean",
      describe: "Turn the glow off entirely. Reads flatter and more restrained than merely lowering it.",
    },
    disableReflection: {
      kind: "boolean",
      describe:
        "Stop reflecting nearby elements. The reflection is what sells the material, so turning it off " +
        "makes it read more like flat colour — only do this if asked.",
    },
    paused: {
      kind: "boolean",
      describe: "Freeze the shader. Set true only if the user asks to pause or stop it.",
    },
    core: {
      kind: "code",
      lang: "glsl",
      describe:
        "The metal's fragment shader, rebuilt. Use it when the request changes the material itself — a " +
        "different flow, pattern or lighting the knobs cannot express — while keeping the selected shape " +
        "and colour preset.",
      contract:
        "Write a complete WebGL 1 fragment shader (GLSL ES 1.00: `precision highp float;`, `gl_FragColor`, " +
        "`texture2D`). Keep every uniform declaration from the stock source with the same names and types " +
        "— the engine uploads exactly those — and keep writing gl_FragColor with alpha multiplied by " +
        "u_shaderOpacity so strength still works. Start from the stock source you are shown; it is the " +
        "material the presets were tuned on.",
    },
  },
  relevant(params) {
    const keys = [
      "variant", "preset", "strength", "shaderScale", "ring",
      "disableGlow", "disableReflection", "paused", "core",
    ];
    return keys;
  },
};

export const IMAGE_SPEC: LibrarySpec = {
  label: "Image",
  about:
    "ImageGeneration is the shader that plays while an image is being generated, then reveals it. " +
    "The preset is the effect's whole character; strength, speed and pixelScale tune it. " +
    "The card background is the colour the shader reasons against, so it changes the mood of the whole tile.",
  params: {
    preset: {
      kind: "enum",
      values: ["pixels-organic", "pixels-mechanic", "sweep-gradient"],
      describe:
        "The effect. pixels-organic is soft and cloud-like, pixels-mechanic is sharp and grid-locked " +
        "(reads technical), sweep-gradient is a smooth wash with no pixel structure (the calmest). " +
        "Pick this first when the request is about the effect's character rather than its intensity.",
    },
    strength: {
      kind: "number",
      min: 0,
      max: 100,
      step: 1,
      describe:
        "Effect intensity in percent, where 50 is the preset's own default look and 100 is its full boost. " +
        "Below 50 is subtler than the preset intends.",
    },
    speed: {
      kind: "number",
      min: 25,
      max: 300,
      step: 5,
      describe:
        "Animation speed as a percentage of normal. Lower reads calmer and more considered; " +
        "higher reads urgent.",
    },
    palette: {
      kind: "enum",
      values: ["preset", "ocean", "ember", "mono"],
      describe:
        "Colour override. preset keeps the effect's own palette; ocean is cool blues; ember is warm " +
        "oranges and reds; mono is greyscale (the most restrained). The lever for 'warmer' and 'cooler'.",
    },
    cardBg: {
      kind: "color",
      describe:
        "Card background the shader sits on, as a hex value. It shows as \"default\" while untouched — the " +
        "theme's own card colour (#242424 dark, #EEEEEF light). The panel's swatches are #1B1B1B neutral " +
        "charcoal, #101018 near-black ink (deepest), #1a2330 navy (cool), #241a2e plum (warm), but any hex " +
        "works. Keep it dark on the dark theme and light on the light one, or the reveal loses contrast.",
    },
    pixelScale: {
      kind: "number",
      min: 0.5,
      max: 2,
      step: 0.05,
      describe:
        "Size of the pixel cells. Below 1 gives finer, denser cells; above 1 gives chunkier, more obvious " +
        "blocks. Barely visible on sweep-gradient, which has no pixel structure.",
    },
    paused: {
      kind: "boolean",
      describe: "Freeze the animation. Set true only if the user asks to pause or stop it.",
    },
    core: {
      kind: "code",
      lang: "glsl",
      describe:
        "The effect's fragment shader, rebuilt. Use it when the request changes what the effect IS — a " +
        "different cell shape, a new pattern, a different reveal texture — while keeping the selected preset.",
      contract:
        "The stock shader you are shown has two halves: a prelude (uniforms, noise, palette, and " +
        "computeEffect(), which colours a point for the selected preset) and main(), which lays that " +
        "colour onto the card as the cell mosaic — grid, cell mask, highlight, edge fade, alpha. You send " +
        "ONLY the second half: your source must start at `void main() {` (any new helper functions you " +
        "need go before it, in your source) and it is appended after the stock prelude, so every uniform " +
        "and helper the prelude declares is already in scope — do not redeclare them. GLSL ES 1.00 " +
        "syntax (`gl_FragColor`; three.js adds the version line and precision — do not write them). Keep " +
        "writing gl_FragColor with alpha multiplied by u_shaderOpacity, keep computeEffect() as the colour " +
        "source and honour u_dotMode, u_cellSize and u_gap so the knobs still act. A different cell " +
        "shape, mask or layout is a rewrite of main()'s mosaic block; a different colour field is a new " +
        "helper called from main() in place of computeEffect().",
    },
  },
  relevant(params) {
    const keys = ["preset", "strength", "speed", "palette", "cardBg", "paused", "core"];
    // The gradient preset has no pixel grid for this to act on.
    if (params.preset !== "sweep-gradient") keys.push("pixelScale");
    return keys;
  },
};

export const GOOEY_SPEC: LibrarySpec = {
  label: "Gooey",
  about:
    "liquid-gooey makes elements behave like drops of liquid that merge and stretch. It has four distinct " +
    "effects and the effect decides which knobs exist at all: morph (a menu blooming out of a button), " +
    "move (a slider thumb that stretches and trails), bend (a card that bows as it is dragged), and " +
    "melt (two cards that fuse into one another). Surface knobs — blur, contrast, waviness, fill — are " +
    "shared by morph, move and bend; melt carries its own complete set instead. " +
    "Gooiness is blur and contrast together: more blur with less contrast reads soft and syrupy, " +
    "less blur with more contrast reads tight and beady.",
  params: {
    effect: {
      kind: "enum",
      values: ["morph", "move", "bend", "melt"],
      describe:
        "Which of the four effects is shown. This changes the entire knob set, so change it only when the " +
        "user is asking for a different effect, not merely a different feel.",
    },
    blur: {
      kind: "number",
      min: 0,
      max: 16,
      step: 0.5,
      describe: "Goo blur. Higher fuses shapes together sooner and reads softer and more liquid.",
      when: "effect is morph, move or bend",
    },
    contrast: {
      kind: "number",
      min: 4,
      max: 40,
      step: 1,
      describe:
        "Threshold sharpness of the goo. Higher gives crisp, defined edges; lower lets shapes stay hazy.",
      when: "effect is morph, move or bend",
    },
    waviness: {
      kind: "number",
      min: 0,
      max: 8,
      step: 0.5,
      describe: "Ripple along the liquid's edge. 0 is a clean contour; higher reads unstable and organic.",
      when: "effect is morph, move or bend",
    },
    fill: {
      kind: "enum",
      values: ["default", "#e9e9e9", "#7cd4ff", "#ffd28f"],
      describe:
        "Liquid colour. default is the effect's own dark surface, #e9e9e9 light grey, #7cd4ff sky (cool), " +
        "#ffd28f amber (warm). Use the literal value, not the name.",
      when: "effect is morph, move or bend",
    },
    morphDuration: {
      kind: "number",
      min: 80,
      max: 1200,
      step: 10,
      describe: "Milliseconds for the menu to open. Longer reads calmer and more deliberate.",
      when: "effect is morph",
    },
    morphEasing: {
      kind: "enum",
      values: ["Bouncy", "Smooth", "Snappy"],
      describe:
        "Opening curve. Bouncy overshoots and reads playful; Smooth is even and neutral; " +
        "Snappy decelerates hard and reads precise and expensive.",
      when: "effect is morph",
    },
    morphStagger: {
      kind: "number",
      min: 0,
      max: 200,
      step: 5,
      describe:
        "Milliseconds between each item appearing. 0 makes them arrive together; higher reads more " +
        "choreographed and unhurried.",
      when: "effect is morph",
    },
    morphSpread: {
      kind: "number",
      min: 0.4,
      max: 2,
      step: 0.05,
      describe: "How far the items travel from the button. Lower is tighter and more compact.",
      when: "effect is morph",
    },
    morphAnticipation: {
      kind: "number",
      min: 0,
      max: 24,
      step: 1,
      describe:
        "Pixels the items pull back before launching. Anticipation is what makes motion read " +
        "characterful rather than mechanical; 0 removes it entirely.",
      when: "effect is morph",
    },
    moveSpringiness: {
      kind: "number",
      min: 0,
      max: 1,
      step: 0.05,
      describe: "How much the thumb springs toward the cursor. Higher reads bouncier and more alive.",
      when: "effect is move",
    },
    moveWobble: {
      kind: "number",
      min: 0,
      max: 1,
      step: 0.05,
      describe: "Residual wobble after it settles. 0 stops dead; higher keeps jiggling.",
      when: "effect is move",
    },
    moveStretch: {
      kind: "number",
      min: 0,
      max: 1,
      step: 0.02,
      describe: "How far the liquid stretches while moving. The main lever on how gooey the drag feels.",
      when: "effect is move",
    },
    moveTrail: {
      kind: "number",
      min: 0,
      max: 1,
      step: 0.025,
      describe: "How much liquid is left trailing behind the thumb. Higher reads thicker and more viscous.",
      when: "effect is move",
    },
    bendVertical: {
      kind: "number",
      min: 0,
      max: 1,
      step: 0.05,
      describe: "How much the card bows along its vertical axis as it is dragged. Higher reads floppier.",
      when: "effect is bend",
    },
    bendHorizontal: {
      kind: "number",
      min: 0,
      max: 1,
      step: 0.05,
      describe: "How much the left and right edges curve. Higher reads rubbery.",
      when: "effect is bend",
    },
    bendContent: {
      kind: "number",
      min: 0,
      max: 1,
      step: 0.05,
      describe:
        "How much the content inside bends with the card. 0 keeps text flat and readable while the card " +
        "deforms around it.",
      when: "effect is bend",
    },
    meltBlur: {
      kind: "number",
      min: 0,
      max: 20,
      step: 0.5,
      describe: "Goo blur for melt. Higher makes the two cards fuse from further apart.",
      when: "effect is melt",
    },
    meltContrast: {
      kind: "number",
      min: 10,
      max: 80,
      step: 1,
      describe: "Edge sharpness of the melt. Higher gives a crisp boundary as they merge.",
      when: "effect is melt",
    },
    meltReach: {
      kind: "number",
      min: 0,
      max: 2,
      step: 0.05,
      describe: "Distance at which the cards start reaching for each other. Higher fuses them sooner.",
      when: "effect is melt",
    },
    meltFade: {
      kind: "number",
      min: 0,
      max: 40,
      step: 1,
      describe: "How softly the merged edge fades out. Higher reads more vaporous.",
      when: "effect is melt",
    },
    meltWarp: {
      kind: "number",
      min: 0,
      max: 40,
      step: 1,
      describe: "Distortion of the surfaces as they meet. 0 keeps them undistorted; higher reads molten.",
      when: "effect is melt",
    },
    meltMarbling: {
      kind: "number",
      min: 0,
      max: 1,
      step: 0.05,
      describe: "How much the two cards' contents swirl into each other rather than simply overlapping.",
      when: "effect is melt",
    },
    meltGravity: {
      kind: "number",
      min: 0,
      max: 4,
      step: 0.1,
      describe: "Downward pull on the liquid. Higher makes it sag and drip; 0 leaves it weightless.",
      when: "effect is melt",
    },
    core: {
      kind: "code",
      lang: "svg",
      describe:
        "The liquid's SVG filter chain, rebuilt. Use it when the request changes the surface itself — a " +
        "different edge, a texture, a lighting model, a shape the goo maths cannot make — while keeping " +
        "the selected effect.",
      contract:
        "Write the SVG filter primitives that replace the library's goo chain inside its <filter>. The " +
        "input is SourceGraphic (the crisp silhouettes of every piece); the LAST primitive's output is " +
        "what paints, so end with the result you want shown. The stock chain you are shown blurs, then " +
        "raises alpha contrast (the goo), then optionally displaces (waviness), then composites the " +
        "silhouette back and layers shadows; keep the result name `shape` for the merged silhouette if " +
        "you keep shadows, since inset and spread passes read a binarised copy of it. Only fe* elements " +
        "(feGaussianBlur, feColorMatrix, feComposite, feMorphology, feOffset, feFlood, feTurbulence, " +
        "feDisplacementMap, feDiffuseLighting, feSpecularLighting, feMerge/feMergeNode, feImage is NOT " +
        "allowed) with plain attributes — no scripts, no hrefs, no event attributes.",
    },
  },
  relevant(params) {
    const effect = String(params.effect ?? "morph");
    const keys = ["core", "effect"];
    if (effect !== "melt") keys.push("blur", "contrast", "waviness", "fill");
    if (effect === "morph") {
      keys.push("morphDuration", "morphEasing", "morphStagger", "morphSpread", "morphAnticipation");
    }
    if (effect === "move") keys.push("moveSpringiness", "moveWobble", "moveStretch", "moveTrail");
    if (effect === "bend") keys.push("bendVertical", "bendHorizontal", "bendContent");
    if (effect === "melt") {
      keys.push("meltBlur", "meltContrast", "meltReach", "meltFade", "meltWarp", "meltMarbling", "meltGravity");
    }
    return keys;
  },
};

export const SPECS: Record<string, LibrarySpec> = {
  beam: BEAM_SPEC,
  orb: ORB_SPEC,
  gooey: GOOEY_SPEC,
  metal: METAL_SPEC,
  image: IMAGE_SPEC,
};

/* JSON Schema for the set_params tool.
 *
 * Deliberately covers the *whole* parameter surface rather than only the
 * props that are live right now. Tools render at the very front of the
 * prompt-cache prefix, so a schema that narrowed itself as the user toggled
 * staticColors would invalidate the cache on every such turn and triple the
 * input cost. Which props are currently inert is told to the model in the
 * user turn instead — after the cache breakpoint, where it is free to vary —
 * and enforced by validate(). */
export function toolSchema(spec: LibrarySpec) {
  const properties: Record<string, unknown> = {};
  for (const [key, p] of Object.entries(spec.params)) {
    const description = p.when ? `${p.describe} (Only applies while ${p.when}.)` : p.describe;
    if (p.kind === "number") {
      properties[key] = { type: "number", minimum: p.min, maximum: p.max, description };
    } else if (p.kind === "enum") {
      properties[key] = { type: "string", enum: [...p.values], description };
    } else if (p.kind === "color") {
      properties[key] = { type: "string", pattern: HEX_COLOR.source, description };
    } else if (p.kind === "code") {
      properties[key] = {
        type: "string",
        description: `${description} Send the complete ${CODE_LABEL[p.lang]}; send "" to restore the stock core.`,
      };
    } else {
      properties[key] = { type: "boolean", description };
    }
  }
  /* Not `strict: true` either. Strict mode requires every property in
     `required`, which would force the model to restate all fifteen props on
     a turn that only moves duration — more tokens, and a far higher chance
     of it clobbering something the user tuned by hand. Correctness comes
     from validate() below instead, which also enforces the conditional
     rules ("spikes only on line") that JSON Schema cannot express here. */
  return { type: "object", properties, additionalProperties: false };
}

/** #rgb or #rrggbb — what every colour knob in the Studio produces. */
export const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const CODE_LABEL: Record<CodeLang, string> = {
  js: "JavaScript function body",
  css: "stylesheet",
  glsl: "fragment shader",
  svg: "SVG filter primitives",
};

/* Static hygiene only — the browser is where the code is compiled and run,
   and it reports a failure back on the next turn. Each blocklist names
   what has no business in that kind of core: the frame function must be
   pure math, the stylesheet must not fetch, the filter chain must be
   primitives only. */
export const CODE_MAX_CHARS = 24_000;
const CODE_FORBIDDEN: Record<CodeLang, RegExp> = {
  js: /\b(import|require|fetch|XMLHttpRequest|WebSocket|document|window|globalThis|self|eval|Function|localStorage|sessionStorage|indexedDB|navigator|postMessage|setTimeout|setInterval|Promise|async|await)\b|<\s*\/?\s*script/i,
  css: /url\s*\(|@import|expression\s*\(|behavior\s*:|-moz-binding|<\s*\/?\s*script/i,
  glsl: /<\s*\/?\s*script/i,
  svg: /<\s*script|<\s*\/?\s*(?!fe[A-Z])[a-zA-Z]+[\s>\/]|\son[a-z]+\s*=|href\s*=|xlink:/,
};

export function checkCode(lang: CodeLang, code: string): string | null {
  if (code.length > CODE_MAX_CHARS) return `longer than ${CODE_MAX_CHARS} characters`;
  const hit = code.match(CODE_FORBIDDEN[lang]);
  if (hit) return `must not contain ${JSON.stringify(hit[0].trim())}`;
  if (lang === "js" && !/\breturn\b/.test(code)) return "must return a frame";
  return null;
}

export interface Validated {
  applied: Record<string, unknown>;
  rejected: Array<{ key: string; reason: string }>;
}

/** Clamp, snap and drop. Never throws — the model gets told what was refused
    and can correct on the next turn. */
export function validate(
  spec: LibrarySpec,
  current: Record<string, unknown>,
  patch: Record<string, unknown>
): Validated {
  const live = new Set(spec.relevant(current));
  const applied: Record<string, unknown> = {};
  const rejected: Array<{ key: string; reason: string }> = [];

  for (const [key, raw] of Object.entries(patch)) {
    const p = spec.params[key];
    if (!p) {
      rejected.push({ key, reason: "not a parameter of this library" });
      continue;
    }
    if (!live.has(key)) {
      rejected.push({ key, reason: `inert with the current settings (${p.when ?? "unavailable"})` });
      continue;
    }
    if (p.kind === "number") {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) {
        rejected.push({ key, reason: "not a number" });
        continue;
      }
      const clamped = Math.min(p.max, Math.max(p.min, n));
      /* Snap to the knob's step so the slider lands on a real detent and the
         emitted snippet matches what the user sees. */
      const snapped = Math.round(clamped / p.step) * p.step;
      applied[key] = Number(snapped.toFixed(4));
    } else if (p.kind === "enum") {
      if (typeof raw !== "string" || !p.values.includes(raw)) {
        rejected.push({ key, reason: `must be one of ${p.values.join(", ")}` });
        continue;
      }
      applied[key] = raw;
    } else if (p.kind === "color") {
      if (typeof raw !== "string" || !HEX_COLOR.test(raw.trim())) {
        rejected.push({ key, reason: "must be a hex colour like #7cd4ff" });
        continue;
      }
      applied[key] = raw.trim().toLowerCase();
    } else if (p.kind === "code") {
      if (typeof raw !== "string") {
        rejected.push({ key, reason: "must be a string of source" });
        continue;
      }
      const code = raw.trim();
      const problem = code ? checkCode(p.lang, code) : null;
      if (problem) {
        rejected.push({ key, reason: problem });
        continue;
      }
      applied[key] = code;
    } else {
      if (typeof raw !== "boolean") {
        rejected.push({ key, reason: "must be true or false" });
        continue;
      }
      applied[key] = raw;
    }
  }
  return { applied, rejected };
}
