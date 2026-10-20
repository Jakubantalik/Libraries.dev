package dev.libraries.magnetbridge

import android.app.Activity
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import dev.libraries.magnetkit.Pt

/**
 * "Learn my magnet": two one-second grabs over rings drawn at known spots on
 * the screen. The first learns which face points at the phone and a first
 * strength; the second (near the bottom) a sturdy strength and, from both,
 * where this phone's magnetometer sits. Full screen, so view = screen dp.
 */
class GrabActivity : Activity() {
    private lateinit var view: GrabView

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        if (!ModelStream.running) startForegroundService(Intent(this, MagnetService::class.java))
        if (Build.VERSION.SDK_INT >= 30) window.setDecorFitsSystemWindows(false)
        window.attributes = window.attributes.apply {
            layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
        }
        view = GrabView(this)
        setContentView(view)
        if (Build.VERSION.SDK_INT >= 30) {
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        }
    }

    private inner class GrabView(ctx: Activity) : View(ctx) {
        private val density = resources.displayMetrics.density
        private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 3 * density; color = Color.WHITE }
        private val arc = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 6 * density; color = Color.rgb(80, 160, 255); strokeCap = Paint.Cap.ROUND }
        private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textSize = 18 * density; textAlign = Paint.Align.CENTER; typeface = Typeface.DEFAULT_BOLD }
        private val small = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(180, 180, 180); textSize = 14 * density; textAlign = Paint.Align.CENTER }
        private var state: GrabState? = null
        private var stateStage = -1
        private var doneAt = 0L
        private val loc = IntArray(2)

        init { setBackgroundColor(Color.BLACK) }

        override fun onDraw(c: Canvas) {
            super.onDraw(c)
            if (!ModelStream.running) {
                c.drawText("Starting the bridge…", width / 2f, height / 2f, text)
                postInvalidateOnAnimation(); return
            }
            val g = ModelStream.grab
            val screen = ModelStream.screen
            val ppcm = 160.0 / 2.54
            val r = ModelStream.last
            getLocationOnScreen(loc)
            fun toPx(p: Pt) = floatArrayOf((p.x * density - loc[0]).toFloat(), (p.y * density - loc[1]).toFloat())
            val cx = width / 2f

            if (g.stage == 2) {
                if (doneAt == 0L) doneAt = SystemClock.uptimeMillis()
                c.drawText("Magnet learned", cx, height * 0.4f, text)
                val s = g.sensor(screen, ppcm)
                c.drawText(String.format("face %s · strength %.0f µT·cm³", if (g.face == 1) "north" else "south", g.strength ?: 0.0), cx, height * 0.4f + 32 * density, small)
                val sp = toPx(s)
                c.drawCircle(sp[0], sp[1], 6 * density, arc)
                c.drawText("magnetometer", sp[0], sp[1] + 24 * density, small)
                if (SystemClock.uptimeMillis() - doneAt > 2500) { finish(); return }
                postInvalidateOnAnimation(); return
            }
            if (stateStage != g.stage) { state = g.grabState(); stateStage = g.stage }
            val spot = if (g.stage == 0) g.grabSpot(screen, ppcm) else g.farGrabSpot(screen)
            val px = toPx(spot)
            val rad = 34 * density
            c.drawCircle(px[0], px[1], rad, ring)
            val st = state!!
            val now = SystemClock.elapsedRealtimeNanos() / 1e9
            val field = st.tick(r, now)
            c.drawArc(RectF(px[0] - rad - 8 * density, px[1] - rad - 8 * density, px[0] + rad + 8 * density, px[1] + rad + 8 * density), -90f, (360 * st.progress).toFloat(), false, arc)
            val msg = when {
                r.calibrating -> "Calibrating — keep the magnet away"
                g.stage == 0 -> "Hold the magnet over the ring, 1–2 cm above the glass"
                else -> "Now hold it over this ring"
            }
            val ty = if (px[1] < height / 2) px[1] + rad + 60 * density else px[1] - rad - 50 * density
            c.drawText(msg, cx, ty, text)
            c.drawText("Keep it still for a second · step ${g.stage + 1} of 2", cx, ty + 26 * density, small)
            c.drawText(String.format("field %.0f µT", r.strength), cx, height - 40 * density, small)
            if (field != null) {
                if (g.stage == 0) g.learnTop(field, spot, screen, ppcm) else g.learnFar(field, spot, screen, ppcm)
                stateStage = -1
            }
            postInvalidateOnAnimation()
        }
    }
}
