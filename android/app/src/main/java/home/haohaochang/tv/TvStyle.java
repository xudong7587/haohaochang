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
  static final int BACKGROUND = 0xff12101b,
      PANEL = 0xff191623,
      SURFACE = 0xff252031,
      INK = 0xfff5f2ff,
      MUTED = 0xffa7a1bb,
      ACCENT = 0xffc3b2ff,
      PURPLE = 0xff6558db,
      BORDER = 0xff393244;

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
    GradientDrawable focused = shape(c, 0xff453957, 10);
    focused.setStroke(dp(c, 2), 0xffe1c8ff);
    d.addState(new int[] {android.R.attr.state_focused}, focused);
    d.addState(new int[] {android.R.attr.state_activated}, focused);
    d.addState(new int[] {android.R.attr.state_pressed}, shape(c, ACCENT, 10));
    d.addState(new int[] {android.R.attr.state_selected}, shape(c, ACCENT, 10));
    GradientDrawable normal = shape(c, SURFACE, 10);
    normal.setStroke(dp(c, 1), BORDER);
    d.addState(new int[] {}, normal);
    return d;
  }

  static ColorStateList ink() {
    return new ColorStateList(
        new int[][] {
          new int[] {-android.R.attr.state_enabled},
          new int[] {android.R.attr.state_focused},
          new int[] {android.R.attr.state_activated},
          new int[] {android.R.attr.state_pressed},
          new int[] {android.R.attr.state_selected},
          new int[] {}
        },
        new int[] {0xff766a84, INK, INK, BACKGROUND, BACKGROUND, INK});
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
    b.setFocusable(true);
    b.setFocusableInTouchMode(true);
    b.setTextSize(14);
    b.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
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

  static void icon(Button button, String name) {
    TvIcon icon = new TvIcon(button.getContext(), name, ink(), 19);
    button.setCompoundDrawablesRelative(icon, null, null, null);
    button.setCompoundDrawablePadding(dp(button.getContext(), 7));
  }

  static void primary(Button button) {
    Context c = button.getContext();
    StateListDrawable states = new StateListDrawable();
    GradientDrawable focused = shape(c, PURPLE, 24);
    focused.setStroke(dp(c, 3), 0xffe1c8ff);
    states.addState(new int[] {android.R.attr.state_focused}, focused);
    states.addState(new int[] {android.R.attr.state_pressed}, shape(c, 0xff8879ec, 24));
    states.addState(new int[] {}, shape(c, PURPLE, 24));
    button.setBackground(states);
    button.setTextColor(Color.WHITE);
  }

  static void subtle(Button button) {
    Context c = button.getContext();
    StateListDrawable states = new StateListDrawable();
    GradientDrawable focused = shape(c, 0x224d3b68, 8);
    focused.setStroke(dp(c, 2), 0xffe1c8ff);
    states.addState(new int[] {android.R.attr.state_focused}, focused);
    states.addState(new int[] {android.R.attr.state_pressed}, shape(c, 0xff453957, 8));
    states.addState(new int[] {}, shape(c, Color.TRANSPARENT, 8));
    button.setBackground(states);
    button.setTextColor(INK);
  }
}
