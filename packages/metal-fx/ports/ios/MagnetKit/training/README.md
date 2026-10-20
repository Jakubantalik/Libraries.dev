# Training the magnet model

The magnet model (`Sources/MagnetKit/Magnet.mfxl`) is one file with three
parts — where the magnet is (locator), whether it is really there
(presence) and air taps (tap) — each trained only on simulated magnet
physics, the simulators fitted to real recordings. These scripts rebuild
each part, test it on real recordings, and pack them into the model:

```
python export4.py locator5.pt parts/MagnetLocator.mfxl
python export6c.py presence6c.pt parts/MagnetPresence.mfxl
python export7.py tap7b.pt parts/MagnetTap.mfxl
python pack_model.py 1.1        # -> ../Sources/MagnetKit/Magnet.mfxl, version 1.1
```

The shipped parts are in `parts/`.

Python 3.9+, `pip install torch numpy scipy`. Runs on Apple-silicon GPUs (MPS) or CPU.

| Script | What |
|---|---|
| `train.py`, `train2.py` | Shared physics, features and the first versions (history). |
| `train4.py` | v4: the magnet's face as an input (fixes the beside-the-sensor mirror). |
| `train5.py` | v5: v4 plus magnets around the phone — on the desk and in the air beside it. Starts from v4's weights. |
| `export4.py` | Writes a locator `.pt` as an MFXL part (`python export4.py locator5.pt parts/MagnetLocator.mfxl`). |
| `pack_model.py` | Packs the three parts into the one model file, with its version. |
| `eval4.py`, `eval5.py` | Accuracy on simulated grips; `eval5.py` compares v4, v5 and the closed-form physics. |
| `train6.py` | v6 presence network: is a magnet really there, or is the sensor's own offset (magnetised by an overload, or a bad calibration) lying? Trained on simulated 15 s sequences. |
| `export6.py` | Writes `presence6.pt` as the presence part. |
| `train7.py` | v7 air-tap network: a hovering magnet dipped toward the glass and back. Simulated 3.2 s sequences of dips, lifts, sweeps, flicks, arriving and leaving. |
| `export7.py` | Writes `tap7.pt` as the tap part. |
| `train7b.py` | v7b, the shipped tap network: v7 with the simulator fitted to the first real session (a tap must rise 2× over the hover; phone leftovers of 30–300 µT). |
| `train6b.py` | Presence with long-lived leftovers in the simulator. Not shipped: alone it mistakes resting magnets for leftovers (see FINETUNE_PLAN.md, pilot results). |
| `realdata.py` | Loads the app's recordings: mat passes (v2: laps, every reading) and sessions (rebuilds the timeline of the first session build). |
| `eval_mats.py` | The shipped locator and the closed-form physics on real mat dots. |
| `eval_session.py`, `eval_presence.py` | The tap and presence networks on a real session, take by take. |
| `calib2.py` | Dipole fit to real mat dots with leftover offsets per stretch. |
| `finetune_loc.py` | Locator fine-tune on real dots, cross-validated by dot position. |
| `real.py` | Real data: `calibrate` (fit sensor spot, strength, face, the phone's distortion), `finetune` (sim + real), `synth` (fake recordings to test the pipeline). |

## Real data

1. Print `../../MetalFxDemo/real-data-mat-iphone15pro.pdf` at 100 % (its 50 mm bar must measure 50 mm).
2. In the demo: Follow › settings › grab the magnet, then *Record real data* — one pass standing on the desk, one 3 cm above it, and the 9-dot measurement for over the screen.
3. Pull the recordings:
   `xcrun devicectl device copy from --device <id> --domain-type appDataContainer --domain-identifier com.jakubantalik.MetalFxDemo --source Documents/real-data --destination real-data`
4. `python real.py calibrate real-data` — this phone's sensor spot, the magnet, the distortion, and how well the physics fits.
5. `python real.py finetune real-data` — fine-tunes v5 on sim + real (a fifth of the readings held out to report the real error), writes `locator5r.pt`; export and bundle it.

More phones and magnets make a model that generalises; one phone's data mostly calibrates that phone.

The full plan for fine-tuning both networks on real data (what to record, how
many phones and magnets, the presence recordings, acceptance numbers, shipping)
is in `FINETUNE_PLAN.md`.
