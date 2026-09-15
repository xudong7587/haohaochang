package home.haohaochang.tv;

import static org.junit.Assert.*;
import android.app.Activity;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.os.Looper;
import android.view.MotionEvent;
import android.widget.Button;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, qualifiers = "w390dp-h844dp-port-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class TvStyleTouchTest {
  @Test public void firstPhoneTapActivatesOnce() {
    Activity activity = Robolectric.buildActivity(Activity.class).setup().get();
    try {
      AtomicInteger clicks = new AtomicInteger();
      Button button = TvStyle.button(activity, "搜索", "搜索", clicks::incrementAndGet);
      activity.setContentView(button);
      button.layout(0, 0, 160, 44);
      assertFalse(button.isFocusableInTouchMode());
      MotionEvent down = MotionEvent.obtain(0, 0, MotionEvent.ACTION_DOWN, 80, 22, 0);
      MotionEvent up = MotionEvent.obtain(0, 50, MotionEvent.ACTION_UP, 80, 22, 0);
      button.dispatchTouchEvent(down); button.dispatchTouchEvent(up);
      Shadows.shadowOf(Looper.getMainLooper()).idle();
      assertEquals(1, clicks.get());
      down.recycle(); up.recycle();
    } finally { activity.finish(); }
  }

  @Test public void longButtonKeepsIconSmallAndSquare() {
    Activity activity = Robolectric.buildActivity(Activity.class).setup().get();
    try {
      TvIcon icon = new TvIcon(activity, "search", ColorStateList.valueOf(Color.WHITE), 20);
      icon.setBounds(0, 0, 180, 44);
      Bitmap bitmap = Bitmap.createBitmap(180, 44, Bitmap.Config.ARGB_8888);
      icon.draw(new Canvas(bitmap));
      int left = 180, right = 0, top = 44, bottom = 0;
      for (int y = 0; y < 44; y++) for (int x = 0; x < 180; x++) {
        if (Color.alpha(bitmap.getPixel(x, y)) == 0) continue;
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
      assertTrue(right > left);
      assertTrue(right - left <= 20 && bottom - top <= 20);
      assertTrue(Math.abs((left + right) / 2f - 90) <= 2);
      bitmap.recycle();
    } finally { activity.finish(); }
  }
}
