"""
The magnet model: one file, one version. Packs the model's three parts —
where the magnet is (locator), whether it is really there (presence) and air
taps (tap) — into Sources/MagnetKit/Magnet.mfxl.

  python pack_model.py VERSION [locator.mfxl presence.mfxl tap.mfxl]

Format: "MFXL", a little-endian UInt32 header length, a JSON header
{"kind": "magnet", "version", "parts": [{"name", "offset", "length"}]}, then
each part as a complete MFXL file of its own, at its offset after the header.
"""
import json, struct, sys, os
here = os.path.dirname(os.path.abspath(__file__))
version = sys.argv[1] if len(sys.argv) > 1 else "1.0"
paths = sys.argv[2:5] if len(sys.argv) > 4 else [os.path.join(here, "parts", f) for f in ("MagnetLocator.mfxl", "MagnetPresence.mfxl", "MagnetTap.mfxl")]
blobs = [open(p, "rb").read() for p in paths]
parts, off = [], 0
for name, b in zip(("locator", "presence", "tap"), blobs):
    assert b[:4] == b"MFXL", name
    parts.append({"name": name, "offset": off, "length": len(b)}); off += len(b)
header = {"kind": "magnet", "version": version, "name": "Magnet model",
          "about": "Where a magnet is, whether it is really there, and air taps, from the iPhone's magnetometer.",
          "parts": parts}
hj = json.dumps(header).encode()
out = os.path.join(here, "..", "Sources", "MagnetKit", "Magnet.mfxl")
with open(out, "wb") as f:
    f.write(b"MFXL"); f.write(struct.pack("<I", len(hj))); f.write(hj)
    for b in blobs: f.write(b)
print(os.path.normpath(out), os.path.getsize(out), "bytes, version", version)
