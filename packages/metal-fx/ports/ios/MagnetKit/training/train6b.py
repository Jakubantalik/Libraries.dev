"""
Magnet presence v6: is there really a magnet, or is the phone's own sensor
lying? A magnet brought within ~2 cm of an iPhone's magnetometer (>2,000 µT)
magnetises parts near it and leaves an offset of 50–250 µT that lasts minutes
— one reading of it looks exactly like a magnet. Over time they differ: a
hand-held magnet always trembles, a resting one arrived by approaching, a
leftover stays behind after a strong reading drops. This network reads the
last 15 s (1.28 s in detail) and answers: magnet present (probability) and
the non-magnet part of the reading (the offset to subtract).

Trained only on simulated sequences: dipole magnets moved by a hand (tremor,
wander), set down (still), taken away fast or slowly, brought too close
(overload → remanent offset), calibrated with a magnet nearby (offset = minus
its field), drift and sensor noise, axis saturation.
"""
import math, sys, time, torch, torch.nn as nn
from train import dev
torch.manual_seed(6)
HZ, T = 50, 750                 # 15 s at 50 Hz
SHORT, LONG_N, LONG_STEP = 64, 40, 5   # 1.28 s detail; 4 s at 10 Hz
N_IN = SHORT * 3 + LONG_N + 4
SAT = 4500.0

def dipole(p, m, K):
    r = -p; l = r.norm(dim=-1, keepdim=True).clamp_min(0.4); rh = r / l
    return K[..., None] * (3 * (m * rh).sum(-1, keepdim=True) * rh - m) / l**3

def sample_pos(n, d, near=False):
    u = lambda *s: torch.rand(*s, device=d)
    if near:   # over the glass close to the sensor (overload zone for a big magnet)
        a = u(n) * 2 * math.pi; rr = 0.6 + u(n) * 1.8
        return torch.stack([rr * torch.cos(a), rr * torch.sin(a) - 0.5, 0.55 + u(n) * 1.2], -1)
    PW, PH = 7.06, 14.66
    sx = (u(n) * 2 - 1) * 1.5; sy = 5.5 + u(n) * 1.5
    mode = u(n)
    over = mode < 0.4
    ox = (u(n) * 2 - 1) * (PW / 2 - 0.3); oy = (u(n) * 2 - 1) * (PH / 2 - 0.3); oz = 0.8 + u(n) * 2.5
    side = (u(n) * 4).floor(); gap = 0.3 + 10 * u(n) ** 1.5; al = u(n) * 2 - 1
    bx = torch.where(side == 0, -(PW / 2 + gap), torch.where(side == 1, PW / 2 + gap, al * (PW / 2 + gap)))
    by = torch.where(side == 2, -(PH / 2 + gap), torch.where(side == 3, PH / 2 + gap, al * (PH / 2 + gap)))
    bz = torch.where(u(n) < 0.5, 0.2 + u(n) * 1.2, 1.5 + u(n) * 4.0) - 0.4
    x = torch.where(over, ox, bx); y = torch.where(over, oy, by); z = torch.where(over, oz, bz)
    return torch.stack([x - sx, y - sy, z], -1)

def far_pos(n, d):
    u = lambda *s: torch.rand(*s, device=d)
    a = u(n) * 2 * math.pi; rr = 40 + u(n) * 40
    return torch.stack([rr * torch.cos(a), rr * torch.sin(a), 2 + u(n) * 20], -1)

def smooth(x): return x * x * (3 - 2 * x)

