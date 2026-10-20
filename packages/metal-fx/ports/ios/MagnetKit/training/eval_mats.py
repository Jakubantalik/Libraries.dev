"""The shipped locator (v5) and the closed-form physics on real mat dots, as the
kit runs them: the kit's sensor spot, the grab's strength, the face it believed."""
import sys, math, numpy as np, torch
from realdata import load_mats, kit_sensor_cm, segments
from train import dev, LOGK_MID
from train4 import Locator, features, position

def cos2(q):
    q = np.clip(q, -1, 1); u = (q + np.sqrt(q*q + 8)) / 2; return np.clip((u*u - 1) / 3, 0, 1)
def physics(B, face, K, cap=4.0):
    """The closed-form inversion (MetalMagnetDipole), as in eval5.py."""
    nb = np.linalg.norm(B, axis=1); c2 = cos2(face * B[:, 2] / nb); c = np.sqrt(c2); s = np.sqrt(1 - c2)
    phi = np.arctan2(B[:, 1], B[:, 0]) + np.where(face > 0, 0, np.pi)
    r = (K * np.sqrt(1 + 3*c2) / nb) ** (1/3); h = r*c; lat = r*s
    over = h > cap; lat = np.where(over, np.sqrt(np.maximum(0, r*r - cap*cap)), lat)
    return np.stack([lat*np.cos(phi), lat*np.sin(phi)], 1)
S = load_mats(sys.argv[1])
net = Locator().to(dev); net.load_state_dict(torch.load("locator5.pt", map_location=dev)); net.eval()
B = np.array([s["B"] for s in S]); K = np.array([s["K"] for s in S], float)
face = np.full(len(S), float(sys.argv[2]) if len(sys.argv) > 2 else 1.0)   # the face the magnet really had (the grab said +1)
sens = np.array([kit_sensor_cm(s) for s in S]); dots = np.array([[s["x"], s["y"]] for s in S])
with torch.no_grad():
    Bt = torch.tensor(B, dtype=torch.float32, device=dev); n = len(S)
    x = features(Bt, torch.tensor(np.log(K), dtype=torch.float32, device=dev), torch.ones(n, device=dev),
                 torch.tensor(face, dtype=torch.float32, device=dev), torch.ones(n, device=dev))
    d_, lr, _, _ = net(x); pn = position(d_, lr).cpu().numpy()[:, :2]
pp = physics(B, face, K)
seg = segments(S)
def ring(s):
    if s["pass_"] == "screen": return "over the screen"
    return ("near ring (1.5 cm out)" if s["dot"] <= 16 else "far ring (4.5 cm out)") + (", standing" if s["pass_"] == "desk" else ", 3 cm up")
groups = {}
for i, s in enumerate(S): groups.setdefault(ring(s), []).append(i)
print(f"{'':32s} {'network v5':>14s} {'physics':>14s}   median error, cm (dots)")
for g, ii in groups.items():
    en = np.linalg.norm(sens[ii] + pn[ii] - dots[ii], axis=1); ep = np.linalg.norm(sens[ii] + pp[ii] - dots[ii], axis=1)
    print(f"{g:32s} {np.median(en):12.1f}   {np.median(ep):12.1f}     ({len(ii)})")
# Which side of the phone: does the estimate land on the right side?
def side(xy): return np.where(np.abs(xy[:, 0]) / 3.53 > np.abs(xy[:, 1]) / 7.33, np.sign(xy[:, 0]) * 1, np.sign(xy[:, 1]) * 2)
mat = [i for i, s in enumerate(S) if s["pass_"] != "screen"]
for name, p in (("network v5", pn), ("physics", pp)):
    ok = side(sens[mat] + p[mat]) == side(dots[mat])
    print(f"right side of the phone, {name}: {100 * ok.mean():.0f}%")
