import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSharedValue } from 'react-native-reanimated';
import {
  MetalBadge,
  MetalEdgeHalo,
  MetalFx,
  MetalReflection,
  MetalReflectionText,
  MetalText,
  refreshMetalFrames,
  type MetalPreset,
} from 'metal-fx-native';

/**
 * The metal-fx v2 demo page's cards on the phone: the composer with its send
 * button (reflecting onto the Auto chip), "Plan Pro", "Live mode · New", a
 * pill button, and a ring parked at the screen edge for the edge halo. Tilt
 * the phone to bend the rings; the tilt pad drives them by hand.
 */
export default function App() {
  const [preset, setPreset] = useState<MetalPreset>('chromatic');
  const strength = 0.9;
  const tiltOverride = useSharedValue<{ dx: number; dy: number } | null>(null);
  const [pad, setPad] = useState({ x: 0, y: 0 });

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scroll} onScroll={refreshMetalFrames} scrollEventThrottle={32}>
        <Text style={styles.title}>Liquid metal</Text>
        <Text style={styles.subtitle}>metal-fx v2 · React Native</Text>

        {/* Composer */}
        <View style={[styles.card, { height: 260 }]}>
          <View style={styles.composer}>
            <Text style={styles.placeholder}>Build anything...</Text>
            <View style={styles.row}>
              <View style={styles.plus}><Text style={styles.plusLabel}>+</Text></View>
              <View style={{ flex: 1 }} />
              <Chip label="Agent" />
              <MetalReflection of="send">
                <Chip label="Auto" />
              </MetalReflection>
              <MetalFx variant="circle" preset={preset} theme="dark" strength={strength} innerShadow id="send" tiltOverride={tiltOverride}>
                <View style={styles.circle}><Text style={styles.arrow}>↑</Text></View>
              </MetalFx>
            </View>
          </View>
        </View>

        {/* Plan · Pro */}
        <View style={[styles.card, styles.center, { height: 170, borderRadius: 36 }]}>
          <View style={[styles.row, { alignItems: 'flex-end', gap: 6 }]}>
            <MetalReflectionText of="pro" fontSize={24} fontWeight="500" strength={0.64}>Plan</MetalReflectionText>
            <MetalText fontSize={24} fontWeight="500" preset={preset} theme="dark" strength={strength} id="pro">Pro</MetalText>
          </View>
        </View>

        {/* Live mode · New */}
        <View style={[styles.card, styles.center, { height: 170, borderRadius: 36 }]}>
          <View style={[styles.row, { gap: 12 }]}>
            <Text style={styles.live}>Live mode</Text>
            <MetalBadge preset={preset} theme="dark" strength={strength}>New</MetalBadge>
          </View>
        </View>

        {/* Edge halo: a ring parked against the right edge; the card hosts the lens. */}
        <MetalEdgeHalo style={[styles.card, styles.row, { height: 120, marginRight: -12, paddingLeft: 24 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Edge halo</Text>
            <Text style={styles.cardSub}>Light leaves through the glass edge</Text>
          </View>
          <MetalFx variant="circle" preset={preset} theme="dark" strength={strength} innerShadow id="edge" tiltOverride={tiltOverride} style={{ marginRight: -4 }}>
            <View style={styles.circle}><Text style={styles.arrow}>↑</Text></View>
          </MetalFx>
        </MetalEdgeHalo>

        {/* Controls */}
        <View style={[styles.card, { padding: 16, gap: 14, borderRadius: 20 }]}>
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <Text style={styles.cardSub}>Button</Text>
            <MetalFx variant="button" preset={preset} theme="dark" strength={strength * 0.7} id="pill" tiltOverride={tiltOverride}>
              <View style={styles.pill}><Text style={styles.pillLabel}>Upgrade to Pro</Text></View>
            </MetalFx>
          </View>
          <View style={styles.segmented}>
            {(['chromatic', 'silver', 'gold'] as MetalPreset[]).map((p) => (
              <Pressable key={p} onPress={() => setPreset(p)} style={[styles.segment, preset === p && styles.segmentOn]}>
                <Text style={[styles.segmentLabel, preset === p && styles.segmentLabelOn]}>{p[0].toUpperCase() + p.slice(1)}</Text>
              </Pressable>
            ))}
          </View>
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.cardTitle}>Tilt pad</Text>
              <Text style={styles.cardSub}>Drag to bend the rings by hand (the phone's tilt drives it otherwise).</Text>
            </View>
            <View
              style={styles.pad}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderMove={(e) => {
                const { locationX, locationY } = e.nativeEvent;
                const dx = Math.max(-1, Math.min(1, (locationX / 96) * 2 - 1));
                const dy = Math.max(-1, Math.min(1, (locationY / 96) * 2 - 1));
                setPad({ x: dx, y: dy });
                tiltOverride.value = { dx: dx * 0.6, dy: dy * 0.6 };
              }}
              onResponderRelease={() => { setPad({ x: 0, y: 0 }); tiltOverride.value = null; }}
            >
              <View style={[styles.padDot, { transform: [{ translateX: pad.x * 48 }, { translateY: pad.y * 48 }] }]} />
            </View>
          </View>
        </View>
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipLabel}>{label}</Text>
      <Text style={styles.chevron}>⌄</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f0f0f' },
  scroll: { paddingHorizontal: 12, paddingTop: 64, gap: 12 },
  title: { color: '#fff', fontSize: 28, fontWeight: '600', textAlign: 'center', marginTop: 24 },
  subtitle: { color: '#999', fontSize: 15, textAlign: 'center', marginBottom: 24 },
  card: { backgroundColor: '#171717', borderRadius: 30, justifyContent: 'center' },
  center: { alignItems: 'center' },
  composer: { backgroundColor: '#1d1d1d', borderRadius: 20, marginHorizontal: 24, paddingTop: 20, paddingHorizontal: 16, paddingBottom: 16 },
  placeholder: { color: '#6b6b6b', fontSize: 14, marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  plus: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#262626', alignItems: 'center', justifyContent: 'center' },
  plusLabel: { color: '#fff', fontSize: 18, lineHeight: 20 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 36, paddingLeft: 14, paddingRight: 10, borderRadius: 18, backgroundColor: '#262626' },
  chipLabel: { color: '#f8f8f8', fontSize: 12 },
  chevron: { color: '#8a8a8a', fontSize: 12, marginTop: -6 },
  circle: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  arrow: { color: '#f8f8f8', fontSize: 18, fontWeight: '500' },
  live: { color: '#999', fontSize: 20 },
  cardTitle: { color: '#fff', fontSize: 17, fontWeight: '500', marginBottom: 4 },
  cardSub: { color: '#999', fontSize: 13 },
  pill: { height: 40, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  pillLabel: { color: '#f8f8f8', fontSize: 14, fontWeight: '500' },
  segmented: { flexDirection: 'row', backgroundColor: '#262626', borderRadius: 9, padding: 2 },
  segment: { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 7 },
  segmentOn: { backgroundColor: '#3a3a3a' },
  segmentLabel: { color: '#bbb', fontSize: 13 },
  segmentLabelOn: { color: '#fff', fontWeight: '600' },
  pad: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#262626', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  padDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.8)' },
});
