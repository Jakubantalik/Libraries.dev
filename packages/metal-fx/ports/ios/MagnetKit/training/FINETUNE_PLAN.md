# Fine-tuning the magnet networks on real data

Both networks shipped today were trained only on simulation:

| Network | File | Answers | Simulated accuracy |
|---|---|---|---|
| Locator v5 | the model's locator part | Where the magnet is (over the screen, beside the phone, on the desk) | Median 1.9 cm with the face known, 3.2 cm without |
| Presence v6 | the presence part | Is a magnet really there, or is the sensor's own offset lying? What is that offset? | Resting magnet kept 99.7 %, leftover cleared 97.6 %, held after an overload only 66 % |
| Tap v7 | the tap part | Did an air tap (a dip toward the glass and back) just finish? | 98 % of visible taps; false taps 0–1 % |

Real data improves them in three ways, roughly in order of value:

1. **Fitting the simulator to reality.** Measure the real tremor, noise, leftover sizes, decay times and phone distortion, then retrain with those ranges. This is cheap and usually the biggest win.
2. **Per-model constants.** The sensor position, distortion and scale for each iPhone model ship as a table. Users then no longer need the grab step to find the sensor.
3. **Fine-tuning on real readings.** The networks learn whatever the physics misses: case and MagSafe distortion, non-dipole magnets, sensor quirks.

The real-data numbers, measured on phones and magnets the model never saw, are also what make the model sellable.

---

## Phase 0: tooling (about 2 days)

The mat recorder already exists (Follow › settings › *Record real data*). Five things are missing.

**App**

1. **Presence recorder.** A scripted session that records 50 Hz sequences with labels. The app prompts each take and knows the label from the script timeline; the user taps *Done* to move on. Takes, about 20 s each:
   - Hold the magnet beside each edge in turn (hand-held, present).
   - Set it down beside the phone and let go (resting, present).
   - Take it away fast, then slowly (absent after).
   - Bring it over the sensor until the *too close* warning, hold 2 s, then take it far away (leftover, absent).
   - Repeat the previous take, but bring the magnet back and hold it beside the phone (present over a leftover; this is the weak case).
   - No magnet at all: phone on the desk, then in hand (absent).
   - Calibrate with the magnet lying 3 cm away, then remove it (bad zero, absent after).
   - Air taps (for the tap network, v7): hover over a marked spot, dip 2–3 cm and back, 10 times; then the same number of near misses — slow dips, shallow dips, dips that stay down, lifts, sweeps across the glass, flicks of the magnet. The app knows which take is which, so every dip is labelled.

   **Ground-truth offset:** after every leftover take, the magnet goes more than 50 cm away and the app records 3 s of field. That reading minus the session's clean zero is the true offset. Bracket each session with a clean calibration at its start and end, with the magnet in another room.

2. **Record the raw field.** Store the uncalibrated `raw` field and the zero in use, not only `delta`. The presence net learns the offset, so the zero must not be baked in.

3. **Both faces.** The mat pass should prompt "flip the magnet" and run a second lap. The face is the locator's main ambiguity, so both faces need real data.

4. **Several readings per dot.** Record 1 s of readings at each dot instead of one, so noise is measured rather than guessed.

**Mats**

5. **Mats for other phones.** Run `tools/make_mat.py --phone <model>` with the outline sizes of every phone recorded. Dot positions are written into each recording, so the trainer does not care which mat was used.

**Python** (about 2 days)

- `real.py`: load many phones, and split leave-one-phone-out and leave-one-magnet-out (whole phones and magnets held out, not random readings).
- `presence_real.py` (new):
  - load sequences, cut 15 s windows every 0.2 s, attach labels and true offsets;
  - `stats`: fit the simulator's ranges (tremor spectrum, noise floor, leftover size versus peak field, leftover decay, drift);
  - `finetune`: start from v6 with mixed sim and real batches.
- Replay harness: run the Swift kit offline over recorded logs. The existing `swiftcheck` harness can do this. It measures what users feel (pull, false releases, re-zeros), not just the network loss.

## Phase 1: pilot (½ day, 1 phone, 1 magnet)

Run one full mat pass with both faces, one screen pass and one presence session on the iPhone 15 Pro, then run the whole pipeline end to end.

Go / no-go checks:
- `real.py calibrate` fits the dipole model to within about 10 % of |B| on the near ring. If it doesn't, the distortion model needs work before collecting more.
- Presence labels line up with the field in a plot of every take.
- The replay harness reproduces what was seen live.

## Phase 2: collection (about 1 week, part-time)

