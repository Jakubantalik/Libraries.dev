package dev.libraries.magnetichome

import dev.libraries.magnetkit.MagnetReading
import dev.libraries.magnetkit.Pt
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

/** A rectangle in dp. */
data class Box(val left: Double, val top: Double, val right: Double, val bottom: Double) {
    val width get() = right - left
    val height get() = bottom - top
    val midX get() = (left + right) / 2
    val midY get() = (top + bottom) / 2
    fun offset(dx: Double, dy: Double) = Box(left + dx, top + dy, right + dx, bottom + dy)
    fun inset(d: Double) = Box(left + d, top + d, right - d, bottom - d)
    fun distanceTo(p: Pt): Double = hypot(max(max(left - p.x, 0.0), p.x - right), max(max(top - p.y, 0.0), p.y - bottom))
}

/**
 * The home screen's physics — the Magnetic UI demo's, ported: every element
 * is a small rigid body on a stiff damped string to its place. A magnet
 * beside the phone (not over the glass) pulls each by its nearest point
 * (1/d³, capped), so it also tilts; bodies collide and rest against the
 * screen's rounded edge; the strings bring everything back when it leaves.
 */
class MagneticField {
    class Particle {
        var home = Box(0.0, 0.0, 0.0, 0.0)
        var corner = 8.0
        var ox = 0.0; var oy = 0.0
        var vx = 0.0; var vy = 0.0
        var angle = 0.0
        var spin = 0.0
        var atEdge = false
        val mass get() = max(1.0, home.width * home.height / 1000)
        val inertia get() = mass * (home.width * home.width + home.height * home.height) / 12
        val center get() = Pt(home.midX + ox, home.midY + oy)
    }

    private val parts = LinkedHashMap<String, Particle>()
    private var lastT = 0.0
    var magnet: Pt? = null; private set
    private var gate = 0.0
    private var lostAt = 0.0
    private val strengths = ArrayDeque<Pair<Double, Double>>()
    var overGlass = false; private set
    /** Set when a body hits the edge hard (for a haptic tick); consumed by the screen. */
    var hit = 0.0

    var screenCorner = 40.0
    var stiffness = 150.0
    var damping = 21.0
    var force = 30000.0
    var reach = 150.0
    var maxForce = 26000.0
    var standoff = 40.0
    var softening = 40.0
    var nearBand = 90.0
    var farBand = 320.0
    var tiltGain = 0.5
    var maxTilt = 0.1
    var spinStiffness = 80.0
    var spinDamping = 12.0
    var restitution = 0.3
    var wallRestitution = 0.25
    var restingSpeed = 250.0
    var wallFriction = 0.35

    fun setHome(id: String, b: Box, corner: Double) {
        val p = parts.getOrPut(id) { Particle() }
        p.home = b; p.corner = corner
    }
    fun particle(id: String): Particle? = parts[id]
    /** Where an element is now, dp. */
    fun frame(id: String): Box? = parts[id]?.let { if (it.home.width > 0) it.home.offset(it.ox, it.oy) else null }
    val ids: Collection<String> get() = parts.keys

    fun relax(now: Double) = simulate(now, null)

    fun step(r: MagnetReading, now: Double, screen: Box, face: Int) {
        val dt = if (lastT > 0) min(1.0 / 30, max(1.0 / 240, now - lastT)) else 1.0 / 60
        val p = r.screenPosition
        if (r.strength > 4 && p != null) {
            val m = magnet
            magnet = if (m != null) {
                val jump = hypot(p.x - m.x, p.y - m.y)
                val k = 1 - exp(-dt / (if (jump > 200) 0.4 else 0.08))
                Pt(m.x + (p.x - m.x) * k, m.y + (p.y - m.y) * k)
            } else p
            lostAt = now
        } else if (now - lostAt > 0.15) magnet = null
        // Leaving: the field falling well below its peak of the last half second.
        strengths.addLast(Pair(now, r.strength))
        while (strengths.isNotEmpty() && now - strengths.first().first > 0.5) strengths.removeFirst()
        val recentMax = strengths.maxOf { it.second }
        val leaving = if (recentMax > 25) min(1.0, max(0.0, (r.strength / recentMax - 0.15) / 0.3)) else 1.0
        // Over the glass: no pull at all (the field along the face, or well inside and above).
        val along = (if (face < 0) -1.0 else 1.0) * r.delta.z / max(1e-6, r.strength)
        val m = magnet
        val inside = m != null && outside(m, screen) < -25 && (r.height ?: 0.0) > 0.8
        if (r.strength > 4) { if (along > 0.2 || inside) overGlass = true else if (along < 0) overGlass = false }
        var target = 0.0
        if (m != null && !overGlass) {
            val field = min(1.0, max(0.0, (r.strength - 10) / 25))
            val real = min(1.0, max(0.0, (r.presence - 0.2) / 0.4))
            target = field * real * leaving
        }
        gate += (target - gate) * (1 - exp(-dt / (if (target > gate) 0.08 else 0.04)))
        simulate(now, screen)
    }

