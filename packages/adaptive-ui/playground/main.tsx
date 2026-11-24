import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AdaptiveProvider, useAdaptive } from "../src";

/* The lab's Pay screen on the kit: confused or lost steps the locked Pay
   back (state 2); frustrated also brings the terms forward (state 3). */
function PayForm() {
  const reading = useAdaptive();
  const [agreed, setAgreed] = useState(false);
  const { mood } = reading;
  const state = agreed ? 1 : mood === "frustrated" ? 3 : mood === "confused" || mood === "lost" ? 2 : 1;
  (window as unknown as { __adaptive?: unknown }).__adaptive = reading;
  return (
    <>
      <form className="pay" data-state={state} onSubmit={(e) => e.preventDefault()}>
        <button id="pay" disabled={!agreed}>Pay $97.54</button>
        <label className="terms">
          <input id="agree" type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          I agree to the terms of sale and the return policy
        </label>
      </form>
      <pre data-adaptive-ignore>{JSON.stringify({ state, ...reading, probabilities: undefined }, null, 2)}</pre>
    </>
  );
}

function App() {
  const [model, setModel] = useState<unknown>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    fetch("/model.json")
      .then((r) => (r.ok ? r.json() : null))
      .then(setModel, () => setModel(null))
      .finally(() => setReady(true));
  }, []);
  if (!ready) return null;
  return (
    <AdaptiveProvider model={model} baselineKey={null}>
      <PayForm />
    </AdaptiveProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
