package com.presenta.remote;

import android.Manifest;
import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.provider.Settings;
import android.text.InputFilter;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Locale;

public final class MainActivity extends Activity implements PresentaBluetoothService.Listener {
    private static final int PERMISSION_REQUEST = 1704;
    private static final int PURPLE = Color.rgb(87, 72, 210);
    private static final int PINK = Color.rgb(255, 45, 120);
    private static final int INK = Color.rgb(23, 28, 37);
    private static final int MUTED = Color.rgb(104, 105, 111);
    private PresentaBluetoothService service;
    private boolean bound;
    private TextView statusView;
    private TextView statusDot;
    private EditText passwordInput;
    private Button connectButton;
    private TouchPadView touchPad;
    private boolean laser;
    private boolean penMode;
    private boolean blackout;
    private String penColor = "#ef3340";
    private int penWidth = 7;
    private String penTool = "pen";
    private Button laserButton;
    private Button penButton;
    private Button blackoutButton;
    private Button redButton;
    private Button blueButton;
    private Button blackButton;
    private Button eraserButton;

    private final ServiceConnection connection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) {
            service = ((PresentaBluetoothService.LocalBinder) binder).getService();
            service.setListener(MainActivity.this);
            bound = true;
        }
        @Override public void onServiceDisconnected(ComponentName name) {
            bound = false;
            service = null;
            onStatus("Servicio Bluetooth detenido", false);
        }
    };

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        Window window = getWindow();
        window.setStatusBarColor(Color.rgb(243, 240, 232));
        window.setNavigationBarColor(Color.rgb(243, 240, 232));
        if (Build.VERSION.SDK_INT >= 23) window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        buildUi();
        bindService(new Intent(this, PresentaBluetoothService.class), connection, Context.BIND_AUTO_CREATE);
        requestBluetoothPermissionIfNeeded();
    }

    private void buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(243, 240, 232));
        LinearLayout root = vertical(20);
        root.setPadding(dp(20), dp(22), dp(20), dp(28));
        scroll.addView(root, matchWrap());

        LinearLayout brand = horizontal(10);
        TextView mark = text("P", 18, Color.WHITE, Typeface.BOLD);
        mark.setGravity(Gravity.CENTER);
        mark.setBackground(round(PURPLE, 14, PURPLE, 0));
        brand.addView(mark, new LinearLayout.LayoutParams(dp(42), dp(42)));
        LinearLayout brandCopy = vertical(0);
        brandCopy.addView(text("Presenta", 22, INK, Typeface.BOLD));
        brandCopy.addView(text("CONTROL ANDROID · BLUETOOTH", 10, PURPLE, Typeface.BOLD));
        brand.addView(brandCopy, wrapWrap());
        root.addView(brand);

        LinearLayout statusCard = horizontal(12);
        statusCard.setPadding(dp(16), dp(14), dp(16), dp(14));
        statusCard.setBackground(round(Color.rgb(255, 254, 250), 18, Color.rgb(225, 221, 211), 1));
        statusDot = text("●", 17, Color.rgb(185, 68, 80), Typeface.NORMAL);
        statusCard.addView(statusDot, wrapWrap());
        LinearLayout statusCopy = vertical(2);
        statusCopy.addView(text("ESTADO DE CONEXIÓN", 10, MUTED, Typeface.BOLD));
        statusView = text("Bluetooth inactivo", 15, INK, Typeface.BOLD);
        statusCopy.addView(statusView);
        statusCard.addView(statusCopy, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        LinearLayout.LayoutParams statusParams = matchWrap(); statusParams.topMargin = dp(22);
        root.addView(statusCard, statusParams);

        TextView keyLabel = text("CONTRASEÑA DEL BRIDGE", 10, MUTED, Typeface.BOLD);
        LinearLayout.LayoutParams labelParams = wrapWrap(); labelParams.topMargin = dp(20);
        root.addView(keyLabel, labelParams);
        LinearLayout keyRow = horizontal(10);
        passwordInput = new EditText(this);
        passwordInput.setSingleLine(true);
        passwordInput.setTextSize(19);
        passwordInput.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        passwordInput.setTextColor(INK);
        passwordInput.setHint("ABCD EFGH");
        passwordInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        passwordInput.setFilters(new InputFilter[] { new InputFilter.AllCaps(), new InputFilter.LengthFilter(9) });
        passwordInput.setPadding(dp(15), 0, dp(15), 0);
        passwordInput.setBackground(round(Color.WHITE, 13, Color.rgb(205, 201, 193), 1));
        String savedPassword = getPreferences(MODE_PRIVATE).getString("bridgePassword", "");
        passwordInput.setText(formatPassword(savedPassword));
        keyRow.addView(passwordInput, new LinearLayout.LayoutParams(0, dp(54), 1));
        connectButton = button("Conectar", PURPLE, Color.WHITE);
        connectButton.setOnClickListener(view -> activateBluetooth());
        keyRow.addView(connectButton, new LinearLayout.LayoutParams(dp(112), dp(54)));
        root.addView(keyRow);

        Button settingsButton = button("Emparejar celular con Windows", Color.TRANSPARENT, PURPLE);
        settingsButton.setOnClickListener(view -> startActivity(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS)));
        LinearLayout.LayoutParams settingsParams = matchWrap(); settingsParams.topMargin = dp(6);
        root.addView(settingsButton, settingsParams);

        touchPad = new TouchPadView(this);
        touchPad.setListener(new TouchPadView.Listener() {
            @Override public void onPointer(double dx, double dy) {
                send(json("pointer").putSafe("relative", true).putSafe("dx", dx).putSafe("dy", dy).value);
            }
            @Override public void onPen(String phase, String id, double x, double y) {
                JsonBuilder command = json("pen").putSafe("phase", phase).putSafe("id", id).putSafe("x", x).putSafe("y", y)
                    .putSafe("color", penColor).putSafe("width", penWidth).putSafe("tool", penTool);
                send(command.value);
            }
        });
        LinearLayout.LayoutParams padParams = matchWrap(); padParams.height = dp(335); padParams.topMargin = dp(18);
        root.addView(touchPad, padParams);

        LinearLayout tools = horizontal(8);
        laserButton = toolButton("Láser"); laserButton.setOnClickListener(view -> toggleLaser());
        penButton = toolButton("Lápiz"); penButton.setOnClickListener(view -> togglePen());
        blackoutButton = toolButton("Pantalla negra"); blackoutButton.setOnClickListener(view -> toggleBlackout());
        tools.addView(laserButton, weightWrap());
        tools.addView(penButton, weightWrap());
        tools.addView(blackoutButton, weightWrap());
        root.addView(tools);

        LinearLayout penOptions = horizontal(7);
        redButton = colorButton("Rojo", "#ef3340");
        blueButton = colorButton("Azul", "#2563eb");
        blackButton = colorButton("Negro", "#111827");
        eraserButton = toolButton("Borrador"); eraserButton.setOnClickListener(view -> { penTool = "eraser"; penMode = true; updateTools(); });
        penOptions.addView(redButton, weightWrap()); penOptions.addView(blueButton, weightWrap()); penOptions.addView(blackButton, weightWrap()); penOptions.addView(eraserButton, weightWrap());
        LinearLayout.LayoutParams penParams = matchWrap(); penParams.topMargin = dp(8);
        root.addView(penOptions, penParams);

        LinearLayout boardRow = horizontal(7);
        boardRow.addView(commandButton("Pantalla", json("board").putSafe("mode", "transparent").value), weightWrap());
        boardRow.addView(commandButton("Pizarra blanca", json("board").putSafe("mode", "white").value), weightWrap());
        boardRow.addView(commandButton("Pizarra negra", json("board").putSafe("mode", "black").value), weightWrap());
        LinearLayout.LayoutParams boardParams = matchWrap(); boardParams.topMargin = dp(8);
        root.addView(boardRow, boardParams);

        LinearLayout widthRow = horizontal(7);
        widthRow.addView(widthButton("Fino", 3), weightWrap()); widthRow.addView(widthButton("Medio", 7), weightWrap()); widthRow.addView(widthButton("Grueso", 12), weightWrap());
        Button clearButton = toolButton("Limpiar"); clearButton.setOnClickListener(view -> send(json("clear-drawing").value));
        widthRow.addView(clearButton, weightWrap());
        LinearLayout.LayoutParams widthParams = matchWrap(); widthParams.topMargin = dp(8);
        root.addView(widthRow, widthParams);

        LinearLayout slides = horizontal(12);
        Button previous = button("←  Anterior", Color.WHITE, INK); previous.setTextSize(16); previous.setOnClickListener(view -> slide(-1));
        Button next = button("Siguiente  →", PURPLE, Color.WHITE); next.setTextSize(16); next.setOnClickListener(view -> slide(1));
        slides.addView(previous, weightHeight(62)); slides.addView(next, weightHeight(62));
        LinearLayout.LayoutParams slideParams = matchWrap(); slideParams.topMargin = dp(16);
        root.addView(slides, slideParams);

        LinearLayout presentation = horizontal(8);
        presentation.addView(commandButton("Iniciar PowerPoint", json("presentation").putSafe("action", "start").value), weightWrap());
        presentation.addView(commandButton("Finalizar", json("presentation").putSafe("action", "stop").value), weightWrap());
        LinearLayout.LayoutParams presentationParams = matchWrap(); presentationParams.topMargin = dp(8);
        root.addView(presentation, presentationParams);

        TextView note = text("La conexión es Bluetooth directa. No necesita Internet, Wi‑Fi ni tener abierta la página. El servicio permanece activo al bloquear el celular.", 12, MUTED, Typeface.NORMAL);
        note.setLineSpacing(0, 1.18f);
        LinearLayout.LayoutParams noteParams = matchWrap(); noteParams.topMargin = dp(18);
        root.addView(note, noteParams);
        setContentView(scroll);
        updateTools();
    }

    private void activateBluetooth() {
        if (!hasBluetoothPermission()) { requestBluetoothPermissionIfNeeded(); return; }
        String password = normalizePassword(passwordInput.getText().toString());
        if (!password.matches("[A-Z2-9]{8}")) { toast("Escribe los 8 caracteres que muestra el Bridge"); return; }
        passwordInput.setText(formatPassword(password));
        getPreferences(MODE_PRIVATE).edit().putString("bridgePassword", password).apply();
        Intent intent = new Intent(this, PresentaBluetoothService.class).putExtra(PresentaBluetoothService.EXTRA_PASSWORD, password);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent); else startService(intent);
        onStatus("Buscando el Bridge de Windows…", false);
    }

    private void toggleLaser() {
        laser = !laser;
        if (laser) penMode = false;
        send(json("laser").putSafe("active", laser).value);
        updateTools();
    }

    private void togglePen() {
        penMode = !penMode;
        if (penMode && laser) { laser = false; send(json("laser").putSafe("active", false).value); }
        penTool = "pen";
        updateTools();
    }

    private void toggleBlackout() {
        blackout = !blackout;
        send(json("blackout").putSafe("active", blackout).value);
        updateTools();
    }

    private Button colorButton(String text, String color) {
        Button button = toolButton(text);
        button.setOnClickListener(view -> { penColor = color; penTool = "pen"; penMode = true; updateTools(); });
        return button;
    }

    private Button widthButton(String text, int width) {
        Button button = toolButton(text);
        button.setOnClickListener(view -> { penWidth = width; penMode = true; updateTools(); });
        return button;
    }

    private Button commandButton(String text, JSONObject command) {
        Button button = toolButton(text);
        button.setOnClickListener(view -> { penMode = command.optString("type").equals("board") || penMode; touchPad.setPenMode(penMode); send(command); });
        return button;
    }

    private void updateTools() {
        touchPad.setPenMode(penMode);
        setSelected(laserButton, laser, PINK);
        setSelected(penButton, penMode, PURPLE);
        setSelected(blackoutButton, blackout, INK);
        setSelected(redButton, penTool.equals("pen") && penColor.equals("#ef3340"), Color.rgb(239, 51, 64));
        setSelected(blueButton, penTool.equals("pen") && penColor.equals("#2563eb"), Color.rgb(37, 99, 235));
        setSelected(blackButton, penTool.equals("pen") && penColor.equals("#111827"), INK);
        setSelected(eraserButton, penTool.equals("eraser"), PURPLE);
    }

    private void setSelected(Button button, boolean selected, int color) {
        button.setTextColor(selected ? Color.WHITE : INK);
        button.setBackground(round(selected ? color : Color.WHITE, 12, selected ? color : Color.rgb(216, 212, 204), 1));
    }

    private void slide(int direction) {
        send(json("slide").putSafe("direction", direction).value);
        if (Build.VERSION.SDK_INT >= 26) {
            android.os.Vibrator vibrator = getSystemService(android.os.Vibrator.class);
            if (vibrator != null) vibrator.vibrate(android.os.VibrationEffect.createOneShot(35, 90));
        }
    }

    private void send(JSONObject value) {
        if (service == null || !service.send(value)) toast("Aún no está conectado al Bridge");
    }

    @Override public void onStatus(String text, boolean connected) {
        runOnUiThread(() -> {
            statusView.setText(text);
            statusDot.setTextColor(connected ? Color.rgb(22, 122, 89) : Color.rgb(185, 68, 80));
            connectButton.setText(connected ? "Conectado" : "Conectar");
        });
    }

    private boolean hasBluetoothPermission() {
        return Build.VERSION.SDK_INT < 31 || checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestBluetoothPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 && (!hasBluetoothPermission() || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED))
            requestPermissions(new String[] { Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.POST_NOTIFICATIONS }, PERMISSION_REQUEST);
        else if (Build.VERSION.SDK_INT >= 31 && !hasBluetoothPermission())
            requestPermissions(new String[] { Manifest.permission.BLUETOOTH_CONNECT }, PERMISSION_REQUEST);
    }

    @Override protected void onDestroy() {
        if (bound) { service.setListener(null); unbindService(connection); }
        super.onDestroy();
    }

    private Button toolButton(String label) { return button(label, Color.WHITE, INK); }
    private Button button(String label, int background, int foreground) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(foreground);
        button.setTextSize(12);
        button.setAllCaps(false);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setGravity(Gravity.CENTER);
        button.setPadding(dp(8), 0, dp(8), 0);
        button.setBackground(round(background, 12, background == Color.TRANSPARENT ? PURPLE : Color.rgb(216, 212, 204), 1));
        return button;
    }

    private TextView text(String value, float size, int color, int style) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(color); view.setTypeface(Typeface.DEFAULT, style); return view;
    }
    private LinearLayout vertical(int spacing) { LinearLayout value = new LinearLayout(this); value.setOrientation(LinearLayout.VERTICAL); if (Build.VERSION.SDK_INT >= 30) value.setShowDividers(LinearLayout.SHOW_DIVIDER_NONE); return value; }
    private LinearLayout horizontal(int spacing) { LinearLayout value = new LinearLayout(this); value.setOrientation(LinearLayout.HORIZONTAL); value.setGravity(Gravity.CENTER_VERTICAL); value.setPadding(0, 0, 0, 0); return value; }
    private GradientDrawable round(int color, int radius, int stroke, int strokeWidth) { GradientDrawable value = new GradientDrawable(); value.setColor(color); value.setCornerRadius(dp(radius)); if (strokeWidth > 0) value.setStroke(dp(strokeWidth), stroke); return value; }
    private LinearLayout.LayoutParams wrapWrap() { return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT); }
    private LinearLayout.LayoutParams matchWrap() { return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT); }
    private LinearLayout.LayoutParams weightWrap() { LinearLayout.LayoutParams value = new LinearLayout.LayoutParams(0, dp(48), 1); value.setMargins(dp(3), 0, dp(3), 0); return value; }
    private LinearLayout.LayoutParams weightHeight(int height) { LinearLayout.LayoutParams value = new LinearLayout.LayoutParams(0, dp(height), 1); value.setMargins(dp(3), 0, dp(3), 0); return value; }
    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void toast(String text) { Toast.makeText(this, text, Toast.LENGTH_SHORT).show(); }
    private static String normalizePassword(String value) { return value == null ? "" : value.replaceAll("[^A-Za-z2-9]", "").toUpperCase(Locale.US); }
    private static String formatPassword(String value) { String clean = normalizePassword(value); return clean.length() > 4 ? clean.substring(0, 4) + " " + clean.substring(4) : clean; }
    private static JsonBuilder json(String type) { return new JsonBuilder().putSafe("type", type); }

    private static final class JsonBuilder {
        final JSONObject value = new JSONObject();
        JsonBuilder putSafe(String key, Object item) { try { value.put(key, item); } catch (JSONException ignored) { } return this; }
    }
}
