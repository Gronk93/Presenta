package com.presenta.remote;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothServerSocket;
import android.bluetooth.BluetoothSocket;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.UUID;

public final class PresentaBluetoothService extends Service {
    public interface Listener { void onStatus(String text, boolean connected); }

    public static final String EXTRA_PASSWORD = "password";
    private static final String CHANNEL_ID = "presenta_bluetooth";
    private static final int NOTIFICATION_ID = 1704;
    private static final UUID SERVICE_ID = UUID.fromString("A52F7B13-6C89-4E28-9D14-8BFD76C21940");
    private final LocalBinder binder = new LocalBinder();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private volatile boolean running;
    private volatile boolean connected;
    private volatile String statusText = "Bluetooth inactivo";
    private volatile String password = "";
    private volatile int generation;
    private Thread serverThread;
    private BluetoothServerSocket serverSocket;
    private BluetoothSocket clientSocket;
    private PrintWriter writer;
    private Listener listener;
    private PowerManager.WakeLock wakeLock;

    public final class LocalBinder extends Binder {
        public PresentaBluetoothService getService() { return PresentaBluetoothService.this; }
    }

    @Override public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        PowerManager manager = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Presenta:BluetoothConnection");
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.hasExtra(EXTRA_PASSWORD)) {
            String supplied = intent.getStringExtra(EXTRA_PASSWORD);
            password = supplied == null ? "" : supplied.trim().toUpperCase(Locale.US);
            getSharedPreferences("presenta", MODE_PRIVATE).edit().putString("bridgePassword", password).apply();
        } else if (password.isEmpty()) {
            password = getSharedPreferences("presenta", MODE_PRIVATE).getString("bridgePassword", "");
        }
        startAsForeground();
        startListening();
        return START_STICKY;
    }

    @Override public IBinder onBind(Intent intent) { return binder; }

    public void setListener(Listener value) {
        listener = value;
        notifyListener();
    }

    public String getStatusText() { return statusText; }
    public boolean isConnected() { return connected; }

    public synchronized boolean send(JSONObject command) {
        if (!connected || writer == null) {
            updateStatus("Esperando al Bridge de Windows…", false);
            return false;
        }
        writer.println(command.toString());
        if (writer.checkError()) {
            closeClient();
            updateStatus("Se perdió la señal; reconectando…", false);
            return false;
        }
        return true;
    }

    private synchronized void startListening() {
        generation++;
        closeClient();
        closeServer();
        if (!password.matches("[A-Z2-9]{8}")) {
            updateStatus("Escribe la contraseña de 8 caracteres", false);
            return;
        }
        if (Build.VERSION.SDK_INT >= 31 && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            updateStatus("Autoriza Dispositivos cercanos", false);
            return;
        }
        running = true;
        if (!wakeLock.isHeld()) wakeLock.acquire();
        final int activeGeneration = generation;
        serverThread = new Thread(() -> serverLoop(activeGeneration), "Presenta Bluetooth Server");
        serverThread.start();
    }

    @SuppressWarnings("MissingPermission")
    private void serverLoop(int activeGeneration) {
        while (running && generation == activeGeneration) {
            try {
                BluetoothManager manager = (BluetoothManager) getSystemService(BLUETOOTH_SERVICE);
                BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
                if (adapter == null || !adapter.isEnabled()) {
                    updateStatus("Activa Bluetooth en el celular", false);
                    sleepBeforeRetry();
                    continue;
                }
                updateStatus("Esperando al Bridge de Windows…", false);
                serverSocket = adapter.listenUsingRfcommWithServiceRecord("Presenta Android", SERVICE_ID);
                clientSocket = serverSocket.accept();
                closeServer();
                authenticateAndServe(clientSocket);
            } catch (SecurityException error) {
                updateStatus("Falta permiso para Bluetooth", false);
                running = false;
            } catch (IOException error) {
                if (running && generation == activeGeneration) updateStatus("Buscando nuevamente el Bridge…", false);
            } finally {
                closeClient();
            }
            if (running && generation == activeGeneration) sleepBeforeRetry();
        }
    }

    private void authenticateAndServe(BluetoothSocket socket) throws IOException {
        BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
        writer = new PrintWriter(new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8)), true);
        try {
            JSONObject auth = new JSONObject();
            auth.put("type", "auth");
            auth.put("password", password);
            auth.put("name", friendlyDeviceName());
            auth.put("platform", "Android " + Build.VERSION.RELEASE);
            writer.println(auth.toString());
            if (writer.checkError()) throw new IOException("No se pudo autenticar");
            String responseLine = reader.readLine();
            JSONObject response = responseLine == null ? null : new JSONObject(responseLine);
            if (response == null || !response.optBoolean("ok", false)) {
                updateStatus("Contraseña incorrecta; revisa el Bridge", false);
                return;
            }
            connected = true;
            updateStatus("Conectado a " + safeRemoteName(socket), true);
            mainHandler.post(heartbeat);
            while (running && reader.readLine() != null) { }
        } catch (org.json.JSONException error) {
            throw new IOException("Respuesta inválida del Bridge", error);
        } finally {
            connected = false;
            mainHandler.removeCallbacks(heartbeat);
        }
    }

    private final Runnable heartbeat = new Runnable() {
        @Override public void run() {
            if (!running || !connected) return;
            try {
                JSONObject ping = new JSONObject();
                ping.put("type", "ping");
                ping.put("sentAt", System.currentTimeMillis());
                send(ping);
            } catch (org.json.JSONException ignored) { }
            mainHandler.postDelayed(this, 4000);
        }
    };

    @SuppressWarnings("MissingPermission")
    private String safeRemoteName(BluetoothSocket socket) {
        try {
            String name = socket.getRemoteDevice().getName();
            return name == null ? "Windows" : name;
        } catch (Exception ignored) { return "Windows"; }
    }

    private static String friendlyDeviceName() {
        String maker = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.trim();
        String model = Build.MODEL == null ? "Android" : Build.MODEL.trim();
        if (model.toLowerCase(Locale.US).startsWith(maker.toLowerCase(Locale.US))) return model;
        return (maker + " " + model).trim();
    }

    private void updateStatus(String text, boolean isConnected) {
        statusText = text;
        connected = isConnected;
        notifyListener();
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(NOTIFICATION_ID, buildNotification());
    }

    private void notifyListener() {
        Listener current = listener;
        if (current != null) mainHandler.post(() -> current.onStatus(statusText, connected));
    }

    private void startAsForeground() {
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
        else startForeground(NOTIFICATION_ID, notification);
    }

    private Notification buildNotification() {
        Intent activityIntent = new Intent(this, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(this, 0, activityIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.presence_online)
            .setContentTitle("Presenta · Bluetooth")
            .setContentText(statusText)
            .setContentIntent(pending)
            .setOngoing(true)
            .build();
    }

    private void createNotificationChannel() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Conexión Bluetooth", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Mantiene conectado el control de Presenta cuando se bloquea el celular.");
        manager.createNotificationChannel(channel);
    }

    private void sleepBeforeRetry() {
        try { Thread.sleep(1600); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
    }

    private synchronized void closeClient() {
        writer = null;
        if (clientSocket != null) try { clientSocket.close(); } catch (IOException ignored) { }
        clientSocket = null;
        connected = false;
    }

    private synchronized void closeServer() {
        if (serverSocket != null) try { serverSocket.close(); } catch (IOException ignored) { }
        serverSocket = null;
    }

    @Override public void onDestroy() {
        running = false;
        generation++;
        mainHandler.removeCallbacks(heartbeat);
        closeClient();
        closeServer();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }
}
