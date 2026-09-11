package home.haohaochang.tv;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;

final class TvStyle {
  static final int BACKGROUND = 0xff15101e,
      SURFACE = 0xff282033,
      INK = 0xfff5efff,
      MUTED = 0xffb6a9c7,
      ACCENT = 0xffd0b9ff;

  static int dp(Context context, float n) {
    return Math.round(n * context.getResources().getDisplayMetrics().density);
  }

  static GradientDrawable shape(Context c, int color, int radius) {
    GradientDrawable d = new GradientDrawable();
    d.setColor(color);
    d.setCornerRadius(dp(c, radius));
    return d;
  }

  static StateListDrawable focus(Context c) {
    StateListDrawable d = new StateListDrawable();
    d.addState(new int[] {android.R.attr.state_focused}, shape(c, Color.WHITE, 10));
    d.addState(new int[] {android.R.attr.state_pressed}, shape(c, ACCENT, 10));
    d.addState(new int[] {android.R.attr.state_selected}, shape(c, Color.WHITE, 10));
    d.addState(new int[] {}, shape(c, SURFACE, 10));
    return d;
  }

  static ColorStateList ink() {
    return new ColorStateList(
        new int[][] {
          new int[] {-android.R.attr.state_enabled},
          new int[] {android.R.attr.state_focused},
          new int[] {android.R.attr.state_pressed},
          new int[] {android.R.attr.state_selected},
          new int[] {}
        },
        new int[] {0xff766a84, BACKGROUND, BACKGROUND, BACKGROUND, INK});
  }

  static TextView text(Context c, String value, int size, int color) {
    TextView v = new TextView(c);
    v.setText(value);
    v.setTextSize(size);
    v.setTextColor(color);
    return v;
  }

  static Button button(Context c, String text, String label, Runnable action) {
    Button b = new Button(c);
    b.setId(View.generateViewId());
    b.setText(text);
    b.setContentDescription(label);
    b.setAllCaps(false);
    b.setFocusableInTouchMode(true);
    b.setTextSize(14);
    b.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    b.setGravity(Gravity.CENTER);
    b.setTextColor(ink());
    b.setBackground(focus(c));
    b.setMinWidth(0);
    b.setMinimumWidth(0);
    b.setMinHeight(0);
    b.setMinimumHeight(0);
    b.setPadding(dp(c, 6), dp(c, 4), dp(c, 6), dp(c, 4));
    b.setStateListAnimator(null);
    b.setOnClickListener(v -> action.run());
    return b;
  }
}
