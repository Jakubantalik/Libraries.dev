import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Canvas, Picture, Skia, ImageFormat, type SkPicture } from '@shopify/react-native-skia';
import { runOnJS, useFrameCallback } from 'react-native-reanimated';
import { File, Paths } from 'expo-file-system';
import {
  BotAvatar,
  BotAvatarSheet,
  botAvatarTypes,
  botAvatarPresets,
  restPose,
  resolveBotAvatarConfig,
  resourcesFor,
  drawBotAvatarPose,
  readBotAvatarUiStats,
  jsStats,
  bakeLog,
  formFormat,
  bakeRawForm,
  type BotAvatarHandle,
  type BotAvatarProps,
  type BotAvatarType,
  type BotAvatarFace,
  type BotAvatarState,
  type BotAvatarShading,
  type BotAvatarSquashEase,
} from 'bot-avatars-native';

/**
 * bot-avatars on the phone: a grid of the eighteen types (tap one to make it
 * hop; drag a finger over the grid and they all look at it), a controls
 * screen with every prop, and the reference grid the web renderer's
 * screenshots are compared against.
 */
type Tab = 'grid' | 'controls' | 'reference';

/* driven from outside for the checks: `<scheme>://?tab=reference&export=1`
   (xcrun simctl openurl) switches the screen and, on the reference screen,
   writes the grid PNG; `state`, `size`, `face` and `whirl` reach the grid */
const remote: { params: Record<string, string>; listeners: Set<() => void> } = { params: {}, listeners: new Set() };
function onUrl(url: string | null) {
  if (!url) return;
  const q = url.split('?')[1] ?? '';
  const params: Record<string, string> = {};
  q.split('&').forEach((kv) => {
    const [k, v] = kv.split('=');
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
  });
  remote.params = params;
  remote.listeners.forEach((fn) => fn());
}
function useRemote(fn: (p: Record<string, string>) => void) {
  useEffect(() => {
    const l = () => fn(remote.params);
    remote.listeners.add(l);
    /* a screen that mounts because of the URL still sees its parameters */
    l();
    return () => {
      remote.listeners.delete(l);
    };
  }, [fn]);
}

export default function App() {
  const [tab, setTab] = useState<Tab>('grid');
  useEffect(() => {
    Linking.getInitialURL().then(onUrl);
    const sub = Linking.addEventListener('url', (e) => onUrl(e.url));
    return () => sub.remove();
  }, []);
  useRemote(
    useCallback((p) => {
      if (p.tab === 'grid' || p.tab === 'controls' || p.tab === 'reference') setTab(p.tab);
    }, [])
  );
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.tabs}>
        {(['grid', 'controls', 'reference'] as Tab[]).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabOn]}>
            <Text style={[styles.tabLabel, tab === t && styles.tabLabelOn]}>{t[0].toUpperCase() + t.slice(1)}</Text>
          </Pressable>
        ))}
      </View>
      {tab === 'grid' && <GridScreen />}
      {tab === 'controls' && <ControlsScreen />}
      {tab === 'reference' && <ReferenceScreen />}
    </View>
  );
}

/* ── the frame costs, read once a second ───────────────────────────── */

interface Stats {
  fps: number;
  uiMs: number;
  jsMs: number;
  flushMs: number;
  rebuilds: number;
  avatars: number;
}
function useStats(): Stats {
  const [stats, setStats] = useState<Stats>({ fps: 0, uiMs: 0, jsMs: 0, flushMs: 0, rebuilds: 0, avatars: 0 });
  const report = useCallback((fps: number, uiFrames: number, uiMs: number, rebuilds: number) => {
    const js = jsStats;
    const avatars = js.frames ? js.avatars / js.frames : 0;
    setStats({ fps, uiMs: uiFrames ? uiMs / uiFrames : 0, jsMs: js.avatars ? js.ms / js.avatars : 0, flushMs: js.frames ? js.flushMs / js.frames : 0, rebuilds: uiFrames ? rebuilds / uiFrames : 0, avatars });
    js.frames = 0;
    js.ms = 0;
    js.avatars = 0;
    js.flushMs = 0;
  }, []);
  useFrameCallback((info) => {
    'worklet';
    const g = globalThis as unknown as { __baFrames?: number; __baSince?: number };
    g.__baFrames = (g.__baFrames ?? 0) + 1;
    if (g.__baSince === undefined) g.__baSince = info.timestamp;
    const elapsed = info.timestamp - g.__baSince;
    if (elapsed >= 1000) {
      const ui = readBotAvatarUiStats();
      runOnJS(report)((g.__baFrames * 1000) / elapsed, ui.frames, ui.ms, ui.rebuilds);
      g.__baFrames = 0;
      g.__baSince = info.timestamp;
    }
  });
  return stats;
}

