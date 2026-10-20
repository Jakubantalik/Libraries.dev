package dev.libraries.magnetbridge;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.DisplayMetrics;

import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Foreground service: reads the magnetometer at ~50 Hz and streams every
 *  reading to the connected pages. The uncalibrated sensor is the one to use:
 *  Android's calibrated field slowly absorbs a magnet held near the phone. */
public final class MagnetService extends Service implements SensorEventListener {
    static final int PORT = 47613;
    static final String PREFS = "bridge";
    static final String KEY_ALLOW_ANY = "allowAny";

    /** Sites that may connect without the "allow any" switch. */
    static final List<String> ALLOWED = Arrays.asList(
            "https://libraries.dev",
            "https://www.libraries.dev",
            "http://localhost:5190",
            "http://127.0.0.1:5190",
            "https://localhost:5191",
            "https://10.0.0.30:5191");

    // State the activity shows.
    static volatile boolean running;
    static volatile int clientCount;
    static volatile String clientOrigins = "";
    static volatile String lastBlocked = "";
    static volatile float[] lastUncal = new float[6];
    static volatile float[] lastCal = new float[3];
    static volatile double rateHz;
    static volatile String sensorInfo = "";

    private WsServer server;
    /** Socket writes off the main thread (the model runs there). */
    private final ExecutorService out = Executors.newSingleThreadExecutor();
    private SensorManager sensors;
    private HandlerThread sensorThread;
    private int count;
    private long rateStart;

    static boolean allowed(Context ctx, String origin) {
        if (ctx.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(KEY_ALLOW_ANY, false)) return true;
        if (origin == null) return false;
        return ALLOWED.contains(origin) || origin.endsWith(".libraries-home.pages.dev");
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (running) return START_STICKY;
        startInForeground();
        startSensors();
        server = new WsServer(PORT, origin -> allowed(this, origin), new WsServer.Listener() {
            @Override public void onOpen(WsServer.Client c) {
                updateClients();
                c.send(hello());
                if (ModelStream.INSTANCE.getRunning()) c.send(ModelStream.INSTANCE.helloJson(MagnetService.this));
            }
            @Override public void onClose(WsServer.Client c) { updateClients(); }
            @Override public void onBlocked(String origin) { lastBlocked = origin.isEmpty() ? "(no origin)" : origin; }
            @Override public void onText(WsServer.Client c, String text) {
                ModelStream.INSTANCE.onMessage(text, reply -> {
                    out.execute(() -> c.send(reply));
                    return kotlin.Unit.INSTANCE;
                });
            }
        });
        try {
            server.start();
            running = true;
            ModelStream.INSTANCE.start(this, msg -> {
                if (server != null && !server.clients.isEmpty()) out.execute(() -> server.broadcast(msg));
                return kotlin.Unit.INSTANCE;
            });
        } catch (Exception e) {
            lastBlocked = "server failed: " + e.getMessage();
            stopSelf();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        ModelStream.INSTANCE.stop();
        out.shutdown();
        if (server != null) server.stop();
        if (sensors != null) sensors.unregisterListener(this);
        if (sensorThread != null) sensorThread.quitSafely();
        clientCount = 0;
        clientOrigins = "";
        super.onDestroy();
    }

    private void updateClients() {
        StringBuilder o = new StringBuilder();
        for (WsServer.Client c : server.clients) o.append(o.length() > 0 ? ", " : "").append(c.origin);
        clientCount = server.clients.size();
        clientOrigins = o.toString();
    }

    private void startInForeground() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("bridge", "Magnet Bridge", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, "bridge")
                .setSmallIcon(android.R.drawable.ic_menu_compass)
                .setContentTitle("Magnet Bridge is on")
                .setContentText("Approved web pages can read the magnet")
                .setContentIntent(open)
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(1, n);
    }

    private void startSensors() {
        sensors = getSystemService(SensorManager.class);
        sensorThread = new HandlerThread("magnet");
        sensorThread.start();
        Handler h = new Handler(sensorThread.getLooper());
        Sensor u = sensors.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD_UNCALIBRATED);
        Sensor c = sensors.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD);
        StringBuilder info = new StringBuilder();
        if (u != null) { sensors.registerListener(this, u, 20000, h); info.append(describe("uncal", u)); }
        if (c != null) { sensors.registerListener(this, c, 20000, h); info.append(describe("cal", c)); }
        sensorInfo = info.length() > 0 ? info.toString() : "no magnetometer";
        rateStart = System.nanoTime();
    }

    private static String describe(String k, Sensor s) {
        return String.format(Locale.ROOT, "%s: %s (%s) range %.0f µT, res %.3f, min delay %d µs\n",
                k, s.getName(), s.getVendor(), s.getMaximumRange(), s.getResolution(), s.getMinDelay());
    }

    private String hello() {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        return String.format(Locale.ROOT,
                "{\"type\":\"hello\",\"app\":\"MagnetBridge\",\"version\":5,\"model\":\"%s\",\"manufacturer\":\"%s\",\"sdk\":%d,"
                        + "\"screenPx\":[%d,%d],\"density\":%.3f,\"sensors\":\"%s\"}",
                esc(Build.MODEL), esc(Build.MANUFACTURER), Build.VERSION.SDK_INT,
                dm.widthPixels, dm.heightPixels, dm.density, esc(sensorInfo.trim()));
    }

    private static String esc(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n");
    }

    @Override
    public void onSensorChanged(SensorEvent e) {
        double t = e.timestamp / 1e6;
        String msg;
        if (e.sensor.getType() == Sensor.TYPE_MAGNETIC_FIELD_UNCALIBRATED) {
            float[] v = e.values;
            lastUncal = new float[] { v[0], v[1], v[2], v[3], v[4], v[5] };
            msg = String.format(Locale.ROOT, "{\"t\":%.1f,\"u\":[%.2f,%.2f,%.2f],\"b\":[%.2f,%.2f,%.2f]}",
                    t, v[0], v[1], v[2], v[3], v[4], v[5]);
            count++;
            long now = System.nanoTime();
            if (now - rateStart > 1_000_000_000L) {
                rateHz = count / ((now - rateStart) / 1e9);
                count = 0;
                rateStart = now;
            }
        } else {
            lastCal = new float[] { e.values[0], e.values[1], e.values[2] };
            msg = String.format(Locale.ROOT, "{\"t\":%.1f,\"c\":[%.2f,%.2f,%.2f]}", t, e.values[0], e.values[1], e.values[2]);
        }
    }

    @Override public void onAccuracyChanged(Sensor sensor, int accuracy) { }
}
