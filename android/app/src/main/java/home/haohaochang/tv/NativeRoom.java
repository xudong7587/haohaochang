package home.haohaochang.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Entire TV room is native: one permanent SurfaceView, recycled catalogue, native lyrics and
 * controls.
 */
final class NativeRoom extends FrameLayout implements RoomSession.Listener, AutoCloseable {
  interface Actions {
    void settings();

    void authRequired();
  }

  private final Activity activity;
  private final Actions actions;
  private final SharedPreferences preferences;
  private final RoomSession session;
  private final NativePlayback player;
  private final NativeLyricsView lyrics;
  private final FrameLayout stage;
  private final LinearLayout sidebar, footer, controls, leftAdjust, rightAdjust;
  private final NativeCatalogue catalogue;
  private final TextView title, status, offsetLabel, stageTitle;
  private final Button pause, vocal, next, fullscreen, lyricToggle, queueButton, reset;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private JSONObject current, playback = new JSONObject(), stats = new JSONObject();
  private String tab = "stage", mediaEntry = "", lastEnded = "", error = "", lastStatus = "";
  private boolean full,
      controlsVisible = true,
      lyricsVisible,
      lease,
      closed,
      foreground = true,
      dialogOpen,
      authReported,
      lastNativePlaying;
  private double lyricBaseOffset;
  private int queueCount;
  private boolean lastPaused = true;
  private int wakeKey = -1;
  private String pageBeforeFull = "stage";

  NativeRoom(Activity activity, RoomApi api, Actions actions) {
    this(activity, api, actions, true);
  }