| Axis | Minimum | Why |
|---|---|---|
| iPhone models | 6, e.g. 13 mini, 14, 15 Pro, 15 Pro Max, 16, 17 Pro | Each family moves the magnetometer. Spread small, large, Pro and non-Pro. |
| Units of one model | 2 | Unit-to-unit spread decides whether the per-model table is enough. |
| Cases | none, silicone, MagSafe case | MagSafe rings are strong, static distortion. |
| Magnets | 4–6: the demo puck, a 10 mm disc, a 20 mm disc, a ring magnet, a MagSafe wallet or puck, a ferrite fridge magnet | Strength, size and shape (non-dipole up close). |
| People | 3–5 | Hand tremor and handling habits drive presence. |
| Places | wooden desk, desk with a laptop or metal frame nearby, in hand | Background fields and nearby iron. |

**Volume targets**

- **Locator:** 6 phones × 4 magnets × 2 faces × (28 desk + 28 air + 9 screen dots) ≈ 3,100 labelled positions, each 1 s of readings. One pass takes about 4 min, so this is about 6–7 h of recording.
- **Presence:** 6 phones × 3 people × 2 magnets × 1 session (about 5 min) ≈ 36 sessions, about 3 h. Cut into windows, that is about 50,000 labelled 15 s windows.
- **Free use:** turn on MagnetLogger while playing with the demos. These logs are unlabelled, but the replay harness uses them to count false releases and phantom pulls.

Pull the files with:

```
xcrun devicectl device copy from --device <id> --domain-type appDataContainer \
  --domain-identifier com.jakubantalik.MetalFxDemo --source Documents --destination real/<phone>-<date>
```

Keep one folder per phone per day, and note the case and magnet in the folder name.

## Phase 3: training (about 1 week)

Steps, in order:

1. **Per-model constants.** Run `real.py calibrate` on each phone to get the sensor spot (mm from the phone's centre), the distortion matrix and the scale. These ship in the kit as a table keyed by `utsname.machine` (e.g. `iPhone16,1`). It replaces the grab step's sensor search, and the grab becomes optional.

2. **Simulator fit (both networks).**
   - Widen or narrow `train5.py` and `train6.py` ranges to the measured ones: distortion spread, noise, tremor, leftover size and decay, magnet K range.
   - Retrain both from their current weights on simulation only. Evaluate on real held-out data.
   - This alone may meet the targets below. If it does, stop here: a sim-only model generalises best to phones never recorded.

3. **Locator fine-tune (v5r).**
   - Start from the step-2 weights.
   - Batches are 80 % sim and 20 % real. Learning rate 1e-4, about 3,000 steps, early stop on the held-out phone.
   - Augment the real data with sensor noise and small per-reading scale jitter.
   - **If phones still differ a lot:** a v7 locator takes the sensor spot and a phone-size code as inputs, so one model covers all phones.

4. **Presence fine-tune (v6r).**
   - Start from the step-2 weights.
   - Batches are 70 % sim and 30 % real windows.
   - Offset loss applies only where ground truth exists (the leftover takes).
   - Weight the present-over-leftover takes ×3; that is the weak case.

5. **Thresholds.** Re-pick the kit thresholds on held-out data with the replay harness: presence re-zero 0.25, pull fade 0.15–0.5, leftover watch.

## Phase 4: acceptance

All numbers are measured on phones and magnets left out of training.

**Locator**

| Measure | Target |
|---|---|
| Near ring (1.5 cm from the edge), median | ≤ 1.5 cm |
| Far ring (4.5 cm), median | ≤ 2.5 cm |
| Over the screen, median | ≤ 1.2 cm |
| Correct side of the phone | ≥ 98 % |
| Versus both the closed-form physics and v5 | ≥ 20 % lower median error |

**Presence**

| Measure | Target |
|---|---|
| Resting magnet kept | ≥ 99 % |
| Leftover cleared within 10 s | ≥ 95 % |
| Held magnet over a leftover | ≥ 85 % (today 66 % in sim) |
| Resting magnet wrongly zeroed in the eval sessions | 0 |
| False releases | < 1 per 10 min of demo use (replay) |

**Parity**

| Measure | Target |
|---|---|
| Swift versus PyTorch outputs | difference < 1e-3 on 1,000 recorded windows |

Ship only if the targets are met. Otherwise keep the simulator-fitted model from step 2 and record more data where it misses.

## Phase 5: shipping

- Export with `export4.py` and `export6.py`. Bump the version in the MFXL header (`v5r`, `v6r`) and run the `swiftcheck` parity harness.
- Add the per-model sensor table to the kit (`MagnetPhones.json`). Unknown models fall back to the grab.
- Add a model card in the README: the phones, magnets and hours behind it, the held-out numbers, and known limits (MagSafe cases, magnets over about 4,000 µT at the sensor, temperature).
- Keep the raw dataset and the fitted simulator private. Together they are the moat; the weights alone are easy to ship in binary form.

## What real data will not fix

- **Desk-level bearing is weak by physics.** About 92 % of the field is vertical there. Real data sharpens distance and side, but not the exact angle.
- **One three-axis sensor cannot separate distance from strength** without the grab or a known magnet. A magnet catalogue (strength per product) helps more than more data.
- **Very strong magnets saturate the sensor** above about 4,500 µT. The kit should keep warning rather than guess.

## Rough schedule

| Week | Work |
|---|---|
| 1 | Phase 0 tooling and the Phase 1 pilot |
| 2 | Phase 2 collection (needs the phones and magnets on hand) |
| 3 | Phase 3 training and Phase 4 evaluation |
| 4 | Fixes, a second collection round where it misses, Phase 5 shipping |

---

## Pilot results (2026-10-19, iPhone 15 Pro, one magnet)

Recorded: desk and 3 cm mat passes (2 laps × 28 dots), the 9-dot screen pass,
and the taps & presence session (19 takes, 10 minutes).

**Recording problems found**
- The two laps were not flipped: their fields agree, not opposite.
- Dot 16 is 3 cm from the sensor: 4,000 µT magnetised the phone and left a
  ~15 µT offset for the rest of the mat passes. The far dots only read
  11–28 µT, so that offset is most of their reading.
- The grab saved the wrong face for these recordings; every estimate then
  lands on the opposite side of the phone. With the right face the numbers
  below hold. The grab's face test needs a fix.
- The first session build restarted its clock on redraws; the timeline is
  rebuilt from the row order (realdata.py), and the app is fixed.

**Leftovers on a real phone** (the session): touching the glass over the
sensor (3,500 µT) left 160 µT; the "too close" take 250 µT; still 135 µT six
minutes later. Afterwards a magnet taken away only moved the reading from 189
to 158 µT.

**Locator** (median error on held-out dots, cm; 5 folds by dot position)

| | v5 shipped | v5 fine-tuned | physics |
|---|---|---|---|
| near ring, standing | 2.7 | 1.8 | 1.6 |
| far ring, standing | 5.3 | 6.2 | 4.7 |
| near ring, 3 cm up | 2.0 | 1.6 | 1.7 |
| far ring, 3 cm up | 2.8 | 2.2 | 2.3 |
| over the screen | 1.2 | 1.0 | 1.2 |

Fine-tuning closes the gap to the physics but does not beat it, so it is
not shipped (the acceptance bar is 20 % better than both). The dipole fit
itself (calib2.py) does not converge on this magnet near the phone.

**Tap** (v7 → v7b, simulator fitted, the session used only as a test): taps
over the top half 11 of 11 → 11 of 11; taps fired during near-miss takes
9 → 0 (8 of them on tiny dips). Shipped as v7b.

**Presence**: v6 says "present" through every leftover (absent recognised
16 % of the time). v6b (leftovers in the simulator) recognises 73 % but
takes a resting magnet for a leftover 85 % of the time. Not shipped. Within
its 15 s window a steady leftover and a magnet lying still read the same;
the next version needs memory beyond the window — whether the phone was
overloaded since its last zero — which the kit can track.

**Next recordings**: flip the magnet for real between laps; skip the dots
within ~4 cm of the sensor (or take the magnet away and re-zero after them);
in the session, keep the magnet off the glass over the sensor except in the
two "too close" takes.

**Follow-up (same day)**
- Presence v6c (train6c.py, shipped): the kit remembers an overload until
  it next zeroes and passes it to the network only right after the field
  drops. On the session, open loop: taken away fast 53 → 96 %, slowly
  62 → 100 %, too close 92 → 99 % recognised; a resting magnet right after
  an overload 100 → 54 % (it can be zeroed away); a wrong re-zero about 2 %
  of the time. A closed-loop replay through the kit is still to do.
- The grab's face test (MetalMagnetDipole.learn) now matches the whole field
  direction for each face over hover heights 0.6–3.6 cm, instead of only the
  sideways bearing: simulated grabs with tilts up to 35°, right face 95.7 →
  100 % (hovering under 2 cm: 89 → 99.9 %), grabface.py.