function StatsBar({ stats }: { stats: Stats }) {
  const last = bakeLog[bakeLog.length - 1];
  return (
    <Text style={styles.stats}>
      {stats.fps.toFixed(0)} fps · UI record {stats.uiMs.toFixed(3)} ms/avatar ({(stats.rebuilds * 100).toFixed(0)} % with a lighting rebuild) · JS sim+pack {stats.jsMs.toFixed(3)} ms/avatar, hand-over {stats.flushMs.toFixed(2)} ms/frame · {stats.avatars.toFixed(0)} animating
      {last ? ` · last bake ${last.ms} ms (${formFormat})` : ''}
    </Text>
  );
}

/* ── grid ──────────────────────────────────────────────────────────── */

function GridScreen() {
  const [state, setState] = useState<BotAvatarState>('default');
  const [whirl, setWhirl] = useState(0);
  const [face, setFace] = useState<BotAvatarFace | undefined>(undefined);
  const refs = useRef<(BotAvatarHandle | null)[]>([]);
  const stats = useStats();
  const [size, setSize] = useState(96);
  const [shading, setShading] = useState<BotAvatarShading>('plastic');
  const [count, setCount] = useState(18);
  const [sheet, setSheet] = useState(true);
  const [sides, setSides] = useState<'auto' | 'vector' | 'sprite'>('auto');
  /* drag anywhere on the grid: every avatar looks at the finger */
  const look = (e: GestureResponderEvent) => refs.current.forEach((r) => r?.lookAt(e.nativeEvent.pageX, e.nativeEvent.pageY));
  const letGo = () => refs.current.forEach((r) => r?.lookAt(null));
  const dragging = useRef(false);
  useRemote(
    useCallback((p) => {
      if (p.state) setState(p.state as BotAvatarState);
      if (p.size) setSize(Number(p.size));
      if (p.face) setFace(p.face as BotAvatarFace);
      if (p.whirl) setWhirl(Number(p.whirl));
      if (p.shading) setShading(p.shading as BotAvatarShading);
      if (p.count) setCount(Number(p.count));
      if (p.sheet) setSheet(p.sheet === '1');
      if (p.sides) setSides(p.sides as 'auto' | 'vector' | 'sprite');
      if (p.poke) {
        delete remote.params.poke;
        refs.current.forEach((r) => r?.poke());
      }
    }, [])
  );
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.row}>
        <Segmented options={['default', 'working', 'sleeping']} value={state} onChange={(v) => setState(v as BotAvatarState)} />
        <Segmented options={['eyes', 'mouth']} value={face ?? 'eyes'} onChange={(v) => setFace(v as BotAvatarFace)} />
      </View>
      <View style={styles.row}>
        <Segmented options={['whirl off', 'whirl on']} value={whirl ? 'whirl on' : 'whirl off'} onChange={(v) => setWhirl(v === 'whirl on' ? 1 : 0)} />
        <Segmented options={['64', '96', '128']} value={String(size)} onChange={(v) => setSize(Number(v))} />
        <Segmented options={['one canvas', 'a canvas each']} value={sheet ? 'one canvas' : 'a canvas each'} onChange={(v) => setSheet(v === 'one canvas')} />
        <Segmented options={['sprite sides', 'vector sides']} value={sides === 'vector' ? 'vector sides' : 'sprite sides'} onChange={(v) => setSides(v === 'vector sides' ? 'vector' : 'sprite')} />
      </View>
      <ScrollView
        contentContainerStyle={styles.grid}
        scrollEnabled={!dragging.current}
        onMoveShouldSetResponderCapture={() => false}
      >
        <Grid sheet={sheet}
          style={styles.gridInner}
          onStartShouldSetResponder={() => false}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(e) => {
            dragging.current = true;
            look(e);
          }}
          onResponderMove={look}
          onResponderRelease={() => {
            dragging.current = false;
            letGo();
          }}
          onResponderTerminate={() => {
            dragging.current = false;
            letGo();
          }}
        >
          {botAvatarTypes.slice(0, count).map((type, i) => (
            <View key={type} style={[styles.cell, { width: size + 16 }]}>
              <BotAvatar ref={(r) => {
                refs.current[i] = r;
              }} type={type} state={state} size={size} whirl={whirl} face={face} shading={shading} sides={sides} />
              <Text style={styles.cellLabel}>{botAvatarPresets[type].label}</Text>
            </View>
          ))}
        </Grid>
      </ScrollView>
      <StatsBar stats={stats} />
    </View>
  );
}

