"""
Magnet tap v7: a magnet hovering over the glass, dipped quickly 2–3 cm
toward the screen and brought back, is a tap. The network reads the last
1.28 s of the field (64 samples at 50 Hz) and answers: did a tap just finish?

The magnitude alone cannot tell a tap from a sweep across the sensor or a
flick of the magnet (all make |B| jump and fall); the direction of the field
can — in a dip it barely turns, in a sweep it swings round, in a flick it
turns without the distance changing. The distance itself is never known
(2× farther with an 8× stronger magnet reads the same), so "2–3 cm" is
taught as a dip that brings the magnet a good part of the way to the
glass: depth ≥ 0.8 cm and ≥ 30 % of the height.

Trained only on simulated sequences: a hand-held magnet (tremor, wander,
tilt wobble) over or just beside the glass, with one event — a dip (quick or
slow, deep or shallow, coming back or staying down), a lift, a sweep (with
or without coming back), arriving, leaving, a flick of the magnet, nothing,
or no magnet at all — plus the phone turning in the Earth's field, an
imperfect zero, noise and sensor saturation.
"""
import math, sys, time, torch, torch.nn as nn
from train import dev
torch.manual_seed(7)
HZ, T = 50, 160                 # 3.2 s sequences at 50 Hz
W = 64                          # window: 1.28 s
N_IN = W * 3 + W + 1
SAT = 4500.0
PW, PH = 7.06, 14.66            # phone, cm
EVENTS = ["dip", "lift", "sweep", "arrive", "leave", "flick", "hover", "none"]
EV_P = [0.40, 0.09, 0.16, 0.06, 0.06, 0.10, 0.09, 0.04]

def dipole(p, m, K):
    r = -p; l = r.norm(dim=-1, keepdim=True).clamp_min(0.3); rh = r / l
    return K[..., None] * (3 * (m * rh).sum(-1, keepdim=True) * rh - m) / l**3

def smooth(x): return x * x * (3 - 2 * x)

