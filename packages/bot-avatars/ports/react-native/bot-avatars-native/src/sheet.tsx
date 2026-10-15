/* One canvas for a roster. Every `<BotAvatar>` inside a `<BotAvatarSheet>`
   lays out as usual but draws nothing of its own: its picture is placed on
   the sheet's single canvas at the avatar's measured position. A roster
   then costs one layer to composite instead of one per avatar — on the
   iOS Simulator, whose compositor is the slow part with many Metal
   layers, eighteen avatars go from about 30 fps to 60 with it. */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Canvas, Picture, type SkPicture } from '@shopify/react-native-skia';
import type { SharedValue } from 'react-native-reanimated';
import { OVERSCAN, RISE } from './packet';

interface Entry {
  key: string;
  /** null until the avatar registers (a layout can be measured first) */
  picture: SharedValue<SkPicture> | null;
  size: number;
  x: number;
  y: number;
}

export interface SheetApi {
  ref: RefObject<View | null>;
  register(key: string, picture: SharedValue<SkPicture>, size: number): void;
  place(key: string, x: number, y: number): void;
  unregister(key: string): void;
}

export const SheetContext = createContext<SheetApi | null>(null);
export const useBotAvatarSheet = () => useContext(SheetContext);

export interface BotAvatarSheetProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function BotAvatarSheet({ children, style }: BotAvatarSheetProps) {
  const ref = useRef<View>(null);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [box, setBox] = useState({ width: 0, height: 0 });
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (b.width === width && b.height === height ? b : { width, height }));
  }, []);
  const api = useMemo<SheetApi>(
    () => ({
      ref,
      register: (key, picture, size) => setEntries((e) => ({ ...e, [key]: { key, picture, size, x: e[key]?.x ?? 0, y: e[key]?.y ?? 0 } })),
      place: (key, x, y) =>
        setEntries((e) => {
          const en = e[key];
          if (en && en.x === x && en.y === y) return e;
          return { ...e, [key]: { key, picture: en?.picture ?? null, size: en?.size ?? 0, x, y } };
        }),
      unregister: (key) =>
        setEntries((e) => {
          if (!e[key]) return e;
          const next = { ...e };
          delete next[key];
          return next;
        }),
    }),
    []
  );
  const list = Object.values(entries).filter((en) => en.picture !== null);
  return (
    <SheetContext.Provider value={api}>
      <View ref={ref} style={style} onLayout={onLayout}>
        {children}
        {box.width > 0 && box.height > 0 && (
          <Canvas style={{ position: 'absolute', left: 0, top: 0, width: box.width, height: box.height }} pointerEvents="none" opaque={false}>
            {list.map((en) => {
              const side = ((OVERSCAN - 1) / 2) * en.size;
              return <Picture key={en.key} picture={en.picture as SharedValue<SkPicture>} transform={[{ translateX: en.x - side }, { translateY: en.y - side - RISE * en.size }]} />;
            })}
          </Canvas>
        )}
      </View>
    </SheetContext.Provider>
  );
}
