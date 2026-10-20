package dev.libraries.magnetkit

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Where an upright magnet is, worked out directly from the physics (a dipole
 * whose axis points roughly at the screen). Needs the magnet's face; the
 * strength only sets the distance. The same maths as MagnetKit's MagnetDipole.
 */
object MagnetDipole {
    /** cos²α from the field's vertical share q = face·Bz/|B| (closed form). */
    fun cos2(q0: Double): Double {
        val q = min(1.0, max(-1.0, q0))
        val u = (q + sqrt(q * q + 8)) / 2
        return min(1.0, max(0.0, (u * u - 1) / 3))
    }

    /** The magnet relative to the sensor (cm, device axes) and how much of the field lies in the screen's plane. */
    fun locate(b: Vec3, face: Int, strength: Double, maxHeight: Double? = null): Pair<Vec3, Double>? {
        val nb = b.length
        if (nb <= 1e-6 || strength <= 0) return null
        val f = if (face < 0) -1.0 else 1.0
        val c2 = cos2(f * b.z / nb)
        val c = sqrt(c2); val s = sqrt(max(0.0, 1 - c2))
        var phi = atan2(b.y, b.x)
        if (f < 0) phi += Math.PI
        val r = (strength * sqrt(1 + 3 * c2) / nb).pow(1.0 / 3.0)
        val inPlane = sqrt(b.x * b.x + b.y * b.y) / nb
        var h = r * c; var lateral = r * s
        if (maxHeight != null && h > maxHeight) { h = maxHeight; lateral = sqrt(max(0.0, r * r - h * h)) }
        return Pair(Vec3(lateral * cos(phi), lateral * sin(phi), h), inPlane)
    }

    /**
     * The face and strength from one reading with the magnet held over a known
     * spot (`offsetX`, `offsetY`: from the sensor, cm, device axes): the face
     * and height (0.6–3.6 cm) whose predicted field direction matches best.
     */
    fun learn(b: Vec3, offsetX: Double, offsetY: Double): Pair<Int, Double>? {
        val nb = b.length
        if (nb <= 1e-6 || sqrt(offsetX * offsetX + offsetY * offsetY) <= 0.5) return null
        val u = b / nb
        var best: Triple<Double, Int, Double>? = null
        for (face in intArrayOf(1, -1)) {
            val m = Vec3(0.0, 0.0, face.toDouble())
            var h = 0.6
            while (h <= 3.6001) {
                val p = Vec3(offsetX, offsetY, h)
                val r = p.length
                val rh = -p / r
                val dir = rh * (3 * m.dot(rh)) - m
                val score = u.dot(dir / dir.length)
                if (best == null || score > best.first) best = Triple(score, face, nb * r * r * r / dir.length)
                h += 0.2
            }
        }
        val b2 = best ?: return null
        return if (b2.first > 0.6) Pair(b2.second, b2.third) else null
    }

    /** The strength from a magnet held over a spot far from the sensor, at roughly `height` cm above it. */
    fun strength(b: Vec3, offsetX: Double, offsetY: Double, height: Double = 2.4): Double? {
        val nb = b.length
        val lateral = sqrt(offsetX * offsetX + offsetY * offsetY)
        if (nb <= 1e-6 || lateral <= 0.5) return null
        val r = sqrt(lateral * lateral + height * height)
        val c = height / r
        return nb * r * r * r / sqrt(1 + 3 * c * c)
    }
}