def simulate(n, d=dev):
    """n sequences: field (n × T × 3, µT), per-sample label (1 tap just
    finished, 0 not) and weight (0 = don't care), event type, and for dips
    the time the return passed 75 % (s, else -1)."""
    u = lambda *s: torch.rand(*s, device=d); rn = lambda *s: torch.randn(*s, device=d)
    t = torch.arange(T, device=d).float() / HZ; tt = t[None, :]
    ev = torch.multinomial(torch.tensor(EV_P, device=d), n, replacement=True)
    # Sensor on the phone (from its centre), and the hover point over the glass
    # (a little past the edges too), height above the glass.
    sx = (u(n) * 2 - 1) * 1.5; sy = 5.5 + u(n) * 1.5
    hx = (u(n) * 2 - 1) * (PW / 2 + 0.8); hy = (u(n) * 2 - 1) * (PH / 2 + 0.8)
    h0 = 1.5 + u(n) * 4.5
    base = torch.stack([hx - sx, hy - sy, h0 + 0.4], -1)                   # n × 3, from the sensor
    pos = base[:, None, :].expand(n, T, 3).clone()
    te = 0.35 + u(n) * 2.0                                                  # event start
    # --- dip / lift: down, hold, up (part of the way back).
    # Most dips are taps (quick, deep, coming back); the rest anything.
    good = u(n) < 0.6
    dd = torch.where(good, 1.0 + u(n) * 2.8, 0.3 + u(n) * 4.2)
    dd = torch.minimum(dd, h0 - 0.15)
    d1 = torch.where(good, 0.06 + u(n) * 0.25, 0.06 + u(n) ** 1.5 * 0.7)
    hold = torch.where(good, u(n) * 0.1, u(n) ** 2 * 0.4)
    up = torch.where(good, 0.08 + u(n) * 0.3, 0.08 + u(n) ** 1.5 * 0.8)
    frac = torch.where(good | (u(n) < 0.5), 0.75 + u(n) * 0.4, u(n) * 0.75)
    sd = smooth(((tt - te[:, None]) / d1[:, None]).clamp(0, 1))
    su = smooth(((tt - (te + d1 + hold)[:, None]) / up[:, None]).clamp(0, 1))
    lat = rn(n, 2) * 0.3
    sign = torch.where(ev == 1, -1.0, 1.0)                                  # a lift goes up
    dz = -sign[:, None] * dd[:, None] * (sd - frac[:, None] * su)
    dxy = lat[:, None, :] * (sd - 0.7 * frac[:, None] * su)[..., None]
    isdip = (ev == 0) | (ev == 1)
    pos[..., 2] = pos[..., 2] + torch.where(isdip[:, None], dz, torch.zeros_like(dz))
    pos[..., :2] = pos[..., :2] + torch.where(isdip[:, None, None], dxy, torch.zeros_like(dxy))
    # --- sweep: across the glass, sometimes back again.
    ang = u(n) * 2 * math.pi; L = 2 + u(n) * 7; sdur = 0.12 + u(n) * 0.6
    back = u(n) < 0.4
    s1 = smooth(((tt - te[:, None]) / sdur[:, None]).clamp(0, 1))
    s2 = smooth(((tt - (te + sdur + 0.05 + u(n) * 0.2)[:, None]) / sdur[:, None]).clamp(0, 1))
    sw = (s1 - torch.where(back[:, None], s2, torch.zeros_like(s2)))
    vec = torch.stack([torch.cos(ang), torch.sin(ang)], -1) * L[:, None]
    dzs = (rn(n) * 0.4)[:, None] * sw
    swp = torch.cat([vec[:, None, :] * sw[..., None], dzs[..., None]], -1)
    pos = pos + torch.where((ev == 2)[:, None, None], swp, torch.zeros_like(swp))
    # --- arrive / leave: from or to far away (up and/or sideways).
    far = rn(n, 3); far[:, 2] = far[:, 2].abs() * 1.5 + 0.5
    far = far / far.norm(dim=-1, keepdim=True) * (6 + u(n) * 14)[:, None]
    adur = 0.12 + u(n) * 0.9
    sa = smooth(((tt - te[:, None]) / adur[:, None]).clamp(0, 1))
    arr = far[:, None, :] * (1 - sa)[..., None]
    lea = far[:, None, :] * sa[..., None]
    pos = pos + torch.where((ev == 3)[:, None, None], arr, torch.zeros_like(arr))
    pos = pos + torch.where((ev == 4)[:, None, None], lea, torch.zeros_like(lea))
    # Hand: tremor and wander (and a slow height drift).
    amp = 0.02 + u(n) * 0.08; f1 = 4 + u(n) * 8; f2 = 4 + u(n) * 8
    trem = torch.stack([amp[:, None] * (torch.sin(2 * math.pi * f1[:, None] * tt + u(n, 1) * 6.3) + 0.6 * torch.sin(2 * math.pi * f2[:, None] * tt + u(n, 1) * 6.3)) for _ in range(3)], -1)
    wf = 0.15 + u(n) * 0.8; wamp = 0.05 + u(n) * 0.3
    wander = torch.stack([wamp[:, None] * torch.sin(2 * math.pi * wf[:, None] * tt + u(n, 1) * 6.3) for _ in range(3)], -1)
    pos = pos + trem + wander
    pos[..., 2] = pos[..., 2].clamp_min(0.5)
    # Magnet: strength, face down or up, tilt with wobble; a flick turns it and back.
    K = torch.exp(math.log(1500.0) + u(n) * (math.log(150000.0) - math.log(1500.0)))
    K = torch.where(ev == 7, torch.zeros_like(K), K)
    face = torch.where(u(n) < 0.5, -1.0, 1.0)
    tilt = torch.deg2rad(u(n) * 25); az = u(n) * 2 * math.pi
    tw = torch.deg2rad(4 * u(n))[:, None] * torch.sin(2 * math.pi * (0.5 + u(n))[:, None] * tt)
    fl = torch.deg2rad(25 + u(n) * 95); fdur = 0.08 + u(n) * 0.35
    f1s = smooth(((tt - te[:, None]) / fdur[:, None]).clamp(0, 1))
    f2s = smooth(((tt - (te + fdur + u(n) * 0.2)[:, None]) / fdur[:, None]).clamp(0, 1))
    flick = torch.where((ev == 5)[:, None], fl[:, None] * (f1s - torch.where(u(n) < 0.7, 1.0, 0.0)[:, None] * f2s), torch.zeros_like(tt).expand(n, T))
    tl = tilt[:, None] + tw + flick
    m = torch.stack([torch.sin(tl) * torch.cos(az)[:, None], torch.sin(tl) * torch.sin(az)[:, None], torch.cos(tl)], -1) * face[:, None, None]
    M = dipole(pos, m, K[:, None].expand(n, T))
    # The phone turning a little in the Earth's field, an imperfect zero, noise.
    E = rn(n, 3); E = E / E.norm(dim=-1, keepdim=True) * 45
    rot = torch.deg2rad(u(n) * 8)[:, None] * torch.sin(2 * math.pi * (0.1 + u(n) * 0.6)[:, None] * tt + u(n, 1) * 6.3)
    axis = rn(n, 3); axis = axis / axis.norm(dim=-1, keepdim=True)
    Er = E[:, None, :] * torch.cos(rot)[..., None] + torch.cross(axis[:, None, :].expand(n, T, 3), E[:, None, :].expand(n, T, 3), dim=-1) * torch.sin(rot)[..., None]
    off = rn(n, 3) * torch.where(u(n) < 0.2, 40.0, 5.0)[:, None]
    noise = rn(n, T, 3) * (0.25 + u(n) * 0.4)[:, None, None]
    B = (M + (Er - E[:, None, :]) + off[:, None, :] + noise).clamp(-SAT, SAT)
    # Labels. A tap must be seen: the field has to rise clearly over the
    # hover (≥ 8 µT and ≥ 1.5×); one too faint to see is not a tap.
    clean = (M + off[:, None, :]).norm(dim=-1)
    i0 = (te * HZ).long().clamp(0, T - 1)
    i1 = ((te + d1 + hold + up) * HZ).long().clamp(0, T - 1)
    k = torch.arange(T, device=d)[None, :]
    during = (k >= i0[:, None]) & (k <= i1[:, None])
    peak = torch.where(during, clean, torch.zeros_like(clean)).max(1).values
    base0 = clean.gather(1, i0[:, None])[:, 0]
    rise = peak - base0; ratio = peak / base0.clamp_min(1)
    seen = (rise >= 8) & (ratio >= 1.5)
    faint = (rise < 3) | (ratio < 1.2)
    rel = dd / (h0 + 0.4)
    total = d1 + hold + up
    t_ret = te + d1 + hold + 0.674 * up
    dip = ev == 0
    pos_ev = dip & seen & (dd >= 0.8) & (rel >= 0.3) & (total <= 0.85) & (frac >= 0.7)
    neg_ev = ~dip | faint | (dd < 0.5) | (rel < 0.18) | (total > 1.3) | (frac < 0.45)
    amb_ev = dip & ~pos_ev & ~neg_ev
    lab = torch.zeros(n, T, device=d); wt = torch.ones(n, T, device=d)
    a = tt - t_ret[:, None]
    lab = torch.where(pos_ev[:, None] & (a >= 0) & (a <= 0.3), torch.ones_like(lab), lab)
    wt = torch.where(pos_ev[:, None] & (((a >= -0.15) & (a < 0)) | ((a > 0.3) & (a <= 0.5))), torch.zeros_like(wt), wt)
    wt = torch.where(amb_ev[:, None] & (tt >= te[:, None]) & (a <= 0.5), torch.zeros_like(wt), wt)
    # A magnet that only just arrived (within 0.3 s): the window has no hover to compare with.
    t_ret = torch.where(pos_ev, t_ret, torch.full_like(t_ret, -1.0))
    return B, lab, wt, ev, pos_ev, amb_ev, t_ret, te + total

