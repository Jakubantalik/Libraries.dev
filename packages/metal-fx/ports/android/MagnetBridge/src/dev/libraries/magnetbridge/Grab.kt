// Copied from magnetic-home's Grab.kt (same logic), prefs renamed for the bridge.
package dev.libraries.magnetbridge

import android.content.Context
import dev.libraries.magnetkit.MagnetConfig
import dev.libraries.magnetkit.MagnetDipole
import dev.libraries.magnetkit.MagnetReading
import dev.libraries.magnetkit.Pt
import dev.libraries.magnetkit.Vec3
import kotlin.math.max
import kotlin.math.min

/**
 * The one-second grabs that learn the magnet (as in the iOS demos): hold it
 * over a ring 5 cm below the sensor (its face and a first strength), then over
 * a ring near the bottom (the strength again, sturdily — far away the height
 * hardly matters — and from both, where this phone's magnetometer sits).
 */
class GrabSettings(context: Context) {
    private val prefs = context.getSharedPreferences("bridge-grab", Context.MODE_PRIVATE)

    var face: Int? = prefs.getInt("face", 0).takeIf { it != 0 }; private set
    var strength: Double? = prefs.getFloat("strength", 0f).toDouble().takeIf { it > 0 }; private set
    var farDone: Boolean = prefs.getBoolean("farDone", false); private set
    /** The sensor's spot as the grabs put it, dp from the window's top left. */
    var sensorSpot: Pt? = if (prefs.contains("sensorX")) Pt(prefs.getFloat("sensorX", 0f).toDouble(), prefs.getFloat("sensorY", 0f).toDouble()) else null; private set
    private var topField: Vec3? = null
    private var topSpot: Pt? = null

    /** 0: waiting for the top grab, 1: for the bottom grab, 2: ready. */
    val stage: Int get() = if (face == null) 0 else if (farDone) 2 else 1
    val ready: Boolean get() = stage == 2

    /** Before measuring: the top centre of the screen (most phones keep the magnetometer up there). */
    fun sensor(screen: Pt, ppcm: Double) = sensorSpot ?: Pt(screen.x / 2, 1.1 * ppcm)
    fun grabSpot(screen: Pt, ppcm: Double) = Pt(screen.x / 2, sensor(screen, ppcm).y + 5.0 * ppcm)
    fun farGrabSpot(screen: Pt) = Pt(screen.x / 2, screen.y * 0.8)

    fun grabState(): GrabState {
        val t = topField
        return if (stage == 1 && t != null) GrabState(4.0, 0.4 * t.length) else GrabState(if (stage == 1) 4.0 else 8.0)
    }

    private fun offset(p: Pt, s: Pt, ppcm: Double) = Pair((p.x - s.x) / ppcm, -(p.y - s.y) / ppcm)

    /** Top grab: which face is toward the screen and a first strength. */
    fun learnTop(field: Vec3, spot: Pt, screen: Pt, ppcm: Double): Boolean {
        val (ox, oy) = offset(spot, sensor(screen, ppcm), ppcm)
        val (f, k) = MagnetDipole.learn(field, ox, oy) ?: return false
        face = f; strength = k; topField = field; topSpot = spot; farDone = false
        save()
        return true
    }

    /** Bottom grab: the sturdy strength; the top grab, re-solved with it, says where the sensor sits. */
    fun learnFar(field: Vec3, spot: Pt, screen: Pt, ppcm: Double) {
        var s = sensor(screen, ppcm)
        var (ox, oy) = offset(spot, s, ppcm)
        var k = MagnetDipole.strength(field, ox, oy) ?: run { skipFar(); return }
        val f = face; val top = topField; val tspot = topSpot
        if (f != null && top != null && tspot != null) {
            repeat(4) {
                val (pos, _) = MagnetDipole.locate(top, f, k, 4.0) ?: return@repeat
                val n = Pt(tspot.x - pos.x * ppcm, tspot.y + pos.y * ppcm)
                // Only where a magnetometer can be: the top part of the phone.
                if (n.x < -20 || n.x > screen.x + 20 || n.y < -40 || n.y > screen.y * 0.45) return@repeat
                s = n
                val o = offset(spot, s, ppcm); ox = o.first; oy = o.second
                k = MagnetDipole.strength(field, ox, oy) ?: return@repeat
            }
            sensorSpot = s
        }
        strength = k; farDone = true
        save()
    }

    fun skipFar() { farDone = true; save() }

    /** Set from outside (the web page's calibration): face, strength and the sensor's spot, dp. */
    fun setLearned(f: Int, k: Double, spot: Pt) {
        face = if (f < 0) -1 else 1; strength = k; sensorSpot = spot; farDone = true; topField = null
        save()
    }

    fun release() { face = null; farDone = false; topField = null; save() }

    /** Into the magnet's config. */
    fun apply(cfg: MagnetConfig, screen: Pt) {
        cfg.screenSize = screen
        cfg.sensorPosition = sensor(screen, cfg.pointsPerCm)
        cfg.magnetFace = face
        cfg.magnetStrength = strength
        cfg.locatorEnabled = true
    }

    private fun save() {
        prefs.edit().apply {
            putInt("face", face ?: 0)
            putFloat("strength", (strength ?: 0.0).toFloat())
            putBoolean("farDone", farDone)
            sensorSpot?.let { putFloat("sensorX", it.x.toFloat()); putFloat("sensorY", it.y.toFloat()) }
        }.apply()
    }
}

/** Waits for a magnet held still and strong enough; returns its mean field once. */
class GrabState(private val threshold: Double = 8.0, private val ceiling: Double = Double.POSITIVE_INFINITY) {
    private val buffer = ArrayDeque<Pair<Double, Vec3>>()
    var progress = 0.0; private set
    private var done = false

    fun tick(r: MagnetReading, now: Double): Vec3? {
        if (done) return null
        if (r.strength <= threshold || r.strength >= ceiling || r.calibrating) { buffer.clear(); progress = 0.0; return null }
        buffer.addLast(Pair(now, r.delta))
        while (buffer.isNotEmpty() && now - buffer.first().first > 0.8) buffer.removeFirst()
        var mean = Vec3.ZERO
        buffer.forEach { mean += it.second }
        mean /= buffer.size.toDouble()
        val spread = buffer.maxOf { (it.second - mean).length }
        if (spread > max(2.0, 0.1 * mean.length)) { buffer.clear(); buffer.addLast(Pair(now, r.delta)); progress = 0.0; return null }
        val held = now - buffer.first().first
        progress = min(1.0, held / 0.6)
        if (held < 0.6) return null
        done = true
        return mean
    }
}
