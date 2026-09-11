package home.haohaochang.tv;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.view.View;

/** Only this small native view redraws at 30 Hz. No layout, network or WebView per lyric frame. */
final class NativeLyricsView extends View {
  interface Clock {
    long timeMs();

    boolean playing();
  }

  private final Clock clock;
  private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
  private LyricsTimeline timeline = new LyricsTimeline("");
  private double offset, duration;
  private int color = Color.rgb(255, 214, 110), cachedIndex = Integer.MIN_VALUE, cachedWidth;
  private float preferredSize = 48, size, lineWidth;
  private float[] wordWidths = new float[0];
  private String current = "", next = "";
  private LyricsTimeline.Line line;

  NativeLyricsView(Context context, Clock clock) {
    super(context);
    this.clock = clock;
    setFocusable(false);
    setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    paint.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
  }

  void lyrics(
      LyricsTimeline value,
      double seconds,
      double offsetSeconds,
      int highlight,
      float fontSize,
      String font) {
    timeline = value;
    duration = seconds;
    offset = offsetSeconds;
    color = highlight;
    preferredSize = Math.max(18, Math.min(80, fontSize));
    paint.setTypeface(Typeface.create(font, Typeface.BOLD));
    cachedIndex = Integer.MIN_VALUE;
    invalidate();
  }

  void offset(double seconds) {
    offset = seconds;
    invalidate();
  }

  void refresh() {
    invalidate();
  }

  private void prepare(int index) {
    if (cachedIndex == index && cachedWidth == getWidth()) return;
    cachedIndex = index;
    cachedWidth = getWidth();
    int active = Math.max(0, index);
    line = timeline.lines.isEmpty() ? null : timeline.lines.get(active);
    current = line == null ? timeline.plain : line.text;
    next = active + 1 < timeline.lines.size() ? timeline.lines.get(active + 1).text : "";
    size = Math.min(preferredSize * getResources().getDisplayMetrics().density, getWidth() * .047f);
    paint.setTextSize(size);
    if (line != null && !line.words.isEmpty()) {
      StringBuilder text = new StringBuilder();
      for (LyricsTimeline.Word word : line.words) text.append(word.text);
      current = text.toString();
    }
    lineWidth = paint.measureText(current);
    if (lineWidth > getWidth() * .9f) {
      size *= getWidth() * .9f / lineWidth;
      paint.setTextSize(size);
      lineWidth = paint.measureText(current);
    }
    wordWidths = new float[line == null ? 0 : line.words.size()];
    for (int i = 0; i < wordWidths.length; i++)
      wordWidths[i] = paint.measureText(line.words.get(i).text);
  }

  @Override
  protected void onDraw(Canvas canvas) {
    super.onDraw(canvas);
    if (!isShown() || getWidth() == 0) return;
    double time = clock.timeMs() / 1000.0 + offset;
    int index = timeline.index(time);
    prepare(index);
    float baseline = getHeight() * .67f;
    paint.setTextSize(size);
    paint.setStyle(Paint.Style.FILL);
    float left = (getWidth() - lineWidth) / 2;
    // Stroke and a clipped second draw avoid gradient/filter allocation.
    drawText(canvas, current, left, baseline, Color.WHITE, true);
    if (line != null) {
      double end =
          Math.max(0, index) + 1 < timeline.lines.size()
              ? timeline.lines.get(Math.max(0, index) + 1).time
              : duration;
      if (wordWidths.length == 0) {
        canvas.save();
        canvas.clipRect(
            left, 0, left + lineWidth * LyricsTimeline.progress(time, line.time, end), getHeight());
        drawText(canvas, current, left, baseline, color, false);
        canvas.restore();
      } else {
        float x = left;
        for (int i = 0; i < wordWidths.length; i++) {
          LyricsTimeline.Word word = line.words.get(i);
          double until = i + 1 < wordWidths.length ? line.words.get(i + 1).time : end;
          canvas.save();
          canvas.clipRect(
              x,
              0,
              x + wordWidths[i] * LyricsTimeline.progress(time, word.time, until),
              getHeight());
          drawText(canvas, word.text, x, baseline, color, false);
          canvas.restore();
          x += wordWidths[i];
        }
      }
    }
    paint.setTextSize(size * .64f);
    float nextWidth = paint.measureText(next);
    if (nextWidth > getWidth() * .9f)
      paint.setTextSize(paint.getTextSize() * getWidth() * .9f / nextWidth);
    drawText(
        canvas,
        next,
        (getWidth() - paint.measureText(next)) / 2,
        baseline + size * 1.1f,
        0xffded2ec,
        true);
    int countdown = timeline.countdown(time);
    paint.setTextSize(size * .5f);
    for (int i = 0; i < countdown; i++)
      drawText(
          canvas,
          "●",
          getWidth() / 2f + (i - 1.5f) * size * .6f,
          baseline - size * 1.3f,
          color,
          true);
    if (clock.playing() && (!timeline.lines.isEmpty())) postInvalidateDelayed(33);
  }

  private void drawText(Canvas canvas, String text, float x, float y, int fill, boolean outline) {
    if (outline) {
      paint.setColor(0xdd000000);
      paint.setStyle(Paint.Style.STROKE);
      paint.setStrokeWidth(Math.max(2, size * .06f));
      canvas.drawText(text, x, y, paint);
    }
    paint.setStyle(Paint.Style.FILL);
    paint.setColor(fill);
    canvas.drawText(text, x, y, paint);
  }
}
