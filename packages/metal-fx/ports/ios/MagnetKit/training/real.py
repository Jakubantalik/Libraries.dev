"""
Real magnet data: calibrate, measure, fine-tune.

  python real.py calibrate DIR      fit this phone + magnet to the recordings
  python real.py finetune DIR       fine-tune locator5.pt on sim + real -> locator5r.pt
  python real.py synth DIR          write synthetic recordings (pipeline test)

Recordings are the app's Documents/real-data/*.json (pull with devicectl).
Each sample: dot position on the mat (mm from the phone centre), the pass
(desk / air3cm / screen) and the field change (µT, device axes).

Calibration fits, by least squares on the dipole model:
  sensor position (x, y from the phone centre; z = height above the table),
  the magnet's strength K and face, its centre height when standing (desk),
  and a 3×3 matrix close to identity for the phone's own distortion
  (iron near the sensor bends the field a little).
"""
import json, math, sys, glob, os
import numpy as np
from scipy.optimize import least_squares

GLASS_ABOVE_TABLE = 0.82          # cm: iPhone 15 Pro is 8.25 mm thick

def load(folder):
    recs = []
    for f in sorted(glob.glob(os.path.join(folder, "*.json"))):
        j = json.load(open(f))
        for s in j["samples"]:
            recs.append(dict(pass_=j["pass"], x=s["x_mm"] / 10, y=s["y_mm"] / 10, B=np.array(s["field"], float),
                             face=j.get("face"), K=j.get("strength"), file=os.path.basename(f)))
    return recs

def dipole(P, S, m, K):
    r = S - P; l = np.linalg.norm(r, axis=-1, keepdims=True); rh = r / l
    return K * (3 * (m * rh).sum(-1, keepdims=True) * rh - m) / l**3

def magnet_z(rec, h_desk):
    # magnet centre height above the table, cm
    if rec["pass_"] == "desk": return h_desk
    if rec["pass_"] == "air3cm": return 3.0 + h_desk
    return GLASS_ABOVE_TABLE + 1.5          # screen pass: hovering ~1.5 cm over the glass

def unpack(v):
    sx, sy, sz, lnK, h_desk = v[:5]; A = np.eye(3) + v[5:14].reshape(3, 3)
    return sx, sy, sz, lnK, h_desk, A

def residuals(v, recs, face):
    sx, sy, sz, lnK, h_desk, A = unpack(v)
    out = []
    for r in recs:
        P = np.array([r["x"], r["y"], magnet_z(r, h_desk)])
        Bm = A @ dipole(P, np.array([sx, sy, sz]), np.array([0, 0, face]), math.exp(lnK))
        w = 1.0 / (0.08 * np.linalg.norm(r["B"]) + 0.7)          # relative error, floor 0.7 µT
        out.append((Bm - r["B"]) * w)
    out.append(v[5:14] * 3.0)                                      # keep the matrix near identity
    return np.concatenate(out)

def calibrate(recs, verbose=True):
    best = None
    K0 = next((r["K"] for r in recs if r["K"]), 30000.0)
    for face in (1.0, -1.0):
        for sx0 in (-1.5, 0.0, 1.5):
            v0 = np.zeros(14); v0[:5] = [sx0, 6.3, 0.4, math.log(K0), 0.8]
            lo = [-3.5, 0, 0.1, math.log(500), 0.1] + [-0.3] * 9
            hi = [3.5, 7.3, 0.8, math.log(2e6), 3.0] + [0.3] * 9
            sol = least_squares(residuals, v0, args=(recs, face), bounds=(lo, hi), loss="soft_l1", f_scale=1.0)
            if best is None or sol.cost < best[0].cost: best = (sol, face)
    sol, face = best
    sx, sy, sz, lnK, h_desk, A = unpack(sol.x)
    res = residuals(sol.x, recs, face)[:-9].reshape(-1, 3)
    cal = dict(sensor_cm=[sx, sy, sz], K=math.exp(lnK), face=face, desk_centre_cm=h_desk, matrix=A.tolist(),
               rms_rel=float(np.sqrt((res**2).sum(1).mean())))
    if verbose:
        print(f"sensor {sx:+.2f}, {sy:+.2f} cm from the phone centre, {sz:.2f} cm above the table")
        print(f"magnet strength {math.exp(lnK):.0f} µT·cm³, face {'north' if face > 0 else 'south'} toward the screen, "
              f"standing centre {h_desk:.2f} cm up")
        print("distortion matrix (identity = none):"); print(np.array2string(A, precision=3, suppress_small=True))
        print(f"fit residual (relative): {cal['rms_rel']:.3f}")
    return cal