  NativeRoom(Activity activity, RoomApi api, Actions actions, boolean connect) {
    super(activity);
    this.activity = activity;
    this.actions = actions;
    preferences = activity.getSharedPreferences("native-room", Activity.MODE_PRIVATE);
    lyricsVisible = preferences.getBoolean("lyrics", true);
    setBackgroundColor(TvStyle.BACKGROUND);
    setFocusable(true);
    setFocusableInTouchMode(true);
    session = new RoomSession(api, this);
    stage = new FrameLayout(activity);
    stage.setBackgroundColor(Color.BLACK);
    stage.setFocusable(true);
    stage.setFocusableInTouchMode(true);
    stage.setContentDescription("演唱画面，确认键全屏");
    addView(stage);
    player = new NativePlayback(activity, stage, this::nativeState);
    player.configure(api.server);
    stageTitle = TvStyle.text(activity, "客厅的舞台，留给你", 24, TvStyle.INK);
    stageTitle.setGravity(Gravity.CENTER);
    stage.addView(stageTitle, new FrameLayout.LayoutParams(-1, -1));
    lyrics =
        new NativeLyricsView(
            activity,
            new NativeLyricsView.Clock() {
              public long timeMs() {
                return player.timeMs();
              }

              public boolean playing() {
                return player.playing();
              }
            });
    stage.addView(lyrics, new FrameLayout.LayoutParams(-1, -1));
    stage.setOnClickListener(
        v -> {
          if (full) reveal(true);
          else setFull(true);
        });
    sidebar = new LinearLayout(activity);
    sidebar.setOrientation(LinearLayout.VERTICAL);
    sidebar.setPadding(dp(12), dp(20), dp(12), dp(12));
    sidebar.setBackgroundColor(0xff1e1729);
    addView(sidebar);
    TextView brand = TvStyle.text(activity, "好好唱", 26, TvStyle.ACCENT);
    sidebar.addView(brand, new LinearLayout.LayoutParams(-1, dp(52)));
    nav("音乐现场", "stage");
    nav("歌名点歌", "songs");
    nav("歌星点歌", "artists");
    nav("分类歌单", "playlists");
    queueButton = nav("已点歌曲", "queue");
    nav("在线找歌", "online");
    sidebar.addView(new View(activity), new LinearLayout.LayoutParams(1, 0, 1));
    Button join = TvStyle.button(activity, "扫码点歌", "手机扫码加入歌房", this::join);
    sidebar.addView(join, new LinearLayout.LayoutParams(-1, dp(42)));
    Button settings = TvStyle.button(activity, "设置", "设置", actions::settings);
    LinearLayout.LayoutParams settingsParams = new LinearLayout.LayoutParams(-1, dp(40));
    settingsParams.topMargin = dp(8);
    sidebar.addView(settings, settingsParams);
    catalogue = new NativeCatalogue(activity, session);
    addView(catalogue);
    catalogue.setVisibility(GONE);
    footer = new LinearLayout(activity);
    footer.setOrientation(LinearLayout.VERTICAL);
    footer.setPadding(dp(12), dp(6), dp(12), dp(8));
    footer.setBackgroundColor(0xf51e1729);
    addView(footer);
    LinearLayout info = new LinearLayout(activity);
    info.setGravity(Gravity.CENTER_VERTICAL);
    footer.addView(info, new LinearLayout.LayoutParams(-1, dp(24)));
    title = TvStyle.text(activity, "下一首，就唱你喜欢的", 14, TvStyle.INK);
    title.setSingleLine();
    title.setEllipsize(android.text.TextUtils.TruncateAt.END);
    title.setOnClickListener(v -> show("stage"));
    info.addView(title, new LinearLayout.LayoutParams(0, -1, 1));
    offsetLabel = TvStyle.text(activity, "歌词原始时间", 12, TvStyle.MUTED);
    info.addView(offsetLabel);
    reset = TvStyle.button(activity, "复位", "重置歌词微调", () -> adjust(0, true));
    info.addView(reset, new LinearLayout.LayoutParams(dp(44), dp(24)));
    controls = new LinearLayout(activity);
    controls.setGravity(Gravity.CENTER_VERTICAL);
    footer.addView(controls, new LinearLayout.LayoutParams(-1, dp(46)));
    lyricToggle = TvStyle.button(activity, "歌词", "隐藏歌词", this::toggleLyrics);
    controls.addView(lyricToggle, new LinearLayout.LayoutParams(dp(54), -1));
    leftAdjust = adjustGroup(new double[] {10, 3, .5, .1}, false);
    controls.addView(leftAdjust, new LinearLayout.LayoutParams(0, -1, 1));
    LinearLayout mainControls = new LinearLayout(activity);
    mainControls.setGravity(Gravity.CENTER);
    controls.addView(mainControls, new LinearLayout.LayoutParams(dp(200), -1));
    vocal = TvStyle.button(activity, "♫ 伴奏", "切换原唱伴奏", () -> control("vocal"));
    mainControls.addView(vocal, new LinearLayout.LayoutParams(dp(68), -1));
    pause = TvStyle.button(activity, "Ⅱ", "暂停", () -> control("pause"));
    LinearLayout.LayoutParams pauseParams = new LinearLayout.LayoutParams(dp(48), -1);
    pauseParams.leftMargin = dp(8);
    pauseParams.rightMargin = dp(8);
    mainControls.addView(pause, pauseParams);
    pause.setTextSize(22);
    next = TvStyle.button(activity, "▶| 切歌", "切歌", () -> control("next"));
    mainControls.addView(next, new LinearLayout.LayoutParams(dp(68), -1));
    rightAdjust = adjustGroup(new double[] {.1, .5, 3, 10}, true);
    controls.addView(rightAdjust, new LinearLayout.LayoutParams(0, -1, 1));
    fullscreen = TvStyle.button(activity, "⛶ 全屏", "全屏播放", () -> setFull(!full));
    controls.addView(fullscreen, new LinearLayout.LayoutParams(dp(90), -1));
    status = TvStyle.text(activity, "正在连接播放会话…", 13, TvStyle.INK);
    status.setBackground(TvStyle.shape(activity, 0xdd392b47, 8));
    status.setPadding(dp(12), dp(8), dp(12), dp(8));
    FrameLayout.LayoutParams statusParams =
        new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.CENTER_HORIZONTAL);
    statusParams.topMargin = dp(8);
    addView(status, statusParams);
    layoutRoom();
    show("stage");
    updateControls();
    if (connect) session.start();
  }

  private int dp(float n) {
    return TvStyle.dp(activity, n);
  }

  private Button nav(String text, String page) {
    Button button = TvStyle.button(activity, text, text, () -> show(page));
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, dp(43));
    p.bottomMargin = dp(7);
    sidebar.addView(button, p);
    return button;
  }

  private LinearLayout adjustGroup(double[] steps, boolean advance) {
    LinearLayout group = new LinearLayout(activity);
    group.setGravity(Gravity.CENTER);
    for (double seconds : steps) {
      String number = seconds >= 1 ? String.valueOf((int) seconds) : String.valueOf(seconds);
      Button b =
          TvStyle.button(
              activity,
              advance ? number + " →" : "← " + number,
              "歌词" + (advance ? "提前 " : "延后 ") + number + " 秒",
              () -> adjust((int) (seconds * 1000) * (advance ? 1 : -1), false));
      b.setTextSize(12);
      b.setPadding(0, 0, 0, 0);
      LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, dp(40), 1);
      p.leftMargin = dp(2);
      group.addView(b, p);
    }
    return group;
  }

  private void layoutRoom() {
    int nav = full ? 0 : dp(144), bar = dp(84);
    FrameLayout.LayoutParams stageParams = new FrameLayout.LayoutParams(-1, -1);
    stageParams.leftMargin = nav;
    stageParams.bottomMargin = full ? 0 : bar;
    stage.setLayoutParams(stageParams);
    FrameLayout.LayoutParams navParams = new FrameLayout.LayoutParams(dp(144), -1);
    navParams.bottomMargin = bar;
    sidebar.setLayoutParams(navParams);
    FrameLayout.LayoutParams libraryParams = new FrameLayout.LayoutParams(-1, -1);
    libraryParams.leftMargin = nav;
    libraryParams.bottomMargin = bar;
    catalogue.setLayoutParams(libraryParams);
    footer.setLayoutParams(new FrameLayout.LayoutParams(-1, bar, Gravity.BOTTOM));
    sidebar.setVisibility(full ? GONE : VISIBLE);
    catalogue.setVisibility(!full && !tab.equals("stage") ? VISIBLE : GONE);
    lyrics.setVisibility(lyricsVisible && full ? VISIBLE : GONE);
    lyricToggle.setVisibility(full ? VISIBLE : INVISIBLE);
    stage.setContentDescription(full ? "演唱画面，按下键打开控制，左右键微调歌词" : "演唱画面，确认键全屏");
    updateAdjustmentVisibility();
  }

  private void updateAdjustmentVisibility() {
    // Keep equal-width flanks when hidden so the shared pause button never moves.
    leftAdjust.setVisibility(full && lyricsVisible && current != null ? VISIBLE : INVISIBLE);
    rightAdjust.setVisibility(full && lyricsVisible && current != null ? VISIBLE : INVISIBLE);
    offsetLabel.setVisibility(full && lyricsVisible && current != null ? VISIBLE : GONE);
    reset.setVisibility(offsetLabel.getVisibility());
  }

  private void show(String value) {
    tab = value;
    catalogue.setVisibility(tab.equals("stage") ? GONE : VISIBLE);
    if (!tab.equals("stage")) catalogue.show(tab);
    layoutRoom();
    // Native focus traversal remains in the selected surface; no hidden DOM targets.
    if (tab.equals("stage")) stage.requestFocus();
    else catalogue.focusGrid();
  }

  private void setFull(boolean value) {
    if (full == value) return;
    if (value) pageBeforeFull = tab;
    full = value;
    controlsVisible = true;
    fullscreen.setText(full ? "⛶ 退出" : "⛶ 全屏");
    fullscreen.setContentDescription(full ? "退出全屏" : "全屏播放");
    layoutRoom();
    footer.setVisibility(VISIBLE);
    if (full) {
      stage.requestFocus();
      armHide();
    } else {
      handler.removeCallbacks(hideControls);
      tab = pageBeforeFull;
      layoutRoom();
      fullscreen.requestFocus();
    }
  }

  private final Runnable hideControls = this::hidePanel;

  private void hidePanel() {
    if (!full || paused() || dialogOpen || !error.isEmpty()) return;
    controlsVisible = false;
    stage.requestFocus();
    footer.setVisibility(GONE);
  }

  private void armHide() {
    handler.removeCallbacks(hideControls);
    if (full && !paused()) handler.postDelayed(hideControls, 4000);
  }

  private void reveal(boolean focus) {
    controlsVisible = true;
    footer.setVisibility(VISIBLE);
    if (focus) pause.requestFocus();
    armHide();
  }

  boolean back() {
    if (full) {
      if (!controlsVisible) {
        reveal(true);
      } else if (footer.hasFocus()) {
        controlsVisible = false;
        handler.removeCallbacks(hideControls);
        stage.requestFocus();
        footer.setVisibility(GONE);
      } else reveal(true);
      return true;
    }
    if (catalogue.getVisibility() == VISIBLE && catalogue.back()) return true;
    if (!tab.equals("stage")) {
      show("stage");
      return true;
    }
    return false;
  }

  @Override
  public boolean dispatchKeyEvent(KeyEvent event) {
    if (event.getKeyCode() == wakeKey) {
      if (event.getAction() == KeyEvent.ACTION_UP) wakeKey = -1;
      return true;
    }
    if (event.getAction() != KeyEvent.ACTION_DOWN) return super.dispatchKeyEvent(event);
    int key = event.getKeyCode();
    if (key == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) {
      control("pause");
      return true;
    }
    if (key == KeyEvent.KEYCODE_MEDIA_NEXT) {
      control("next");
      return true;
    }
    if (full) {
      boolean wake =
          key == KeyEvent.KEYCODE_DPAD_CENTER
              || key == KeyEvent.KEYCODE_ENTER
              || key == KeyEvent.KEYCODE_DPAD_DOWN;
      boolean arrow = key >= KeyEvent.KEYCODE_DPAD_UP && key <= KeyEvent.KEYCODE_DPAD_RIGHT;
      if (!controlsVisible && (wake || arrow)) {
        if (event.getRepeatCount() == 0) {
          wakeKey = key;
          reveal(true);
        }
        return true;
      }
      if (stage.hasFocus() && wake) {
        if (event.getRepeatCount() == 0) {
          wakeKey = key;
          reveal(true);
        }
        return true;
      }
      if (stage.hasFocus()
          && lyricsVisible
          && (key == KeyEvent.KEYCODE_DPAD_LEFT || key == KeyEvent.KEYCODE_DPAD_RIGHT)) {
        if (event.getRepeatCount() == 0)
          adjust(key == KeyEvent.KEYCODE_DPAD_LEFT ? -100 : 100, false);
        return true;
      }
      armHide();
    }
    return super.dispatchKeyEvent(event);
  }

  private boolean paused() {
    return current == null || current.optBoolean("ambient")
        ? current == null || current.optBoolean("paused")
        : playback.optBoolean("paused");
  }

  private String variant() {
    return current != null
                && (current.optBoolean("ambient") || current.optString("mode").equals("original"))
            || playback.optBoolean("vocal")
        ? "vocal"
        : "backing";
  }

  private void control(String action) {
    if (current == null) return;
    session.command(
        "/api/control",
        "POST",
        RoomApi.object("action", action, "entryId", current.optString("id")),
        null);
    reveal(false);
  }

  private void adjust(int delta, boolean reset) {
    if (current == null) return;
    session.command(
        "/api/control",
        "POST",
        RoomApi.object(
            "action",
            "lyrics-offset",
            "entryId",
            current.optString("id"),
            "deltaMs",
            delta,
            "reset",
            reset),
        null);
    armHide();
  }

  private void toggleLyrics() {
    lyricsVisible = !lyricsVisible;
    preferences.edit().putBoolean("lyrics", lyricsVisible).apply();
    layoutRoom();
    updateControls();
    armHide();
  }

  private void updateControls() {
    boolean has = current != null;
    pause.setEnabled(has);
    next.setEnabled(has);
    lyricToggle.setEnabled(has);
    vocal.setEnabled(
        has
            && !current.optBoolean("ambient")
            && !current.optString("mode").equals("original")
            && !current.optString("mode").equals("instrumental"));
    String voice =
        has && current.optString("mode").equals("original")
            ? "原始音频"
            : variant().equals("vocal") ? "原唱" : "伴奏";
    vocal.setText("♫ " + voice);
    pause.setText(paused() ? "▶" : "Ⅱ");
    pause.setContentDescription(paused() ? "播放" : "暂停");
    lyricToggle.setText(lyricsVisible ? "歌词 ●" : "歌词 ○");
    lyricToggle.setContentDescription(lyricsVisible ? "隐藏歌词" : "显示歌词");
    title.setText(
        has
            ? current.optString("title") + "  ·  " + current.optString("artist") + "  ·  " + voice
            : "下一首，就唱你喜欢的");
    int offset = playback.optInt("lyricsOffsetMs");
    offsetLabel.setText(
        offset == 0
            ? "歌词原始时间"
            : "歌词"
                + (offset > 0 ? "提前 " : "延后 ")
                + String.format(java.util.Locale.ROOT, "%.1f", Math.abs(offset) / 1000.0)
                + " 秒");
    updateAdjustmentVisibility();
    if (lastPaused != paused()) {
      lastPaused = paused();
      if (lastPaused) reveal(false);
      else armHide();
    }
  }

  @Override
  public void state(JSONObject state) {
    JSONArray queue = state.optJSONArray("queue");
    queueCount = queue == null ? 0 : queue.length();
    JSONObject nextEntry = queueCount > 0 ? queue.optJSONObject(0) : state.optJSONObject("ambient");
    String before = current == null ? "" : current.optString("id"),
        after = nextEntry == null ? "" : nextEntry.optString("id");
    current = nextEntry;
    playback = state.optJSONObject("playback");
    if (playback == null) playback = new JSONObject();
    if (!before.equals(after)) {
      player.stop();
      mediaEntry = "";
      lastEnded = "";
      lyricBaseOffset = 0;
      error = "";
      lyrics.lyrics(new LyricsTimeline(""), 0, 0, 0xffffd66e, 48, "sans-serif");
      stageTitle.setVisibility(VISIBLE);
      stageTitle.setText(
          current == null
              ? "客厅的舞台，留给你"
              : current.optString("title") + "\n" + current.optString("artist"));
    }
    lyrics.offset(lyricBaseOffset + playback.optInt("lyricsOffsetMs") / 1000.0);
    queueButton.setText("已点歌曲  " + queueCount);
    catalogue.queue(state);
    updateControls();
    syncPlayback();
  }

  @Override
  public void media(String entry, JSONObject resources, boolean legacy) {
    if (current == null || !entry.equals(current.optString("id"))) return;
    mediaEntry = entry;
    error = "";
    send(
        RoomApi.object(
            "action",
            "load",
            "session",
            entry,
            "resources",
            resources,
            "legacy",
            legacy,
            "variant",
            variant()));
    stageTitle.setVisibility(resources.has("video") || legacy ? GONE : VISIBLE);
    syncPlayback();
  }

  @Override
  public void lyrics(String entry, LyricsTimeline timeline, JSONObject style, double offset) {
    if (current == null || !entry.equals(current.optString("id"))) return;
    lyricBaseOffset = offset + style.optDouble("offset", 0);
    int color = 0xffffd66e;
    try {
      color = Color.parseColor(style.optString("color", "#ffd66e"));
    } catch (IllegalArgumentException ignored) {
    }
    lyrics.lyrics(
        timeline,
        current.optDouble("duration"),
        lyricBaseOffset + playback.optInt("lyricsOffsetMs") / 1000.0,
        color,
        (float) style.optDouble("size", 48),
        style.optString("font", "sans-serif"));
  }

  @Override
  public void permission(boolean allowed) {
    boolean recovered = allowed && foreground && !lease;
    lease = allowed && foreground;
    if (recovered) {
      error = "";
      lastStatus = "";
      status.setVisibility(GONE);
    }
    syncPlayback();
  }

  private void syncPlayback() {
    if (mediaEntry.isEmpty()) return;
    send(
        RoomApi.object(
            "action",
            "state",
            "session",
            mediaEntry,
            "lease",
            lease,
            "paused",
            paused(),
            "variant",
            variant()));
    lyrics.refresh();
  }

  private void send(JSONObject value) {
    try {
      player.command(value);
    } catch (Exception failure) {
      error("播放参数无效，请重新连接歌房", false);
    }
  }

  private void nativeState(JSONObject value) {
    if (closed || !value.optString("session").equals(mediaEntry)) return;
    stats = value;
    if (lastNativePlaying != value.optBoolean("playing")) {
      lastNativePlaying = value.optBoolean("playing");
      lyrics.refresh();
    }
    String warning = value.optString("error", "");
    if (warning.isEmpty()) warning = value.optString("warning", "");
    if (!warning.isEmpty()) error(warning, false);
    else if (lease && error.isEmpty()) {
      status.setVisibility(GONE);
    }
    if (value.optBoolean("pictureError")) stageTitle.setVisibility(VISIBLE);
    if (value.optBoolean("ended") && lease && !paused() && !mediaEntry.equals(lastEnded)) {
      lastEnded = mediaEntry;
      session.command(
          "/api/player/ended",
          "POST",
          RoomApi.object("entryId", mediaEntry, "playerId", session.playerId),
          null);
    }
  }

  @Override
  public void error(String message, boolean auth) {
    if (closed) return;
    if (auth) {
      if (!authReported) {
        authReported = true;
        actions.authRequired();
      }
      return;
    }
    error = message;
    if (!message.equals(lastStatus)) {
      lastStatus = message;
      status.setText(message + "  ·  菜单键可重试");
      reveal(false);
    }
    status.setVisibility(VISIBLE);
  }

  void retry() {
    error = "";
    lastStatus = "";
    status.setVisibility(GONE);
    session.retry(current);
  }

  private void join() {
    session.read(
        "/api/join?origin=" + RoomApi.encode(session.api.server),
        value -> {
          try {
            JSONObject data = (JSONObject) value;
            String qr = data.getString("qr");
            byte[] bytes = Base64.decode(qr.substring(qr.indexOf(',') + 1), Base64.DEFAULT);
            ImageView image = new ImageView(activity);
            image.setAdjustViewBounds(true);
            image.setImageBitmap(BitmapFactory.decodeByteArray(bytes, 0, bytes.length));
            image.setPadding(dp(28), dp(20), dp(28), dp(20));
            dialogOpen = true;
            AlertDialog dialog =
                new AlertDialog.Builder(activity)
                    .setTitle("手机扫码点歌")
                    .setView(image)
                    .setPositiveButton("关闭", null)
                    .create();
            dialog.setOnDismissListener(
                d -> {
                  dialogOpen = false;
                  armHide();
                });
            dialog.show();
          } catch (Exception e) {
            error("二维码读取失败，请重试", false);
          }
        });
  }

  void diagnostics() {
    dialogOpen = true;
    AlertDialog dialog =
        new AlertDialog.Builder(activity)
            .setTitle("播放信息")
            .setMessage(
                "Media3 · SurfaceView · 原生歌词\n"
                    + stats.optInt("width")
                    + " × "
                    + stats.optInt("height")
                    + "  "
                    + stats.optDouble("fps", 0)
                    + " fps\n解码器："
                    + stats.optString("decoder", "等待播放")
                    + "\n丢帧："
                    + stats.optLong("droppedFrames")
                    + "\n缓冲："
                    + (stats.optLong("bufferedMs") / 1000)
                    + " 秒\n"
                    + session.api.server)
            .setPositiveButton("关闭", null)
            .create();
    dialog.setOnDismissListener(
        d -> {
          dialogOpen = false;
          armHide();
        });
    dialog.show();
  }

  void foreground(boolean value) {
    foreground = value;
    player.foreground(value);
    session.active(value);
    if (value) {
      lyrics.refresh();
      armHide();
    } else handler.removeCallbacks(hideControls);
  }

  @Override
  public void close() {
    closed = true;
    handler.removeCallbacksAndMessages(null);
    session.close();
    catalogue.close();
    player.destroy();
  }
}
