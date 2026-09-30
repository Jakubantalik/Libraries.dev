import { createRoot } from 'react-dom/client';
import { BotAvatar, botAvatarTypes, type BotAvatarType, type BotAvatarHat, type BotAvatarGlasses, type BotAvatarState } from '../src';

/* The fabric material and the wearables, staged like the dots reference:
   big plush bots on soft pastel grounds, each wearing something. */
const SCENES: Array<{ type: BotAvatarType; bg: string; hat?: BotAvatarHat; glasses?: BotAvatarGlasses; headphones?: boolean; bowTie?: boolean; color?: string; label: string }> = [
  { type: 'clover', bg: '#d9ecfb', hat: 'beret', label: 'clover · beret' },
  { type: 'flower', bg: '#f7dfe7', headphones: true, color: '#f07fa6', label: 'flower · headphones' },
  { type: 'triangle', bg: '#faf3d2', glasses: 'round', bowTie: true, color: '#f5d23b', label: 'triangle · glasses · bow tie' },
  { type: 'blob', bg: '#e8f3cf', bowTie: true, label: 'blob · bow tie' },
  { type: 'circle', bg: '#ece0f8', hat: 'beanie', label: 'circle · beanie' },
  { type: 'square', bg: '#dcecf7', hat: 'party', glasses: 'shades', label: 'square · party · shades' },
  { type: 'star', bg: '#fbf0d6', hat: 'crown', label: 'star · crown' },
  { type: 'ghost', bg: '#e9e9ee', glasses: 'square', label: 'ghost · square glasses' },
];

function App() {
  const only = new URLSearchParams(location.search);
  const size = Number(only.get('size')) || 150;
  const paused = only.has('paused');
  /* ?state=working to see the wear through hops and flips */
  const state = (only.get('state') as BotAvatarState | null) ?? undefined;
  return (
    <>
      <div className="grid">
        {SCENES.map((s) => (
          <div className="scene" key={s.label} style={{ background: s.bg }} data-theme="light">
            <BotAvatar
              type={s.type}
              size={size}
              shading="fabric"
              color={s.color}
              hat={s.hat}
              glasses={s.glasses}
              headphones={s.headphones}
              bowTie={s.bowTie}
              paused={paused}
              state={state}
            />
            <span className="label">{s.label}</span>
          </div>
        ))}
      </div>
      <h2>fabric, every type</h2>
      <div className="row">
        {botAvatarTypes.map((t) => (
          <div className="cell" key={t}>
            <BotAvatar type={t} size={72} shading="fabric" paused={paused} />
            <span className="label">{t}</span>
          </div>
        ))}
      </div>
      <h2>plastic, wearing the same</h2>
      <div className="row">
        {SCENES.map((s) => (
          <div className="cell" key={s.label}>
            <BotAvatar type={s.type} size={96} color={s.color} hat={s.hat} glasses={s.glasses} headphones={s.headphones} bowTie={s.bowTie} paused={paused} />
            <span className="label">{s.label}</span>
          </div>
        ))}
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
