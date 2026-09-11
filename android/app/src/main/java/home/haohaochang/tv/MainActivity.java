package home.haohaochang.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/** Native TV entry point. No WebView or Javascript bridge is instantiated. */
public final class MainActivity extends Activity {
  private FrameLayout root;
  private NativeRoom room;
  private RoomApi connectionApi;
  private SharedPreferences preferences;
  private AppUpdater updater;
  private LanDiscovery discovery;
  private String server = "";
  private boolean destroyed, resumed;
  private int generation;
  private long exitPressedAt;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final ExecutorService executor = Executors.newFixedThreadPool(2);

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    updater = new AppUpdater(this);
    setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
    if (Build.VERSION.SDK_INT >= 33)
      getOnBackInvokedDispatcher()
          .registerOnBackInvokedCallback(
              android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    immersive();
    preferences = getSharedPreferences("connection", MODE_PRIVATE);
    root = new FrameLayout(this);
    root.setBackgroundColor(TvStyle.BACKGROUND);
    setContentView(root);
    server = preferences.getString("server", "");
    if (server.isEmpty()) discover();
    else connect(server);
  }

  private void immersive() {
    getWindow()
        .getDecorView()
        .setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
  }

  private void reset() {
    generation++;
    handler.removeCallbacksAndMessages(null);
    if (discovery != null) {
      discovery.cancel();
      discovery = null;
    }
    if (room != null) {
      room.close();
      room = null;
    }
    if (connectionApi != null) {
      connectionApi.close();
      connectionApi = null;
    }
    root.removeAllViews();
  }