def synth(folder, seed=3):
    """Recordings from a made-up phone: sensor off-centre, 4 % distortion."""
    rng = np.random.default_rng(seed); os.makedirs(folder, exist_ok=True)
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
    dots = [tuple(map(float, l.split(" ", 1)[1].strip("()").split(","))) for l in os.popen(
        "python3 '" + os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "MetalFxDemo", "tools", "make_mat.py") + "' /dev/null").read().splitlines()]
    S = np.array([0.7, 6.1, 0.42]); K = 48000; face = 1.0; h_desk = 1.2
    A = np.eye(3) + rng.normal(0, 0.04, (3, 3))
    for pass_ in ("desk", "air3cm"):
        samples = []
        for i, (x, y) in enumerate(dots):
            z = h_desk if pass_ == "desk" else 3 + h_desk
            t = math.radians(rng.uniform(0, 4)); a = rng.uniform(0, 2*math.pi)
            m = face * np.array([math.sin(t)*math.cos(a), math.sin(t)*math.sin(a), math.cos(t)])
            B = A @ dipole(np.array([x/10, y/10, z]), S, m, K) + rng.normal(0, 0.5, 3)
            samples.append(dict(dot=i+1, x_mm=x, y_mm=y, field=B.tolist()))
        json.dump(dict(version=1, pass_=pass_, **{"pass": pass_}, face=1, strength=30000, samples=samples),
                  open(os.path.join(folder, f"synth-{pass_}.json"), "w"))
    print("truth: sensor", S.tolist(), "K", K, "face", face, "standing centre", h_desk); print("matrix"); print(np.array2string(A, precision=3))

def finetune(folder, steps=3000, out="locator5r.pt"):
    import torch
    from train import dev, LOGK_MID
    from train4 import Locator, features, position
    from train5 import sample
    recs = load(folder); cal = calibrate(recs)
    S = np.array(cal["sensor_cm"]); A_inv = np.linalg.inv(np.array(cal["matrix"]))
    # Real samples, undistorted by the fitted matrix, as sensor-relative training pairs.
    X, Y, names = [], [], []
    for r in recs:
        P = np.array([r["x"], r["y"], magnet_z(r, cal["desk_centre_cm"])]) - S
        X.append(A_inv @ r["B"]); Y.append(P); names.append(r["pass_"])
    X = torch.tensor(np.array(X), dtype=torch.float32, device=dev); Y = torch.tensor(np.array(Y), dtype=torch.float32, device=dev)
    n = len(X); idx = torch.randperm(n); held = idx[: max(1, n // 5)]; train_i = idx[max(1, n // 5):]
    lnK = torch.full((n,), math.log(cal["K"]), device=dev); one = torch.ones(n, device=dev); face = torch.full((n,), cal["face"], device=dev)
    model = Locator().to(dev); model.load_state_dict(torch.load("locator5.pt", map_location=dev))
    def held_err():
        with torch.no_grad():
            d_, lr, _, _ = model(features(X[held], lnK[held], one[held], face[held], one[held]))
            return (position(d_, lr) - Y[held]).norm(dim=-1).median().item()
    print(f"held-out real error before: {held_err():.2f} cm")
    opt = torch.optim.AdamW(model.parameters(), lr=1e-4)
    for step in range(steps):
        B, lk, kn, fc, fk, p = sample(4096)
        keep = B.norm(dim=-1) > 2.5
        xs = features(B[keep], lk[keep], kn[keep], fc[keep], fk[keep]); ys = p[keep]
        # real batch, lightly augmented, weighted up
        j = train_i[torch.randint(len(train_i), (256,), device=train_i.device)]
        xr = X[j] + torch.randn_like(X[j]) * 0.3
        xr = features(xr, lnK[j] + torch.randn(256, device=dev) * 0.1, one[j], face[j], one[j])
        xs = torch.cat([xs, xr]); ys = torch.cat([ys, Y[j]])
        d_, lr, lvr, lva = model(xs)
        r_true = ys.norm(dim=-1); u_true = ys / r_true[:, None]; e_r = lr - torch.log(r_true)
        th2 = 2 * (1 - (d_ * u_true).sum(-1)).clamp_min(0)
        w = torch.ones(len(ys), device=dev); w[-256:] = 4.0
        loss = ((0.5 * (lvr + e_r**2 / torch.exp(lvr)) + 0.5 * (lva + th2 / torch.exp(lva)) + 0.2 * (e_r**2 + th2)) * w).mean()
        opt.zero_grad(); loss.backward(); opt.step()
        if step % 1000 == 999: print(f"step {step+1}: held-out real error {held_err():.2f} cm", flush=True)
    torch.save(model.state_dict(), out); print("saved", out)

if __name__ == "__main__":
    cmd, folder = sys.argv[1], sys.argv[2]
    if cmd == "synth": synth(folder)
    elif cmd == "calibrate": calibrate(load(folder))
    elif cmd == "finetune": finetune(folder)
