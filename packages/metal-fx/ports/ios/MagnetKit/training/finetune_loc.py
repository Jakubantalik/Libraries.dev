"""
Fine-tune the locator (v5) on real mat dots, mixed with simulation.
Honest numbers: 5 folds by dot position (a held-out position is held out in
every pass and lap), error measured only on held-out dots.
  python finetune_loc.py DIR FACE [steps]      -> cross-validated errors
  python finetune_loc.py DIR FACE steps final  -> train on all, save locator5r.pt
"""
import sys, math, numpy as np, torch
from realdata import load_mats, kit_sensor_cm, GLASS_ABOVE_TABLE
from train import dev
from train4 import Locator, features, position
from train5 import sample
torch.manual_seed(5); np.random.seed(5)
folder, face = sys.argv[1], float(sys.argv[2]); steps = int(sys.argv[3]) if len(sys.argv) > 3 else 2500
final = len(sys.argv) > 4 and sys.argv[4] == "final"
S = load_mats(folder)
SENSOR_Z = 0.4                                     # cm above the table
z_of = {"desk": 0.6, "air3cm": 3.6, "screen": GLASS_ABOVE_TABLE + 1.46}
rows, Y, key, grp, Ks = [], [], [], [], []
for s in S:
    sc = kit_sensor_cm(s)
    tgt = np.array([s["x"] - sc[0], s["y"] - sc[1], z_of[s["pass_"]] - SENSOR_Z])
    for r in s["readings"]:                         # every reading of the second: real noise
        rows.append(r); Y.append(tgt); key.append((round(s["x"], 1), round(s["y"], 1))); Ks.append(s["K"])
        grp.append(s["pass_"] if s["pass_"] == "screen" else ("near " if s["dot"] <= 16 else "far ") + s["pass_"])
X = torch.tensor(np.array(rows), dtype=torch.float32, device=dev); Y = torch.tensor(np.array(Y), dtype=torch.float32, device=dev)
lnK = torch.tensor(np.log(np.array(Ks, float)), dtype=torch.float32, device=dev)
n = len(X); one = torch.ones(n, device=dev); F = torch.full((n,), face, device=dev)
keys = sorted(set(key)); kidx = np.array([keys.index(k) for k in key]); grp = np.array(grp)
def predict(model, ii):
    with torch.no_grad():
        d_, lr, _, _ = model(features(X[ii], lnK[ii], one[ii], F[ii], one[ii]))
        return position(d_, lr)
def err_xy(model, ii):
    return (predict(model, ii) - Y[ii])[:, :2].norm(dim=-1).cpu().numpy()
def train(tr):
    model = Locator().to(dev); model.load_state_dict(torch.load("locator5.pt", map_location=dev))
    opt = torch.optim.AdamW(model.parameters(), lr=1e-4)
    tr = torch.tensor(tr, device=dev)
    for step in range(steps):
        B, lk, kn, fc, fk, p = sample(2048)
        keep = B.norm(dim=-1) > 2.5
        d_, lr, lvr, lva = model(features(B[keep], lk[keep], kn[keep], fc[keep], fk[keep])); ys = p[keep]
        r_true = ys.norm(dim=-1); u_true = ys / r_true[:, None]; e_r = lr - torch.log(r_true)
        th2 = 2 * (1 - (d_ * u_true).sum(-1)).clamp_min(0)
        loss_sim = (0.5 * (lvr + e_r**2 / torch.exp(lvr)) + 0.5 * (lva + th2 / torch.exp(lva)) + 0.2 * (e_r**2 + th2)).mean()
        j = tr[torch.randint(len(tr), (256,), device=dev)]
        xr = X[j] * (1 + torch.randn(256, 1, device=dev) * 0.03) + torch.randn(256, 3, device=dev) * 0.3
        d2, l2, _, _ = model(features(xr, lnK[j] + torch.randn(256, device=dev) * 0.1, one[j], F[j], one[j]))
        e = position(d2, l2) - Y[j]
        loss_real = torch.nn.functional.huber_loss(e[:, :2], torch.zeros_like(e[:, :2]), delta=1.0) + 0.3 * torch.nn.functional.huber_loss(e[:, 2], torch.zeros_like(e[:, 2]), delta=1.0)
        loss = loss_sim + 2.0 * loss_real
        opt.zero_grad(); loss.backward(); opt.step()
    return model
base = Locator().to(dev); base.load_state_dict(torch.load("locator5.pt", map_location=dev)); base.eval()
if final:
    m = train(np.arange(n)); torch.save(m.state_dict(), "locator5r.pt"); print("saved locator5r.pt"); sys.exit()
folds = np.arange(len(keys)) % 5; np.random.shuffle(folds)
e_base = err_xy(base, torch.arange(n, device=dev)); e_ft = np.zeros(n)
for f in range(5):
    te = np.nonzero(folds[kidx] == f)[0]; tr = np.nonzero(folds[kidx] != f)[0]
    m = train(tr); m.eval(); e_ft[te] = err_xy(m, torch.tensor(te, device=dev))
    print(f"fold {f + 1}/5 done", flush=True)
print(f"{'':16s} {'v5':>8s} {'fine-tuned':>11s}   median error on held-out dots, cm")
for g in ["near desk", "far desk", "near air3cm", "far air3cm", "screen"]:
    ii = grp == g
    print(f"{g:16s} {np.median(e_base[ii]):8.1f} {np.median(e_ft[ii]):11.1f}")
print(f"{'all':16s} {np.median(e_base):8.1f} {np.median(e_ft):11.1f}")