def simulate(n, d=dev):
    """n sequences of T samples: measured field (µT, device axes), and at the
    end: magnet present, offset (non-magnet part)."""
    u = lambda *s: torch.rand(*s, device=d); rn = lambda *s: torch.randn(*s, device=d)
    t = torch.arange(T, device=d).float() / HZ                         # T
    # Scenario: 0 hand-held at the end, 1 resting at the end, 2 taken away fast,
    # 3 taken away slowly, 4 no magnet at all, 5 hand-held far (weak).
    sc = torch.multinomial(torch.tensor([0.24, 0.2, 0.18, 0.12, 0.14, 0.12], device=d), n, replacement=True)
    P1 = sample_pos(n, d); P2 = sample_pos(n, d); Pn = sample_pos(n, d, near=True); Pf = far_pos(n, d)
    end = torch.where((sc == 2)[:, None] | (sc == 3)[:, None] | (sc == 4)[:, None], Pf, P2)
    end = torch.where((sc == 5)[:, None], P2 * (2.5 + 2 * u(n))[:, None], end)
    start = torch.where((sc == 4)[:, None], Pf, P1)
    overload = (u(n) < 0.4) & (sc != 4)
    mid = torch.where(overload[:, None], Pn, (start + end) / 2 + rn(n, 3) * 1.5)
    # Timeline: at start until ta, to mid by tb, to end by tc, then stay.
    ta = 0.5 + u(n) * 6; dur1 = 0.3 + u(n) * 1.5
    tb = ta + dur1; hold = torch.where(overload, 0.2 + u(n) * 1.5, u(n) * 0.5)
    fast = (sc == 2) | ((sc != 3) & (u(n) < 0.5))
    dur2 = torch.where(fast, 0.08 + u(n) * 0.25, 0.8 + u(n) * 2.5)
    tc = (tb + hold + dur2).clamp(max=14.4); t2 = tb + hold
    tt = t[None, :]
    s1 = smooth(((tt - ta[:, None]) / dur1[:, None]).clamp(0, 1))
    s2 = smooth(((tt - t2[:, None]) / (tc - t2)[:, None].clamp_min(0.05)).clamp(0, 1))
    pos = start[:, None] + (mid - start)[:, None] * s1[..., None]
    pos = pos + (end - mid)[:, None] * s2[..., None]
    # Hand: tremor (4–12 Hz, 0.02–0.1 cm) and wander, except a magnet at rest.
    resting_end = (sc == 1)
    held = torch.ones(n, T, device=d)
    held = torch.where(resting_end[:, None] & (tt > tc[:, None] + 0.15), torch.zeros_like(held), held)
    held = torch.where((sc == 4)[:, None], torch.zeros_like(held), held)
    amp = 0.02 + u(n) * 0.08; f1 = 4 + u(n) * 8; f2 = 4 + u(n) * 8
    trem = torch.stack([amp[:, None] * (torch.sin(2 * math.pi * f1[:, None] * tt + u(n, 1) * 6.3) + 0.6 * torch.sin(2 * math.pi * f2[:, None] * tt + u(n, 1) * 6.3)) for _ in range(3)], -1)
    wf = 0.2 + u(n) * 0.8; wamp = 0.05 + u(n) * 0.35
    wander = torch.stack([wamp[:, None] * torch.sin(2 * math.pi * wf[:, None] * tt + u(n, 1) * 6.3) for _ in range(3)], -1)
    pos = pos + (trem + wander) * held[..., None]
    # Magnet: strength, face, tilt (a hand wobbles it a little).
    logK = math.log(2000.0) + u(n) * (math.log(150000.0) - math.log(2000.0)); K = torch.exp(logK)
    face = torch.where(u(n) < 0.5, -1.0, 1.0)
    tilt = torch.deg2rad(u(n) * 20); az = u(n) * 2 * math.pi
    tw = torch.deg2rad(3 * u(n))[:, None] * torch.sin(2 * math.pi * (0.5 + u(n))[:, None] * tt) * held
    tl = tilt[:, None] + tw
    m = torch.stack([torch.sin(tl) * torch.cos(az)[:, None], torch.sin(tl) * torch.sin(az)[:, None], torch.cos(tl)], -1) * face[:, None, None]
    M = dipole(pos, m, K[:, None].expand(n, T))
    # Offset: a calibration taken with a magnet nearby (minus its field), small
    # leftovers, and the remanence an overload leaves once the field drops.
    O = torch.zeros(n, T, 3, device=d)
    # (A calibration taken with the magnet nearby is left to the kit's
    # remembered-zero rule: once static it is indistinguishable from a magnet
    # at rest, so teaching it here only blurs "resting = present".)
    calbad = u(n) < 0.0
    Pc = sample_pos(n, d); Kc = torch.exp(math.log(2000.0) + u(n) * (math.log(150000.0) - math.log(2000.0)))
    mc = torch.stack([torch.zeros(n, device=d), torch.zeros(n, device=d), torch.where(u(n) < 0.5, -1.0, 1.0)], -1)
    Oc = -dipole(Pc, mc, Kc); Oc = Oc * (Oc.norm(dim=-1, keepdim=True).clamp_max(400) / Oc.norm(dim=-1, keepdim=True).clamp_min(1e-6))
    O = O + torch.where(calbad[:, None, None], Oc[:, None, :].expand(n, T, 3), torch.zeros_like(O))
    O = O + (rn(n, 3) * 2.0)[:, None, :]
    # A leftover from an overload long before this window (minutes: on an
    # iPhone 15 Pro 160–250 µT, still 135 µT six minutes on): steady from the start.
    pre = rn(n, 3); pre = pre / pre.norm(dim=-1, keepdim=True) * (30 + u(n) * 270)[:, None]
    O = O + torch.where((u(n) < 0.35)[:, None], pre, torch.zeros_like(pre))[:, None, :]
    big = M.norm(dim=-1) > 2000
    hit = big.any(dim=1)
    first = torch.where(hit, big.float().argmax(dim=1), torch.full((n,), T, device=d, dtype=torch.long))
    # Released: the first sample after the overload where the field is back under 1,000 µT.
    after = (torch.arange(T, device=d)[None, :] > first[:, None]) & (M.norm(dim=-1) < 1000)
    rel = torch.where(after.any(dim=1), after.float().argmax(dim=1), torch.full((n,), T, device=d, dtype=torch.long))
    dO = rn(n, 3); dO = dO / dO.norm(dim=-1, keepdim=True) * (40 + u(n) * 220)[:, None]
    since = ((torch.arange(T, device=d)[None, :] - rel[:, None]).float() / HZ).clamp_min(0)
    on = (torch.arange(T, device=d)[None, :] >= rel[:, None]).float() * hit[:, None].float()
    O = O + dO[:, None, :] * (on * (1 - torch.exp(-since / 0.3)))[..., None]
    # Drift and noise; the sensor saturates.
    drift = torch.cumsum(rn(n, T, 3) * 0.03, dim=1)
    noise = rn(n, T, 3) * (0.25 + u(n) * 0.35)[:, None, None]
    B = (M + O + drift + noise).clamp(-SAT, SAT)
    return B, M.norm(dim=-1), O + drift, sc, hit

