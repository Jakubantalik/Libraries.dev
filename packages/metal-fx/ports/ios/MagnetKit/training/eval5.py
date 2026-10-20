"""v5 vs v4 vs the closed-form physics on the same simulated poses (face and strength known)."""
import math, sys, torch, numpy as np
from train import dev, LOGK_MID
from train4 import Locator, features, position
torch.manual_seed(21); rng = np.random.default_rng(21)
PW, PH = 7.06, 14.66
S = np.array([0.0, 6.3])       # sensor, phone-centred (cm); the guess is off by `off`
def load(p):
    m = Locator().to(dev); m.load_state_dict(torch.load(p, map_location=dev)); m.eval(); return m
def cos2(q):
    q = np.clip(q, -1, 1); u = (q + np.sqrt(q*q + 8)) / 2; return np.clip((u*u - 1) / 3, 0, 1)
def physics(B, face, K, cap=4.0):
    nb = np.linalg.norm(B, axis=1); c2 = cos2(face * B[:, 2] / nb); c = np.sqrt(c2); s = np.sqrt(1 - c2)
    phi = np.arctan2(B[:, 1], B[:, 0]) + np.where(face > 0, 0, np.pi)
    r = (K * np.sqrt(1 + 3*c2) / nb) ** (1/3); h = r*c; lat = r*s
    over = h > cap; lat = np.where(over, np.sqrt(np.maximum(0, r*r - cap*cap)), lat)
    return np.stack([lat*np.cos(phi), lat*np.sin(phi)], 1)
def scenario(kind, n=6000):
    u = lambda: rng.random(n)
    if kind.startswith("over"):
        x = (u()*2-1)*(PW/2-0.3); y = (u()*2-1)*(PH/2-0.3)
        z = (0.42 + 0.5 + u()*2.0) if kind == "over-hover" else (0.42 + 0.3 + u()*0.2)
        tilt = 20 if kind == "over-hover" else 5
    else:
        side = rng.integers(0, 4, n); gap = 0.5 + 9*u(); a = u()*2-1
        x = np.where(side == 0, -(PW/2+gap), np.where(side == 1, PW/2+gap, a*(PW/2+gap)))
        y = np.where(side == 2, -(PH/2+gap), np.where(side == 3, PH/2+gap, a*(PH/2+gap)))
        z = {"beside-air": 3.0 - 0.4, "beside-desk-tall": 1.2 - 0.4, "beside-desk-flat": 0.1 - 0.4}[kind] + 0*u()
        tilt = {"beside-air": 15, "beside-desk-tall": 5, "beside-desk-flat": 5}[kind]
    return np.stack([x, y, np.broadcast_to(z, (n,))], 1), tilt
def field(P, tilt, K, face, sensor):
    n = len(P); t = np.radians(rng.random(n) * tilt); a = rng.random(n) * 2*np.pi
    m = face * np.stack([np.sin(t)*np.cos(a), np.sin(t)*np.sin(a), np.cos(t)], 1)
    r = np.stack([sensor[0] - P[:, 0], sensor[1] - P[:, 1], -P[:, 2]], 1)
    l = np.linalg.norm(r, axis=1, keepdims=True); rh = r / l
    B = K * (3 * (m*rh).sum(1, keepdims=True) * rh - m) / l**3
    return B + rng.normal(0, 0.5, B.shape)
def edge(xy, inset=0.6):
    return np.stack([np.clip(xy[:, 0], -PW/2+inset, PW/2-inset), np.clip(xy[:, 1], -PH/2+inset, PH/2-inset)], 1)
models = {name: load(p) for name, p in [("v4", "locator4.pt"), ("v5", sys.argv[1] if len(sys.argv) > 1 else "locator5.pt")]}
K = 40000.0
print("median/p90 cm; sensor guess off by 0.85 cm; face and strength known. 'edge' = where the ring sits on screen")
for kind in ["over-hover", "over-glass", "beside-air", "beside-desk-tall", "beside-desk-flat"]:
    P, tilt = scenario(kind)
    true_sensor = S + np.array([0.8, -0.3])
    face = 1.0
    B = field(P, tilt, K, face, true_sensor)
    keep = np.linalg.norm(B, axis=1) > 2.5; P, B = P[keep], B[keep]
    rows = []
    q = physics(B, face, K) + S
    rows.append(("physics", q))
    for name, m in models.items():
        Bt = torch.tensor(B, dtype=torch.float32, device=dev); n = len(B)
        with torch.no_grad():
            d_, lr, _, _ = m(features(Bt, torch.full((n,), math.log(K), device=dev), torch.ones(n, device=dev),
                                      torch.full((n,), face, device=dev), torch.ones(n, device=dev)))
            pos = position(d_, lr).cpu().numpy()
        rows.append((name, pos[:, :2] + S))
    line = f"{kind:18s}"
    for name, q in rows:
        e = np.linalg.norm(q - P[:, :2], axis=1); ee = np.linalg.norm(edge(q) - edge(P[:, :2]), axis=1)
        line += f" | {name} pos {np.median(e):4.1f}/{np.percentile(e,90):4.1f} edge {np.median(ee):3.1f}/{np.percentile(ee,90):3.1f}"
    print(line, flush=True)
