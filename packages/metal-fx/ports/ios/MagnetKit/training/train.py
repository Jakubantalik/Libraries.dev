"""
Magnet locator: a network trained only on simulated physics.

Input: one magnetometer change (µT, device axes: x right, y toward the top
edge, z out of the screen) plus an optional magnet-strength hint.
Output: where the magnet is relative to the sensor (cm, device axes) and the
network's own uncertainty, so any iPhone works once its sensor spot is known.
"""
import math, json, struct, time, sys
import torch, torch.nn as nn

dev = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
torch.manual_seed(0)

LOGK_MID = math.log(10000.0)      # µT·cm³, the strength range's centre
LOGB_MID = math.log(40.0)         # µT

def sample(n, hover_only=False, d=dev):
    u = lambda *s: torch.rand(*s, device=d)
    rn = lambda *s: torch.randn(*s, device=d)
    # Magnet relative to the sensor, cm. Covers every iPhone screen with the sensor near the top.
    px = (u(n) * 2 - 1) * 7.5
    py = -16.0 + u(n) * 20.0
    glass = (u(n) < (0.0 if hover_only else 0.2))
    pz = torch.where(glass, 0.75 + u(n) * 0.3, 0.85 + u(n) * 3.2)
    tilt = torch.deg2rad(u(n) * 40.0); az = u(n) * 2 * math.pi
    sgn = torch.where(u(n) < 0.5, -1.0, 1.0)
    m = torch.stack([torch.sin(tilt) * torch.cos(az), torch.sin(tilt) * torch.sin(az), torch.cos(tilt)], -1) * sgn[:, None]
    logK = math.log(1500.0) + u(n) * (math.log(70000.0) - math.log(1500.0))
    p = torch.stack([px, py, pz], -1)
    r = -p
    l = r.norm(dim=-1, keepdim=True); rh = r / l
    B = torch.exp(logK)[:, None] * (3 * (m * rh).sum(-1, keepdim=True) * rh - m) / l**3
    # The phone: small gain/rotation distortion, noise, leftover drift.
    A = torch.eye(3, device=d) + rn(n, 3, 3) * 0.02
    B = (A @ B[..., None])[..., 0]
    B = B + rn(n, 3) * (0.1 + u(n) * 0.3)[:, None] + rn(n, 3) * 0.6
    # Strength hint: half the time a known magnet (±10 %), half unknown.
    known = (u(n) < 0.5).float()
    logK_in = torch.where(known > 0, logK + rn(n) * 0.1, torch.full((n,), LOGK_MID, device=d))
    return B, logK_in, known, p

def features(B, logK_in, known):
    nb = B.norm(dim=-1, keepdim=True).clamp_min(1e-6)
    return torch.cat([B / nb, (torch.log(nb) - LOGB_MID) / 2.0, ((logK_in - LOGK_MID) / 1.5)[:, None], known[:, None]], -1)

class Locator(nn.Module):
    def __init__(self, widths=(512, 512, 512, 256)):
        super().__init__()
        layers, d = [], 6
        for w in widths:
            layers += [nn.Linear(d, w), nn.SiLU()]
            d = w
        layers += [nn.Linear(d, 6)]
        self.net = nn.Sequential(*layers)
    def forward(self, x):
        o = self.net(x)
        return o[:, :3] * 5.0, o[:, 3:].clamp(-8, 6)     # mean (cm), log variance

def readable(B): return B.norm(dim=-1) > 2.5

if __name__ == "__main__":
    steps = int(sys.argv[1]) if len(sys.argv) > 1 else 20000
    model = Locator().to(dev)
    nparams = sum(p.numel() for p in model.parameters())
    print(f"parameters: {nparams:,}  device: {dev}")
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-5)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=2e-3, total_steps=steps, pct_start=0.05)
    t0 = time.time()
    for step in range(steps):
        B, lk, kn, p = sample(16384)
        keep = readable(B)
        x = features(B[keep], lk[keep], kn[keep]); y = p[keep]
        mu, logv = model(x)
        mse = ((mu - y)**2).sum(-1).mean()
        nll = (0.5 * (logv + (mu - y)**2 / torch.exp(logv))).sum(-1).mean()
        loss = nll if step > steps * 0.1 else mse
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
        if step % 2000 == 0 or step == steps - 1:
            print(f"step {step:6d}  rmse {math.sqrt(mse.item()):.3f} cm  nll {nll.item():.3f}  {time.time()-t0:.0f}s", flush=True)
    torch.save(model.state_dict(), "locator.pt")
    print("saved locator.pt")