    private fun outside(p: Pt, s: Box): Double {
        val dx = max(s.left - p.x, p.x - s.right); val dy = max(s.top - p.y, p.y - s.bottom)
        if (dx > 0 || dy > 0) return hypot(max(0.0, dx), max(0.0, dy))
        return max(dx, dy)
    }

    private fun pullPoint(m: Pt, s: Box): Pt {
        var qx = min(max(m.x, s.left), s.right); var qy = min(max(m.y, s.top), s.bottom)
        var nx = m.x - qx; var ny = m.y - qy
        if (hypot(nx, ny) < 1) {
            val dl = m.x - s.left; val dr = s.right - m.x; val dtp = m.y - s.top; val db = s.bottom - m.y
            val mn = minOf(dl, dr, dtp, db)
            when (mn) {
                dl -> { qx = s.left; nx = -1.0; ny = 0.0 }
                dr -> { qx = s.right; nx = 1.0; ny = 0.0 }
                dtp -> { qy = s.top; nx = 0.0; ny = -1.0 }
                else -> { qy = s.bottom; nx = 0.0; ny = 1.0 }
            }
        }
        val l = max(1e-6, hypot(nx, ny))
        return Pt(qx + nx / l * standoff, qy + ny / l * standoff)
    }

    private fun proximity(m: Pt, s: Box) = min(1.0, max(0.0, 1 - (outside(m, s) - nearBand) / (farBand - nearBand)))

    private fun direction(c: Pt, m: Pt, s: Box): Pt {
        var rx = m.x - c.x; var ry = m.y - c.y
        val rl = max(1e-6, hypot(rx, ry)); rx /= rl; ry /= rl
        val qx = min(max(m.x, s.left), s.right); val qy = min(max(m.y, s.top), s.bottom)
        var ex = m.x - qx; var ey = m.y - qy
        if (hypot(ex, ey) < 1) {
            val dl = m.x - s.left; val dr = s.right - m.x; val dtp = m.y - s.top; val db = s.bottom - m.y
            val mn = minOf(dl, dr, dtp, db)
            when (mn) { dl -> { ex = -1.0; ey = 0.0 }; dr -> { ex = 1.0; ey = 0.0 }; dtp -> { ex = 0.0; ey = -1.0 }; else -> { ex = 0.0; ey = 1.0 } }
        }
        val el = max(1e-6, hypot(ex, ey)); ex /= el; ey /= el
        val w = 0.65
        var dx = ex * w + rx * (1 - w); var dy = ey * w + ry * (1 - w)
        val dl = max(1e-6, hypot(dx, dy)); dx /= dl; dy /= dl
        return Pt(dx, dy)
    }

