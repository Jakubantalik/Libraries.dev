import math, sys, torch, numpy as np
from train import dev, LOGK_MID
from train4 import Locator, features, position
torch.manual_seed(11)
W, H = 6.55, 14.2
model = Locator().to(dev); model.load_state_dict(torch.load(sys.argv[1] if len(sys.argv) > 1 else "locator4.pt", map_location=dev)); model.eval()
def field(p, m, K):
    r = -p; l = r.norm(dim=-1, keepdim=True); rh = r / l
    return K * (3 * (m * rh).sum(-1, keepdim=True) * rh - m) / l**3
def run(sxy, grip, hlo, hhi, tmax, known, fknown, n=20000, K=6500.0):
    sx = torch.rand(n, device=dev) * W; sy = torch.rand(n, device=dev) * H; h = hlo + torch.rand(n, device=dev) * (hhi - hlo)
    tilt = torch.deg2rad(torch.rand(n, device=dev) * tmax); az = torch.rand(n, device=dev) * 2 * math.pi
    face = torch.where(torch.rand(n, device=dev) < 0.5, -1.0, 1.0)
    m = torch.stack([torch.sin(tilt)*torch.cos(az), torch.sin(tilt)*torch.sin(az), torch.cos(tilt)], -1) * face[:, None]
    p = torch.stack([sx - sxy[0], -(sy - sxy[1]), h + 0.4], -1)
    B = field(p, m, K) + torch.randn(n, 3, device=dev) * 0.2 + torch.randn(n, 3, device=dev) * 0.5
    ok = B.norm(dim=-1) > 2.5
    lk = torch.full((n,), math.log(K) if known else LOGK_MID, device=dev)
    with torch.no_grad():
        dirn, logr, lvr, lva = model(features(B, lk, torch.full((n,), known, device=dev), face, torch.full((n,), fknown, device=dev)))
        q = position(dirn, logr)
    px = sxy[0] + q[:, 0]; py = sxy[1] - q[:, 1]
    err = torch.sqrt((px - sx)**2 + (py - sy)**2)[ok].cpu().numpy(); yy = sy[ok].cpu().numpy(); xx = sx[ok].cpu().numpy()
    reg = np.where(yy < H/3, 0, np.where(yy < 2*H/3, 1, 2))
    s = "  ".join(f"{nm} {np.median(err[reg==i]):.2f}/{np.percentile(err[reg==i],90):.2f}" for i, nm in enumerate(["top", "mid", "bottom"]))
    return s
print("median/p90 error, cm")
for sxy, sname in [((3.27, 1.0), "sensor top centre"), ((4.45, 1.06), "sensor top right (sim)"), ((3.27, 4.0), "sensor 4 cm down")]:
    print(sname)
    for grip, hlo, hhi, tmax in [("hover 1-3 cm flat-ish", 0.8, 3.0, 20), ("puck on glass", 0.35, 0.6, 5)]:
        for fknown in (1.0, 0.0):
            print(f"  {grip:22s} K known, face {'known  ' if fknown else 'unknown'} | {run(sxy, grip, hlo, hhi, tmax, 1.0, fknown)}")