/* the roster's container: the sheet (one canvas for all) or a plain view */
function Grid({ sheet, ...rest }: { sheet: boolean } & React.ComponentProps<typeof View>) {
  return sheet ? (
    <BotAvatarSheet>
      <View {...rest} />
    </BotAvatarSheet>
  ) : (
    <View {...rest} />
  );
}

/* ── controls ──────────────────────────────────────────────────────── */

function ControlsScreen() {
  const [p, setP] = useState<BotAvatarProps>({ type: 'clover', state: 'default', size: 160, shading: 'plastic', whirl: 0 });
  const set = <K extends keyof BotAvatarProps>(k: K, v: BotAvatarProps[K]) => setP((o) => ({ ...o, [k]: v }));
  const stats = useStats();
  const num = (k: keyof BotAvatarProps, fallback: number) => (typeof p[k] === 'number' ? (p[k] as number) : fallback);
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.stage}>
        <BotAvatar {...p} />
      </View>
      <ScrollView contentContainerStyle={styles.controls}>
        <Label>Type</Label>
        <Wrap>
          {botAvatarTypes.map((t) => (
            <Chip key={t} label={botAvatarPresets[t].label} on={p.type === t} onPress={() => set('type', t as BotAvatarType)} />
          ))}
        </Wrap>
        <Label>Face · state · shading</Label>
        <Segmented options={['eyes', 'mouth']} value={p.face ?? botAvatarPresets[p.type ?? 'clover'].face} onChange={(v) => set('face', v as BotAvatarFace)} />
        <Segmented options={['default', 'working', 'sleeping']} value={p.state ?? 'default'} onChange={(v) => set('state', v as BotAvatarState)} />
        <Segmented options={['plastic', 'crisp', 'smooth', 'flat']} value={(p.shading as string) ?? 'plastic'} onChange={(v) => set('shading', v as BotAvatarShading)} />
        <Segmented options={['animated', 'paused']} value={p.paused ? 'paused' : 'animated'} onChange={(v) => set('paused', v === 'paused')} />
        <Label>Size · material</Label>
        <Slider label="size" value={num('size', 160)} min={24} max={240} step={1} onChange={(v) => set('size', v)} />
        <Slider label="brightness" value={num('brightness', 1)} min={0.5} max={1.5} onChange={(v) => set('brightness', v)} />
        <Slider label="saturation" value={num('saturation', 1.5)} min={0.5} max={2} onChange={(v) => set('saturation', v)} />
        <Slider label="shadow" value={num('shadow', 0.35)} min={0} max={2} onChange={(v) => set('shadow', v)} />
        <Slider label="highlight" value={num('highlight', 1.3)} min={0} max={2} onChange={(v) => set('highlight', v)} />
        <Slider label="depth" value={num('depth', 0.65)} min={0.2} max={2} onChange={(v) => set('depth', v)} />
        <Slider label="light" value={num('light', 265)} min={0} max={360} step={1} onChange={(v) => set('light', v)} />
        <Slider label="rim" value={num('rim', 0.5)} min={0} max={2} onChange={(v) => set('rim', v)} />
        <Slider label="spread" value={num('spread', 1.55)} min={0.4} max={2.5} onChange={(v) => set('spread', v)} />
        <Slider label="speed" value={num('speed', 1)} min={0} max={3} onChange={(v) => set('speed', v)} />
        <Label>Whirl</Label>
        <Slider label="whirl" value={num('whirl', 0)} min={0} max={2} onChange={(v) => set('whirl', v)} />
        <Slider label="whirlSize" value={num('whirlSize', 1)} min={0.6} max={1.6} onChange={(v) => set('whirlSize', v)} />
        <Slider label="whirlWidth" value={num('whirlWidth', 1)} min={0.4} max={2} onChange={(v) => set('whirlWidth', v)} />
        <Slider label="whirlLength" value={num('whirlLength', 1)} min={0.4} max={1.6} onChange={(v) => set('whirlLength', v)} />
        <Slider label="whirlTilt" value={num('whirlTilt', 1)} min={0.5} max={1.8} onChange={(v) => set('whirlTilt', v)} />
        <Label>The jump (tap the avatar)</Label>
        <Slider label="jumpHeight" value={num('jumpHeight', 26)} min={0} max={60} step={1} onChange={(v) => set('jumpHeight', v)} />
        <Slider label="jumpTime" value={num('jumpTime', 0.68)} min={0.2} max={1.6} onChange={(v) => set('jumpTime', v)} />
        <Slider label="jumpStretch" value={num('jumpStretch', 1)} min={0} max={2} onChange={(v) => set('jumpStretch', v)} />
        <Slider label="jumpSquash" value={num('jumpSquash', 1.15)} min={0} max={2} onChange={(v) => set('jumpSquash', v)} />
        <Slider label="jumpSquashTime" value={num('jumpSquashTime', 0.37)} min={0.05} max={1} onChange={(v) => set('jumpSquashTime', v)} />
        <Segmented options={['sharp', 'pulse', 'soft', 'bouncy']} value={p.jumpSquashEase ?? 'pulse'} onChange={(v) => set('jumpSquashEase', v as BotAvatarSquashEase)} />
        <Slider label="jumpClickSquashTime" value={num('jumpClickSquashTime', 0.24)} min={0.05} max={1} onChange={(v) => set('jumpClickSquashTime', v)} />
        <Slider label="jumpSpin" value={num('jumpSpin', 1)} min={0} max={2} step={1} onChange={(v) => set('jumpSpin', v)} />
        <Slider label="jumpLean" value={num('jumpLean', 6)} min={0} max={30} step={1} onChange={(v) => set('jumpLean', v)} />
        <Slider label="jumpEvery" value={num('jumpEvery', 8)} min={0} max={20} step={0.5} onChange={(v) => set('jumpEvery', v)} />
        <Slider label="jumpLand" value={num('jumpLand', 0)} min={-0.2} max={0.2} onChange={(v) => set('jumpLand', v)} />
      </ScrollView>
      <StatsBar stats={stats} />
    </View>
  );
}

