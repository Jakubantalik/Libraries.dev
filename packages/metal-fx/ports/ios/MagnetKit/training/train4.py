"""
Magnet locator v4: v3 plus the magnet's face as an input.

With only the field, a magnet some way beside the sensor and a flipped magnet
on the opposite side give the same reading (the field direction repeats, the
strength fits a slightly different distance). v3 settled that with a prior
("the magnet is usually below the sensor"), which fails beside or above it.
Once the face is known (the 9-dot measurement finds it) the answer is unique,
so v4 takes it as an input: the field is turned to face +1 (north toward the
user) and a flag says so. Without it, v4 falls back to v3's flip-to-Bz≥0 and
prior. With the face known the prior is also wider, so a sensor anywhere on the
top half (or the middle) still works.
"""
import math, sys, time, torch, torch.nn as nn
from train import dev, LOGK_MID, LOGB_MID
from train2 import LOGR_MID
torch.manual_seed(4)

def sample(n, d=dev):
    u = lambda *s: torch.rand(*s, device=d); rn = lambda *s: torch.randn(*s, device=d)
    mode = u(n)
    hover, glass = mode < 0.5, (mode >= 0.5) & (mode < 0.8)
    near = u(n) < 0.4
    face_known = (u(n) < 0.7).float()
    px = torch.where(near, (u(n) * 2 - 1) * 4.0, (u(n) * 2 - 1) * 6.5)
    py_v3 = torch.where(near, -6.0 + u(n) * 7.5, -15.5 + u(n) * 17.0)
    py_wide = torch.where(near, -6.0 + u(n) * 10.0, -15.5 + u(n) * 21.5)
    py = torch.where(face_known > 0, py_wide, py_v3)
    pz = torch.where(glass, 0.75 + u(n) * 0.25, torch.where(hover, 1.2 + u(n) * 2.2, 0.85 + u(n) * 3.2))
    tiltmax = torch.where(glass, torch.full((n,), 6.0, device=d), torch.where(hover, torch.full((n,), 20.0, device=d), torch.full((n,), 45.0, device=d)))
    tilt = torch.deg2rad(u(n) * tiltmax); az = u(n) * 2 * math.pi
    face = torch.where(u(n) < 0.5, -1.0, 1.0)
    m = torch.stack([torch.sin(tilt) * torch.cos(az), torch.sin(tilt) * torch.sin(az), torch.cos(tilt)], -1) * face[:, None]
    logK = math.log(2000.0) + u(n) * (math.log(70000.0) - math.log(2000.0))
    p = torch.stack([px, py, pz], -1)
    r = -p; l = r.norm(dim=-1, keepdim=True); rh = r / l
    B = torch.exp(logK)[:, None] * (3 * (m * rh).sum(-1, keepdim=True) * rh - m) / l**3
    A = torch.eye(3, device=d) + rn(n, 3, 3) * 0.02
    B = (A @ B[..., None])[..., 0]
    B = B + rn(n, 3) * (0.1 + u(n) * 0.3)[:, None] + rn(n, 3) * 0.5
    known = (u(n) < 0.7).float()
    logK_in = torch.where(known > 0, logK + rn(n) * 0.08, torch.full((n,), LOGK_MID, device=d))
    return B, logK_in, known, face, face_known, p

def features(B, logK_in, known, face, face_known):
    flipped = torch.where(B[:, 2:3] < 0, -B, B)
    Bc = torch.where(face_known[:, None] > 0, B * face[:, None], flipped)
    nb = B.norm(dim=-1, keepdim=True).clamp_min(1e-6)
    return torch.cat([Bc / nb, (torch.log(nb) - LOGB_MID) / 2.0, ((logK_in - LOGK_MID) / 1.5)[:, None], known[:, None], face_known[:, None]], -1)

class Locator(nn.Module):
    def __init__(self, widths=(512, 512, 512, 256), n_in=7):
        super().__init__()
        layers, d = [], n_in
        for w in widths: layers += [nn.Linear(d, w), nn.SiLU()]; d = w
        layers += [nn.Linear(d, 6)]
        self.net = nn.Sequential(*layers)
    def forward(self, x):
        o = self.net(x)
        dirn = o[:, :3] / o[:, :3].norm(dim=-1, keepdim=True).clamp_min(1e-6)
        return dirn, o[:, 3] + LOGR_MID, o[:, 4].clamp(-10, 4), o[:, 5].clamp(-10, 4)

def position(dirn, logr): return dirn * torch.exp(logr)[:, None]

if __name__ == "__main__":
    steps = int(sys.argv[1]) if len(sys.argv) > 1 else 24000
    model = Locator().to(dev)
    print(f"parameters: {sum(p.numel() for p in model.parameters()):,}", flush=True)
    opt = torch.optim.AdamW(model.parameters(), lr=1.5e-3, weight_decay=1e-5)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=1.5e-3, total_steps=steps, pct_start=0.05)
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
        loss = plain if step < steps * 0.1 else nll + 0.2 * plain
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
        if step % 2000 == 0 or step == steps - 1:
            with torch.no_grad():
                err = (position(dirn, logr) - y).norm(dim=-1)
                fkk = fk[keep] > 0
            print(f"step {step:6d}  median err face known {err[fkk].median().item():.2f} cm, unknown {err[~fkk].median().item():.2f}  nll {nll.item():.3f}  {time.time()-t0:.0f}s", flush=True)
    torch.save(model.state_dict(), "locator4.pt"); print("saved locator4.pt", flush=True)