def features(B):
    """B: n × T' × 3, the last sample is now (T' ≥ 750 at 50 Hz)."""
    n = B.shape[0]
    last = B[:, -1]
    S = last.norm(dim=-1).clamp_min(10)
    short = (B[:, -SHORT:] / S[:, None, None]).clamp(-6, 6).reshape(n, -1)
    mag = B.norm(dim=-1)
    long = torch.log1p(mag[:, -LONG_N * LONG_STEP::LONG_STEP] / 10) / 6
    peak, idx = mag.max(dim=1)
    since = (B.shape[1] - 1 - idx).float() / HZ / 15
    ctx = torch.stack([torch.log1p(peak / 100) / 4, since, torch.log1p(S / 10) / 6, (peak > 2000).float()], -1)
    return torch.cat([short, long, ctx], -1), S

class Presence(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(N_IN, 256), nn.SiLU(), nn.Linear(256, 256), nn.SiLU(),
                                 nn.Linear(256, 128), nn.SiLU(), nn.Linear(128, 4))
    def forward(self, x):
        o = self.net(x)
        return o[:, 0], o[:, 1:]      # presence logit, offset / S

def make_dataset(n_batches, cuts=(300, 420, 560, 750), d=dev):
    """Features and labels, each simulated batch cut at several "now" points."""
    X, P, OFF, SC, HIT, W, MN = [], [], [], [], [], [], []
    for _ in range(n_batches):
        B, Mn, Off, sc, hit = simulate(2048, d)
        for c in cuts:
            jitter = int(torch.randint(-40, 1, (1,)).item()) if c == 750 else int(torch.randint(-60, 60, (1,)).item())
            cc = max(SHORT + LONG_N * LONG_STEP, min(T, c + jitter))
            x, S = features(B[:, :cc])
            X.append(x.half()); P.append((Mn[:, cc - 1] > 10).float())
            W.append(((Mn[:, cc - 1] < 4) | (Mn[:, cc - 1] > 16)).float())
            MN.append(Mn[:, cc - 1].half())
            OFF.append(((Off[:, cc - 1]) / S[:, None]).clamp(-6, 6).half())
            SC.append(sc); HIT.append(hit & (torch.arange(T, device=d)[None, :cc].shape[1] > 0))
    return torch.cat(X), torch.cat(P), torch.cat(OFF), torch.cat(SC), torch.cat(HIT), torch.cat(W), torch.cat(MN)

