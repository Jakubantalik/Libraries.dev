"""
Loading the app's real recordings (Documents/real-data/*.json).

Mat passes (version 2): one sample per dot — the mean field held there, every
reading of that second, the lap and the face the app believed.

Sessions: the raw field at 50 Hz with the takes. The first session build
restarted its clock whenever the screen redrew (row times jump back); rows
still come every 20 ms, so the timeline is rebuilt from the row order, and
each take is found by its end time, which equals the time of the row written
in the same tick.
"""
import json, glob, os, math
import numpy as np

GLASS_ABOVE_TABLE = 0.82          # cm, iPhone 15 Pro (8.25 mm)
OVERLOAD = 2000.0                 # µT: above this the phone's parts magnetise

def load_mats(folder, min_version=2):
    """Samples of the mat passes, in recording order (file by file, as recorded)."""
    out = []
    for f in sorted(glob.glob(os.path.join(folder, "*.json"))):
        j = json.load(open(f))
        if j.get("pass") == "session" or j.get("version", 1) < min_version: continue
        for s in j["samples"]:
            out.append(dict(file=os.path.basename(f), pass_=j["pass"], lap=s.get("lap", 1), dot=s["dot"],
                            x=s["x_mm"] / 10, y=s["y_mm"] / 10, B=np.array(s["field"], float),
                            readings=np.array(s.get("readings") or [s["field"]], float),
                            face=s.get("face", j.get("face")), K=j.get("strength"),
                            sensor_pt=j.get("sensorInUse"), screen_pt=j.get("screenPoints"), ppcm=j.get("pointsPerCm", 60.4)))
    return out

def segments(samples):
    """Offset segments: a new one starts after every reading strong enough to
    magnetise the phone (the zero held during the pass is then off)."""
    seg, out = 0, []
    for s in samples:
        out.append(seg)
        if np.linalg.norm(s["B"]) > OVERLOAD * 0.8: seg += 1
    return np.array(out)

def kit_sensor_cm(s):
    """The sensor spot the kit used, cm from the phone centre (x right, y up)."""
    (px, py), (w, h) = s["sensor_pt"], s["screen_pt"]
    return np.array([(px - w / 2) / s["ppcm"], -(py - h / 2) / s["ppcm"]])

def load_session(path):
    j = json.load(open(path))
    rows = np.array(j["rows"], float)
    t = rows[:, 0]
    dt = np.diff(t)
    ok = (dt > 0) & (dt < 0.2)
    T = np.concatenate([[0.0], np.cumsum(np.where(ok, dt, 0.02))])     # rebuilt clock, s
    takes = []
    for tk in j["takes"]:
        hit = np.nonzero(np.abs(t - tk["end"]) < 1e-9)[0]
        if len(hit) == 0: continue
        i_end = hit[-1]
        T_end = T[i_end]; T_start = T_end - (tk["end"] - tk["start"])
        marks = [dict(at=T_start + (m["at"] - tk["start"]), say=m["say"]) for m in tk.get("marks", [])]
        takes.append(dict(id=tk["id"], label=tk["label"], start=T_start, end=T_end, marks=marks))
    takes.sort(key=lambda k: k["start"])
    return dict(T=T, raw=rows[:, 1:4], zero=rows[:, 4:7], presence=rows[:, 7], too_close=rows[:, 8],
                screen=rows[:, 9:11], height=rows[:, 11], takes=takes, face=j.get("face"), K=j.get("strength"),
                sensor_pt=j.get("sensorInUse"), screen_pt=j.get("screenPoints"))

if __name__ == "__main__":
    import sys
    folder = sys.argv[1]
    m = load_mats(folder)
    print(len(m), "mat samples;", "segments:", segments(m).max() + 1)
    for f in sorted(glob.glob(os.path.join(folder, "*session.json"))):
        s = load_session(f)
        print(os.path.basename(f), f"{s['T'][-1]:.0f} s")
        for k in s["takes"]:
            i0, i1 = np.searchsorted(s["T"], [k["start"], k["end"]])
            B = s["raw"][i0:i1] - s["zero"][i0:i1]
            print(f"  {k['id']:16s} {k['label']:22s} {k['start']:6.1f}–{k['end']:6.1f} s  |B| median {np.median(np.linalg.norm(B, axis=1)):7.1f} max {np.linalg.norm(B, axis=1).max():7.1f}")
