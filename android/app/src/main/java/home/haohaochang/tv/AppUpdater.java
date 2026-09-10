package home.haohaochang.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import org.json.JSONArray;
import org.json.JSONObject;

final class AppUpdater {
    private final Activity activity;
    private volatile boolean busy, cancelled;
    private boolean waitingPermission;
    AppUpdater(Activity activity) { this.activity = activity; }
    private void ui(Runnable work) { activity.runOnUiThread(() -> { if (!activity.isFinishing() && !activity.isDestroyed()) work.run(); }); }
    private String current() throws Exception { return activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionName; }
    private HttpURLConnection connect(String url, boolean metadata) throws Exception {
        for (int i = 0; i < 6; i++) {
            if (!metadata && !UpdatePolicy.allowed(url, false)) throw new Exception("下载地址不可信");
            HttpURLConnection c = (HttpURLConnection)new URL(url).openConnection();
            c.setConnectTimeout(15000); c.setReadTimeout(20000); c.setInstanceFollowRedirects(false);
            c.setRequestProperty("User-Agent", "haohaochang-tv");
            int code = c.getResponseCode();
            if (code == 200) return c;
            if (!metadata && code >= 300 && code < 400) {
                String next = c.getHeaderField("Location"); c.disconnect();
                url = new URL(new URL(url), next).toString(); continue;
            }
            c.disconnect(); throw new Exception("GitHub 暂不可用（" + code + "），稍后重试");
        }
        throw new Exception("下载重定向过多");
    }
    void check() {
        if (busy) return;
        busy = true; cancelled = false;
        AlertDialog progress = new AlertDialog.Builder(activity).setTitle("检查更新").setMessage("正在连接 GitHub…").setNegativeButton("取消", (d,w) -> cancelled = true).create();
        progress.setOnCancelListener(d -> cancelled = true); progress.show();
        new Thread(() -> {
            try {
                HttpURLConnection connection = connect("https://api.github.com/repos/" + UpdatePolicy.REPO + "/releases/latest", true);
                ByteArrayOutputStream data = new ByteArrayOutputStream();
                try (InputStream in = connection.getInputStream()) {
                    byte[] buffer = new byte[8192]; int n;
                    while ((n = in.read(buffer)) != -1) { data.write(buffer,0,n); if (data.size() > 2*1024*1024) throw new Exception("版本信息过大"); }
                } finally { connection.disconnect(); }
                JSONObject release = new JSONObject(data.toString("UTF-8"));
                String tag = release.getString("tag_name");
                if (release.optBoolean("draft") || release.optBoolean("prerelease")) throw new Exception("暂无正式新版");
                if (!UpdatePolicy.newer(tag, current())) { ui(() -> { progress.dismiss(); if (!cancelled) message("已是最新版本"); }); return; }
                JSONArray assets = release.getJSONArray("assets"); JSONObject found = null;
                for (int i=0; i<assets.length(); i++) if ("haohaochang-tv.apk".equals(assets.getJSONObject(i).getString("name"))) found = assets.getJSONObject(i);
                if (found == null || !UpdatePolicy.allowed(found.getString("browser_download_url"), true) || !found.optString("digest").matches("sha256:[a-f0-9]{64}") || found.getLong("size") <= 0 || found.getLong("size") > 50*1024*1024) throw new Exception("新版缺少有效的 APK 或校验信息");
                final JSONObject asset = found;
                ui(() -> { progress.dismiss(); if (!cancelled) new AlertDialog.Builder(activity).setTitle("发现新版 " + tag).setMessage("下载校验后将打开系统安装界面。连接设置会保留。").setPositiveButton("下载更新", (d,w) -> download(asset)).setNegativeButton("稍后", null).show(); });
            } catch (Exception e) { ui(() -> { progress.dismiss(); if (!cancelled) message("检查失败：" + e.getMessage()); }); }
            finally { busy = false; }
        }, "tv-update-check").start();
    }
    private void download(JSONObject asset) {
        if (busy) return; busy = true; cancelled = false;
        AlertDialog progress = new AlertDialog.Builder(activity).setTitle("下载新版").setMessage("正在下载…").setNegativeButton("取消", (d,w) -> cancelled = true).create();
        progress.setOnCancelListener(d -> cancelled = true); progress.show();
        new Thread(() -> {
            File file = new File(activity.getCacheDir(), "update.apk");
            try {
                HttpURLConnection connection = connect(asset.getString("browser_download_url"), false);
                long expected = asset.getLong("size"), total = 0; int last = -1;
                MessageDigest hash = MessageDigest.getInstance("SHA-256");
                try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(file)) {
                    byte[] buffer = new byte[65536]; int n;
                    while ((n = in.read(buffer)) != -1) {
                        if (cancelled) throw new Exception("已取消");
                        total += n; if (total > expected) throw new Exception("文件大小不匹配");
                        out.write(buffer,0,n); hash.update(buffer,0,n);
                        int pct = (int)(total * 100 / expected);
                        if (pct != last) { last = pct; ui(() -> progress.setMessage("已下载 " + pct + "%")); }
                    }
                } finally { connection.disconnect(); }
                StringBuilder hex = new StringBuilder(); for (byte b : hash.digest()) hex.append(String.format("%02x", b & 255));
                if (total != expected || !asset.getString("digest").equals("sha256:" + hex)) throw new Exception("下载校验失败");
                verify(file);
                ui(() -> { progress.dismiss(); if (!cancelled) install(); });
            } catch (Exception e) { file.delete(); ui(() -> { progress.dismiss(); if (!cancelled) message("更新失败：" + e.getMessage()); }); }
            finally { busy = false; }
        }, "tv-update-download").start();
    }
    @SuppressWarnings("deprecation") private void verify(File file) throws Exception {
        PackageManager pm = activity.getPackageManager();
        PackageInfo next = pm.getPackageArchiveInfo(file.getAbsolutePath(), PackageManager.GET_SIGNATURES);
        PackageInfo old = pm.getPackageInfo(activity.getPackageName(), PackageManager.GET_SIGNATURES);
        if (next == null || !activity.getPackageName().equals(next.packageName) || next.versionCode <= old.versionCode || !Arrays.equals(next.signatures, old.signatures)) throw new Exception("安装包名称、版本或签名不匹配");
    }
    private void install() {
        try {
            verify(new File(activity.getCacheDir(), "update.apk"));
            if (Build.VERSION.SDK_INT >= 26 && !activity.getPackageManager().canRequestPackageInstalls()) {
                waitingPermission = true;
                new AlertDialog.Builder(activity).setTitle("允许安装更新").setMessage("请在系统设置中允许好好唱安装应用，然后返回继续。").setPositiveButton("打开设置", (d,w) -> {
                    try { activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName()))); }
                    catch (Exception e) { waitingPermission = false; message("设备不支持打开安装权限设置"); }
                }).setNegativeButton("取消", (d,w) -> waitingPermission = false).show();
                return;
            }
            Uri uri = Uri.parse("content://" + activity.getPackageName() + ".updates/update.apk");
            activity.startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
        } catch (Exception e) { message("无法安装：" + e.getMessage()); }
    }
    void resume() {
        if (waitingPermission && Build.VERSION.SDK_INT >= 26 && activity.getPackageManager().canRequestPackageInstalls()) { waitingPermission = false; install(); }
    }
    void destroy() { cancelled = true; }
    private void message(String value) { new AlertDialog.Builder(activity).setTitle("好好唱更新").setMessage(value).setPositiveButton("确定", null).show(); }
}
