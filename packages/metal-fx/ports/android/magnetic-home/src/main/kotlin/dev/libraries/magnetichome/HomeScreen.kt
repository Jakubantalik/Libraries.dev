package dev.libraries.magnetichome

import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.RoundedCorner
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Text
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import dev.libraries.magnetkit.MagnetGesture
import dev.libraries.magnetkit.MagnetReading
import dev.libraries.magnetkit.MagnetSource
import dev.libraries.magnetkit.Pt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.PI

private val labelStyle = TextStyle(
    color = Color.White, fontSize = 12.sp, textAlign = TextAlign.Center,
    shadow = Shadow(Color(0x66000000), Offset(0f, 1f), 4f),
)

@Composable
fun HomeScreen(drawerOpen: MutableState<Boolean>, settingsOpen: MutableState<Boolean>) {
    val ctx = LocalContext.current
    val view = LocalView.current
    val density = LocalDensity.current.density
    val source = remember { MagnetSource.get(ctx) }
    val grab = remember { GrabSettings(ctx) }
    val field = remember { MagneticField() }
    var all by remember { mutableStateOf<List<AppEntry>>(emptyList()) }
    var screen by remember { mutableStateOf(Pt(0.0, 0.0)) }
    var now by remember { mutableDoubleStateOf(0.0) }
    var reading by remember { mutableStateOf(MagnetReading()) }
    var stage by remember { mutableIntStateOf(grab.stage) }
    var grabState by remember { mutableStateOf(grab.grabState()) }
    var tapMark by remember { mutableStateOf<Pair<Pt, Double>?>(null) }
    var lastTick by remember { mutableDoubleStateOf(0.0) }
    // dp per centimetre on this screen (its real density, not the dp bucket).
    val ppcm = remember { ctx.resources.displayMetrics.xdpi / 2.54 / ctx.resources.displayMetrics.density }

    LaunchedEffect(Unit) { all = withContext(Dispatchers.Default) { Apps.all(ctx) } }
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 31) {
            view.rootWindowInsets?.getRoundedCorner(RoundedCorner.POSITION_TOP_LEFT)?.let { field.screenCorner = it.radius / density.toDouble() }
        }
    }

    // The magnet runs while the home screen is visible.
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val obs = LifecycleEventObserver { _, e ->
            if (e == Lifecycle.Event.ON_START) source.attach()
            if (e == Lifecycle.Event.ON_STOP) source.detach()
        }
        lifecycle.addObserver(obs)
        onDispose { lifecycle.removeObserver(obs); source.detach() }
    }

    // Air taps open the app under them.
    DisposableEffect(Unit) {
        val id = source.addGestureListener { g ->
            if (g !is MagnetGesture.Tap || !grab.ready || drawerOpen.value || settingsOpen.value) return@addGestureListener
            val p = g.at ?: return@addGestureListener
            val hit = field.ids.filter { it.startsWith("app:") }
                .mapNotNull { id -> field.frame(id)?.let { id to it.distanceTo(p) } }
                .filter { it.second <= 90 }.minByOrNull { it.second }
            tapMark = Pair(p, now)
            view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
            val pkg = hit?.first?.removePrefix("app:")
            all.firstOrNull { it.packageName == pkg }?.let { Apps.launch(ctx, it) }
        }
        onDispose { source.removeGestureListener(id) }
    }

    // Every frame: the magnet, then the grab or the physics.
    LaunchedEffect(Unit) {
        while (true) {
            withFrameNanos { t ->
                val s = t / 1e9
                if (screen.x > 0) grab.apply(source.config, screen)
                val r = source.reading(s)
                reading = r
                if (!grab.ready) {
                    field.relax(s)
                    val g = grabState.tick(r, s)
                    if (g != null && screen.x > 0) {
                        if (grab.stage == 0) {
                            if (grab.learnTop(g, grab.grabSpot(screen, ppcm), screen, ppcm)) view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
                        } else grab.learnFar(g, grab.farGrabSpot(screen), screen, ppcm)
                        stage = grab.stage
                        grabState = grab.grabState()
                    }
                } else if (screen.x > 0) {
                    field.step(r, s, Box(0.0, 0.0, screen.x, screen.y), grab.face ?: 1)
                    if (field.hit > 400 && s - lastTick > 0.07) { view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK); lastTick = s }
                    field.hit = 0.0
                }
                now = s
            }
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .onGloballyPositioned { c -> screen = Pt(c.size.width / density.toDouble(), c.size.height / density.toDouble()) }
            .pointerInput(Unit) {
                detectVerticalDragGestures { _, dy -> if (dy < -24 && grab.ready) drawerOpen.value = true }
            }
            .pointerInput(Unit) { detectTapGestures(onLongPress = { settingsOpen.value = true }) },
    ) {
        // A magnetic element: tied to its place, drawn where its string lets it be.
        fun Modifier.particle(id: String, corner: Double): Modifier = this
            .onGloballyPositioned { c ->
                val b = c.boundsInRoot()
                field.setHome(id, Box(b.left / density.toDouble(), b.top / density.toDouble(), b.right / density.toDouble(), b.bottom / density.toDouble()), corner)
            }
            .graphicsLayer {
                if (now < 0) return@graphicsLayer   // reads the frame time: redraw every frame
                val p = field.particle(id)
                translationX = ((p?.ox ?: 0.0) * density).toFloat()
                translationY = ((p?.oy ?: 0.0) * density).toFloat()
                rotationZ = ((p?.angle ?: 0.0) * 180 / PI).toFloat()
            }

        // Date, top left.
        Column(Modifier.statusBarsPadding().padding(start = 28.dp, top = 36.dp)) {
            Text(
                SimpleDateFormat("EEE, MMM d", Locale.getDefault()).format(Date()),
                style = TextStyle(color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Normal, shadow = labelStyle.shadow),
                modifier = Modifier.particle("date", 6.0),
            )
        }

        // Apps, dock and search, bottom.
        val home = Apps.pick(all, Apps.homeRow, emptySet())
        val dock = Apps.pick(all, Apps.dockRow, home.map { it.packageName }.toSet())
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().navigationBarsPadding().padding(horizontal = 20.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                home.forEach { app ->
                    Column(
                        Modifier.width(80.dp).particle("app:${app.packageName}", 20.0)
                            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { Apps.launch(ctx, app) },
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Image(app.icon, app.label, Modifier.size(56.dp))
                        Text(app.label, style = labelStyle, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
                    }
                }
            }
            Spacer(Modifier.height(22.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                dock.forEach { app ->
                    Box(
                        Modifier.width(80.dp).particle("app:${app.packageName}", 28.0)
                            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { Apps.launch(ctx, app) },
                        contentAlignment = Alignment.Center,
                    ) { Image(app.icon, app.label, Modifier.size(56.dp)) }
                }
            }
            Spacer(Modifier.height(22.dp))
            SearchBar(Modifier.particle("search", 28.0).clickable { Apps.webSearch(ctx) })
        }

        // Where an air tap landed (drawn per frame, no recomposition).
        Canvas(Modifier.fillMaxSize()) {
            val (p, t0) = tapMark ?: return@Canvas
            val age = now - t0
            if (age < 0 || age > 0.6) return@Canvas
            val a = (1 - age / 0.6).toFloat()
            drawCircle(Color.White.copy(alpha = 0.8f * a), radius = (28 + 40 * age).toFloat() * density,
                center = Offset((p.x * density).toFloat(), (p.y * density).toFloat()), style = Stroke(2f * density))
        }

        StatusHint({ reading }, Modifier.align(Alignment.Center))

        if (stage < 2 && screen.x > 0) GrabOverlay(grab, grabState, stage, screen, ppcm, { now }) { grab.skipFar(); stage = grab.stage; grabState = grab.grabState() }

        AnimatedVisibility(drawerOpen.value, enter = slideInVertically { it / 3 } + fadeIn(), exit = slideOutVertically { it / 3 } + fadeOut()) {
            AppDrawer(all) { app -> drawerOpen.value = false; Apps.launch(ctx, app) }
        }
        if (settingsOpen.value) Settings(
            onCalibrate = { source.calibrate(); settingsOpen.value = false },
            onGrab = { grab.release(); stage = grab.stage; grabState = grab.grabState(); settingsOpen.value = false },
            onClose = { settingsOpen.value = false },
        )
    }
}

