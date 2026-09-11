package home.haohaochang.tv;

import static org.junit.Assert.*;

import android.app.Activity;
import android.view.View;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 23, qualifiers = "w960dp-h540dp-land-mdpi")
public class NativeCompatibilityTest {
  @Test
  public void androidSixCanCreateNativeRoomAndParseLyrics() {
    Activity activity = Robolectric.buildActivity(Activity.class).setup().get();
    try (NativeRoom room =
        new NativeRoom(
            activity,
            new RoomApi("http://127.0.0.1:1", "fixture"),
            new NativeRoom.Actions() {
              public void settings() {}

              public void authRequired() {}
            },
            false)) {
      activity.setContentView(room);
      room.state(
          RoomApi.object(
              "queue",
              new JSONArray(),
              "ambient",
              RoomApi.object(
                  "id",
                  "ambient-one",
                  "song_id",
                  "one",
                  "title",
                  "随机歌曲",
                  "artist",
                  "歌手",
                  "mode",
                  "tracks",
                  "ambient",
                  true),
              "playback",
              RoomApi.object("paused", false)));
      room.measure(
          View.MeasureSpec.makeMeasureSpec(960, View.MeasureSpec.EXACTLY),
          View.MeasureSpec.makeMeasureSpec(540, View.MeasureSpec.EXACTLY));
      room.layout(0, 0, 960, 540);
      LyricsTimeline timeline = new LyricsTimeline("[00:02]第二句\n[00:01]第一句");
      assertEquals("第一句", timeline.lines.get(0).text);
      assertEquals(0, timeline.index(1));
      room.lyrics("ambient-one", timeline, RoomApi.object("size", 36), 0);
      assertEquals(960, room.getWidth());
    } finally {
      activity.finish();
    }
  }
}