  private void connect(String address) {
    try {
      server = ConnectionPolicy.normalize(address);
    } catch (IllegalArgumentException error) {
      settings();
      return;
    }
    reset();
    int current = generation;
    String token = preferences.getString("token:" + server, "");
    RoomApi api = new RoomApi(server, token);
    connectionApi = api;
    ConnectionScreen loading = screen("正在连接你的歌房", "连接 NAS 后即可在电视上点歌、查看歌词和播放。");
    loading.loading(server);
    root.addView(loading, new FrameLayout.LayoutParams(-1, -1));
    android.view.inputmethod.InputMethodManager keyboard =
        (android.view.inputmethod.InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
    if (keyboard != null) keyboard.hideSoftInputFromWindow(root.getWindowToken(), 0);
    executor.execute(
        () -> {
          try {
            api.json("/api/health", null);
            if (!token.isEmpty()) api.json("/api/state", null);
            handler.post(
                () -> {
                  if (stale(current)) return;
                  preferences.edit().putString("server", server).apply();
                  if (token.isEmpty()) pair();
                  else openRoom(api);
                });
          } catch (Exception error) {
            handler.post(
                () -> {
                  if (stale(current)) return;
                  if (RoomSession.auth(error)) {
                    preferences.edit().remove("token:" + server).apply();
                    api.token = "";
                    pair();
                  } else failed("暂时连不上歌房", RoomSession.message(error));
                });
          }
        });
  }

  private boolean stale(int current) {
    return destroyed || generation != current;
  }

  private void openRoom(RoomApi api) {
    generation++;
    handler.removeCallbacksAndMessages(null);
    connectionApi = null;
    root.removeAllViews();
    room =
        new NativeRoom(
            this,
            api,
            new NativeRoom.Actions() {
              public void settings() {
                menu();
              }

              public void authRequired() {
                handler.post(
                    () -> {
                      preferences.edit().remove("token:" + server).apply();
                      connect(server);
                    });
              }
            });
    root.addView(room, new FrameLayout.LayoutParams(-1, -1));
    room.foreground(resumed);
    room.requestFocus();
  }

  private void pair() {
    int current = ++generation;
    RoomApi api = connectionApi;
    LinearLayout panel = new LinearLayout(this);
    panel.setOrientation(LinearLayout.VERTICAL);
    panel.setGravity(Gravity.CENTER);
    panel.setPadding(dp(24), dp(18), dp(24), dp(18));
    panel.setBackgroundColor(TvStyle.BACKGROUND);
    root.removeAllViews();
    root.addView(panel, new FrameLayout.LayoutParams(-1, -1));
    TextView title = TvStyle.text(this, "手机扫码，连接这台电视", 26, TvStyle.INK);
    panel.addView(title);
    TextView hint = TvStyle.text(this, "手机登录歌房并确认后，电视自动进入。", 15, TvStyle.MUTED);
    hint.setPadding(0, dp(10), 0, dp(12));
    panel.addView(hint);
    ImageView qr = new ImageView(this);
    qr.setContentDescription("电视连接二维码");
    panel.addView(qr, new LinearLayout.LayoutParams(dp(220), dp(220)));
    TextView code = TvStyle.text(this, "正在生成二维码…", 16, TvStyle.ACCENT);
    code.setPadding(0, dp(8), 0, dp(12));
    panel.addView(code);
    LinearLayout buttons = new LinearLayout(this);
    panel.addView(buttons);
    Button refresh = TvStyle.button(this, "刷新二维码", "刷新二维码", this::pair);
    buttons.addView(refresh, new LinearLayout.LayoutParams(dp(120), dp(44)));
    Button password = TvStyle.button(this, "密码登录", "使用管理密码登录", this::password);
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(dp(120), dp(44));
    p.leftMargin = dp(12);
    buttons.addView(password, p);
    Button change = TvStyle.button(this, "更换歌房", "更换歌房", this::settings);
    LinearLayout.LayoutParams changeParams = new LinearLayout.LayoutParams(dp(120), dp(44));
    changeParams.leftMargin = dp(12);
    buttons.addView(change, changeParams);
    refresh.requestFocus();
    executor.execute(
        () -> {
          try {
            JSONObject data =
                (JSONObject) api.json("/api/tv-pairing", RoomApi.object("origin", server));
            String image = data.getString("qr");
            byte[] bytes = Base64.decode(image.substring(image.indexOf(',') + 1), Base64.DEFAULT);
            android.graphics.Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            handler.post(
                () -> {
                  if (stale(current)) return;
                  qr.setImageBitmap(bitmap);
                  code.setText("请核对连接码：" + data.optString("code"));
                  pollPair(api, data, current, code);
                });
          } catch (Exception error) {
            handler.post(
                () -> {
                  if (!stale(current)) code.setText(RoomSession.message(error) + "，请选择刷新二维码。");
                });
          }
        });
  }

  private void pollPair(RoomApi api, JSONObject pair, int current, TextView status) {
    if (stale(current)) return;
    executor.execute(
        () -> {
          try {
            JSONObject data =
                (JSONObject)
                    api.json(
                        "/api/tv-pairing/" + pair.optString("id") + "/check",
                        RoomApi.object("pollKey", pair.optString("pollKey")));
            handler.post(
                () -> {
                  if (stale(current)) return;
                  if (data.optString("status").equals("approved")) {
                    api.token = data.optString("token");
                    preferences.edit().putString("token:" + server, api.token).apply();
                    openRoom(api);
                  } else handler.postDelayed(() -> pollPair(api, pair, current, status), 2000);
                });
          } catch (Exception error) {
            handler.post(
                () -> {
                  if (stale(current)) return;
                  status.setText(RoomSession.message(error) + "，请选择刷新二维码。");
                });
          }
        });
  }

  private void password() {
    EditText input = new EditText(this);
    input.setSingleLine();
    input.setInputType(
        android.text.InputType.TYPE_CLASS_TEXT
            | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
    input.setHint("NAS 管理密码");
    AlertDialog dialog =
        new AlertDialog.Builder(this)
            .setTitle("登录歌房")
            .setView(input)
            .setNegativeButton("取消", null)
            .setPositiveButton("登录", null)
            .create();
    dialog.setOnShowListener(
        d ->
            dialog
                .getButton(AlertDialog.BUTTON_POSITIVE)
                .setOnClickListener(
                    v -> {
                      String secret = input.getText().toString();
                      if (secret.isEmpty()) {
                        input.setError("请输入密码");
                        return;
                      }
                      int current = generation;
                      dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
                      executor.execute(
                          () -> {
                            try (RoomApi login = new RoomApi(server, secret)) {
                              JSONObject result =
                                  (JSONObject) login.json("/api/login", new JSONObject());
                              handler.post(
                                  () -> {
                                    if (stale(current)) return;
                                    String token = result.optString("token");
                                    preferences.edit().putString("token:" + server, token).apply();
                                    dialog.dismiss();
                                    connect(server);
                                  });
                            } catch (Exception error) {
                              handler.post(
                                  () -> {
                                    if (stale(current)) return;
                                    input.setError(RoomSession.message(error));
                                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
                                  });
                            }
                          });
                    }));
    dialog.show();
  }

  private ConnectionScreen screen(String title, String description) {
    return new ConnectionScreen(
        this,
        new ConnectionScreen.Actions() {
          public void scan() {
            discover();
          }

          public void manual() {
            settings();
          }

          public void connect(String address) {
            MainActivity.this.connect(address);
          }

          public void cancel() {
            connect(preferences.getString("server", server));
          }
        },
        title,
        description);
  }

  private void settings() {
    reset();
    ConnectionScreen view = screen("连接你的家庭歌房", "输入 NAS 地址或 HTTPS 域名，成功后自动记住。");
    view.manual(server, !preferences.getString("server", "").isEmpty());
    root.addView(view, new FrameLayout.LayoutParams(-1, -1));
  }

  private void discover() {
    reset();
    int current = generation;
    ConnectionScreen view = screen("寻找家庭歌房", "正在寻找同一网络中的服务器，大约需要 8 秒。");
    view.searching(server);
    root.addView(view, new FrameLayout.LayoutParams(-1, -1));
    LanDiscovery search = new LanDiscovery();
    discovery = search;
    executor.execute(
        () -> {
          List<LanDiscovery.Server> found = search.search();
          handler.post(
              () -> {
                if (stale(current)) return;
                discovery = null;
                if (found.size() == 1) {
                  connect(found.get(0).address);
                  return;
                }
                root.removeAllViews();
                ConnectionScreen result =
                    screen(
                        found.isEmpty() ? "还没有找到歌房" : "找到 " + found.size() + " 个歌房",
                        found.isEmpty() ? "请确认 NAS 已启动 LAN 自动发现，也可以手动输入地址。" : "选择这台电视要连接的服务器。");
                if (found.isEmpty()) result.manual(server, !server.isEmpty());
                else result.servers(found);
                root.addView(result, new FrameLayout.LayoutParams(-1, -1));
              });
        });
  }

  private void failed(String title, String description) {
    reset();
    ConnectionScreen view = screen(title, description);
    view.failure(
        server, "Android " + Build.VERSION.RELEASE + " · 原生 TV " + BuildConfig.VERSION_NAME);
    root.addView(view, new FrameLayout.LayoutParams(-1, -1));
  }

  private void menu() {
    new AlertDialog.Builder(this)
        .setTitle("好好唱设置 · " + BuildConfig.VERSION_NAME)
        .setItems(
            new String[] {"重试当前播放", "播放信息", "重新连接歌房", "连接设置", "重新自动发现", "检查应用更新", "退出歌房登录"},
            (d, w) -> {
              if (w == 0 && room != null) room.retry();
              else if (w == 1 && room != null) room.diagnostics();
              else if (w == 2) connect(server);
              else if (w == 3) settings();
              else if (w == 4) discover();
              else if (w == 5) updater.check();
              else if (w == 6) {
                preferences.edit().remove("token:" + server).apply();
                connect(server);
              }
            })
        .setNegativeButton("关闭", null)
        .show();
  }

  @Override
  public boolean dispatchKeyEvent(KeyEvent event) {
    if (event.getAction() == KeyEvent.ACTION_DOWN && event.getKeyCode() == KeyEvent.KEYCODE_MENU) {
      if (event.getRepeatCount() == 0) menu();
      return true;
    }
    return super.dispatchKeyEvent(event);
  }

  @Override
  public void onBackPressed() {
    handleBack();
  }

  private void handleBack() {
    if (room != null && room.back()) {
      exitPressedAt = 0;
      return;
    }
    long now = SystemClock.elapsedRealtime();
    if (exitPressedAt != 0 && now - exitPressedAt < 2500) {
      finish();
      return;
    }
    exitPressedAt = now;
    Toast.makeText(this, "再按一次返回退出好好唱", Toast.LENGTH_SHORT).show();
  }

  @Override
  protected void onResume() {
    super.onResume();
    resumed = true;
    immersive();
    if (room != null) room.foreground(true);
    if (updater != null) updater.resume();
  }

  @Override
  protected void onPause() {
    resumed = false;
    if (room != null) room.foreground(false);
    super.onPause();
  }

  @Override
  protected void onDestroy() {
    destroyed = true;
    reset();
    executor.shutdownNow();
    updater.destroy();
    super.onDestroy();
  }

  private int dp(float n) {
    return TvStyle.dp(this, n);
  }
}
