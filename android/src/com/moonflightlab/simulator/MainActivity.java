package com.moonflightlab.simulator;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/** A self-contained, offline cockpit. Only bundled assets are accessible. */
public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/assets/index.html";
    private static final int EXPORT_REQUEST = 41;
    private WebView web;
    private FrameLayout root;
    private View fullScreenView;
    private WebChromeClient.CustomViewCallback fullScreenCallback;
    private String pendingCsv;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(16, 19, 23));
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (fullScreenView == null) {
                if (Build.VERSION.SDK_INT >= 30) {
                    android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                    view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                } else {
                    view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
                }
            } else view.setPadding(0, 0, 0, 0);
            return insets;
        });
        setContentView(root);
        PackageInfo provider = WebView.getCurrentWebViewPackage();
        if (provider != null) {
            try {
                if (Integer.parseInt(provider.versionName.split("\\.")[0]) < 100) {
                    new AlertDialog.Builder(this).setTitle("Нужно обновить WebView")
                        .setMessage("Обновите Android System WebView или Google Chrome через магазин приложений, затем откройте MOON снова.")
                        .setPositiveButton("Закрыть", (dialog, which) -> finish()).setCancelable(false).show();
                    return;
                }
            } catch (NumberFormatException ignored) { }
        }
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(16, 19, 23));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportZoom(false);
        settings.setTextZoom(100);
        WebView.setWebContentsDebuggingEnabled(false);
        web.addJavascriptInterface(new ExportBridge(), "MoonAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                return !"https".equals(url.getScheme()) || !HOST.equals(url.getHost()) || !url.getPath().startsWith("/assets/");
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!"https".equals(url.getScheme()) || !HOST.equals(url.getHost()) || !url.getPath().startsWith("/assets/")) return error(403, "Forbidden");
                String file = url.getPath().substring("/assets/".length());
                if (file.isEmpty()) file = "index.html";
                for (String part : file.split("/")) if (part.startsWith(".") || part.isEmpty()) return error(403, "Forbidden");
                try {
                    String mime = file.endsWith(".html") ? "text/html" : file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "application/octet-stream";
                    Map<String, String> headers = new HashMap<>();
                    headers.put("Cache-Control", "no-cache");
                    headers.put("X-Content-Type-Options", "nosniff");
                    headers.put("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; base-uri 'none'");
                    return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, getAssets().open(file));
                } catch (Exception exception) { return error(404, "Not Found"); }
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) Toast.makeText(MainActivity.this, "Не удалось открыть игру. Перезапустите приложение.", Toast.LENGTH_LONG).show();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullScreenView != null) { callback.onCustomViewHidden(); return; }
                fullScreenView = view;
                fullScreenCallback = callback;
                web.setVisibility(View.GONE);
                root.addView(view, new FrameLayout.LayoutParams(-1, -1));
                getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
                root.requestApplyInsets();
            }
            @Override public void onHideCustomView() { leaveFullScreen(); }
        });
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        web.loadUrl(START);
    }

    private static WebResourceResponse error(int status, String message) {
        return new WebResourceResponse("text/plain", "UTF-8", status, message, new HashMap<>(), new ByteArrayInputStream(message.getBytes(StandardCharsets.UTF_8)));
    }
    private void leaveFullScreen() {
        if (fullScreenView == null) return;
        root.removeView(fullScreenView); fullScreenView = null;
        web.setVisibility(View.VISIBLE);
        getWindow().getDecorView().setSystemUiVisibility(0);
        if (fullScreenCallback != null) { fullScreenCallback.onCustomViewHidden(); fullScreenCallback = null; }
        root.requestApplyInsets();
    }
    @Override public void onBackPressed() {
        if (fullScreenView != null) { leaveFullScreen(); return; }
        if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('moon-app-pause'))", null);
        new AlertDialog.Builder(this).setTitle("Выйти из MOON?").setMessage("Текущий полёт остановится. Рекорды и журнал останутся на телефоне.")
            .setPositiveButton("Выйти", (dialog, which) -> finish()).setNegativeButton("Остаться", null).show();
    }
    @Override protected void onPause() {
        if (web != null) { web.evaluateJavascript("window.dispatchEvent(new Event('moon-app-pause'))", null); web.onPause(); }
        super.onPause();
    }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onDestroy() {
        if (web != null) { web.removeJavascriptInterface("MoonAndroid"); root.removeView(web); web.destroy(); web = null; }
        super.onDestroy();
    }
    private final class ExportBridge {
        @JavascriptInterface public void saveTelemetry(String csv) {
            if (csv == null || csv.length() > 5_000_000) return;
            runOnUiThread(() -> {
                if (pendingCsv != null) return;
                pendingCsv = csv;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("text/csv");
                intent.putExtra(Intent.EXTRA_TITLE, "moon-telemetry.csv");
                try { startActivityForResult(intent, EXPORT_REQUEST); }
                catch (Exception exception) { pendingCsv = null; Toast.makeText(MainActivity.this, "Не удалось открыть выбор файла.", Toast.LENGTH_LONG).show(); }
            });
        }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != EXPORT_REQUEST) return;
        String csv = pendingCsv; pendingCsv = null;
        if (result == RESULT_OK && data != null && data.getData() != null && csv != null) {
            try (OutputStream output = getContentResolver().openOutputStream(data.getData())) {
                if (output == null) throw new IllegalStateException("No output stream");
                output.write(csv.getBytes(StandardCharsets.UTF_8));
                Toast.makeText(this, "Телеметрия сохранена", Toast.LENGTH_SHORT).show();
            } catch (Exception exception) { Toast.makeText(this, "Не удалось сохранить файл", Toast.LENGTH_LONG).show(); }
        }
    }
}