/* ── the reference grid ────────────────────────────────────────────── */

/* 18 columns = the types in order; 5 rows: idle rest with eyes; yaw 0.6
   pitch 0.2; yaw −0.9 pitch −0.25 roll 0.1 with the mouth; sleeping rest
   with the mouth; working rest with yaw 0.3 and the mouth. Box 96 at a
   device scale of 2 → 288 px tiles, the web reference's geometry. */
const REF_BOX = 96;
const REF_SCALE = 2;
const REF_ROWS: { state: BotAvatarState; face: BotAvatarFace; yaw?: number; pitch?: number; roll?: number }[] = [
  { state: 'default', face: 'eyes' },
  { state: 'default', face: 'eyes', yaw: 0.6, pitch: 0.2 },
  { state: 'default', face: 'mouth', yaw: -0.9, pitch: -0.25, roll: 0.1 },
  { state: 'sleeping', face: 'mouth' },
  { state: 'working', face: 'mouth', yaw: 0.3 },
];

function recordReference(scale: number): SkPicture {
  const tile = REF_BOX * 1.5;
  const rec = Skia.PictureRecorder();
  const c = rec.beginRecording({ x: 0, y: 0, width: tile * 18 * scale, height: tile * 5 * scale });
  c.scale(scale, scale);
  REF_ROWS.forEach((row, r) => {
    botAvatarTypes.forEach((type, col) => {
      const cfg = resolveBotAvatarConfig({ type, face: row.face }, REF_BOX * REF_SCALE);
      const res = resourcesFor(type, REF_BOX * REF_SCALE, 0.65, true, true);
      const pose = restPose(row.state);
      pose.yaw = row.yaw ?? 0;
      if (row.pitch !== undefined) pose.pitch = row.pitch;
      if (row.roll !== undefined) pose.roll = row.roll;
      c.save();
      c.translate(col * tile, r * tile);
      drawBotAvatarPose(c, REF_BOX, pose, cfg, res, `ref:${type}`);
      c.restore();
    });
  });
  return rec.finishRecordingAsPicture();
}

