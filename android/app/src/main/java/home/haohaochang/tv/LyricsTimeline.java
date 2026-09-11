package home.haohaochang.tv;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Immutable LRC timeline. Same offset convention as shared/lyrics.js. */
final class LyricsTimeline {
  static final class Word {
    final double time;
    final String text;

    Word(double time, String text) {
      this.time = time;
      this.text = text;
    }
  }

  static final class Line {
    final double time;
    final String text;
    final List<Word> words;

    Line(double time, String text, List<Word> words) {
      this.time = time;
      this.text = text;
      this.words = Collections.unmodifiableList(words);
    }
  }

  final List<Line> lines;
  final String plain;
  private static final Pattern OFFSET =
      Pattern.compile("\\[offset:([+-]?\\d+)\\]", Pattern.CASE_INSENSITIVE);
  private static final Pattern STAMP = Pattern.compile("\\[(\\d+):(\\d{1,2}(?:\\.\\d+)?)\\]");
  private static final Pattern WORD = Pattern.compile("<(\\d+):(\\d{1,2}(?:\\.\\d+)?)>([^<]*)");

  LyricsTimeline(String text) {
    plain = text == null ? "" : text.trim();
    Matcher offsetMatch = OFFSET.matcher(plain);
    double offset = offsetMatch.find() ? Double.parseDouble(offsetMatch.group(1)) / 1000 : 0;
    List<Line> parsed = new ArrayList<>();
    for (String row : plain.split("\\r?\\n")) {
      String clean = row.replaceAll("\\[[^\\]]+\\]|<[^>]+>", "").trim();
      if (clean.isEmpty()) continue;
      List<Word> words = new ArrayList<>();
      Matcher word = WORD.matcher(row);
      while (word.find()) words.add(new Word(seconds(word) - offset, word.group(3)));
      Matcher stamp = STAMP.matcher(row);
      while (stamp.find()) parsed.add(new Line(seconds(stamp) - offset, clean, words));
    }
    Collections.sort(parsed, (a, b) -> Double.compare(a.time, b.time));
    lines = Collections.unmodifiableList(parsed);
  }

  private static double seconds(Matcher stamp) {
    return Double.parseDouble(stamp.group(1)) * 60 + Double.parseDouble(stamp.group(2));
  }

  int index(double time) {
    int low = 0, high = lines.size();
    while (low < high) {
      int mid = (low + high) >>> 1;
      if (lines.get(mid).time <= time) low = mid + 1;
      else high = mid;
    }
    return low - 1;
  }

  static float progress(double time, double start, double end) {
    return (float)
        (end > start
            ? Math.max(0, Math.min(1, (time - start) / (end - start)))
            : time >= start ? 1 : 0);
  }

  int countdown(double time) {
    return !lines.isEmpty() && time < lines.get(0).time
        ? Math.min(4, (int) Math.ceil(lines.get(0).time - time))
        : 0;
  }
}
