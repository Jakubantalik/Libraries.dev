package dev.libraries.magnetkit

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sqrt

/** How `MagnetConfig.locatorEnabled` finds the magnet. */
enum class MagnetLocatorMode { NETWORK, DIPOLE }

/** A quick magnet movement. */
sealed class MagnetGesture {
    /** Pushed quickly toward the phone; approach speed, cm/s. */
    data class Push(val speed: Double) : MagnetGesture()
    /** Pulled quickly away; retreat speed, cm/s. */
    data class PullAway(val speed: Double) : MagnetGesture()
    /** An air tap: hovering over the glass, dipped toward the screen and back. `at`: the located point, dp, with the locator on. */
    data class Tap(val at: Pt?) : MagnetGesture()
    /** Swept across the screen (needs the locator); unit direction and speed, dp/s. */
    data class Swipe(val direction: Pt, val speed: Double) : MagnetGesture()
}

/** How a magnetometer reading becomes a magnet reading. Lengths on screen are dp. */
data class MagnetConfig(
    /** Field change, µT, that reads as full pull. */
    var fullScale: Double = 60.0,
    /** Knee of the log scale, µT. */
    var scale: Double = 10.0,
    /** Change below this, µT, is noise. */
    var deadzone: Double = 3.0,
    /** Low-pass time constant on the reading, s. */
    var smoothing: Double = 0.06,
    /** Re-zero once the phone has settled in a new pose. */
    var autoRecalibrate: Boolean = true,
    var poseTolerance: Double = 10.0,
    var settleSeconds: Double = 0.8,
    /** Where the magnetometer sits, dp from the window's top left. */
    var sensorPosition: Pt? = null,
    /** The window's size, dp (for placing a magnet resting beside an edge). */
    var screenSize: Pt? = null,
    var distanceK: Double = 16.0,
    /** dp per centimetre (160 dp per inch). */
    var pointsPerCm: Double = 160.0 / 2.54,
    var driftSeconds: Double = 2.0,
    var driftThreshold: Double? = null,
    var steadyRezero: Boolean = true,
    /** Above this, µT, the magnet is close enough to the sensor to magnetise the phone. */
    var tooCloseStrength: Double = 2000.0,
    var presenceModel: Boolean = true,
    var tapModel: Boolean = true,
    var locatorEnabled: Boolean = false,
    /** The magnet's dipole constant, µT·cm³, if known. */
    var magnetStrength: Double? = null,
    /** +1 north toward the user, −1 south, null unknown. */
    var magnetFace: Int? = null,
    var locatorMode: MagnetLocatorMode = MagnetLocatorMode.NETWORK,
    var dipoleMaxHeight: Double? = 4.0,
    var deskPrior: Boolean = true,
    var gesturePushRate: Double = 5.0,
    var gesturePullRate: Double = 5.0,
    var gestureTapWindow: Double = 0.45,
    var gestureMinPull: Double = 0.2,
    var gestureSwipeSpeed: Double = 1500.0,
)

/** One frame, relative to the calibrated zero. */
data class MagnetReading(
    var available: Boolean = false,
    var calibrated: Boolean = false,
    var calibrating: Boolean = false,
    var tooClose: Boolean = false,
    var presence: Double = 1.0,
    var offsetEstimate: Vec3 = Vec3.ZERO,
    /** Raw field, µT, device axes. */
    var raw: Vec3 = Vec3.ZERO,
    /** Low-passed field minus the zero, µT. */
    var delta: Vec3 = Vec3.ZERO,
    var strength: Double = 0.0,
    /** 0…1, log scale of `strength`. */
    var pull: Double = 0.0,
    /** Unit vector on screen from the sensor toward the magnet; zero when unknown. */
    var toward: Pt = Pt.ZERO,
    var polarity: Double = 1.0,
    var distance: Double = Double.POSITIVE_INFINITY,
    var moving: Boolean = false,
    /** With the locator: where the magnet is, dp (smoothed), its 1-σ spread, dp, and height above the glass, cm. */
    var screenPosition: Pt? = null,
    var screenSpread: Double = 0.0,
    var height: Double? = null,
    var approachRate: Double = 0.0,
    var approachSpeed: Double = 0.0,
    var lateralVelocity: Pt = Pt.ZERO,
)

