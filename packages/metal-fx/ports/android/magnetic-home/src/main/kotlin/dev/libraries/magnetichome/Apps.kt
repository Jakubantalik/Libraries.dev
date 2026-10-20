package dev.libraries.magnetichome

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.LauncherApps
import android.os.Process
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.core.graphics.drawable.toBitmap

/** An app on the home screen or in the drawer. */
class AppEntry(val label: String, val packageName: String, val component: ComponentName, val icon: ImageBitmap)

object Apps {
    /** The home screen of the phone in the photo: four apps with labels, then the dock. */
    val homeRow = listOf("com.android.vending", "com.google.android.gm", "com.google.android.apps.photos", "com.google.android.youtube")
    val dockRow = listOf("com.google.android.dialer", "com.Slack", "com.android.chrome", "com.google.android.GoogleCamera")

    /** Every launchable app, by label. */
    fun all(context: Context): List<AppEntry> {
        val la = context.getSystemService(Context.LAUNCHER_APPS_SERVICE) as LauncherApps
        val px = (56 * context.resources.displayMetrics.density).toInt()
        return la.getActivityList(null, Process.myUserHandle())
            .filter { it.applicationInfo.packageName != context.packageName }
            .map { info ->
                val d = info.getIcon(context.resources.displayMetrics.densityDpi)
                AppEntry(info.label.toString(), info.applicationInfo.packageName, info.componentName, d.toBitmap(px, px).asImageBitmap())
            }
            .sortedBy { it.label.lowercase() }
    }

    /** The apps for a row, in order; missing ones are filled from the rest. */
    fun pick(all: List<AppEntry>, packages: List<String>, used: Set<String>): List<AppEntry> {
        val out = ArrayList<AppEntry>()
        for (p in packages) all.firstOrNull { it.packageName == p }?.let { out.add(it) }
        for (a in all) { if (out.size >= packages.size) break; if (a.packageName !in used && out.none { it.packageName == a.packageName } && a.packageName !in packages) out.add(a) }
        return out.take(packages.size)
    }

    fun launch(context: Context, app: AppEntry) {
        val la = context.getSystemService(Context.LAUNCHER_APPS_SERVICE) as LauncherApps
        runCatching { la.startMainActivity(app.component, Process.myUserHandle(), null, null) }
    }

    fun webSearch(context: Context) {
        val i = Intent(Intent.ACTION_WEB_SEARCH).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { context.startActivity(i) }
    }
}
