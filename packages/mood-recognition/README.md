# Mood recognition React kit (beta)

Interfaces that notice when someone is stuck. The kit reads how the pointer, presses, scrolling and typing behave inside your app and tells your components when the user is frustrated, confused or lost, so the screen can bring forward what helps. It runs in the browser: no LLM, no server, nothing leaves the page.

Docs and downloads: [libraries.dev/mood-recognition](https://libraries.dev/mood-recognition)

## Install

1. Download the kit and the model from libraries.dev/mood-recognition (Install tab, free account).
2. Unzip the kit into your app, for example as `src/mood-recognition/`.
3. Put the model, `MoodRecognition.json`, next to it and import it, so it ships inside your bundle.

React 18 or newer. No other dependency. Importing JSON needs `resolveJsonModule` in TypeScript (Vite, Next.js and Create React App have it on).

## Usage

```tsx
import { useState } from "react";
import { MoodProvider, useMood } from "./mood-recognition";
import model from "./mood-recognition/MoodRecognition.json";

// One provider per page; the components that adapt sit inside it.
export function Checkout() {
  return (
    <MoodProvider model={model}>
      <PayForm />
    </MoodProvider>
  );
}

function PayForm() {
  // mood: "frustrated" | "confused" | "lost" | "away" | null; reaction: 0 … 1
  const { mood } = useMood();
  const [agreed, setAgreed] = useState(false);
  // 2: confused or lost, 3: frustrated
  const state = agreed ? 1 : mood === "frustrated" ? 3 : mood === "confused" || mood === "lost" ? 2 : 1;

  return (
    <form data-state={state}>
      <button disabled={!agreed}>Pay $97.54</button>
      <label className="terms">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        I agree to the terms of sale and the return policy
      </label>
    </form>
  );
}
```

```css
/* Confused or lost: the locked Pay steps back. Frustrated: the terms that unlock it come forward too. */
form[data-state="2"] button:disabled,
form[data-state="3"] button:disabled { opacity: 0.2; }
form[data-state="3"] .terms { color: #e8e8e8; }

/* Or blend a calm and an emphatic style by the reaction, 0 … 1, which the provider sets as --mood. */
.terms { color: color-mix(in srgb, #8f8f8f, #e8e8e8 calc(var(--mood, 0) * 100%)); }
```

## Each reading

| Field | What it is |
| --- | --- |
| `mood` | `"frustrated"`, `"confused"`, `"lost"` or `"away"`; null while calm or without input. Blocked reads as frustrated. A mood holds for a second before it fades. |
| `reaction` | How strongly the UI should react, 0 … 1: from 0.30 of the reading for the moods in `reactTo`, full at the 0.65 alert line. Rises in about 0.1 s, eases back over a few seconds once calm, about half a minute while the pointer rests. Away does not raise it. Also set as `--mood` on the provider's children. |
| `score` | The strength behind the mood, 0 … 1: the higher of the model and the fast signals. |
| `probabilities` | The model's belief in each reading, `none`, `blocked`, `lost`, `confused`, `waiting` and `frustrated`, summing to 1; null without input or a model. |
| `fast` | The fast signals, 0 … 1, and `fastKind`: `"shake"`, `"orbit"`, `"rage"` or `"disabled"`; null when none. |
| `isModelLoaded` | Whether the model passed in could be read. Without it, only the fast signals and away work. |

`MoodProvider` props: `model`, `baselineKey` (default `"mood-baseline"`; `null` keeps the person's pace in memory only) and `reactTo` (default `["frustrated", "confused", "lost"]`).

Without React: `createMoodReader({ model, scope, onReading }).start()`.

## Good to know

- It reads the whole page, as the model was trained, wherever the provider sits. Mark parts it should skip, such as your own help panel, with `data-mood-ignore`. Use one provider per page.
- It reads positions, timings and element facts (a button, disabled, invalid), never text, field values or the screen. Nothing leaves the page. Events are kept in memory for about half a minute.
- Confused comes from how the pointer moves alone, its speed and its path: circling one spot, hovering round a control without pressing it. Lost comes from wandering back to the same places without pressing and opening section after section. Frustrated comes from shaking the pointer, rapid presses on one spot or on nothing, presses on disabled controls, and retyping what failed.
- React to frustrated, confused and lost, not to away: someone away isn't looking. Keep the reaction small and reversible: bring forward what unlocks, a hint or a way out, never block or move things from under the pointer.
- Beta: trained on simulated people and real sessions of more than 10 people, on mouse, trackpad and touch. Short lost searches can stay under the line, and a blocked checkout is often read as lost.

## License

The kit's code is MIT (`LICENSE`). The model, `MoodRecognition.json`, is under the [Libraries.dev Model License](https://github.com/Jakubantalik/Libraries.dev/blob/main/LICENSE-MODEL.md): free for development, prototypes and non-commercial apps; a commercial release needs Libraries.dev Pro or Business. Ship it inside your app's bundle only, never on its own.
