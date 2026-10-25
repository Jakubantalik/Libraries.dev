package dev.libraries.magnetkit

import android.content.Context
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.ln1p
import kotlin.math.max
import kotlin.math.min

/**
 * The magnet model: one on-device model that reads the phone's magnetometer
 * and answers three things — where the magnet is, whether it is really there
 * (or the phone's own magnetised parts are lying), and air taps. The same
 * file as MagnetKit on iOS (Magnet.mfxl, ~2 MB, half precision).
 * `MagnetSource` runs it every frame.
 *
 * The model is not part of this MIT library: it is licensed separately under
 * the Libraries.dev Model License (LICENSE-MODEL.md) and downloaded from
 * libraries.dev. Put Magnet.mfxl in your app's src/main/assets and
 * `bundled` finds it.
 */
class MagnetModel private constructor(
    val version: String,
    val locator: MagnetLocator,
    val presence: MagnetPresence,
    val tap: MagnetTap,
) {
    companion object {
        @Volatile private var cached: MagnetModel? = null

        /** The model in the app's assets (assets/Magnet.mfxl), or null if missing. */
        fun bundled(context: Context): MagnetModel? = cached ?: synchronized(this) {
            cached ?: runCatching { context.assets.open("Magnet.mfxl").use { it.readBytes() } }
                .getOrNull()?.let { parse(it) }?.also { cached = it }
        }

        /** "MFXL", header (kind "magnet", version, parts with offsets and lengths), then each part. */
        fun parse(data: ByteArray): MagnetModel? {
            val header = MfxlNet.header(data) ?: return null
            if (header.optString("kind") != "magnet") return null
            val parts = header.optJSONArray("parts") ?: return null
            val start = 8 + MfxlNet.headerLength(data)
            fun part(name: String): ByteArray? {
                for (i in 0 until parts.length()) {
                    val p = parts.getJSONObject(i)
                    if (p.optString("name") != name) continue
                    val off = start + p.getInt("offset"); val len = p.getInt("length")
                    if (off + len > data.size) return null
                    return data.copyOfRange(off, off + len)
                }
                return null
            }
            val l = part("locator")?.let { MagnetLocator.parse(it) } ?: return null
            val p = part("presence")?.let { MagnetPresence.parse(it) } ?: return null
            val t = part("tap")?.let { MagnetTap.parse(it) } ?: return null
            return MagnetModel(header.optString("version", "1.0"), l, p, t)
        }
    }
}

/** Where the magnet is, from one reading: position relative to the sensor (cm, device axes) and its 1-σ spread, cm. */
class MagnetLocator private constructor(
    private val net: MfxlNet,
    private val logbMid: Float,
    private val logkMid: Float,
    private val logrMid: Float,
    private val lvMin: Float,
    private val lvMax: Float,
    val takesFace: Boolean,
) {
    fun locate(field: Vec3, strength: Double?, face: Int?): Pair<Vec3, Double>? {
        val nb = field.length
        if (nb <= 1e-6) return null
        val knownFace = if (takesFace) face?.let { if (it < 0) -1.0 else 1.0 } else null
        // Known face: turn the field to face +1. Unknown: a flipped magnet
        // gives −B at the same spot, so the network sees one face (Bz ≥ 0).
        val f = knownFace?.let { field * it } ?: if (field.z < 0) -field else field
        val input = ArrayList<Float>(7)
        input += (f.x / nb).toFloat(); input += (f.y / nb).toFloat(); input += (f.z / nb).toFloat()
        input += (ln(nb).toFloat() - logbMid) / 2f
        input += strength?.let { (ln(max(1.0, it)).toFloat() - logkMid) / 1.5f } ?: 0f
        input += if (strength == null) 0f else 1f
        if (takesFace) input += if (knownFace == null) 0f else 1f
        val o = net.forward(input.toFloatArray())
        val d = Vec3(o[0].toDouble(), o[1].toDouble(), o[2].toDouble())
        val dl = d.length
        if (dl <= 1e-9) return null
        val r = exp((o[3] + logrMid).toDouble())
        fun sd(v: Float) = exp(0.5 * min(lvMax, max(lvMin, v)))
        val spread = r * hypot(sd(o[4]), sd(o[5]))
        return Pair(d / dl * r, spread)
    }

    companion object {
        fun parse(data: ByteArray): MagnetLocator? {
            val net = MfxlNet.parse(data, "locator") ?: return null
            val h = net.header
            val version = h.optInt("version", 0)
            if (version != 2 && version != 3) return null
            val clamp = h.optJSONArray("logvarClamp")
            if (net.inputs != (if (version == 3) 7 else 6) || net.outputs != 6) return null
            return MagnetLocator(
                net,
                h.optDouble("logbMid", ln(40.0)).toFloat(), h.optDouble("logkMid", ln(10000.0)).toFloat(),
                h.optDouble("logrMid", ln(5.0)).toFloat(),
                (clamp?.optDouble(0, -10.0) ?: -10.0).toFloat(), (clamp?.optDouble(1, 4.0) ?: 4.0).toFloat(),
                version == 3,
            )
        }
    }
}

