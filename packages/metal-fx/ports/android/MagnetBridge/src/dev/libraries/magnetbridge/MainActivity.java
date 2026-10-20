package dev.libraries.magnetbridge;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.Locale;

/** One screen: start or stop the bridge, see who is connected and what the
 *  sensor reads. */
public final class MainActivity extends Activity {
    private final Handler ui = new Handler(Looper.getMainLooper());
    private TextView status;
    private Button toggle;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        int pad = dp(20);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(pad, dp(48), pad, pad);
        col.setBackgroundColor(Color.rgb(18, 18, 18));

        TextView title = new TextView(this);
        title.setText("Magnet Bridge");
        title.setTextSize(26);
        title.setTextColor(Color.WHITE);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        col.addView(title);

        TextView sub = new TextView(this);
        sub.setText("Lets web pages you approve read this phone's magnetometer. Pages connect to ws://127.0.0.1:"
                + MagnetService.PORT + " while the bridge is on.");
        sub.setTextColor(Color.rgb(190, 190, 190));
        sub.setTextSize(15);
        sub.setPadding(0, dp(8), 0, dp(20));
        col.addView(sub);

        toggle = new Button(this);
        toggle.setAllCaps(false);
        toggle.setTextSize(17);
        toggle.setOnClickListener(v -> {
            if (MagnetService.running) stopService(new Intent(this, MagnetService.class));
            else startForegroundService(new Intent(this, MagnetService.class));
            ui.postDelayed(this::refresh, 300);
        });
        col.addView(toggle);

        Button learn = new Button(this);
        learn.setAllCaps(false);
        learn.setTextSize(17);
        learn.setText("Learn my magnet");
        learn.setOnClickListener(v -> startActivity(new Intent(this, GrabActivity.class)));
        col.addView(learn);

        Button zero = new Button(this);
        zero.setAllCaps(false);
        zero.setTextSize(15);
        zero.setText("Re-zero (keep magnets away)");
        zero.setOnClickListener(v -> ModelStream.INSTANCE.calibrate());
        col.addView(zero);

        SharedPreferences prefs = getSharedPreferences(MagnetService.PREFS, MODE_PRIVATE);
        CheckBox any = new CheckBox(this);
        any.setText("Allow any website (testing only)");
        any.setTextColor(Color.rgb(220, 220, 220));
        any.setChecked(prefs.getBoolean(MagnetService.KEY_ALLOW_ANY, false));
        any.setOnCheckedChangeListener((v, on) -> prefs.edit().putBoolean(MagnetService.KEY_ALLOW_ANY, on).apply());
        any.setPadding(0, dp(12), 0, dp(12));
        col.addView(any);

        status = new TextView(this);
        status.setTypeface(Typeface.MONOSPACE);
        status.setTextSize(13);
        status.setTextColor(Color.rgb(230, 230, 230));
        status.setBackgroundColor(Color.rgb(30, 30, 30));
        status.setPadding(dp(14), dp(14), dp(14), dp(14));
        col.addView(status);

        TextView help = new TextView(this);
        help.setText("Allowed sites: " + String.join(", ", MagnetService.ALLOWED)
                + ", *.libraries-home.pages.dev\n\nTest: open https://10.0.0.30:5191/__lab in Chrome and tap “Connect to bridge”.");
        help.setTextColor(Color.rgb(150, 150, 150));
        help.setTextSize(13);
        help.setPadding(0, dp(16), 0, 0);
        help.setGravity(Gravity.START);
        col.addView(help);

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.rgb(18, 18, 18));
        scroll.addView(col);
        setContentView(scroll);

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1);
        }
    }

    @Override protected void onResume() { super.onResume(); tick(); }
    @Override protected void onPause() { super.onPause(); ui.removeCallbacksAndMessages(null); }

    private void tick() { refresh(); ui.postDelayed(this::tick, 250); }

    private void refresh() {
        toggle.setText(MagnetService.running ? "Stop bridge" : "Start bridge");
        float[] u = MagnetService.lastUncal, c = MagnetService.lastCal;
        String model = "off";
        if (ModelStream.INSTANCE.getRunning()) {
            dev.libraries.magnetkit.MagnetReading r = ModelStream.INSTANCE.getLast();
            GrabSettings g = ModelStream.INSTANCE.getGrab();
            dev.libraries.magnetkit.Pt pos = r.getScreenPosition();
            model = String.format(Locale.ROOT, "%s, magnet %s\n          presence %.2f  field %.0f µT\n          at %s",
                    r.getCalibrating() ? "calibrating" : "on",
                    g.getStage() == 2 ? "learned" : "not learned (step " + (g.getStage() + 1) + " of 2)",
                    r.getPresence(), r.getStrength(),
                    pos == null ? "–" : String.format(Locale.ROOT, "%.0f, %.0f dp", pos.getX(), pos.getY()));
        }
        status.setText(String.format(Locale.ROOT,
                "Bridge:   %s\nModel:    %s\nPages:    %d %s\nRaw:      %6.1f %6.1f %6.1f µT  |B| %.1f\nBias:     %6.1f %6.1f %6.1f\nAndroid:  %6.1f %6.1f %6.1f µT\nRate:     %.1f Hz\nBlocked:  %s\n\n%s",
                MagnetService.running ? "on, port " + MagnetService.PORT : "off", model,
                MagnetService.clientCount, MagnetService.clientOrigins,
                u[0], u[1], u[2], Math.sqrt(u[0] * u[0] + u[1] * u[1] + u[2] * u[2]),
                u[3], u[4], u[5], c[0], c[1], c[2],
                MagnetService.rateHz,
                MagnetService.lastBlocked.isEmpty() ? "–" : MagnetService.lastBlocked,
                MagnetService.sensorInfo));
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
}
