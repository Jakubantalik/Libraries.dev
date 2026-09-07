import { useState } from "react";
import { PgTabs } from "./controls";
import { MetalStudioV2 } from "./metal-v2";
import { MetalStudioV1 } from "./metal-v1";

/* Studio — Metal. Two families behind one Version tab, mirroring the
   detail page: v2 (metal-fx 2, the default) and v1 (metal-fx 1.0.4, as
   published). Both benches stay mounted so tuning survives switching, and
   so v1's keeper instance keeps its shared renderer alive (see metal-v1);
   the hidden one renders no stage content. */

type Version = "v2" | "v1";
const VERSION_OPTIONS = [
  { value: "v2", label: "v2" },
  { value: "v1", label: "v1" },
] as const;

export function MetalStudio({ visible = true, theme = "dark" }: { visible?: boolean; theme?: "dark" | "light" }) {
  const [version, setVersion] = useState<Version>("v2");
  const tabs = <PgTabs label="Version" options={VERSION_OPTIONS} value={version} onChange={setVersion} />;
  return (
    <>
      <div hidden={version !== "v2"}>
        <MetalStudioV2 visible={visible && version === "v2"} theme={theme} versionTabs={tabs} />
      </div>
      <div hidden={version !== "v1"}>
        <MetalStudioV1 visible={visible && version === "v1"} theme={theme} versionTabs={tabs} />
      </div>
    </>
  );
}
