package com.presenta.remote;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.MotionEvent;
import android.view.View;

import java.util.UUID;

public final class TouchPadView extends View {
    public interface Listener {
        void onPointer(double dx, double dy);
        void onPen(String phase, String id, double x, double y);
    }

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private Listener listener;
    private boolean penMode;
    private float previousX;
    private float previousY;
    private String strokeId;

    public TouchPadView(Context context) {
        super(context);
        setLayerType(View.LAYER_TYPE_SOFTWARE, null);
        setContentDescription("Área táctil para puntero y lápiz");
    }

    public void setListener(Listener value) { listener = value; }
    public void setPenMode(boolean value) { penMode = value; invalidate(); }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(Color.rgb(255, 254, 250));
        canvas.drawRoundRect(new RectF(0, 0, getWidth(), getHeight()), 34, 34, paint);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(1);
        paint.setColor(Color.rgb(226, 222, 212));
        for (int i = 1; i < 6; i++) {
            float x = getWidth() * i / 6f;
            canvas.drawLine(x, 0, x, getHeight(), paint);
        }
        for (int i = 1; i < 5; i++) {
            float y = getHeight() * i / 5f;
            canvas.drawLine(0, y, getWidth(), y, paint);
        }
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(Color.rgb(102, 103, 110));
        paint.setTextSize(15 * getResources().getDisplayMetrics().scaledDensity);
        paint.setTextAlign(Paint.Align.CENTER);
        String text = penMode ? "Escribe aquí para dibujar" : "Desliza para mover el láser";
        canvas.drawText(text, getWidth() / 2f, getHeight() - 34, paint);
    }

    @Override public boolean onTouchEvent(MotionEvent event) {
        if (listener == null) return true;
        double x = Math.max(0, Math.min(1, event.getX() / Math.max(1, getWidth())));
        double y = Math.max(0, Math.min(1, event.getY() / Math.max(1, getHeight())));
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                previousX = event.getX();
                previousY = event.getY();
                if (penMode) {
                    strokeId = UUID.randomUUID().toString();
                    listener.onPen("start", strokeId, x, y);
                }
                return true;
            case MotionEvent.ACTION_MOVE:
                if (penMode) {
                    listener.onPen("move", strokeId, x, y);
                } else {
                    float pixelX = event.getX() - previousX;
                    float pixelY = event.getY() - previousY;
                    double speed = Math.hypot(pixelX, pixelY);
                    double acceleration = 0.72 + Math.min(0.95, speed / 22.0);
                    double dx = clamp((pixelX / Math.max(1, getWidth())) * 1.35 * acceleration, -0.12, 0.12);
                    double dy = clamp((pixelY / Math.max(1, getHeight())) * 1.35 * acceleration, -0.12, 0.12);
                    if (Math.abs(dx) > 0.0001 || Math.abs(dy) > 0.0001) listener.onPointer(dx, dy);
                }
                previousX = event.getX();
                previousY = event.getY();
                return true;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                if (penMode && strokeId != null) listener.onPen("end", strokeId, x, y);
                strokeId = null;
                performClick();
                return true;
            default:
                return true;
        }
    }

    @Override public boolean performClick() {
        super.performClick();
        return true;
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }
}
