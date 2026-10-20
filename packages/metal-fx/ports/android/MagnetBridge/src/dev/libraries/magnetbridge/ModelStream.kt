package dev.libraries.magnetbridge

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.DisplayMetrics
import android.view.WindowManager
import dev.libraries.magnetkit.MagnetGesture
import dev.libraries.magnetkit.MagnetReading
import dev.libraries.magnetkit.MagnetSource
import dev.libraries.magnetkit.Pt
import java.util.Locale

/**
 * Runs the magnet model (MagnetKit for Android) ~50 times a second while the
 * bridge is on, and hands every frame and every gesture to the pages as JSON.
 * Positions are dp from the screen's top left, the frame the grab measured in.
 */
object ModelStream {
    @Volatile var last: MagnetReading = MagnetReading(); private set
    @Volatile var running = false; private set
    lateinit var grab: GrabSettings; private set
    var screen = Pt(0.0, 0.0); private set

    private var sink: ((String) -> Unit)? = null
    private var source: MagnetSource? = null
    private val main = Handler(Looper.getMainLooper())
    private var gestureId = 0
    private var nextAt = 0L

    fun start(ctx: Context, send: (String) -> Unit) {
        if (running) return
        sink = send
        lastContext = ctx.applicationContext
        grab = GrabSettings(ctx)
        screen = screenDp(ctx)
        val s = MagnetSource.get(ctx)
        source = s
        s.attach()
        gestureId = s.addGestureListener { g -> sink?.invoke(gestureJson(g)) }
        running = true
        nextAt = SystemClock.uptimeMillis()
        main.post(tick)
    }

    fun stop() {
        if (!running) return
        running = false
        main.removeCallbacks(tick)
        source?.let { it.removeGestureListener(gestureId); it.detach() }
        sink = null
    }

    /** Take a new zero (keep magnets away). */
    fun calibrate() { source?.calibrate() }

    fun reloadGrab(ctx: Context) { grab = GrabSettings(ctx) }

    /** Messages from a page: {"type":"set-magnet","face":-1,"strength":3200,"sensor":[x,y]} (dp),
     *  {"type":"calibrate"}. Runs on the main thread, like the model. */
    fun onMessage(text: String, reply: (String) -> Unit) {
        val j = runCatching { org.json.JSONObject(text) }.getOrNull() ?: return
        main.post {
            when (j.optString("type")) {
                "set-magnet" -> {
                    val s = j.optJSONArray("sensor")
                    val spot = if (s != null) Pt(s.getDouble(0), s.getDouble(1)) else grab.sensor(screen, 160.0 / 2.54)
                    grab.setLearned(j.optInt("face", 1), j.optDouble("strength", 5000.0), spot)
                    source?.let { grab.apply(it.config, screen) }
                    lastContext?.let { reply(helloJson(it)) }
                }
                "calibrate" -> source?.calibrate()
                "hello" -> lastContext?.let { reply(helloJson(it)) }
            }
        }
    }
    private var lastContext: Context? = null

    private val tick = object : Runnable {
        override fun run() {
            if (!running) return
            val s = source ?: return
            grab.apply(s.config, screen)
            val now = SystemClock.elapsedRealtimeNanos() / 1e9
            val r = s.reading(now)
            last = r
            sink?.invoke(frameJson(r, now))
            nextAt += 20
            if (nextAt < SystemClock.uptimeMillis() - 100) nextAt = SystemClock.uptimeMillis()
            main.postAtTime(this, nextAt)
        }
    }

    fun screenDp(ctx: Context): Pt {
        val d = ctx.resources.displayMetrics.density
        return if (Build.VERSION.SDK_INT >= 30) {
            val b = ctx.getSystemService(WindowManager::class.java).maximumWindowMetrics.bounds
            Pt(b.width() / d.toDouble(), b.height() / d.toDouble())
        } else {
            @Suppress("DEPRECATION")
            val m = DisplayMetrics().also { ctx.getSystemService(WindowManager::class.java).defaultDisplay.getRealMetrics(it) }
            Pt(m.widthPixels / d.toDouble(), m.heightPixels / d.toDouble())
        }
    }

    private fun n(v: Double?): String = if (v == null || !v.isFinite()) "null" else String.format(Locale.ROOT, "%.3f", v)
    private fun p(v: Pt?): String = if (v == null) "null" else "[${n(v.x)},${n(v.y)}]"

    fun helloJson(ctx: Context): String {
        val g = grab
        return "{\"type\":\"model-hello\",\"screenDp\":${p(screen)},\"density\":${n(ctx.resources.displayMetrics.density.toDouble())}," +
            "\"grabStage\":${g.stage},\"face\":${g.face ?: "null"},\"strength\":${n(g.strength)}," +
            "\"sensorDp\":${p(g.sensor(screen, source?.config?.pointsPerCm ?: (160.0 / 2.54)))}," +
            "\"model\":${source?.model != null}}"
    }

    private fun frameJson(r: MagnetReading, now: Double): String = buildString {
        append("{\"type\":\"m\",\"t\":").append(n(now * 1000))
        append(",\"pos\":").append(p(r.screenPosition))
        append(",\"sp\":").append(n(r.screenSpread))
        append(",\"h\":").append(n(r.height))
        append(",\"p\":").append(n(r.presence))
        append(",\"pull\":").append(n(r.pull))
        append(",\"tw\":").append(p(r.toward))
        append(",\"pol\":").append(n(r.polarity))
        append(",\"s\":").append(n(r.strength))
        append(",\"d\":[").append(n(r.delta.x)).append(',').append(n(r.delta.y)).append(',').append(n(r.delta.z)).append(']')
        append(",\"dist\":").append(n(r.distance))
        append(",\"as\":").append(n(r.approachSpeed))
        append(",\"lv\":").append(p(r.lateralVelocity))
        append(",\"tc\":").append(r.tooClose)
        append(",\"cal\":").append(r.calibrating)
        append(",\"zeroed\":").append(r.calibrated)
        append(",\"u\":[").append(n(r.raw.x)).append(',').append(n(r.raw.y)).append(',').append(n(r.raw.z)).append("]}")
    }

    private fun gestureJson(g: MagnetGesture): String = when (g) {
        is MagnetGesture.Tap -> "{\"type\":\"gesture\",\"g\":\"tap\",\"at\":${p(g.at)}}"
        is MagnetGesture.Push -> "{\"type\":\"gesture\",\"g\":\"push\",\"speed\":${n(g.speed)}}"
        is MagnetGesture.PullAway -> "{\"type\":\"gesture\",\"g\":\"pullAway\",\"speed\":${n(g.speed)}}"
        is MagnetGesture.Swipe -> "{\"type\":\"gesture\",\"g\":\"swipe\",\"dir\":${p(g.direction)},\"speed\":${n(g.speed)}}"
    }
}
