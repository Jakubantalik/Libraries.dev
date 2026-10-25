import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Magnet, MagnetCalibration, MagneticView, useMagnet, useMagnetGestures } from 'react-native-magnetkit';

const CHIPS = ['Home', 'Voice', 'Metal', 'Magnetic', 'Beam'];
const CARDS = ['Liquid metal', 'Thinking orbs', 'Border beam', 'Voice glow'];

export default function App() {
  const frame = useMagnet();
  const [calibrating, setCalibrating] = useState(false);
  const [gesture, setGesture] = useState('');
  useMagnetGestures((g) => setGesture(g.g === 'tap' ? 'Air tap' : g.g === 'swipe' ? 'Swipe' : g.g === 'push' ? 'Push' : 'Pull away'));

  const magnet = Magnet.getMagnet();
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.chips}>
        {CHIPS.map((c) => (
          <MagneticView key={c} style={styles.chip}>
            <Text style={styles.chipText}>{c}</Text>
          </MagneticView>
        ))}
      </View>
      <View style={styles.grid}>
        {CARDS.map((c) => (
          <MagneticView key={c} style={styles.card}>
            <Text style={styles.cardText}>{c}</Text>
          </MagneticView>
        ))}
      </View>
      <View style={styles.readout}>
        <Text style={styles.line}>{Magnet.hasModel() ? 'Model loaded' : 'No Magnet.mfxl in the app'}</Text>
        <Text style={styles.line}>
          {frame ? `${frame.strength.toFixed(0)} µT · presence ${frame.presence.toFixed(2)}` : 'Waiting for readings…'}
        </Text>
        <Text style={styles.line}>
          {frame?.pos ? `Magnet at ${frame.pos.x.toFixed(0)}, ${frame.pos.y.toFixed(0)}` : 'No magnet located'}
        </Text>
        <Text style={styles.line}>
          {magnet ? `Calibrated: face ${magnet.face > 0 ? 'N' : 'S'}, ${magnet.strength.toFixed(0)} µT·cm³` : 'Not calibrated'}
        </Text>
        <Text style={styles.gesture}>{gesture}</Text>
      </View>
      <View style={styles.buttons}>
        <Pressable style={styles.button} onPress={() => Magnet.zero()}>
          <Text style={styles.buttonText}>Re-zero</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.primary]} onPress={() => setCalibrating(true)}>
          <Text style={styles.buttonText}>Calibrate</Text>
        </Pressable>
      </View>
      <MagnetCalibration visible={calibrating} onClose={() => setCalibrating(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e0e0e', paddingTop: 64, paddingHorizontal: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: '#222', justifyContent: 'center' },
  chipText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 24 },
  card: { width: '47%', height: 120, borderRadius: 20, backgroundColor: '#1a1a1a', padding: 16, justifyContent: 'flex-end' },
  cardText: { color: '#e8e8e8', fontSize: 15, fontWeight: '500' },
  readout: { marginTop: 32, gap: 6 },
  line: { color: '#9a9a9a', fontSize: 13, fontVariant: ['tabular-nums'] },
  gesture: { color: '#4f9cff', fontSize: 15, fontWeight: '600', marginTop: 8, minHeight: 20 },
  buttons: { position: 'absolute', left: 16, right: 16, bottom: 48, flexDirection: 'row', gap: 12 },
  button: { flex: 1, height: 48, borderRadius: 24, backgroundColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: '#4f9cff' },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