def features(win):
    """win: n × W × 3, oldest first, the last sample is now."""
    mag = win.norm(dim=-1)
    S = mag.median(dim=1).values.clamp_min(10)
    vec = (win / S[:, None, None]).clamp(-8, 8).reshape(win.shape[0], -1)
    lm = torch.log(mag.clamp_min(1) / S[:, None]).clamp(-4, 4)
    return torch.cat([vec, lm, (torch.log1p(S / 10) / 6)[:, None]], -1)

class Tap(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(N_IN, 256), nn.SiLU(), nn.Linear(256, 256), nn.SiLU(),
                                 nn.Linear(256, 128), nn.SiLU(), nn.Linear(128, 1))
    def forward(self, x): return self.net(x)[:, 0]

def batch(n=2048, cuts=6, d=dev):
    B, lab, wt, ev, pos_ev, amb_ev, t_ret, t_end = simulate(n, d)
    X, Y, Wt = [], [], []
    for c in range(cuts):
        if c % 2 == 0:
            e = torch.randint(W - 1, T, (n,), device=d)
        else:   # near the event, so taps are not rare
            e = ((t_ret.clamp_min(0) + (torch.rand(n, device=d) - 0.3) * 0.9) * HZ).long().clamp(W - 1, T - 1)
            e = torch.where(t_ret > 0, e, torch.randint(W - 1, T, (n,), device=d))
        idx = e[:, None] - (W - 1) + torch.arange(W, device=d)[None, :]
        win = torch.gather(B, 1, idx[..., None].expand(n, W, 3))
        X.append(features(win)); Y.append(lab.gather(1, e[:, None])[:, 0]); Wt.append(wt.gather(1, e[:, None])[:, 0])
    return torch.cat(X), torch.cat(Y), torch.cat(Wt)

