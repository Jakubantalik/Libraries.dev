package dev.libraries.magnetkit.rn

import android.content.Context
import android.os.Build
import android.util.DisplayMetrics
import android.view.Choreographer
import android.view.WindowManager
import dev.libraries.magnetkit.MagnetGesture
import dev.libraries.magnetkit.MagnetModel
import dev.libraries.magnetkit.MagnetSource
import dev.libraries.magnetkit.Pt
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * MagnetKit for React Native: runs `MagnetSource` (the magnet model) every
 * display frame while JavaScript listens, and sends each reading and each
 * gesture as an event. Positions are dp from the window's top left, as React
 * Native lays out (edge to edge). The model (Magnet.mfxl) comes from the
 * app's assets.
 */
class MagnetKitModule : Module() {
  private var source: MagnetSource? = null
  private var gestureId = 0
  private var running = false
  private var screen = Pt(0.0, 0.0)

  private val context: Context get() = requireNotNull(appContext.reactContext) { "React context is gone" }
  private val prefs get() = context.getSharedPreferences("magnetkit-rn", Context.MODE_PRIVATE)

  private val frame = object : Choreographer.FrameCallback {
    override fun doFrame(frameTimeNanos: Long) {
      if (!running) return
      tick(frameTimeNanos / 1e9)
      Choreographer.getInstance().postFrameCallback(this)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("MagnetKit")

    Events("onFrame", "onGesture")

    Function("isAvailable") { MagnetSource.get(context).isSensorAvailable }

    Function("hasModel") { MagnetModel.bundled(context) != null }

    AsyncFunction("start") { start() }.runOnQueue(Queues.MAIN)

    AsyncFunction("stop") { stop() }.runOnQueue(Queues.MAIN)

    AsyncFunction("zero") { source?.calibrate() }.runOnQueue(Queues.MAIN)

    AsyncFunction("setMagnet") { face: Int, strength: Double, x: Double, y: Double ->
      prefs.edit()
        .putInt("face", if (face < 0) -1 else 1)
        .putFloat("strength", strength.toFloat())
        .putFloat("sensorX", x.toFloat())
        .putFloat("sensorY", y.toFloat())
        .apply()
      applyMagnet()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("clearMagnet") {
      prefs.edit().clear().apply()
      applyMagnet()
    }.runOnQueue(Queues.MAIN)

    Function("getMagnet") {
      val p = prefs
      if (!p.contains("face")) return@Function null
      mapOf(
        "face" to p.getInt("face", 1),
        "strength" to p.getFloat("strength", 0f).toDouble(),
        "sensor" to mapOf("x" to p.getFloat("sensorX", 0f).toDouble(), "y" to p.getFloat("sensorY", 0f).toDouble()),
      )
    }

    Function("screen") {
      val s = screenDp()
      mapOf("width" to s.x, "height" to s.y, "pointsPerCm" to MagnetSource.get(context).config.pointsPerCm)
    }

    OnDestroy {
      android.os.Handler(android.os.Looper.getMainLooper()).post { stop() }
    }
  }

  /** The calibrated magnet, or a guess (sensor near the top centre, face and
   *  strength unknown) so the locator still answers before a calibration. */
  private fun applyMagnet() {
    val s = source ?: MagnetSource.get(context)
    val cfg = s.config
    screen = screenDp()
    cfg.screenSize = screen
    val p = prefs
    if (p.contains("face")) {
      cfg.magnetFace = p.getInt("face", 1)
      cfg.magnetStrength = p.getFloat("strength", 5000f).toDouble()
      cfg.sensorPosition = Pt(p.getFloat("sensorX", 0f).toDouble(), p.getFloat("sensorY", 0f).toDouble())
    } else {
      cfg.magnetFace = null
      cfg.magnetStrength = null
      cfg.sensorPosition = Pt(screen.x / 2, 1.1 * cfg.pointsPerCm)
    }
    cfg.locatorEnabled = true
  }

  private fun start() {
    if (running) return
    val s = MagnetSource.get(context)
    source = s
    applyMagnet()
    s.attach()
    gestureId = s.addGestureListener { g -> sendEvent("onGesture", gesture(g)) }
    running = true
    Choreographer.getInstance().postFrameCallback(frame)
  }

  private fun stop() {
    if (!running) return
    running = false
    Choreographer.getInstance().removeFrameCallback(frame)
    source?.let { it.removeGestureListener(gestureId); it.detach() }
  }

  private fun tick(now: Double) {
    val r = (source ?: return).reading(now)
    sendEvent(
      "onFrame",
      mapOf(
        "t" to now * 1000,
        "pos" to r.screenPosition?.let { mapOf("x" to it.x, "y" to it.y) },
        "spread" to r.screenSpread,
        "height" to r.height,
        "presence" to r.presence,
        "pull" to r.pull,
        "strength" to r.strength,
        "delta" to listOf(r.delta.x, r.delta.y, r.delta.z),
        "toward" to mapOf("x" to r.toward.x, "y" to r.toward.y),
        "polarity" to r.polarity,
        "distance" to r.distance.takeIf { it.isFinite() },
        "approachSpeed" to r.approachSpeed,
        "tooClose" to r.tooClose,
        "calibrating" to r.calibrating,
        "zeroed" to r.calibrated,
      ),
    )
  }

  private fun gesture(g: MagnetGesture): Map<String, Any?> = when (g) {
    is MagnetGesture.Tap -> mapOf("g" to "tap", "at" to g.at?.let { mapOf("x" to it.x, "y" to it.y) })
    is MagnetGesture.Push -> mapOf("g" to "push", "speed" to g.speed)
    is MagnetGesture.PullAway -> mapOf("g" to "pullAway", "speed" to g.speed)
    is MagnetGesture.Swipe -> mapOf("g" to "swipe", "dir" to mapOf("x" to g.direction.x, "y" to g.direction.y), "speed" to g.speed)
  }

  /** The window's size, dp. */
  private fun screenDp(): Pt {
    val ctx = context
    val d = ctx.resources.displayMetrics.density.toDouble()
    return if (Build.VERSION.SDK_INT >= 30) {
      val b = ctx.getSystemService(WindowManager::class.java).maximumWindowMetrics.bounds
      Pt(b.width() / d, b.height() / d)
    } else {
      @Suppress("DEPRECATION")
      val m = DisplayMetrics().also { ctx.getSystemService(WindowManager::class.java).defaultDisplay.getRealMetrics(it) }
      Pt(m.widthPixels / d, m.heightPixels / d)
    }
  }
}