/** Calibrating, too close: recomposes only itself as the reading changes. */
@Composable
private fun StatusHint(reading: () -> MagnetReading, modifier: Modifier) {
    val r = reading()
    val hint = when {
        r.calibrating -> "Calibrating — keep the magnet away"
        r.tooClose -> "Too close — hold the magnet a little farther from the top"
        else -> null
    } ?: return
    Text(hint, style = TextStyle(color = Color.White, fontSize = 13.sp),
        modifier = modifier.clip(RoundedCornerShape(20.dp)).background(Color(0x99000000)).padding(horizontal = 14.dp, vertical = 9.dp))
}

/** The Google search bar, as on the Pixel home screen. */
@Composable
private fun SearchBar(modifier: Modifier) {
    Row(
        modifier.fillMaxWidth().height(56.dp).clip(RoundedCornerShape(28.dp)).background(Color(0xF2F3F3F3)).padding(horizontal = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("G", style = TextStyle(color = Color(0xFF4285F4), fontSize = 22.sp, fontWeight = FontWeight.Bold))
        Spacer(Modifier.weight(1f))
        // A microphone and a lens, drawn.
        Canvas(Modifier.size(22.dp)) {
            val w = size.width
            drawRoundRect(Color(0xFF4A4A4A), topLeft = Offset(w * 0.34f, w * 0.08f), size = Size(w * 0.32f, w * 0.52f), cornerRadius = androidx.compose.ui.geometry.CornerRadius(w * 0.16f))
            drawArc(Color(0xFF4A4A4A), 0f, 180f, false, topLeft = Offset(w * 0.2f, w * 0.3f), size = Size(w * 0.6f, w * 0.45f), style = Stroke(w * 0.08f))
            drawLine(Color(0xFF4A4A4A), Offset(w * 0.5f, w * 0.75f), Offset(w * 0.5f, w * 0.92f), strokeWidth = w * 0.08f)
        }
        Spacer(Modifier.width(18.dp))
        Canvas(Modifier.size(22.dp)) {
            val w = size.width
            drawRoundRect(Color(0xFF4A4A4A), topLeft = Offset(w * 0.1f, w * 0.1f), size = Size(w * 0.8f, w * 0.8f), cornerRadius = androidx.compose.ui.geometry.CornerRadius(w * 0.2f), style = Stroke(w * 0.08f))
            drawCircle(Color(0xFF4A4A4A), radius = w * 0.16f, center = Offset(w * 0.5f, w * 0.5f))
        }
    }
}

/** Hold the magnet over the ring for a second: top, then bottom. */
@Composable
private fun GrabOverlay(grab: GrabSettings, state: GrabState, stage: Int, screen: Pt, ppcm: Double, now: () -> Double, onSkip: () -> Unit) {
    val density = LocalDensity.current.density
    val spot = if (stage == 0) grab.grabSpot(screen, ppcm) else grab.farGrabSpot(screen)
    Box(Modifier.fillMaxSize().background(Color(0x99000000))) {
        Canvas(Modifier.fillMaxSize()) {
            now()   // redraw every frame for the progress arc
            val c = Offset((spot.x * density).toFloat(), (spot.y * density).toFloat())
            val r = 34 * density
            drawCircle(Color.White.copy(alpha = 0.35f), r, c, style = Stroke(6 * density))
            drawArc(Color.White, -90f, (360 * state.progress).toFloat(), false, topLeft = Offset(c.x - r, c.y - r), size = Size(2 * r, 2 * r), style = Stroke(6 * density))
        }
        Column(
            Modifier.align(Alignment.TopCenter).offset(y = (if (stage == 0) spot.y + 60 else spot.y - 210).dp).padding(horizontal = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(if (stage == 0) "Hold the magnet over the ring" else "Now over the ring at the bottom",
                style = TextStyle(color = Color.White, fontSize = 19.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center))
            Text("A second each: it learns your magnet so the apps can feel it around the phone.",
                style = TextStyle(color = Color(0xCCFFFFFF), fontSize = 14.sp, textAlign = TextAlign.Center), modifier = Modifier.padding(top = 8.dp))
            if (stage == 1) Text("Skip — too weak down here", style = TextStyle(color = Color.White, fontSize = 14.sp),
                modifier = Modifier.padding(top = 14.dp).clip(CircleShape).background(Color(0x33FFFFFF)).clickable(onClick = onSkip).padding(horizontal = 16.dp, vertical = 9.dp))
        }
    }
}

/** Every app, from a swipe up. */
@Composable
private fun AppDrawer(all: List<AppEntry>, onOpen: (AppEntry) -> Unit) {
    Box(Modifier.fillMaxSize().background(Color(0xE6101010)).statusBarsPadding().navigationBarsPadding()) {
        LazyVerticalGrid(GridCells.Fixed(4), Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 24.dp)) {
            items(all, key = { it.component.flattenToString() }) { app ->
                Column(Modifier.padding(vertical = 12.dp).clickable { onOpen(app) }, horizontalAlignment = Alignment.CenterHorizontally) {
                    Image(app.icon, app.label, Modifier.size(52.dp))
                    Text(app.label, style = labelStyle, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
                }
            }
        }
    }
}

/** Long press on the home screen. */
@Composable
private fun Settings(onCalibrate: () -> Unit, onGrab: () -> Unit, onClose: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color(0x99000000)).clickable(onClick = onClose), contentAlignment = Alignment.BottomCenter) {
        Column(
            Modifier.fillMaxWidth().navigationBarsPadding().padding(12.dp).clip(RoundedCornerShape(28.dp)).background(Color(0xFF202124)).padding(8.dp),
        ) {
            Text("Magnetic Home", style = TextStyle(color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.SemiBold), modifier = Modifier.padding(16.dp))
            @Composable fun item(title: String, sub: String, action: () -> Unit) = Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).clickable(onClick = action).padding(16.dp)) {
                Text(title, style = TextStyle(color = Color.White, fontSize = 16.sp))
                Text(sub, style = TextStyle(color = Color(0x99FFFFFF), fontSize = 13.sp), modifier = Modifier.padding(top = 2.dp))
            }
            item("Calibrate", "Take the magnet away first", onCalibrate)
            item("Grab the magnet again", "Learn its face and strength, and where the sensor is", onGrab)
            item("Back to Pixel Launcher", "Settings › Apps › Default apps › Home app", onClose)
        }
    }
}
