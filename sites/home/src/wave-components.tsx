import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WaveComponents } from "./distortion-waves/Components";

/* The wave components demo page (wave-components.html): one React island. */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WaveComponents />
  </StrictMode>,
);
