"""The shipped presence (v6, as it ran live) and tap (v7) networks on a real session."""
import sys, glob, numpy as np, torch
from realdata import load_session
from train7 import Tap, features as tap_features, W
s = load_session(sys.argv[1])
T, raw, zero, pres = s["T"], s["raw"], s["zero"], s["presence"]
# Tap network over the session, 50 Hz windows against the zero in use at the window's end.
tap = Tap(); tap.load_state_dict(torch.load(sys.argv[2] if len(sys.argv) > 2 else "tap7.pt", map_location="cpu")); tap.eval()
idx = np.arange(W - 1, len(T))
wins = np.stack([raw[i - W + 1:i + 1] - zero[i] for i in idx]).astype(np.float32)
with torch.no_grad():
    p = torch.sigmoid(tap(tap_features(torch.tensor(wins)))).numpy()
P = np.zeros(len(T)); P[idx] = p
# Fires: rising edge over 0.5, at least 0.35 s apart (as the kit does).
fires, high, last = [], False, -10
for i in range(len(T)):
    if P[i] > 0.5 and not high and T[i] - last > 0.35: fires.append(T[i]); high = True; last = T[i]
    elif P[i] < 0.3: high = False
fires = np.array(fires)
def dips(i0, i1):
    """Quick rises of |B| over the take's running baseline: candidate dips."""
    m = np.linalg.norm(raw[i0:i1] - zero[i0:i1], axis=1); base = np.median(m)
    n, above = 0, False
    for v in m:
        if not above and v > max(base * 1.5, base + 8): n += 1; above = True
        elif above and v < base * 1.2 + 4: above = False
    return n
print(f"{'take':16s} {'label':22s} {'presence>0.5':>13s}  {'taps fired':>10s}  {'dips seen':>9s}")
for k in s["takes"]:
    i0, i1 = np.searchsorted(T, [k["start"], k["end"]])
    pr = (pres[i0:i1] > 0.5).mean()
    nf = ((fires >= k["start"]) & (fires < k["end"])).sum()
    print(f"{k['id']:16s} {k['label']:22s} {100*pr:12.0f}%  {nf:10d}  {dips(i0, i1):9d}")
print(f"taps fired outside the tap takes and not-tap takes: {sum(1 for f in fires if not any(k['start'] <= f < k['end'] for k in s['takes']))}")