if __name__ == "__main__":
    epochs = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    t0 = time.time()
    X, P, OFF, SC, HIT, W, MN = make_dataset(int(sys.argv[2]) if len(sys.argv) > 2 else 90)
    Xv, Pv, OFFv, SCv, HITv, Wv, MNv = make_dataset(8)
    print(f"dataset {len(X):,} train / {len(Xv):,} val, built in {time.time()-t0:.0f}s, present share {P.mean().item():.2f}", flush=True)
    model = Presence().to(dev)
    print(f"parameters: {sum(p.numel() for p in model.parameters()):,}", flush=True)
    bs = 4096; steps = epochs * (len(X) // bs)
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-5)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=1e-3, total_steps=steps, pct_start=0.05)
    bce = nn.BCEWithLogitsLoss(reduction="none")
    def evaluate():
        model.eval(); out = []
        with torch.no_grad():
            for i in range(0, len(Xv), 8192):
                out.append(model(Xv[i:i+8192].float())[0])
        model.train()
        logit = torch.cat(out); acc = ((logit > 0).float() == Pv).float()
        clear = Wv > 0
        msg = [f"clear cases {100*acc[clear].mean().item():.1f}%"]
        def rate(mask, name):
            if mask.any(): msg.append(f"{name} {100*acc[mask].mean().item():.1f}%")
        strong = MNv.float() > 16
        rate((SCv == 0) & strong, "held→present")
        rate((SCv == 1) & strong & ~HITv, "resting→present")
        rate((SCv == 1) & strong & HITv, "(resting after overload)")
        rate(HITv & (MNv.float() < 4), "leftover→absent")
        rate((SCv == 4) & (MNv.float() < 4), "no magnet→absent")
        rate(((SCv == 2) | (SCv == 3)) & (MNv.float() < 4) & ~HITv, "taken away→absent")
        return " ".join(msg)
    step = 0
    for ep in range(epochs):
        perm = torch.randperm(len(X), device=X.device)
        for i in range(0, len(X) - bs + 1, bs):
            idx = perm[i:i+bs]
            logit, off = model(X[idx].float())
            loss = (bce(logit, P[idx]) * W[idx]).sum() / W[idx].sum().clamp_min(1) + 0.5 * ((off - OFF[idx].float()) ** 2).mean()
            opt.zero_grad(); loss.backward(); opt.step(); sched.step(); step += 1
        if ep % 3 == 0 or ep == epochs - 1:
            print(f"epoch {ep:3d} loss {loss.item():.3f} | {evaluate()} | {time.time()-t0:.0f}s", flush=True)
    torch.save(model.state_dict(), "presence6b.pt"); print("saved presence6b.pt", flush=True)
