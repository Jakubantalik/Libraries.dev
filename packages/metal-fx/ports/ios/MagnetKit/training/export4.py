import json, struct, sys, os, torch, numpy as np
from train import LOGK_MID, LOGB_MID
from train2 import LOGR_MID
from train4 import Locator
model = Locator(); model.load_state_dict(torch.load(sys.argv[1] if len(sys.argv) > 1 else "locator4.pt", map_location="cpu"))
linears = [m for m in model.net if isinstance(m, torch.nn.Linear)]
layers, blobs = [], []
for i, lin in enumerate(linears):
    layers.append({"in": lin.in_features, "out": lin.out_features, "act": "silu" if i < len(linears) - 1 else "none"})
    blobs += [lin.weight.detach().numpy().astype(np.float16).tobytes(), lin.bias.detach().numpy().astype(np.float16).tobytes()]
header = {"version": 3,
          "inputs": ["bx/|b|", "by/|b|", "bz/|b| (b times face if known, else flipped so bz>=0)", "(ln|b|-logbMid)/2",
                     "(lnK-logkMid)/1.5", "strength known", "face known"],
          "outputs": ["direction x", "direction y", "direction z", "ln r - logrMid", "ln var(ln r)", "ln var(angle)"],
          "logbMid": LOGB_MID, "logkMid": LOGK_MID, "logrMid": LOGR_MID, "logvarClamp": [-10, 4],
          "axes": "device: x right, y toward the top edge, z out of the screen; magnet relative to the magnetometer, cm; face +1 = north toward the user",
          "layers": layers}
hj = json.dumps(header).encode()
out = sys.argv[2] if len(sys.argv) > 2 else "MagnetLocator.mfxl"
with open(out, "wb") as f:
    f.write(b"MFXL"); f.write(struct.pack("<I", len(hj))); f.write(hj)
    for b in blobs: f.write(b)
print(out, os.path.getsize(out), "bytes")
