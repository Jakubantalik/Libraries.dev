"""
Printable mat for recording real magnet data around a phone (A4, true scale).

The phone lies screen-up in the outline; the magnet goes on each numbered dot
in turn while the app records the field. Dot positions are in mm from the
phone's centre (x right, y toward the phone's top) and must match
`RealDataMat.dots` in Sources/MagnetRealData.swift.

    python3 make_mat.py            # writes real-data-mat-iphone15pro.pdf
"""
import sys

PHONE = ("iPhone 15 Pro", 70.6, 146.6, 10.0)      # name, width, height, corner radius (mm)

def dots(w=PHONE[1], h=PHONE[2]):
    hw, hh = w / 2, h / 2
    out = []
    n = 15.0   # near ring: 15 mm from the edges
    out += [(-(hw + n), hh + n)]
    out += [(x, hh + n) for x in (-25, 0, 25)]
    out += [(hw + n, hh + n)]
    out += [(hw + n, y) for y in (50, 0, -50)]
    out += [(hw + n, -(hh + n))]
    out += [(x, -(hh + n)) for x in (25, 0, -25)]
    out += [(-(hw + n), -(hh + n))]
    out += [(-(hw + n), y) for y in (-50, 0, 50)]
    f = 45.0   # far ring: 45 mm from the edges
    out += [(x, hh + f) for x in (-25, 0, 25)]
    out += [(hw + f, y) for y in (50, 0, -50)]
    out += [(x, -(hh + f)) for x in (25, 0, -25)]
    out += [(-(hw + f), y) for y in (-50, 0, 50)]
    return out

MM = 72 / 25.4
PW, PH = 595.28, 841.89
cx, cy = PW / 2, PH / 2 - 22

def P(x, y): return cx + x * MM, cy + y * MM

def circle(x, y, r, fill=False):
    k = 0.5523 * r
    s = f"{x + r:.2f} {y:.2f} m "
    s += f"{x + r:.2f} {y + k:.2f} {x + k:.2f} {y + r:.2f} {x:.2f} {y + r:.2f} c "
    s += f"{x - k:.2f} {y + r:.2f} {x - r:.2f} {y + k:.2f} {x - r:.2f} {y:.2f} c "
    s += f"{x - r:.2f} {y - k:.2f} {x - k:.2f} {y - r:.2f} {x:.2f} {y - r:.2f} c "
    s += f"{x + k:.2f} {y - r:.2f} {x + r:.2f} {y - k:.2f} {x + r:.2f} {y:.2f} c "
    return s + ("f\n" if fill else "S\n")

def rrect(x0, y0, x1, y1, r):
    k = 0.5523 * r
    s = f"{x0 + r:.2f} {y0:.2f} m {x1 - r:.2f} {y0:.2f} l "
    s += f"{x1 - r + k:.2f} {y0:.2f} {x1:.2f} {y0 + r - k:.2f} {x1:.2f} {y0 + r:.2f} c {x1:.2f} {y1 - r:.2f} l "
    s += f"{x1:.2f} {y1 - r + k:.2f} {x1 - r + k:.2f} {y1:.2f} {x1 - r:.2f} {y1:.2f} c {x0 + r:.2f} {y1:.2f} l "
    s += f"{x0 + r - k:.2f} {y1:.2f} {x0:.2f} {y1 - r + k:.2f} {x0:.2f} {y1 - r:.2f} c {x0:.2f} {y0 + r:.2f} l "
    s += f"{x0:.2f} {y0 + r - k:.2f} {x0 + r - k:.2f} {y0:.2f} {x0 + r:.2f} {y0:.2f} c S\n"
    return s

def text(x, y, size, t, bold=False):
    t = t.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    return f"BT /{'F2' if bold else 'F1'} {size} Tf {x:.2f} {y:.2f} Td ({t}) Tj ET\n"

def build(path):
    name, w, h, rad = PHONE
    c = "0 0 0 RG 0 0 0 rg\n"
    # phone outline (dashed)
    x0, y0 = P(-w / 2, -h / 2); x1, y1 = P(w / 2, h / 2)
    c += "0.8 w [4 3] 0 d\n" + rrect(x0, y0, x1, y1, rad * MM) + "[] 0 d\n"
    c += text(cx - 52, cy + 6, 9, f"{name} here, screen up", True)
    tx, ty = P(0, h / 2 - 8)
    c += text(tx - 10, ty, 9, "TOP", True)
    # dots
    c += "0.6 w\n"
    for i, (x, y) in enumerate(dots()):
        px, py = P(x, y)
        c += circle(px, py, 4.0 * MM)
        c += circle(px, py, 1.0 * MM, fill=True)
        c += text(px + 5.2 * MM, py - 3, 8, str(i + 1), True)
    # title, instructions, scale bar
    c += text(40, PH - 40, 13, "metal-fx - real magnet data mat", True)
    c += text(40, PH - 56, 8.5, "Print at 100 % (no fit-to-page). Check: the bar below must measure exactly 50 mm.")
    c += text(40, PH - 68, 8.5, "Lay the phone in the outline, open Follow > settings > Record real data, and put the magnet")
    c += text(40, PH - 80, 8.5, "on each dot in turn (centre of the magnet on the dot) until the phone ticks.")
    bx, by = PW - 40 - 50 * MM - 40, 30
    c += "1.2 w\n" + f"{bx:.2f} {by:.2f} m {bx + 50 * MM:.2f} {by:.2f} l S\n"
    c += f"{bx:.2f} {by - 4:.2f} m {bx:.2f} {by + 4:.2f} l S\n{bx + 50 * MM:.2f} {by - 4:.2f} m {bx + 50 * MM:.2f} {by + 4:.2f} l S\n"
    c += text(bx + 50 * MM + 8, by - 3, 8, "50 mm")
    objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PW} {PH}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
        f"<< /Length {len(c.encode())} >>\nstream\n{c}endstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    ]
    out = b"%PDF-1.4\n"; offs = []
    for i, o in enumerate(objs):
        offs.append(len(out)); out += f"{i + 1} 0 obj\n{o}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for o in offs: out += f"{o:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    open(path, "wb").write(out)

if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else "real-data-mat-iphone15pro.pdf")
    for i, d in enumerate(dots()): print(i + 1, d)