    private fun simulate(now: Double, screen: Box?) {
        val dt = if (lastT > 0) min(1.0 / 30, max(1.0 / 240, now - lastT)) else 1.0 / 60
        lastT = now
        for (p in parts.values) {
            if (p.home.width <= 0) continue
            var ax = -stiffness * p.ox - damping * p.vx
            var ay = -stiffness * p.oy - damping * p.vy
            var torque = 0.0
            val raw = magnet
            if (raw != null && screen != null && gate > 0.01) {
                val m = pullPoint(raw, screen)
                val c = p.center
                val w = p.home.width; val h = p.home.height
                val box = p.home.offset(p.ox, p.oy)
                val qx = min(max(m.x, box.left), box.right); val qy = min(max(m.y, box.top), box.bottom)
                val dist = hypot(m.x - qx, m.y - qy) + softening
                val f = min(maxForce, force * (reach / dist).pow(3)) * gate * proximity(raw, screen)
                val u = direction(c, m, screen)
                ax += f * u.x; ay += f * u.y
                // Gripped by its nearest point: an off-centre pull turns it.
                val ca = cos(p.angle); val sa = sin(p.angle)
                val lx = (m.x - c.x) * ca + (m.y - c.y) * sa; val ly = -(m.x - c.x) * sa + (m.y - c.y) * ca
                val nlx = min(max(lx, -w / 2), w / 2); val nly = min(max(ly, -h / 2), h / 2)
                val nx = nlx * ca - nly * sa; val ny = nlx * sa + nly * ca
                torque = tiltGain * (nx * f * u.y - ny * f * u.x) / ((w * w + h * h) / 12)
                if (p.atEdge) torque *= 0.4
            }
            p.vx += ax * dt; p.vy += ay * dt
            val v = hypot(p.vx, p.vy)
            if (v > 2600) { p.vx = p.vx / v * 2600; p.vy = p.vy / v * 2600 }
            p.ox += p.vx * dt; p.oy += p.vy * dt
            p.spin += (torque - spinStiffness * p.angle - spinDamping * p.spin) * dt
            p.angle += p.spin * dt
            if (abs(p.angle) > maxTilt) { p.angle = max(-maxTilt, min(maxTilt, p.angle)); p.spin *= 0.4 }
        }
        if (screen == null) return
        val list = parts.values.filter { it.home.width > 0 }
        var hardest = 0.0
        repeat(4) {
            for (i in list.indices) for (j in i + 1 until list.size) collide(list[i], list[j])
            for (p in list) hardest = max(hardest, contain(p, screen))
        }
        for (p in list) if (abs(p.angle) > maxTilt) p.angle = max(-maxTilt, min(maxTilt, p.angle))
        if (hardest > 250) hit = max(hit, hardest)
    }

    /** Two boxes (separating axes): push apart by mass; a real knock bounces and spins them. */
    private fun collide(a: Particle, b: Particle) {
        val ca = a.center; val cb = b.center
        val haw = a.home.width / 2; val hah = a.home.height / 2; val hbw = b.home.width / 2; val hbh = b.home.height / 2
        if (abs(cb.x - ca.x) > haw + hbw + 20 || abs(cb.y - ca.y) > hah + hbh + 20) return
        val axA = arrayOf(Pt(cos(a.angle), sin(a.angle)), Pt(-sin(a.angle), cos(a.angle)))
        val axB = arrayOf(Pt(cos(b.angle), sin(b.angle)), Pt(-sin(b.angle), cos(b.angle)))
        val dx = cb.x - ca.x; val dy = cb.y - ca.y
        var best = Double.POSITIVE_INFINITY; var nX = 0.0; var nY = 0.0
        for (n in axA + axB) {
            val ra = haw * abs(axA[0].x * n.x + axA[0].y * n.y) + hah * abs(axA[1].x * n.x + axA[1].y * n.y)
            val rb = hbw * abs(axB[0].x * n.x + axB[0].y * n.y) + hbh * abs(axB[1].x * n.x + axB[1].y * n.y)
            val dist = dx * n.x + dy * n.y
            val overlap = ra + rb - abs(dist)
            if (overlap <= 0) return
            if (overlap < best) { best = overlap; if (dist < 0) { nX = -n.x; nY = -n.y } else { nX = n.x; nY = n.y } }
        }
        val wa = 1 / a.mass; val wb = 1 / b.mass
        val k = best / (wa + wb)
        a.ox -= nX * k * wa; a.oy -= nY * k * wa
        b.ox += nX * k * wb; b.oy += nY * k * wb
        val vn = (b.vx - a.vx) * nX + (b.vy - a.vy) * nY
        if (vn < 0) {
            val knock = -vn > restingSpeed
            val j = -(1 + (if (knock) restitution else 0.0)) * vn / (wa + wb)
            a.vx -= nX * j * wa; a.vy -= nY * j * wa
            b.vx += nX * j * wb; b.vy += nY * j * wb
            if (!knock) return
            val pcx = (ca.x + cb.x) / 2; val pcy = (ca.y + cb.y) / 2
            val crossA = (pcx - ca.x) * nY - (pcy - ca.y) * nX
            val crossB = (pcx - cb.x) * nY - (pcy - cb.y) * nX
            a.spin -= 0.5 * crossA * j / a.inertia
            b.spin += 0.5 * crossB * j / b.inertia
        }
    }

