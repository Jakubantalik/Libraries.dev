import json, struct, sys, os, torch, numpy as np
from train6c import Presence, HZ, SHORT, LONG_N, LONG_STEP, N_IN
model = Presence(); model.load_state_dict(torch.load(sys.argv[1] if len(sys.argv) > 1 else "presence6c.pt", map_location="cpu"))
linears = [m for m in model.net if isinstance(m, torch.nn.Linear)]
layers, blobs = [], []
for i, lin in enumerate(linears):
    layers.append({"in": lin.in_features, "out": lin.out_features, "act": "silu" if i < len(linears) - 1 else "none"})
    blobs += [lin.weight.detach().numpy().astype(np.float16).tobytes(), lin.bias.detach().numpy().astype(np.float16).tobytes()]
header = {"kind": "presence", "version": 2, "context": 2, "hz": HZ, "short": SHORT, "longN": LONG_N, "longStep": LONG_STEP, "window": 15,
          "inputs": f"{SHORT}×3 field/S (S = max(10, |field now|), clipped ±6), {LONG_N} × log1p(|field|/10)/6 every {LONG_STEP} samples, "
                    "log1p(peak/100)/4, samples since peak / hz / 15, log1p(S/10)/6, peak > 2000, overloaded since the last zero (and the field just dropped), min(1.6, log1p(seconds since that overload / 10) / log1p(60))",
          "outputs": ["presence logit", "offset x / S", "offset y / S", "offset z / S"],
          "layers": layers}
hj = json.dumps(header).encode()
out = sys.argv[2] if len(sys.argv) > 2 else "MagnetPresence.mfxl"
with open(out, "wb") as f:
    f.write(b"MFXL"); f.write(struct.pack("<I", len(hj))); f.write(hj)
    for b in blobs: f.write(b)
print(out, os.path.getsize(out), "bytes")
