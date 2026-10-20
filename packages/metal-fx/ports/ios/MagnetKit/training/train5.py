"""
Magnet locator v5: v4 (face input) trained on magnets around the phone too.

Poses (sensor-relative, cm; the phone lies screen-up, its sensor somewhere in
the top part of the phone, 0.3–0.5 cm above the table):
  45 % over the screen   — v4's grips: hovering, a puck on the glass, harder poses
  20 % beside, on the desk — standing (centre 0.15–1.5 cm up), small tilt
  25 % beside, in the air  — held 1.5–8 cm above the desk, hand tilt
  10 % hard               — anywhere, tilts to 45°
Beside the phone means outside its outline, up to 15 cm from the edges.
Face known 70 % (from the grab), strength known 70 %.
"""
import math, sys, time, torch, torch.nn as nn
from train import dev, LOGK_MID, LOGB_MID
from train2 import LOGR_MID
from train4 import Locator, features, position
torch.manual_seed(5)
PW, PH = 7.06, 14.66

def sample(n, d=dev):
    u = lambda *s: torch.rand(*s, device=d); rn = lambda *s: torch.randn(*s, device=d)
    # Phone in sensor coordinates: the sensor sits at (sx, sy) from the phone centre.
    sx = (u(n) * 2 - 1) * 2.5; sy = 2.5 + u(n) * 4.6; sh = 0.3 + u(n) * 0.2
    mode = u(n)
    over, desk, air = mode < 0.45, (mode >= 0.45) & (mode < 0.65), (mode >= 0.65) & (mode < 0.9)
    hard = mode >= 0.9
    # --- over the screen (phone-centred x, y inside the outline), v4 heights
    sub = u(n)
    hover, glass = sub < 0.55, (sub >= 0.55) & (sub < 0.85)
    ox = (u(n) * 2 - 1) * (PW / 2 - 0.3); oy = (u(n) * 2 - 1) * (PH / 2 - 0.3)
    oz = torch.where(glass, 0.75 + u(n) * 0.25, torch.where(hover, 1.2 + u(n) * 2.2, 0.85 + u(n) * 3.2))
    otilt = torch.where(glass, torch.full((n,), 6.0, device=d), torch.where(hover, torch.full((n,), 20.0, device=d), torch.full((n,), 40.0, device=d)))
    # --- beside the phone: a point outside the outline, up to 15 cm from it
    side = (u(n) * 4).floor()
    gap = 0.2 + 15 * u(n) ** 1.6                      # more samples near the phone
    along = u(n) * 2 - 1
    bx = torch.where(side == 0, -(PW / 2 + gap), torch.where(side == 1, PW / 2 + gap, along * (PW / 2 + gap)))
    by = torch.where(side == 2, -(PH / 2 + gap), torch.where(side == 3, PH / 2 + gap, along * (PH / 2 + gap)))
    dz = (0.15 + u(n) * 1.35) - sh                     # standing on the desk
    az_ = (1.5 + u(n) * 6.5) - sh                      # held in the air
    bz = torch.where(desk, dz, az_)
    btilt = torch.where(desk, torch.where(u(n) < 0.5, torch.full((n,), 8.0, device=d), torch.full((n,), 25.0, device=d)), torch.full((n,), 30.0, device=d))
    # --- hard: anywhere around, any reasonable height, big tilt
    hx = (u(n) * 2 - 1) * (PW / 2 + 12); hy = (u(n) * 2 - 1) * (PH / 2 + 12)
    inside = (hx.abs() < PW / 2) & (hy.abs() < PH / 2)
    hz = torch.where(inside, 0.75 + u(n) * 4, -0.3 + u(n) * 6)
    x = torch.where(over, ox, torch.where(hard, hx, bx))
    y = torch.where(over, oy, torch.where(hard, hy, by))
    z = torch.where(over, oz, torch.where(hard, hz, bz))
    tiltmax = torch.where(over, otilt, torch.where(hard, torch.full((n,), 45.0, device=d), btilt))
    # sensor-relative magnet position
    p = torch.stack([x - sx, y - sy, z], -1)
    tilt = torch.deg2rad(u(n) * tiltmax); az = u(n) * 2 * math.pi
    face = torch.where(u(n) < 0.5, -1.0, 1.0)
    m = torch.stack([torch.sin(tilt) * torch.cos(az), torch.sin(tilt) * torch.sin(az), torch.cos(tilt)], -1) * face[:, None]
    logK = math.log(2000.0) + u(n) * (math.log(150000.0) - math.log(2000.0))
    r = -p; l = r.norm(dim=-1, keepdim=True).clamp_min(0.4); rh = r / l
    B = torch.exp(logK)[:, None] * (3 * (m * rh).sum(-1, keepdim=True) * rh - m) / l**3
    A = torch.eye(3, device=d) + rn(n, 3, 3) * 0.02
    B = (A @ B[..., None])[..., 0]
    B = B + rn(n, 3) * (0.1 + u(n) * 0.3)[:, None] + rn(n, 3) * 0.5
    known = (u(n) < 0.7).float()
    logK_in = torch.where(known > 0, logK + rn(n) * 0.15, torch.full((n,), LOGK_MID, device=d))
    face_known = (u(n) < 0.7).float()
    return B, logK_in, known, face, face_known, p

if __name__ == "__main__":
    steps = int(sys.argv[1]) if len(sys.argv) > 1 else 30000
    model = Locator().to(dev)
    # Start from v4: it already knows the screen; v5 adds the surroundings.
    try:
        model.load_state_dict(torch.load("locator4.pt", map_location=dev)); print("from locator4.pt", flush=True)
    except Exception as e:
        print("fresh start:", e, flush=True)
    print(f"parameters: {sum(p.numel() for p in model.parameters()):,}", flush=True)
    opt = torch.optim.AdamW(model.parameters(), lr=1.0e-3, weight_decay=1e-5)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=1.0e-3, total_steps=steps, pct_start=0.05)
    t0 = time.time()
    for step in range(steps):
        B, lk, kn, fc, fk, p = sample(16384)
        keep = B.norm(dim=-1) > 2.5
        x = features(B[keep], lk[keep], kn[keep], fc[keep], fk[keep]); y = p[keep]
        dirn, logr, lvr, lva = model(x)
        r_true = y.norm(dim=-1); u_true = y / r_true[:, None]
        e_r = logr - torch.log(r_true)
        th2 = 2 * (1 - (dirn * u_true).sum(-1)).clamp_min(0)
        plain = (e_r**2 + th2).mean()
        nll = (0.5 * (lvr + e_r**2 / torch.exp(lvr)) + 0.5 * (lva + th2 / torch.exp(lva))).mean()
        loss = nll + 0.2 * plain
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
        if step % 2000 == 0 or step == steps - 1:
            with torch.no_grad():
                err = (position(dirn, logr) - y).norm(dim=-1); fkk = fk[keep] > 0
            print(f"step {step:6d}  median err face known {err[fkk].median().item():.2f} cm, unknown {err[~fkk].median().item():.2f}  nll {nll.item():.3f}  {time.time()-t0:.0f}s", flush=True)
    torch.save(model.state_dict(), "locator5.pt"); print("saved locator5.pt", flush=True)
