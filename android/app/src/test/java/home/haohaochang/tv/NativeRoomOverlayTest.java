package home.haohaochang.tv;

import static org.junit.Assert.*;

import android.app.Activity;
import android.os.Looper;
import android.view.View;
import java.time.Duration;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class NativeRoomOverlayTest {
  @Test
  public void queueHidesAfterSixSecondsRepeatsAndStopsWhenLeaving() throws Exception {
    Activity activity = Robolectric.buildActivity(Activity.class).setup().get();
    try (LocalNas server = new LocalNas((path, headers, body) -> new LocalNas.Reply(200, "{}"))) {
      RoomSession session =
          new RoomSession(
              new RoomApi(server.origin(), "fixture"),
              new RoomSession.Listener() {
                public void state(JSONObject state) {}

                public void media(String entry, JSONObject resources, boolean legacy) {}

                public void lyrics(
                    String entry, LyricsTimeline timeline, JSONObject style, double offset) {}

                public void permission(boolean allowed) {}

                public void error(String message, boolean auth) {}
              });
      NativeRoomOverlay overlay = new NativeRoomOverlay(activity, session);
      activity.setContentView(overlay);
      try {
        overlay.queue(new JSONArray().put(RoomApi.object("id", "entry", "title", "测试曲")));
        overlay.fullscreen(true);
        View panel = overlay.getChildAt(1);
        assertEquals(View.VISIBLE, panel.getVisibility());
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(7));
        assertEquals(View.GONE, panel.getVisibility());
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(24));
        assertEquals(View.VISIBLE, panel.getVisibility());
        overlay.fullscreen(false);
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(31));
        assertEquals(View.VISIBLE, overlay.getVisibility());
        assertEquals(View.GONE, panel.getVisibility());
      } finally {
        overlay.close();
        session.close();
        activity.finish();
      }
    }
  }
}
