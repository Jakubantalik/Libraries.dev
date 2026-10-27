import { MetalStudioV2 } from "./metal-v2";

/* Studio — Metal: metal-fx 2 (Paper Shaders liquidMetal). */

export function MetalStudio({ visible = true, theme = "dark" }: { visible?: boolean; theme?: "dark" | "light" }) {
  return <MetalStudioV2 visible={visible} theme={theme} />;
}
