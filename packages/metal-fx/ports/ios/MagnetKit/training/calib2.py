"""
Fit the dipole physics to real mat recordings, with what the recordings
really contain: the phone's own offsets (one per stretch between readings
strong enough to magnetise it), one orientation of the magnet per lap
(sign found by the fit), the sensor's spot and depth, the magnet's strength,
the standing and hovering heights, and the phone's distortion (a matrix
near identity).
"""
import sys, math, json, numpy as np
from scipy.optimize import least_squares
from realdata import load_mats, segments, GLASS_ABOVE_TABLE

def dipole(P, S, m, K):
    r = S - P; l = np.linalg.norm(r, axis=-1, keepdims=True); rh = r / l
    return K * (3 * (m * rh).sum(-1, keepdims=True) * rh - m) / l**3

def fit(samples, signs, verbose=True):
    seg = segments(samples); nseg = seg.max() + 1
    groups = sorted({(s["file"], s["lap"]) for s in samples}); gi = {g: i for i, g in enumerate(groups)}
    G = np.array([gi[(s["file"], s["lap"])] for s in samples])
    P = np.array([[s["x"], s["y"]] for s in samples]); B = np.array([s["B"] for s in samples])
    kind = np.array([s["pass_"] for s in samples])
    # v: sensor x,y,z(above table) | lnK | h_desk | h_screen(above glass) | A(9) | tilt per group (2) | offsets per segment (3)
    nG = len(groups)
    def unpack(v):
        S = v[0:3]; K = math.exp(v[3]); hd, hs = v[4], v[5]; A = np.eye(3) + v[6:15].reshape(3, 3)
        tilt = v[15:15 + 2 * nG].reshape(nG, 2); off = v[15 + 2 * nG:].reshape(nseg, 3)
        return S, K, hd, hs, A, tilt, off
    def model(v):
        S, K, hd, hs, A, tilt, off = unpack(v)
        z = np.where(kind == "desk", hd, np.where(kind == "air3cm", 3.0 + hd, GLASS_ABOVE_TABLE + hs))
        Pm = np.column_stack([P, z])
        m = np.column_stack([tilt[G], np.ones(len(G))]); m /= np.linalg.norm(m, axis=1, keepdims=True); m *= signs[G][:, None]
        return dipole(Pm, S, m, K) @ A.T + off[seg]
    def res(v):
        r = (model(v) - B) / (0.06 * np.linalg.norm(B, axis=1, keepdims=True) + 1.0)
        return np.concatenate([r.ravel(), v[6:15] * 3, v[15:15 + 2 * nG] * 2])
    K0 = next((s["K"] for s in samples if s["K"]), 40000)
    best = None
    for sx0 in (-2.0, 0.0, 2.0):
        v0 = np.zeros(15 + 2 * nG + 3 * nseg); v0[:6] = [sx0, 5.6, 0.4, math.log(K0), 0.8, 1.5]
        lo = np.full_like(v0, -np.inf); hi = np.full_like(v0, np.inf)
        lo[:6] = [-3.5, 0, 0.1, math.log(500), 0.1, 0.3]; hi[:6] = [3.5, 7.3, 0.8, math.log(5e5), 3.0, 5.0]
        lo[6:15] = -0.3; hi[6:15] = 0.3; lo[15:15 + 2 * nG] = -1; hi[15:15 + 2 * nG] = 1
        lo[15 + 2 * nG:] = -400; hi[15 + 2 * nG:] = 400
        sol = least_squares(res, v0, bounds=(lo, hi), loss="soft_l1", f_scale=1.0, max_nfev=1500)
        if best is None or sol.cost < best.cost: best = sol
    S, K, hd, hs, A, tilt, off = unpack(best.x)
    pred = model(best.x)
    rel = np.linalg.norm(pred - B, axis=1) / np.linalg.norm(B, axis=1)
    out = dict(sensor_cm=S.tolist(), K=K, h_desk=hd, h_screen=hs, matrix=A.tolist(), offsets=off.tolist(),
               groups=[list(g) for g in groups], signs=signs.tolist(), tilt=tilt.tolist(), cost=float(best.cost),
               rel_median=float(np.median(rel)), rel_p90=float(np.quantile(rel, 0.9)))
    if verbose:
        print(f"signs {signs.tolist()}  cost {best.cost:.1f}")
        print(f"  sensor {S[0]:+.2f}, {S[1]:+.2f} cm from the phone centre, {S[2]:.2f} cm above the table; K {K:.0f} µT·cm³")
        print(f"  magnet centre standing {hd:.2f} cm up; hovering {hs:.2f} cm over the glass")
        print("  offsets per stretch (µT):", "  ".join(f"({o[0]:.0f},{o[1]:.0f},{o[2]:.0f})" for o in off))
        print(f"  fit error |model − real| / |real|: median {np.median(rel):.3f}, 90 % {np.quantile(rel, 0.9):.3f}")
    return out, pred, seg, off

if __name__ == "__main__":
    samples = load_mats(sys.argv[1])
    groups = sorted({(s["file"], s["lap"]) for s in samples})
    # The laps were recorded with the magnet the same way up (their fields
    # agree, not opposite), so one sign for the mat laps; the screen pass
    # (hovering, held differently) may differ.
    best = None
    for screen_sign in (1.0, -1.0):
        signs = np.array([screen_sign if "screen" in g[0] else 1.0 for g in groups])
        out, *_ = fit(samples, signs, verbose=False)
        print(f"  screen sign {screen_sign:+.0f}: cost {out['cost']:.1f}", flush=True)
        if best is None or out["cost"] < best["cost"]: best = out
    print("groups:", [f"{g[0][20:-5]} lap {g[1]}" for g in groups])
    out, pred, seg, off = fit(samples, np.array(best["signs"]))
    json.dump(out, open(sys.argv[2] if len(sys.argv) > 2 else "calib_real1.json", "w"), indent=1)
