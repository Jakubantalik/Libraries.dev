"""The grab's face test, old (sideways bearing) vs new (whole direction), on
simulated grabs: magnet 5 cm from the sensor over the ring, hovering
0.8–4 cm above the sensor, tilted in the fingers, sensor spot off by up to 1 cm."""
import numpy as np
rng = np.random.default_rng(1)
def cos2(q):
    q = np.clip(q, -1, 1); u = (q + np.sqrt(q*q + 8)) / 2; return np.clip((u*u - 1) / 3, 0, 1)
def old(b, off):
    nb = np.linalg.norm(b); want = np.arctan2(off[1], off[0]); best = None
    for f in (1, -1):
        phi = np.arctan2(b[1], b[0]) + (0 if f > 0 else np.pi); sc = np.cos(phi - want)
        if best is None or sc > best[0]: best = (sc, f)
    return best[1] if best[0] > 0.5 else 0
def new(b, off):
    u = b / np.linalg.norm(b); best = None
    for f in (1, -1):
        for h in np.arange(0.6, 3.61, 0.2):
            p = np.array([off[0], off[1], h]); r = np.linalg.norm(p); rh = -p / r; m = np.array([0, 0, f])
            d = 3 * (m @ rh) * rh - m; sc = u @ (d / np.linalg.norm(d))
            if best is None or sc > best[0]: best = (sc, f)
    return best[1] if best[0] > 0.6 else 0
N = 4000; res = {"old": [], "new": []}; hs = []
for _ in range(N):
    f = rng.choice([1, -1]); h = rng.uniform(0.8, 4.0); tilt = np.radians(rng.uniform(0, 35)); az = rng.uniform(0, 2*np.pi)
    m = f * np.array([np.sin(tilt)*np.cos(az), np.sin(tilt)*np.sin(az), np.cos(tilt)])
    true_off = np.array([0.0, -5.0]); P = np.array([*true_off, h]); r = np.linalg.norm(P); rh = -P / r
    b = 50000 * (3 * (m @ rh) * rh - m) / r**3 + rng.normal(0, 1, 3)
    kit_off = true_off + rng.normal(0, 0.6, 2)          # the kit's idea of the spot is off a little
    res["old"].append(old(b, kit_off) == f); res["new"].append(new(b, kit_off) == f); hs.append(h)
hs = np.array(hs)
for name, ok in res.items():
    ok = np.array(ok)
    print(f"{name}: right face {100*ok.mean():.1f}%  | hover <2 cm {100*ok[hs<2].mean():.1f}%, 2–3 cm {100*ok[(hs>=2)&(hs<3)].mean():.1f}%, 3–4 cm {100*ok[hs>=3].mean():.1f}%")