def evaluate(model, B, lab, wt, ev, pos_ev, amb_ev, t_ret, t_end, thr=0.5):
    """Dense: every window end. Recall per tap; false fires per event type."""
    n = B.shape[0]; ends = torch.arange(W - 1, T, device=B.device)
    P = []
    with torch.no_grad():
        for e in ends:
            P.append(torch.sigmoid(model(features(B[:, e - W + 1:e + 1]))))
    P = torch.stack(P, 1)                                       # n × (T-W+1)
    te = ends.float()[None, :] / HZ
    fire = P > thr
    L = lab[:, W - 1:]; Wt = wt[:, W - 1:]
    a = te - t_ret[:, None]
    inband = (a >= -0.15) & (a <= 0.5)
    hit = (fire & inband).any(1)
    false = (fire & (Wt > 0) & (L < 0.5) & ~(pos_ev[:, None] & inband)).any(1)
    msg = []
    pe = pos_ev & (t_ret + 0.5 < (T - 1) / HZ) & (t_ret - 1.0 > (W - 1) / HZ)
    if pe.any():
        msg.append(f"tap recall {100 * hit[pe].float().mean().item():.1f}%")
        first = torch.where(fire & inband, te, torch.full_like(te, 99)).min(1).values
        lat = (first - t_end)[pe & hit]
        msg.append(f"fires {1000 * lat.median().item():+.0f} ms after the motion ends")
    for k, name in enumerate(EVENTS):
        mk = (ev == k) & ~amb_ev & ~pos_ev
        if mk.any(): msg.append(f"{name} {100 * false[mk].float().mean().item():.1f}%")
    return "  false fires: ".join([" ".join(msg[:2]), " ".join(msg[2:])])

if __name__ == "__main__":
    steps = int(sys.argv[1]) if len(sys.argv) > 1 else 12000
    model = Tap().to(dev)
    print(f"parameters: {sum(p.numel() for p in model.parameters()):,}", flush=True)
    torch.manual_seed(70); val = simulate(3000); torch.manual_seed(7)
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-5)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=1e-3, total_steps=steps, pct_start=0.05)
    bce = nn.BCEWithLogitsLoss(reduction="none")
    t0 = time.time()
    for step in range(steps):
        X, Y, Wt = batch()
        loss = (bce(model(X), Y) * Wt).sum() / Wt.sum().clamp_min(1)
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
        if step % 1500 == 0 or step == steps - 1:
            model.eval(); msg = evaluate(model, *val); model.train()
            print(f"step {step:6d} loss {loss.item():.3f} | {msg} | {time.time()-t0:.0f}s", flush=True)
    torch.save(model.state_dict(), "tap7.pt"); print("saved tap7.pt", flush=True)
