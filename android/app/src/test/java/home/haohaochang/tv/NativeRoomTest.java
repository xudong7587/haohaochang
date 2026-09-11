package home.haohaochang.tv;

import static org.junit.Assert.*;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.GridView;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, qualifiers = "w960dp-h540dp-land-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class NativeRoomTest {
  private Activity activity;
  private NativeRoom room;
  private LocalNas server;
  private final List<JSONObject> commands = new CopyOnWriteArrayList<>();
  private volatile String songsFixture =
      "[{\"id\":\"song-1\",\"title\":\"测试歌曲\",\"artist\":\"测试歌手\"}]";
  private final JSONObject song =
      RoomApi.object(
          "id",
          "entry-1",
          "song_id",
          "song-1",
          "title",
          "测试歌曲",
          "artist",
          "测试歌手",
          "mode",
          "tracks",
          "duration",
          60);

  @Before
  public void setup() throws Exception {
    server =
        new LocalNas(
            (path, headers, body) -> {
              if (path.equals("/api/control")) commands.add(new JSONObject(body));
              return new LocalNas.Reply(200, path.startsWith("/api/songs") ? songsFixture : "{}");
            });
    activity = Robolectric.buildActivity(Activity.class).setup().get();
    room =
        new NativeRoom(
            activity,
            new RoomApi(server.origin(), "fixture"),
            new NativeRoom.Actions() {
              public void settings() {}

              public void authRequired() {
                fail("unexpected auth error");
              }
            },
            false);
    activity.setContentView(room);
    room.state(
        RoomApi.object(
            "queue",
            new JSONArray().put(song),
            "playback",
            RoomApi.object("paused", false, "vocal", false, "lyricsOffsetMs", 0)));
    layout(960, 540);
    room.focusInitial();
  }

  @After
  public void cleanup() throws Exception {
    room.close();
    activity.finish();
    server.close();
  }

  private void layout(int width, int height) {
    room.measure(
        View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
        View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY));
    room.layout(0, 0, width, height);
  }

  private List<View> descendants(View root) {
    List<View> all = new ArrayList<>();
    all.add(root);
    if (root instanceof ViewGroup)
      for (int i = 0; i < ((ViewGroup) root).getChildCount(); i++)
        all.addAll(descendants(((ViewGroup) root).getChildAt(i)));
    return all;
  }

  private View find(String label) {
    return descendants(room).stream()
        .filter(
            v ->
                label.contentEquals(
                    v.getContentDescription() == null ? "" : v.getContentDescription()))
        .findFirst()
        .orElseThrow(() -> new AssertionError(label));
  }

  private void press(int key) {
    activity.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, key));
    activity.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, key));
  }

  @Test
  public void remoteMovesAcrossSidebarContentAndFooterWithoutTouch() throws Exception {
    assertTrue(find("音乐现场").hasFocus());
    press(KeyEvent.KEYCODE_DPAD_DOWN);
    assertTrue(find("歌名点歌").hasFocus());
    press(KeyEvent.KEYCODE_DPAD_DOWN);
    assertTrue(find("歌星点歌").hasFocus());
    press(KeyEvent.KEYCODE_DPAD_UP);
    assertTrue(find("歌名点歌").hasFocus());
    press(KeyEvent.KEYCODE_DPAD_CENTER);
    drain();
    layout(960, 540);
    assertTrue(find("歌名点歌").hasFocus());
    press(KeyEvent.KEYCODE_DPAD_RIGHT);
    assertTrue(find("歌曲卡片").hasFocus());
    press(KeyEvent.KEYCODE_DPAD_UP);
    assertTrue(find("搜索歌名或歌手").hasFocus());
    press(KeyEvent.KEYCODE_DPAD_RIGHT);
    assertTrue(find("搜索").hasFocus());
    press(KeyEvent.KEYCODE_DPAD_LEFT);
    assertTrue(find("搜索歌名或歌手").hasFocus());
    press(KeyEvent.KEYCODE_DPAD_DOWN);
    assertTrue(find("歌曲卡片").hasFocus());
    press(KeyEvent.KEYCODE_DPAD_LEFT);
    assertTrue(find("歌名点歌").hasFocus());
    press(KeyEvent.KEYCODE_DPAD_RIGHT);
    press(KeyEvent.KEYCODE_DPAD_DOWN);
    assertTrue(find("暂停").hasFocus());
    press(KeyEvent.KEYCODE_DPAD_RIGHT);
    assertTrue(find("切歌").hasFocus());
    press(KeyEvent.KEYCODE_DPAD_LEFT);
    assertTrue(find("暂停").hasFocus());
    press(KeyEvent.KEYCODE_DPAD_UP);
    assertTrue(find("歌曲卡片").hasFocus());
    assertEquals(0, commands.size());
  }

  @Test
  public void remoteConfirmActivatesOnceAndFullControlsStayNavigable() throws Exception {
    press(KeyEvent.KEYCODE_DPAD_RIGHT);
    press(KeyEvent.KEYCODE_DPAD_DOWN);
    assertTrue(find("暂停").hasFocus());
    activity.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_CENTER));
    activity.dispatchKeyEvent(
        new KeyEvent(0, 0, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_CENTER, 3));
    activity.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DPAD_CENTER));
    drain();
    assertEquals(1, commands.size());
    assertEquals("pause", commands.get(0).optString("action"));
    press(KeyEvent.KEYCODE_DPAD_RIGHT);
    press(KeyEvent.KEYCODE_DPAD_RIGHT);
    assertTrue(find("全屏播放").hasFocus());
    press(KeyEvent.KEYCODE_DPAD_CENTER);
    layout(960, 540);
    press(KeyEvent.KEYCODE_DPAD_DOWN);
    assertTrue(find("暂停").hasFocus());
    press(KeyEvent.KEYCODE_DPAD_LEFT);
    assertTrue(find("切换原唱伴奏").hasFocus());
    press(KeyEvent.KEYCODE_DPAD_LEFT);
    assertTrue(find("歌词延后 0.5 秒").hasFocus());
    press(KeyEvent.KEYCODE_DPAD_UP);
    assertTrue(find("重置歌词微调").hasFocus());
    press(KeyEvent.KEYCODE_DPAD_DOWN);
    assertTrue(find("暂停").hasFocus());
  }

  @Test
  public void catalogueLeavesVideoVisibleAndCapturesNativeStyle() throws Exception {
    JSONArray fixtures = new JSONArray();
    for (int i = 0; i < 16; i++)
      fixtures.put(
          RoomApi.object("id", "song-" + i, "title", "合成测试曲 · " + (i + 1), "artist", "测试歌手"));
    songsFixture = fixtures.toString();
    find("歌名点歌").performClick();
    drain();
    layout(960, 540);
    NativeCatalogue catalogue =
        (NativeCatalogue)
            descendants(room).stream().filter(v -> v instanceof NativeCatalogue).findFirst().get();
    assertTrue("Keep a clear video strip at the right", catalogue.getRight() <= 800);
    assertEquals(144, catalogue.getLeft());
    assertFalse(find("隐藏歌词").isShown());
    assertFalse(
        descendants(room).stream().anyMatch(v -> v.getClass().getName().contains("WebView")));
    capture("native-tv-catalogue.png");
    press(KeyEvent.KEYCODE_DPAD_RIGHT);
    layout(960, 540);
    capture("native-tv-catalogue-focused.png");
    GridView grid = (GridView) find("歌曲卡片");
    assertTrue(grid.getChildAt(0).isActivated());
    int columns = grid.getNumColumns();
    press(KeyEvent.KEYCODE_DPAD_RIGHT);
    press(KeyEvent.KEYCODE_DPAD_RIGHT);
    layout(960, 540);
    assertEquals(2, grid.getSelectedItemPosition());
    press(KeyEvent.KEYCODE_DPAD_DOWN);
    layout(960, 540);
    assertEquals(2 + columns, grid.getSelectedItemPosition());
    press(KeyEvent.KEYCODE_DPAD_DOWN);
    press(KeyEvent.KEYCODE_DPAD_DOWN);
    layout(960, 540);
    assertTrue("Remote scroll reveals offscreen cards", grid.getFirstVisiblePosition() > 0);
    press(KeyEvent.KEYCODE_DPAD_UP);
    layout(960, 540);
    assertEquals(2 + columns * 2, grid.getSelectedItemPosition());
  }

  private void capture(String name) throws Exception {
    java.io.File folder = new java.io.File("build/test-screenshots");
    folder.mkdirs();
    Bitmap image = Bitmap.createBitmap(960, 540, Bitmap.Config.ARGB_8888);
    room.draw(new Canvas(image));
    try (java.io.FileOutputStream out =
        new java.io.FileOutputStream(new java.io.File(folder, name))) {
      image.compress(Bitmap.CompressFormat.PNG, 100, out);
    }
    image.recycle();
  }

  private void drain() throws Exception {
    for (int i = 0; i < 30; i++) {
      Thread.sleep(15);
      Shadows.shadowOf(Looper.getMainLooper()).idle();
    }
  }

  @Test
  public void fullscreenHidesCatalogueAndSidebarAndKeepsSameControls() throws Exception {
    NativeLyricsView lyrics =
        (NativeLyricsView)
            descendants(room).stream().filter(v -> v instanceof NativeLyricsView).findFirst().get();
    assertEquals(View.GONE, lyrics.getVisibility());
    View background = find("演唱画面，确认键全屏");
    assertEquals(144, background.getLeft());
    assertEquals(468, background.getHeight());
    assertEquals(816, background.getWidth());
    View pause = find("暂停");
    find("歌名点歌").performClick();
    drain();
    assertTrue(find("歌名点歌").isShown());
    find("全屏播放").performClick();
    layout(960, 540);
    assertFalse(find("歌名点歌").isShown());
    assertSame(pause, find("暂停"));
    assertEquals(View.VISIBLE, lyrics.getVisibility());
    assertFalse(
        descendants(room).stream().filter(v -> v instanceof GridView).findFirst().get().isShown());
    View stage = find("演唱画面，按下键打开控制，左右键微调歌词");
    assertEquals(0, stage.getLeft());
    assertEquals(960, stage.getWidth());
    assertEquals(540, stage.getHeight());
    find("退出全屏").performClick();
    layout(960, 540);
    assertTrue(find("歌名点歌").isShown());
    assertSame(pause, find("暂停"));
    assertEquals(View.GONE, lyrics.getVisibility());
    assertFalse(
        descendants(room).stream().anyMatch(v -> v.getClass().getName().contains("WebView")));
  }

  @Test
  public void pausedControlsStayHiddenAcrossRepeatedStateUpdates() {
    find("全屏播放").performClick();
    JSONObject pausedState =
        RoomApi.object(
            "queue", new JSONArray().put(song), "playback", RoomApi.object("paused", true));
    room.state(pausedState);
    find("播放").requestFocus();
    room.back();
    assertFalse(find("播放").isShown());
    room.state(pausedState);
    room.state(pausedState);
    assertFalse(find("播放").isShown());
    room.back();
    assertTrue(find("播放").isShown());
  }

  @Test
  public void lyricButtonsHaveReversedDirectionsAndStayConditional() throws Exception {
    find("全屏播放").performClick();
    layout(960, 540);
    assertEquals("0.5\n←", ((Button) find("歌词延后 0.5 秒")).getText().toString());
    assertEquals("3\n→", ((Button) find("歌词提前 3 秒")).getText().toString());
    assertFalse(
        descendants(room).stream()
            .anyMatch(v -> String.valueOf(v.getContentDescription()).contains("0.1 秒")));
    find("歌词延后 0.5 秒").performClick();
    find("歌词提前 3 秒").performClick();
    drain();
    assertEquals(-500, commands.get(0).getInt("deltaMs"));
    assertEquals(3000, commands.get(1).getInt("deltaMs"));
    assertEquals("entry-1", commands.get(1).getString("entryId"));
    find("隐藏歌词").performClick();
    assertFalse(find("歌词延后 0.5 秒").isShown());
    assertFalse(find("重置歌词微调").isShown());
    find("显示歌词").performClick();
    assertTrue(find("歌词延后 0.5 秒").isShown());
    find("重置歌词微调").performClick();
    drain();
    assertTrue(commands.get(2).getBoolean("reset"));
  }

  @Test
  public void iconControlsExplainFocusBrieflyWithoutPermanentLabels() throws Exception {
    for (String name : new String[] {"暂停", "切换原唱伴奏", "切歌", "全屏播放", "隐藏歌词"}) {
      assertEquals("", ((Button) find(name)).getText().toString());
    }
    press(KeyEvent.KEYCODE_DPAD_RIGHT);
    press(KeyEvent.KEYCODE_DPAD_DOWN);
    assertTrue(find("暂停").hasFocus());
    View hint = find("播放控制提示");
    assertTrue(hint.isShown());
    assertEquals("暂停", ((android.widget.TextView) hint).getText().toString());
    Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(2));
    assertFalse(hint.isShown());
    assertTrue(find("暂停").hasFocus());
    press(KeyEvent.KEYCODE_DPAD_RIGHT);
    assertTrue(hint.isShown());
    assertEquals("切歌", ((android.widget.TextView) hint).getText().toString());
    layout(960, 540);
    capture("native-tv-control-hint.png");
  }

  @Test
  public void pictureArrowsAdjustByHalfASecondAndDoNotStealControlNavigation() throws Exception {
    find("全屏播放").performClick();
    press(KeyEvent.KEYCODE_DPAD_LEFT);
    press(KeyEvent.KEYCODE_DPAD_RIGHT);
    drain();
    assertEquals(-500, commands.get(0).optInt("deltaMs"));
    assertEquals(500, commands.get(1).optInt("deltaMs"));
    press(KeyEvent.KEYCODE_DPAD_DOWN);
    press(KeyEvent.KEYCODE_DPAD_LEFT);
    drain();
    assertTrue(find("切换原唱伴奏").hasFocus());
    assertEquals(2, commands.size());
  }

  @Test
  public void remoteWakeDoesNotPauseAndHiddenControlsCannotReceiveFocus() throws Exception {
    find("全屏播放").performClick();
    press(KeyEvent.KEYCODE_DPAD_DOWN);
    assertTrue(find("暂停").hasFocus());
    Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(5));
    assertFalse(find("暂停").isShown());
    room.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_CENTER));
    room.dispatchKeyEvent(
        new KeyEvent(0, 0, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_CENTER, 2));
    room.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DPAD_CENTER));
    drain();
    assertTrue(find("暂停").isShown());
    assertTrue(find("暂停").hasFocus());
    assertEquals(0, commands.size());
    find("暂停").performClick();
    drain();
    assertEquals("pause", commands.get(0).optString("action"));
    assertTrue(room.back());
    assertFalse(find("暂停").isShown());
    assertTrue(room.back());
    assertTrue(find("暂停").isShown());
  }

  @Test
  public void fullControlsFit720pAndNativeLyricsRender() throws Exception {
    find("全屏播放").performClick();
    layout(960, 540);
    room.lyrics(
        "entry-1",
        new LyricsTimeline("[00:00]今晚的好时光\n[00:10]一起唱喜欢的歌"),
        RoomApi.object("size", 38, "color", "#ffd66e"),
        0);
    for (View view : descendants(room))
      if (view instanceof Button && view.isShown()) {
        int[] xy = new int[2];
        view.getLocationInWindow(xy);
        assertTrue(
            view.getContentDescription() + " outside screen",
            xy[0] >= 0 && xy[0] + view.getWidth() <= 960);
      }
    java.io.File folder = new java.io.File("build/test-screenshots");
    folder.mkdirs();
    Bitmap image = Bitmap.createBitmap(960, 540, Bitmap.Config.ARGB_8888);
    room.draw(new Canvas(image));
    try (java.io.FileOutputStream out =
        new java.io.FileOutputStream(new java.io.File(folder, "native-tv-fullscreen.png"))) {
      image.compress(Bitmap.CompressFormat.PNG, 100, out);
    }
    assertTrue(image.getPixel(20, 500) != 0);
  }
}
