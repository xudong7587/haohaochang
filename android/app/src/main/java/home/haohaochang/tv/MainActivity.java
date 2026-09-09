package home.haohaochang.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

/** Lightweight TV terminal. Media conversion and audio separation stay on the NAS. */
public final class MainActivity extends Activity {
    private WebView web;
    private FrameLayout root;
    private View fullVideo;
    private WebChromeClient.CustomViewCallback fullCallback;
    private SharedPreferences preferences;
    private String server;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        preferences = getSharedPreferences("connection", MODE_PRIVATE);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        web = new WebView(this);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setLoadWithOverviewMode(true);
        web.getSettings().setUseWideViewPort(true);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                Uri base = Uri.parse(server == null ? "" : server);
                return !(target.getScheme() != null && target.getScheme().equals(base.getScheme()) && target.getHost() != null && target.getHost().equals(base.getHost()) && target.getPort() == base.getPort());
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) new AlertDialog.Builder(MainActivity.this).setTitle("暂时连不上 NAS").setMessage("请确认地址可访问且 Docker 已启动。外网连接请使用 HTTPS 反代域名，并检查证书是否有效。").setPositiveButton("重试", (d,w) -> connect()).setNegativeButton("修改地址", (d,w) -> settings()).show();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullVideo != null) { callback.onCustomViewHidden(); return; }
                fullVideo = view; fullCallback = callback; root.addView(view, new FrameLayout.LayoutParams(-1,-1)); web.setVisibility(View.GONE); view.setFocusableInTouchMode(true); view.requestFocus();
            }
            @Override public void onHideCustomView() { exitFull(); }
        });
        server = preferences.getString("server", "");
        if (server.isEmpty()) settings(); else connect();
    }
    private void connect() { web.loadUrl(server + "/tv"); web.requestFocus(); }
    private void settings() {
        EditText input = new EditText(this);
        input.setSingleLine(true); input.setText(server == null ? "" : server); input.setHint("https://ktv.example.com");
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("连接家庭 NAS").setMessage("输入 http://NAS-IP:3210 或 HTTPS 反代域名，可在外地连接。不要附加 /admin 或 /tv。连接后用管理密码登录，菜单键可修改地址。").setView(input).setPositiveButton("连接", null).setNegativeButton("取消", (d,w) -> { if(server == null || server.isEmpty()) finish(); }).create();
        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String value = input.getText().toString().trim().replaceAll("/+$", "");
            Uri uri = Uri.parse(value);
            if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) || uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null || (uri.getPath() != null && !uri.getPath().isEmpty())) { input.setError("请输入 http://NAS-IP:3210 或 https://域名，不要附加路径"); return; }
            server = value; preferences.edit().putString("server", value).apply(); dialog.dismiss(); exitFull(); connect();
        }));
        dialog.show();
    }
    private void exitFull() { if(fullVideo != null) { root.removeView(fullVideo); fullVideo = null; web.setVisibility(View.VISIBLE); web.requestFocus(); if(fullCallback != null) { fullCallback.onCustomViewHidden(); fullCallback = null; } } }
    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        if(event.getAction() == KeyEvent.ACTION_DOWN && event.getKeyCode() == KeyEvent.KEYCODE_MENU) { settings(); return true; }
        // Let WebView dispatch real DPAD/Enter keyboard events, including IME text input.
        return super.dispatchKeyEvent(event);
    }
    @Override public void onBackPressed() {
        if(fullVideo != null) { exitFull(); return; }
        web.evaluateJavascript("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",null);
    }
    @Override protected void onPause() { super.onPause(); web.onPause(); }
    @Override protected void onResume() { super.onResume(); if(web != null)web.onResume(); }
    @Override protected void onDestroy() { web.destroy(); super.onDestroy(); }
}
