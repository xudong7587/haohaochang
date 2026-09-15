package home.haohaochang.tv;

import static org.junit.Assert.*;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.BitmapDrawable;
import android.os.Looper;
import android.view.View;
import android.widget.GridView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import java.io.ByteArrayOutputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.concurrent.atomic.AtomicInteger;
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
public class OnlineCoverTest {
  @Test
  public void onlineCardsFetchNasCoversAndClearRecycledImages() throws Exception {
    Bitmap bitmap = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888);
    bitmap.eraseColor(Color.MAGENTA);
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    bitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
    String path = "/api/online/cover?url=https%3A%2F%2Fi0.hdslb.com%2Fcover.png";
    AtomicInteger reads = new AtomicInteger();
    try (LocalNas server = new LocalNas((target, headers, body) -> {
      assertEquals(path, target);
      assertTrue(headers.contains("Bearer fixture"));
      reads.incrementAndGet();
      return new LocalNas.Reply(200, out.toByteArray());
    })) {
      Activity activity = Robolectric.buildActivity(Activity.class).setup().get();
      RoomSession session = new RoomSession(new RoomApi(server.origin(), "fixture"), new RoomSession.Listener() {
        public void state(JSONObject state) {}
        public void media(String entry, JSONObject resources, boolean legacy) {}
        public void lyrics(String entry, LyricsTimeline lyrics, JSONObject style, double offset) {}
        public void permission(boolean allowed) {}
        public void error(String message, boolean auth) { fail(message); }
      });
      NativeCatalogue catalogue = new NativeCatalogue(activity, session);
      try {
        Field page = NativeCatalogue.class.getDeclaredField("page");
        page.setAccessible(true);
        page.set(catalogue, "online");
        Method setRows = NativeCatalogue.class.getDeclaredMethod("setRows", JSONArray.class);
        setRows.setAccessible(true);
        setRows.invoke(catalogue, new JSONArray()
            .put(RoomApi.object("title", "在线封面", "coverPath", path))
            .put(RoomApi.object("title", "没有封面")));
        Field gridField = NativeCatalogue.class.getDeclaredField("grid");
        gridField.setAccessible(true);
        GridView grid = (GridView) gridField.get(catalogue);
        View card = grid.getAdapter().getView(0, null, grid);
        ImageView image = (ImageView) ((LinearLayout) card).getChildAt(0);
        for (int i = 0; i < 100 && !(image.getDrawable() instanceof BitmapDrawable); i++) {
          Thread.sleep(20);
          Shadows.shadowOf(Looper.getMainLooper()).idle();
        }
        assertTrue("NAS thumbnail is decoded on the card", image.getDrawable() instanceof BitmapDrawable);
        assertEquals(ImageView.ScaleType.CENTER_CROP, image.getScaleType());
        assertEquals(1, reads.get());
        grid.getAdapter().getView(1, card, grid);
        assertFalse("recycled card must not keep the previous video cover", image.getDrawable() instanceof BitmapDrawable);
        grid.getAdapter().getView(0, card, grid);
        assertTrue(image.getDrawable() instanceof BitmapDrawable);
        assertEquals("cached thumbnail does not repeat network read", 1, reads.get());
      } finally {
        catalogue.close();
        session.close();
        activity.finish();
      }
    }
  }
}
