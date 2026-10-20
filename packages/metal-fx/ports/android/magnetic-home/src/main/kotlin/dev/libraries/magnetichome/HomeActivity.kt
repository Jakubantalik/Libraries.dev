package dev.libraries.magnetichome

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.mutableStateOf

/**
 * Magnetic Home: an Android home screen whose apps feel a magnet beside the
 * phone — pulled toward it, resting against the screen's edge, springing back
 * when it leaves — with air taps to open them. Set it as the home app in
 * Settings › Apps › Default apps › Home app (and back to Pixel Launcher there).
 */
class HomeActivity : ComponentActivity() {
    private val drawerOpen = mutableStateOf(false)
    private val settingsOpen = mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        // A home screen has nowhere to go back to: back only closes what is open.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { drawerOpen.value = false; settingsOpen.value = false }
        })
        setContent { HomeScreen(drawerOpen, settingsOpen) }
    }

    /** Home pressed while already home: close the drawer. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        drawerOpen.value = false
        settingsOpen.value = false
    }
}