function ReferenceScreen() {
  const [note, setNote] = useState('');
  /* on screen at box 64: 96-pt tiles, 288 device px at 3× — the reference's pixel size */
  const picture = useMemo(() => recordReference(1), []);
  const tile = REF_BOX * 1.5;
  const onScreen = 2 / 3;
  const exportPng = () => {
    const t0 = Date.now();
    const w = tile * 18 * REF_SCALE, h = tile * 5 * REF_SCALE;
    const surface = Skia.Surface.MakeOffscreen(w, h);
    if (!surface) return setNote('no offscreen surface');
    const c = surface.getCanvas();
    c.clear(Skia.Color('#1a1a1a'));
    c.drawPicture(recordReference(REF_SCALE));
    surface.flush();
    const bytes = surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG);
    const file = new File(Paths.document, 'reference-grid.png');
    file.write(bytes);
    setNote(`wrote ${file.uri} (${w}×${h}, ${bytes.length} bytes, ${Date.now() - t0} ms)`);
  };
  const exportRef = useRef(exportPng);
  exportRef.current = exportPng;
  useRemote(
    useCallback((p) => {
      if (p.export === 'form') {
        delete remote.params.export;
        const raw = bakeRawForm((p.type as BotAvatarType) ?? 'blob', Number(p.n ?? 96), 15 * 0.65);
        new File(Paths.document, 'form.json').write(JSON.stringify(raw));
      } else if (p.export) {
        delete remote.params.export;
        setTimeout(() => exportRef.current(), 300);
      }
    }, [])
  );
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.row}>
        <Chip label="Export PNG to Documents" on={false} onPress={exportPng} />
      </View>
      {!!note && <Text style={styles.note}>{note}</Text>}
      <ScrollView horizontal>
        <ScrollView>
          <Canvas style={{ width: tile * 18 * onScreen, height: tile * 5 * onScreen, backgroundColor: '#1a1a1a' }}>
            <Picture picture={picture} transform={[{ scale: onScreen }]} />
          </Canvas>
        </ScrollView>
      </ScrollView>
    </View>
  );
}

/* ── bits ──────────────────────────────────────────────────────────── */

function Label({ children }: { children: string }) {
  return <Text style={styles.label}>{children}</Text>;
}
function Wrap({ children }: { children: React.ReactNode }) {
  return <View style={styles.wrap}>{children}</View>;
}
function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{label}</Text>
    </Pressable>
  );
}
function Segmented({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => (
        <Pressable key={o} onPress={() => onChange(o)} style={[styles.segment, value === o && styles.segmentOn]}>
          <Text style={[styles.segmentLabel, value === o && styles.segmentLabelOn]}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}
function Slider({ label, value, min, max, step = 0.01, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  const [width, setWidth] = useState(1);
  const at = (x: number) => {
    const t = Math.max(0, Math.min(1, x / width));
    const v = min + t * (max - min);
    onChange(Math.round(v / step) * step);
  };
  const t = (value - min) / (max - min);
  return (
    <View style={styles.slider}>
      <Text style={styles.sliderLabel}>
        {label} <Text style={styles.sliderValue}>{Number.isInteger(step) ? value.toFixed(0) : value.toFixed(2)}</Text>
      </Text>
      <View
        style={styles.track}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => at(e.nativeEvent.locationX)}
        onResponderMove={(e) => at(e.nativeEvent.locationX)}
      >
        <View style={[styles.fill, { width: `${Math.max(0, Math.min(1, t)) * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1a1a1a', paddingTop: 56 },
  tabs: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 8 },
  tab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: '#262626' },
  tabOn: { backgroundColor: '#f4f2fa' },
  tabLabel: { color: '#bbb', fontSize: 14, fontWeight: '600' },
  tabLabelOn: { color: '#1a1a1a' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  grid: { paddingBottom: 40 },
  gridInner: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: 8, paddingTop: 24, rowGap: 28 },
  cell: { alignItems: 'center', gap: 6 },
  cellLabel: { color: '#8a8a8a', fontSize: 11, marginTop: 8 },
  stats: { color: '#8a8a8a', fontSize: 11, paddingHorizontal: 16, paddingVertical: 10, fontVariant: ['tabular-nums'] },
  stage: { height: 260, alignItems: 'center', justifyContent: 'center' },
  controls: { paddingHorizontal: 16, paddingBottom: 40, gap: 8 },
  label: { color: '#8a8a8a', fontSize: 12, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.6 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: '#262626' },
  chipOn: { backgroundColor: '#35B8FF' },
  chipLabel: { color: '#ccc', fontSize: 12 },
  chipLabelOn: { color: '#0b1a24' },
  segmented: { flexDirection: 'row', backgroundColor: '#262626', borderRadius: 10, padding: 3, alignSelf: 'flex-start' },
  segment: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  segmentOn: { backgroundColor: '#3a3a3a' },
  segmentLabel: { color: '#aaa', fontSize: 12 },
  segmentLabelOn: { color: '#fff' },
  slider: { gap: 4 },
  sliderLabel: { color: '#bbb', fontSize: 12 },
  sliderValue: { color: '#fff', fontVariant: ['tabular-nums'] },
  track: { height: 28, borderRadius: 8, backgroundColor: '#262626', overflow: 'hidden', justifyContent: 'center' },
  fill: { height: 28, backgroundColor: '#3f5f73' },
  note: { color: '#8a8a8a', fontSize: 11, paddingHorizontal: 16, paddingBottom: 8 },
});
