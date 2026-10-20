"""Presence networks on a real session: is the magnet there, take by take."""
import sys, numpy as np, torch
from realdata import load_session
import math
import train6, train6c
s = load_session(sys.argv[1]); T, raw, zero = s["T"], s["raw"], s["zero"]
def truth(t):
    """1 present, 0 absent, None unclear (moments of moving away or calibrating)."""
    for k in s["takes"]:
        if not (k["start"] <= t < k["end"]): continue
        a = t - k["start"]; m = [x["at"] - k["start"] for x in k["marks"]]
        L = k["label"]
        if L == "absent": return 0
        if L in ("present", "taps", "not-taps"): return 1 if a > 1 else None
        if L == "present-then-absent":
            gone = m[0] + (1.5 if k["id"] == "away-fast" else 4.5)
            return 1 if a < m[0] else (0 if a > gone else None)
        if L == "leftover": return 1 if a < m[0] else (0 if a > m[0] + 2 else None)
        if L == "leftover-then-present":
            return 1 if a < m[0] else (0 if m[0] + 2 < a < m[1] else (1 if a > m[1] + 1.5 else None))
        if L == "bad-zero": return 0 if a > m[0] + 2 else None
    return None
idx = np.arange(749, len(T), 5)
lab = [truth(T[i]) for i in idx]
models = {}
for name in [a for a in sys.argv[2:] if not a.startswith("--")]:
    sd = torch.load(name, map_location="cpu")
    mod = train6c if sd["net.0.weight"].shape[1] == train6c.N_IN else train6
    net = mod.Presence(); net.load_state_dict(sd); net.eval(); models[name] = (net, mod)
# What the kit would know (open loop, the zeros as recorded): overloaded since
# the last zero (the field over 2,000 µT, the zero not moved since), and how long ago.
mag = np.linalg.norm(raw - zero, axis=1)
sus = np.zeros(len(T), bool); since = np.zeros(len(T)); last = None
for i in range(len(T)):
    if mag[i] > 2000: last = i
    # Cleared by a real re-zero; in this open-loop replay, the session's one
    # calibration (the bad-zero take). The zero's slow drift tracking does not count.
    if last is not None and any(abs(T[i] - k["start"]) < 0.011 for k in s["takes"] if k["id"] == "bad-zero"): last = None
    if last is not None: sus[i] = True; since[i] = T[i] - T[last]
# Gate: the memory counts only after the field has just dropped (the magnet
# moving away): its peak over the last 10 s is well above now.
gate = "--gate" in sys.argv
if gate:
    for i in range(len(T)):
        j = np.searchsorted(T, T[i] - 10.0); pk = mag[j:i + 1].max()
        if not (pk - mag[i] > max(15.0, 0.12 * pk)): sus[i] = False
res = {name: [] for name in models}
with torch.no_grad():
    for b in range(0, len(idx), 256):
        ii = idx[b:b + 256]
        win = torch.tensor(np.stack([raw[i - 749:i + 1] - zero[i] for i in ii]), dtype=torch.float32)
        for name, (net, mod) in models.items():
            if mod is train6c:
                ctx = torch.tensor(np.stack([sus[ii].astype(float), np.where(sus[ii], np.clip(np.log1p(since[ii] / 10) / mod.SINCE_SCALE, 0, 1.6), 0)], -1), dtype=torch.float32)
                x, _ = mod.features(win, ctx)
            else:
                x, _ = mod.features(win)
            res[name] += torch.sigmoid(net(x)[0]).tolist()
live = s["presence"][idx]
print(f"{'take':16s} {'truth':>9s} " + " ".join(f"{n:>14s}" for n in ["live v6"] + list(models)))
for k in s["takes"]:
    sel = [j for j, i in enumerate(idx) if k["start"] <= T[i] < k["end"] and lab[j] is not None]
    if not sel: continue
    y = np.array([lab[j] for j in sel])
    row = f"{k['id']:16s} {('present' if y.mean() > 0.5 else 'absent') if y.std() == 0 else 'both':>9s} "
    for p in [live[sel]] + [np.array(res[n])[sel] for n in models]:
        row += f"{100 * ((p > 0.5) == y).mean():13.0f}% "
    print(row)
for name, p in [("live v6", live)] + [(n, np.array(res[n])) for n in models]:
    y = np.array([l if l is not None else -1 for l in lab]); ok = y >= 0
    pa, ab = ok & (y == 1), ok & (y == 0)
    print(f"{name:14s} present→present {100*(p[pa] > 0.5).mean():.0f}%   absent→absent {100*(p[ab] <= 0.5).mean():.0f}%   (would re-zero: absent with p<0.25 {100*(p[ab] < 0.25).mean():.0f}%, present wrongly {100*(p[pa] < 0.25).mean():.0f}%)")