/** Is a magnet really there, or is the phone's own offset lying — from the last 15 s. */
class MagnetPresence private constructor(
    private val net: MfxlNet,
    val hz: Double, val short: Int, val longN: Int, val longStep: Int, val window: Double, val contextInputs: Int,
) {
    /**
     * @param history the field change (µT, against the current zero) at [hz], oldest first, ending now.
     * @param overloadedFor seconds since an unzeroed overload, told only right after the field drops; null: no.
     * @return presence (0–1) and the non-magnet part of the reading now, µT.
     */
    fun evaluate(history: List<Vec3>, overloadedFor: Double? = null): Pair<Double, Vec3> {
        val n = history.size
        if (n < max(short, longN * longStep)) return Pair(1.0, Vec3.ZERO)
        val last = history[n - 1]
        val s = max(10.0, last.length)
        val x = FloatArray(short * 3 + longN + 4 + contextInputs)
        var k = 0
        for (i in n - short until n) {
            val v = history[i] / s
            x[k++] = v.x.coerceIn(-6.0, 6.0).toFloat(); x[k++] = v.y.coerceIn(-6.0, 6.0).toFloat(); x[k++] = v.z.coerceIn(-6.0, 6.0).toFloat()
        }
        var j = n - longN * longStep
        repeat(longN) { x[k++] = (ln1p(history[j].length / 10) / 6).toFloat(); j += longStep }
        var peak = 0.0; var peakAt = 0
        for ((i, v) in history.withIndex()) { val m = v.length; if (m > peak) { peak = m; peakAt = i } }
        x[k++] = (ln1p(peak / 100) / 4).toFloat()
        x[k++] = ((n - 1 - peakAt) / hz / 15).toFloat()
        x[k++] = (ln1p(s / 10) / 6).toFloat()
        x[k++] = if (peak > 2000) 1f else 0f
        if (contextInputs >= 2) {
            x[k++] = if (overloadedFor == null) 0f else 1f
            x[k++] = overloadedFor?.let { min(1.6, ln1p(it / 10) / ln1p(60.0)).toFloat() } ?: 0f
        }
        val o = net.forward(x)
        val p = 1 / (1 + exp(-o[0].toDouble()))
        return Pair(p, Vec3(o[1].toDouble(), o[2].toDouble(), o[3].toDouble()) * s)
    }

    companion object {
        fun parse(data: ByteArray): MagnetPresence? {
            val net = MfxlNet.parse(data, "presence") ?: return null
            val h = net.header
            val short = h.optInt("short", 64); val longN = h.optInt("longN", 40); val ctx = h.optInt("context", 0)
            if (net.inputs != short * 3 + longN + 4 + ctx || net.outputs != 4) return null
            return MagnetPresence(net, h.optDouble("hz", 50.0), short, longN, h.optInt("longStep", 5), h.optDouble("window", 15.0), ctx)
        }
    }
}

/** Did an air tap — the hovering magnet dipped toward the glass and back — just finish, from the last 1.28 s. */
class MagnetTap private constructor(private val net: MfxlNet, val hz: Double, val window: Int) {
    fun evaluate(history: List<Vec3>): Double {
        if (history.size < window) return 0.0
        val w = history.subList(history.size - window, history.size)
        val mags = w.map { it.length }
        val s = max(10.0, mags.sorted()[(window - 1) / 2])   // the lower median, as torch's
        val x = FloatArray(window * 4 + 1)
        var k = 0
        for (v in w) {
            x[k++] = (v.x / s).coerceIn(-8.0, 8.0).toFloat(); x[k++] = (v.y / s).coerceIn(-8.0, 8.0).toFloat(); x[k++] = (v.z / s).coerceIn(-8.0, 8.0).toFloat()
        }
        for (m in mags) x[k++] = ln(max(m, 1.0) / s).coerceIn(-4.0, 4.0).toFloat()
        x[k] = (ln1p(s / 10) / 6).toFloat()
        val o = net.forward(x)
        return 1 / (1 + exp(-o[0].toDouble()))
    }

    companion object {
        fun parse(data: ByteArray): MagnetTap? {
            val net = MfxlNet.parse(data, "tap") ?: return null
            val window = net.header.optInt("window", 64)
            if (net.inputs != window * 4 + 1 || net.outputs != 1) return null
            return MagnetTap(net, net.header.optDouble("hz", 50.0), window)
        }
    }
}
