/* The Magnetic UI pull for React Native: every <MagneticView> is a small
   rigid body on a stiff damped string to its place, pulled toward a magnet
   held beside the phone; bodies collide, rest against the screen's rounded
   edge, and come back when it leaves. One field for the app, run on the JS
   thread; transforms are set through Animated values, without re-renders. */

import { forwardRef, useEffect, useImperativeHandle, useRef, type ComponentRef, type ForwardRefExoticComponent, type ReactNode, type RefAttributes } from "react";
import { AccessibilityInfo, Animated, Dimensions, StyleSheet, View, type ViewProps } from "react-native";
import { MagneticField, type Box } from "./core/field";
import { Magnet } from "./magnet";

export type ViewRef = ComponentRef<typeof View>;

type Body = {
  view: { current: ViewRef | null };
  x: Animated.Value;
  y: Animated.Value;
  r: Animated.Value;
  corner: number;
  box: Box | null;
};

const bodies = new Map<string, Body>();
let field: MagneticField | null = null;
let raf = 0;
let offFrames: (() => void) | null = null;
let reduceMotion = false;
let lastMeasure = 0;
let face = 1;
let faceAt = -1;
let nextId = 0;

AccessibilityInfo.isReduceMotionEnabled?.().then((v) => (reduceMotion = v)).catch(() => {});
AccessibilityInfo.addEventListener?.("reduceMotionChanged", (v) => (reduceMotion = v));

/** The shared field, to tune (stiffness, damping, force, reach, screenCorner…). */
export function getMagneticField(): MagneticField {
  if (!field) {
    field = new MagneticField();
    field.screenCorner = 44;
  }
  return field;
}

function measure(id: string) {
  const b = bodies.get(id);
  const p = field?.parts.get(id);
  // Measure only at rest: the transform would move the box.
  if (!b?.view.current || (p && !p.resting)) return;
  b.view.current.measureInWindow((x, y, w, h) => {
    if (w > 0 && h > 0) b.box = { left: x, top: y, right: x + w, bottom: y + h };
  });
}

function tick() {
  raf = requestAnimationFrame(tick);
  const f = getMagneticField();
  const now = performance.now() / 1000;
  // Layout moves without telling us (scrolling, keyboard): measure resting bodies now and then.
  if (now - lastMeasure > 0.5 && !f.active) {
    lastMeasure = now;
    bodies.forEach((_, id) => measure(id));
  }
  if (now - faceAt > 1) {
    faceAt = now;
    face = Magnet.getMagnet()?.face ?? 1;
  }
  for (const [id, b] of bodies) if (b.box) f.setHome(id, b.box, b.corner);
  const frame = Magnet.frame;
  const win = Dimensions.get("window");
  const screenBox: Box = { left: 0, top: 0, right: win.width, bottom: win.height };
  if (frame && !reduceMotion && performance.now() - Magnet.frameAt < 500) f.step(frame, now, screenBox, face);
  else f.relax(now);
  for (const [id, b] of bodies) {
    const p = f.parts.get(id);
    if (!p) continue;
    if (p.resting) {
      b.x.setValue(0); b.y.setValue(0); b.r.setValue(0);
    } else {
      b.x.setValue(p.ox); b.y.setValue(p.oy); b.r.setValue(p.angle);
    }
  }
}

function register(b: Body) {
  const id = String(nextId++);
  bodies.set(id, b);
  if (bodies.size === 1) {
    offFrames = Magnet.addFrameListener(() => {});
    raf = requestAnimationFrame(tick);
  }
  return {
    id,
    remove() {
      bodies.delete(id);
      field?.parts.delete(id);
      if (bodies.size === 0) {
        cancelAnimationFrame(raf);
        offFrames?.();
        offFrames = null;
      }
    },
  };
}

export type MagneticViewProps = ViewProps & {
  /** Corner radius used for collisions; defaults to the style's borderRadius. */
  corner?: number;
  /** Off: the view stays put. */
  enabled?: boolean;
  children?: ReactNode;
};

/** A View the magnet pulls. Put several on screen; they collide with each other. */
export const MagneticView: ForwardRefExoticComponent<MagneticViewProps & RefAttributes<ViewRef>> = forwardRef<ViewRef, MagneticViewProps>(function MagneticView(
  { corner, enabled = true, style, onLayout, children, ...rest },
  forwarded,
) {
  const view = useRef<ViewRef | null>(null);
  useImperativeHandle(forwarded, () => view.current as ViewRef);
  const anim = useRef({ x: new Animated.Value(0), y: new Animated.Value(0), r: new Animated.Value(0) }).current;
  const flat = StyleSheet.flatten(style) ?? {};
  const radius = corner ?? (typeof flat.borderRadius === "number" ? flat.borderRadius : 8);
  const reg = useRef<{ id: string; remove(): void } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const r = register({ view, x: anim.x, y: anim.y, r: anim.r, corner: radius, box: null });
    reg.current = r;
    measure(r.id);
    return () => {
      r.remove();
      reg.current = null;
      anim.x.setValue(0); anim.y.setValue(0); anim.r.setValue(0);
    };
  }, [enabled, radius, anim]);

  const rotate = anim.r.interpolate({ inputRange: [-1, 1], outputRange: ["-1rad", "1rad"] });
  const own = Array.isArray(flat.transform) ? flat.transform : [];
  return (
    <Animated.View
      ref={view}
      {...rest}
      style={[style, { transform: [{ translateX: anim.x }, { translateY: anim.y }, { rotate }, ...own] }]}
      onLayout={(e) => {
        if (reg.current) measure(reg.current.id);
        onLayout?.(e);
      }}
    >
      {children}
    </Animated.View>
  );
});
