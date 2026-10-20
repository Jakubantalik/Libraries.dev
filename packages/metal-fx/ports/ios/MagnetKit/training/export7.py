import json, struct, sys, os, torch, numpy as np
from train7 import Tap, HZ, W, N_IN
model = Tap(); model.load_state_dict(torch.load(sys.argv[1] if len(sys.argv) > 1 else "tap7.pt", map_location="cpu"))
linears = [m for m in model.net if isinstance(m, torch.nn.Linear)]
layers, blobs = [], []
for i, lin in enumerate(linears):
    layers.append({"in": lin.in_features, "out": lin.out_features, "act": "silu" if i < len(linears) - 1 else "none"})
    blobs += [lin.weight.detach().numpy().astype(np.float16).tobytes(), lin.bias.detach().numpy().astype(np.float16).tobytes()]
header = {"kind": "tap", "version": 1, "hz": HZ, "window": W,
          "inputs": f"{W}×3 field/S (S = max(10, lower median of |field| over the window), clipped ±8), "
                    f"{W} × ln(max(|field|, 1)/S) clipped ±4, log1p(S/10)/6",
          "outputs": ["tap just finished, logit"],
          "layers": layers}
hj = json.dumps(header).encode()
out = sys.argv[2] if len(sys.argv) > 2 else "MagnetTap.mfxl"
with open(out, "wb") as f:
    f.write(b"MFXL"); f.write(struct.pack("<I", len(hj))); f.write(hj)
    for b in blobs: f.write(b)
print(out, os.path.getsize(out), "bytes")