    /** Keep a body inside the screen's rounded rectangle; how hard it hit, dp/s. */
    private fun contain(p: Particle, s: Box): Double {
        val c = p.center
        val hw = p.home.width / 2; val hh = p.home.height / 2
        val r = min(p.corner, min(hw, hh))
        val inner = s.inset(r)
        val rr = max(0.0, screenCorner - r)
        val ca = cos(p.angle); val sa = sin(p.angle)
        var wx = 0.0; var wy = 0.0; var worstLen = 0.0; var wpx = c.x; var wpy = c.y
        for ((sx, sy) in listOf(-1.0 to -1.0, 1.0 to -1.0, 1.0 to 1.0, -1.0 to 1.0)) {
            val lx = sx * (hw - r); val ly = sy * (hh - r)
            val qx = c.x + lx * ca - ly * sa; val qy = c.y + lx * sa + ly * ca
            val corr = pushInside(qx, qy, inner, rr)
            val len = hypot(corr.x, corr.y)
            if (len > worstLen) { worstLen = len; wx = corr.x; wy = corr.y; wpx = qx; wpy = qy }
        }
        if (worstLen < 0.5) { p.atEdge = false; return 0.0 }
        val wasAtEdge = p.atEdge
        p.atEdge = true
        p.ox += wx; p.oy += wy
        val nx = wx / worstLen; val ny = wy / worstLen
        val vn = p.vx * nx + p.vy * ny
        var hit = 0.0
        if (vn < 0) {
            // Held against the edge: it just stops there, friction holds it. A real hit bounces a little.
            val resting = wasAtEdge && -vn < 900
            hit = if (resting) 0.0 else -vn
            val e = if (resting) 0.0 else wallRestitution
            p.vx -= (1 + e) * vn * nx; p.vy -= (1 + e) * vn * ny
            val vn2 = p.vx * nx + p.vy * ny
            val tx = p.vx - vn2 * nx; val ty = p.vy - vn2 * ny
            val tl = hypot(tx, ty)
            if (tl > 1e-6) {
                val drop = if (resting) min(tl, wallFriction * -vn) / tl else 0.15
                p.vx -= tx * drop; p.vy -= ty * drop
            }
            if (resting) p.spin *= 0.7
            else {
                val cross = (wpx - c.x) * ny - (wpy - c.y) * nx
                p.spin += 0.5 * cross * hit * p.mass / p.inertia
            }
        }
        return hit
    }

    private fun pushInside(qx: Double, qy: Double, rect: Box, radius: Double): Pt {
        val cx = if (qx < rect.left + radius) rect.left + radius else if (qx > rect.right - radius) rect.right - radius else null
        val cy = if (qy < rect.top + radius) rect.top + radius else if (qy > rect.bottom - radius) rect.bottom - radius else null
        if (cx != null && cy != null && radius > 0) {
            val d = hypot(qx - cx, qy - cy)
            if (d <= radius) return Pt.ZERO
            return Pt((cx - qx) * (d - radius) / d, (cy - qy) * (d - radius) / d)
        }
        var vx = 0.0; var vy = 0.0
        if (qx < rect.left) vx = rect.left - qx else if (qx > rect.right) vx = rect.right - qx
        if (qy < rect.top) vy = rect.top - qy else if (qy > rect.bottom) vy = rect.bottom - qy
        return Pt(vx, vy)
    }
}