/**
 * The phone's magnetometer as a magnet detector — the Android twin of
 * MagnetKit's MagnetSource. It reads the uncalibrated magnetometer (Android's
 * own calibration would slowly take a nearby magnet for part of the phone),
 * keeps its own zero, and runs the magnet model. Call [reading] once per frame.
 */
class MagnetSource private constructor(private val app: Context) : SensorEventListener {
    companion object {
        @Volatile private var instance: MagnetSource? = null
        fun get(context: Context): MagnetSource = instance ?: synchronized(this) {
            instance ?: MagnetSource(context.applicationContext).also { instance = it }
        }
        private const val SETTLE_DELAY = 0.25
        private const val CAL_DURATION = 0.35
        private const val ZEROS_KEY = "zeros"
    }

    var config = MagnetConfig()
    /** Feed a raw field by hand, µT in device axes (emulator, tests). */
    var simulatedField: Vec3? = null
    var simulatedAmbient: Vec3? = null
    /** Pause the drift re-zero. */
    var holdBaseline = false

    private val sensors = app.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val magSensor: Sensor? = sensors.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD_UNCALIBRATED)
        ?: sensors.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD)
    private val poseSensor: Sensor? = sensors.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)
    private val gyroSensor: Sensor? = sensors.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
    val isSensorAvailable: Boolean get() = magSensor != null
    val model: MagnetModel? by lazy { MagnetModel.bundled(app) }

    @Volatile private var latestRaw: Vec3? = null
    @Volatile private var latestPose: FloatArray? = null
    @Volatile private var gyroRate = 0.0

    private var subscribers = 0
    private var baseline: Vec3? = null
    private var calStart = -1.0
    private var calSum = Vec3.ZERO
    private var calCount = 0
    private var calPose: FloatArray? = null
    private var smoothed: Vec3? = null
    private var lastSign = 1.0
    private var lastToward = Pt.ZERO
    private var lastPolarity = 1.0
    private var located: Pt? = null
    private val targets = ArrayDeque<Pair<Double, Pt>>()
    private var locatedDistance: Double? = null
    private val lnHistory = ArrayDeque<Triple<Double, Double, Double>>()
    private val posHistory = ArrayDeque<Pair<Double, Pt>>()
    private var motionRate = 0.0
    private val pullHistory = ArrayDeque<Pair<Double, Double>>()
    private var pushed = false
    private var lastPushT = -10.0
    private var lastPullT = -10.0
    private var lastSwipeT = -10.0
    private val listeners = LinkedHashMap<Int, (MagnetGesture) -> Unit>()
    private var nextListenerId = 1
    private val main = Handler(Looper.getMainLooper())
    private var lastT = 0.0
    private var overloadPeak = 0.0
    private var overloadAt = -10.0
    private var leftoverWatchUntil = -10.0
    private var stillSince = -1.0
    private val recent = ArrayDeque<Pair<Double, Vec3>>()
    private var quietSince = -1.0
    private var phantomSince = -1.0
    private val rawHistory = ArrayList<Pair<Double, Vec3>>()
    private var presence = 1.0
    private var offsetEstimate = Vec3.ZERO
    private var presenceAt = 0.0
    /** When the phone was last overloaded, while it has not been zeroed since. */
    private var overloadedAt: Double? = null
    private val recentSize = ArrayDeque<Pair<Double, Double>>()
    private var tapP = 0.0
    private var tapAt = 0.0
    private var tapHigh = false
    private var lastTapT = -10.0
    private val tapPoints = ArrayDeque<Triple<Double, Pt, Double>>()
    private var zeroBeforePhantom: Vec3? = null
    private var zeroBeforePhantomAt = 0.0
    private val prefs = app.getSharedPreferences("magnetkit", Context.MODE_PRIVATE)
    private val knownZeros = loadZeros()
    private var cachedNow = -1.0
    private var cached = MagnetReading()

    // MARK: Sensors

    fun attach() {
        subscribers += 1
        if (subscribers != 1) return
        magSensor?.let { sensors.registerListener(this, it, 10_000) }
        poseSensor?.let { sensors.registerListener(this, it, 16_000) }
        gyroSensor?.let { sensors.registerListener(this, it, 16_000) }
        if (baseline == null) calibrate()
    }

    fun detach() {
        subscribers = max(0, subscribers - 1)
        if (subscribers != 0) return
        sensors.unregisterListener(this)
        smoothed = null
    }

    override fun onSensorChanged(e: SensorEvent) {
        when (e.sensor.type) {
            Sensor.TYPE_MAGNETIC_FIELD_UNCALIBRATED, Sensor.TYPE_MAGNETIC_FIELD ->
                latestRaw = Vec3(e.values[0].toDouble(), e.values[1].toDouble(), e.values[2].toDouble())
            Sensor.TYPE_GAME_ROTATION_VECTOR -> {
                val q = FloatArray(4); SensorManager.getQuaternionFromVector(q, e.values); latestPose = q
            }
            Sensor.TYPE_GYROSCOPE -> gyroRate = sqrt((e.values[0] * e.values[0] + e.values[1] * e.values[1] + e.values[2] * e.values[2]).toDouble())
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    /** Be told about quick movements (push, pull away, tap, swipe), on the main thread. Returns an id to remove it. */
    fun addGestureListener(l: (MagnetGesture) -> Unit): Int { val id = nextListenerId++; listeners[id] = l; return id }
    fun removeGestureListener(id: Int) { listeners.remove(id) }
    private fun fire(g: MagnetGesture) { val ls = listeners.values.toList(); main.post { ls.forEach { it(g) } } }

    /** Take a new zero over the next ~0.6 s. Keep magnets away. */
    fun calibrate() {
        zeroBeforePhantom = null
        calStart = 0.0
        calSum = Vec3.ZERO
        calCount = 0
    }

    // MARK: Remembered zeros

    private fun loadZeros(): MutableList<Pair<Vec3, Double>> {
        val now = System.currentTimeMillis() / 1000.0
        val out = ArrayList<Pair<Vec3, Double>>()
        val a = runCatching { JSONArray(prefs.getString(ZEROS_KEY, "[]")) }.getOrNull() ?: return out
        for (i in 0 until a.length()) {
            val e = a.optJSONArray(i) ?: continue
            if (e.length() == 4 && now - e.getDouble(3) < 2 * 86400) out.add(Pair(Vec3(e.getDouble(0), e.getDouble(1), e.getDouble(2)), e.getDouble(3)))
        }
        return out
    }

    private fun rememberZero(z: Vec3) {
        val now = System.currentTimeMillis() / 1000.0
        knownZeros.removeAll { (it.first - z).length < 2 || now - it.second > 2 * 86400 }
        knownZeros.add(Pair(z, now))
        while (knownZeros.size > 6) knownZeros.removeAt(0)
        val a = JSONArray()
        knownZeros.forEach { a.put(JSONArray(listOf(it.first.x, it.first.y, it.first.z, it.second))) }
        prefs.edit().putString(ZEROS_KEY, a.toString()).apply()
    }

    // MARK: Locator

    private fun screenVector(x: Double, y: Double) = Pt(x, -y)   // portrait: device y up → screen y down

    private fun locate(d: Vec3, cfg: MagnetConfig): Pair<Vec3, Double>? {
        val engine = engineLocate(d, cfg)
        val desk = if (cfg.deskPrior) deskPlacement(d, cfg) else null
        if (desk == null) return engine
        if (engine == null) return Pair(desk.first, desk.second)
        val w = desk.third
        return Pair(engine.first * (1 - w) + desk.first * w, engine.second * (1 - w) + desk.second * w)
    }

    /** A magnet resting at desk height beside the phone: placed beside the edge its sideways field points to. */
    private fun deskPlacement(d: Vec3, cfg: MagnetConfig): Triple<Vec3, Double, Double>? {
        val face = cfg.magnetFace ?: return null
        val sensor = cfg.sensorPosition ?: return null
        val screen = cfg.screenSize ?: return null
        val nb = d.length
        if (nb <= 1e-6) return null
        val f = if (face < 0) -1.0 else 1.0
        if (f * d.z >= 0) return null
        val inPlane = sqrt(d.x * d.x + d.y * d.y) / nb
        val w = min(1.0, max(0.0, (0.3 - inPlane) / 0.15))
        if (w <= 0) return null
        val r = ((cfg.magnetStrength ?: 30000.0) / nb).pow(1.0 / 3.0)
        var tx = f * d.x; var ty = f * d.y
        val tl = sqrt(tx * tx + ty * ty)
        if (tl <= 1e-6) return null
        tx /= tl; ty /= tl
        val ppcm = cfg.pointsPerCm
        val left = -sensor.x / ppcm; val right = (screen.x - sensor.x) / ppcm
        val top = sensor.y / ppcm
        val gap = 1.5
        var x: Double; var y: Double
        if (ty > 0.85) {
            y = top + gap
            if (r <= y) { y = r; x = 0.0 } else x = (if (tx >= 0) 1.0 else -1.0) * sqrt(r * r - y * y)
        } else if (ty < -0.85) {
            x = r * tx; y = r * ty
        } else {
            val side = if (tx >= 0) 1.0 else -1.0
            x = if (side > 0) right + gap else left - gap
            if (r <= abs(x)) { x = side * r; y = 0.0 } else y = -sqrt(r * r - x * x)
        }
        return Triple(Vec3(x, y, 0.5), 0.3 + 0.15 * r, w)
    }

    private fun engineLocate(d: Vec3, cfg: MagnetConfig): Pair<Vec3, Double>? {
        val face = cfg.magnetFace
        if (cfg.locatorMode == MagnetLocatorMode.DIPOLE && face != null) {
            MagnetDipole.locate(d, face, cfg.magnetStrength ?: 30000.0, cfg.dipoleMaxHeight)?.let { (p, inPlane) ->
                val lateral = sqrt(p.x * p.x + p.y * p.y)
                val bearingSD = min(1.2, 0.12 / max(0.05, inPlane))
                return Pair(p, 0.3 + 0.12 * p.length + lateral * bearingSD)
            }
        }
        return model?.locator?.locate(d, cfg.magnetStrength, cfg.magnetFace)
    }

    // MARK: Reading

    /** The current reading. Evaluated once per frame (`now` in seconds); every view shares it. */
    fun reading(now: Double): MagnetReading {
        if (now == cachedNow) return cached
        cachedNow = now
        cached = compute(now)
        return cached
    }

    private fun resample(now: Double, n: Int, hz: Double, zero: Vec3): List<Vec3> {
        val h = ArrayList<Vec3>(n)
        var j = 0
        for (k in 0 until n) {
            val tk = now - (n - 1 - k) / hz
            while (j + 1 < rawHistory.size && rawHistory[j + 1].first <= tk) j++
            h.add(rawHistory[j].second - zero)
        }
        return h
    }

    private fun compute(now: Double): MagnetReading {
        val out = MagnetReading()
        val raw = simulatedField ?: latestRaw ?: return out
        out.available = true
        out.raw = raw
        val cfg = config
        val dt = if (lastT > 0) min(0.1, max(0.001, now - lastT)) else 1.0 / 60
        lastT = now

        var s = smoothed ?: raw
        s += (raw - s) * (1 - exp(-dt / max(0.005, cfg.smoothing)))
        smoothed = s

        // Calibration: let the reading settle, then average.
        if (calStart >= 0) {
            if (calStart == 0.0) calStart = now
            out.calibrating = true
            out.calibrated = baseline != null
            val age = now - calStart
            if (age >= SETTLE_DELAY) {
                calSum += if (simulatedField != null) (simulatedAmbient ?: raw) else raw
                calCount += 1
            }
            if (age >= SETTLE_DELAY + CAL_DURATION && calCount > 0) {
                val b = calSum / calCount.toDouble()
                baseline = b
                overloadedAt = null
                if (simulatedField == null) rememberZero(b)
                smoothed = b
                calPose = latestPose?.copyOf()
                calStart = -1.0
                stillSince = -1.0
            }
            return out
        }
        val base = baseline ?: run { calibrate(); return out }
        out.calibrated = true

        // New pose (picked up, turned): re-zero once the phone settles.
        val ref = calPose; val pose = latestPose
        if (simulatedField == null && cfg.autoRecalibrate && ref != null && pose != null) {
            val dot = abs(ref[0] * pose[0] + ref[1] * pose[1] + ref[2] * pose[2] + ref[3] * pose[3]).toDouble()
            val angle = 2 * acos(min(1.0, dot)) * 180 / Math.PI
            if (angle > cfg.poseTolerance) {
                out.moving = true
                if (gyroRate < 0.12) {
                    if (stillSince < 0) stillSince = now
                    if (now - stillSince > cfg.settleSeconds) calibrate()
                } else stillSince = -1.0
            } else stillSince = -1.0
        }

        // Drift and leftovers.
        recent.addLast(Pair(now, s))
        while (recent.isNotEmpty() && now - recent.first().first > 0.8) recent.removeFirst()
        var zero = base
        zeroBeforePhantom?.let { prev ->
            if (now - zeroBeforePhantomAt > 120) zeroBeforePhantom = null
            else if ((s - prev).length < max(2.0, 0.05 * (prev - zero).length)) { zero = prev; baseline = prev; zeroBeforePhantom = null }
        }
        val away = (s - zero).length
        val weak = away < (cfg.driftThreshold ?: max(5.0, 0.08 * cfg.fullScale))
        if (away > cfg.tooCloseStrength) {
            overloadPeak = max(overloadPeak, away); overloadAt = now
            overloadedAt = now
        } else if (overloadPeak > 0) {
            if (away < 0.15 * overloadPeak && now - overloadAt < 20) { leftoverWatchUntil = now + 10; overloadPeak = 0.0 }
            else if (now - overloadAt > 20) overloadPeak = 0.0
        }
        var devMax = Double.POSITIVE_INFINITY
        if (recent.size >= 4) {
            var mean = Vec3.ZERO
            recent.forEach { mean += it.second }
            mean /= recent.size.toDouble()
            devMax = recent.maxOf { (it.second - mean).length }
        }

        // The model: presence (~30 Hz) and taps (~50 Hz) from the recent raw field.
        val net = if (cfg.presenceModel) model?.presence else null
        val tapNet = if (cfg.tapModel) model?.tap else null
        if (net != null || tapNet != null) {
            rawHistory.add(Pair(now, raw))
            val keep = max(net?.let { it.window + 1 } ?: 0.0, tapNet?.let { it.window / it.hz + 0.5 } ?: 0.0)
            var cut = 0
            while (cut < rawHistory.size && now - rawHistory[cut].first > keep) cut++
            if (cut > 0) rawHistory.subList(0, cut).clear()
        }
        if (tapNet != null && now - tapAt >= 1.0 / 50) {
            tapAt = now
            tapP = tapNet.evaluate(resample(now, tapNet.window, tapNet.hz, zero))
        } else if (tapNet == null) tapP = 0.0
        if (net != null) {
            if (now - presenceAt >= 1.0 / 30) {
                presenceAt = now
                val h = resample(now, (net.window * net.hz).toInt(), net.hz, zero)
                // Told about an unzeroed overload only while the field has just dropped.
                val size = (raw - zero).length
                recentSize.addLast(Pair(now, size))
                while (recentSize.isNotEmpty() && now - recentSize.first().first > 10) recentSize.removeFirst()
                val peak = recentSize.maxOf { it.second }
                val dropped = peak - size > max(15.0, 0.12 * peak)
                val r = net.evaluate(h, if (dropped) overloadedAt?.let { now - it } else null)
                presence += (r.first - presence) * (1 - exp(-(1.0 / 30) / 0.1))
                offsetEstimate = r.second
            }
        } else presence = 1.0

        // Settled back onto a remembered no-magnet reading: that is the zero.
        var snapped = false
        if (!holdBaseline && !weak && devMax < 1.5) {
            val k = knownZeros.minByOrNull { (it.first - s).length }
            if (k != null && (k.first - s).length < 2.5) {
                zero = k.first; baseline = k.first
                zeroBeforePhantom = null
                overloadedAt = null
                snapped = true
            }
        }
        val phantom = if (net != null) presence < 0.25 else (cfg.steadyRezero && now < leftoverWatchUntil)
        if (snapped) {
            quietSince = -1.0; phantomSince = -1.0
        } else if (!holdBaseline && weak && devMax < 0.8) {
            phantomSince = -1.0
            if (quietSince < 0) quietSince = now
            if (now - quietSince > 0.6) {
                zero += (s - zero) * (1 - exp(-dt / max(0.2, cfg.driftSeconds)))
                baseline = zero
            }
        } else if (!holdBaseline && phantom && !weak && devMax < max(3.5, 0.03 * away)) {
            // Not a magnet and holding still: the sensor's own offset.
            quietSince = -1.0
            if (phantomSince < 0) phantomSince = now
            if (now - phantomSince > 0.6) {
                if (zeroBeforePhantom == null || now - zeroBeforePhantomAt > 2) { zeroBeforePhantom = zero; zeroBeforePhantomAt = now }
                zero += (s - zero) * (1 - exp(-dt / 0.25))
                baseline = zero
                if ((s - zero).length < 2) overloadedAt = null
            }
        } else {
            quietSince = -1.0; phantomSince = -1.0
        }

        val d = s - zero
        out.delta = d
        val strength = d.length
        out.strength = strength
        out.tooClose = strength > cfg.tooCloseStrength
        val b = max(0.0, strength - cfg.deadzone)
        val kk = max(0.5, cfg.scale)
        out.pull = min(1.0, log10(1 + b / kk) / max(0.01, log10(1 + max(1.0, cfg.fullScale - cfg.deadzone) / kk)))
        out.presence = presence
        out.offsetEstimate = offsetEstimate
        if (net != null) out.pull *= min(1.0, max(0.0, (presence - 0.15) / 0.35))
        if (strength > 1) out.distance = cfg.distanceK * strength.pow(-1.0 / 3.0)

        // Locator: where the magnet is, smoothed more when unsure.
        val sensor = cfg.sensorPosition
        val loc = if (cfg.locatorEnabled && strength > 2.5 && sensor != null) locate(d, cfg) else null
        if (loc != null && sensor != null) {
            val (pos, spreadCm) = loc
            val v = screenVector(pos.x, pos.y)
            var target = Pt(sensor.x + v.x * cfg.pointsPerCm, sensor.y + v.y * cfg.pointsPerCm)
            val window = if (strength < 15) 0.2 else if (strength < 40) 0.12 else 0.04
            targets.addLast(Pair(now, target))
            while (targets.isNotEmpty() && now - targets.first().first > window) targets.removeFirst()
            if (targets.size >= 3) {
                val xs = targets.map { it.second.x }.sorted(); val ys = targets.map { it.second.y }.sorted()
                target = Pt(xs[xs.size / 2], ys[ys.size / 2])
            }
            val tau = 0.04 + 0.22 * min(1.0, spreadCm / 1.5)
            val cur = located
            located = if (cur != null) cur + (target - cur) * (1 - exp(-dt / tau)) else target
            out.screenPosition = located
            out.screenSpread = spreadCm * cfg.pointsPerCm
            out.height = pos.z - 0.4
            locatedDistance = pos.length
        } else if (strength <= 2.5) {
            located = null; targets.clear(); locatedDistance = null
        }

        // Motion: the slope of ln|B| over the last ~0.12 s.
        val rEst = locatedDistance ?: out.distance
        if (strength > max(3.0, cfg.deadzone * 1.5)) lnHistory.addLast(Triple(now, ln(strength), rEst))
        while (lnHistory.isNotEmpty() && now - lnHistory.first().first > 0.12) lnHistory.removeFirst()
        var rate = 0.0
        if (lnHistory.size >= 3) {
            val n = lnHistory.size.toDouble()
            val mt = lnHistory.sumOf { it.first } / n; val ml = lnHistory.sumOf { it.second } / n
            var num = 0.0; var den = 0.0
            lnHistory.forEach { num += (it.first - mt) * (it.second - ml); den += (it.first - mt) * (it.first - mt) }
            if (den > 1e-9) rate = num / den
        }
        motionRate += (rate - motionRate) * (1 - exp(-dt / 0.03))
        out.approachRate = motionRate
        val rNow = lnHistory.lastOrNull()?.third ?: rEst
        out.approachSpeed = if (rNow.isFinite()) motionRate * rNow / 3 else 0.0

        // Lateral motion of the located point.
        val sp = out.screenPosition
        if (sp != null) {
            posHistory.addLast(Pair(now, sp))
            while (posHistory.isNotEmpty() && now - posHistory.first().first > 0.1) posHistory.removeFirst()
            val first = posHistory.first()
            if (now - first.first > 0.03) {
                val span = now - first.first
                out.lateralVelocity = Pt((sp.x - first.second.x) / span, (sp.y - first.second.y) / span)
            }
        } else posHistory.clear()

        // Gestures.
        pullHistory.addLast(Pair(now, out.pull))
        while (pullHistory.isNotEmpty() && now - pullHistory.first().first > 0.5) pullHistory.removeFirst()
        val recentPull = pullHistory.maxOfOrNull { it.second } ?: 0.0
        if (motionRate > cfg.gesturePushRate && out.pull >= cfg.gestureMinPull && !pushed && now - lastPushT > 0.3) {
            pushed = true; lastPushT = now
            fire(MagnetGesture.Push(max(0.0, out.approachSpeed)))
        } else if (motionRate < cfg.gesturePushRate * 0.3) pushed = false
        if (motionRate < -cfg.gesturePullRate && recentPull >= cfg.gestureMinPull && now - lastPullT > 0.3) {
            lastPullT = now
            fire(MagnetGesture.PullAway(max(0.0, -out.approachSpeed)))
            if (tapNet == null && now - lastPushT < cfg.gestureTapWindow) fire(MagnetGesture.Tap(out.screenPosition))
        }
        if (tapNet != null) {
            out.screenPosition?.let { tapPoints.addLast(Triple(now, it, strength)) }
            while (tapPoints.isNotEmpty() && now - tapPoints.first().first > 1.0) tapPoints.removeFirst()
            // No presence gate: a tap is a quick rise and fall, which a leftover never makes.
            if (tapP > 0.5 && !tapHigh && now - lastTapT > 0.35 && strength > cfg.deadzone) {
                tapHigh = true; lastTapT = now
                fire(MagnetGesture.Tap(tapPoints.maxByOrNull { it.third }?.second))
            } else if (tapP < 0.3) tapHigh = false
        }
        val lv = out.lateralVelocity
        val lspeed = hypot(lv.x, lv.y)
        if (lspeed > cfg.gestureSwipeSpeed && now - lastSwipeT > 0.4) {
            lastSwipeT = now
            fire(MagnetGesture.Swipe(Pt(lv.x / lspeed, lv.y / lspeed), lspeed))
        }

        // Rough side and polarity without the locator.
        if (abs(d.z) > 0.15 * strength + 0.5) lastSign = if (d.z >= 0) 1.0 else -1.0
        val inPlane = hypot(d.x, d.y)
        if (out.pull > 0 && inPlane > 0.06 * strength + 1.5) {
            val flat = abs(d.z) > 0.6 * strength
            val side = if (flat) lastSign else {
                val rv = screenVector(d.x / inPlane, d.y / inPlane)
                if (lastToward == Pt.ZERO) -1.0 else if (rv.x * lastToward.x + rv.y * lastToward.y >= 0) 1.0 else -1.0
            }
            lastToward = screenVector(side * d.x / inPlane, side * d.y / inPlane)
            if (flat) lastPolarity = -lastSign
        } else if (out.pull == 0.0) lastToward = Pt.ZERO
        out.toward = lastToward
        out.polarity = lastPolarity
        return out
    }
}
