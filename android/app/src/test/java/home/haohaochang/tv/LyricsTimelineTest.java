package home.haohaochang.tv;

import static org.junit.Assert.*;

import org.junit.Test;

public class LyricsTimelineTest {
  @Test
  public void countdownSeekAndDuplicateTimestamps() {
    LyricsTimeline lyrics =
        new LyricsTimeline("[00:08]第一句\n[00:10]第二句\n[00:10]同时间后一句\n[00:15]最后一句");
    assertEquals(-1, lyrics.index(0));
    assertEquals(4, lyrics.countdown(0));
    assertEquals(1, lyrics.countdown(7.1));
    assertEquals(0, lyrics.countdown(8));
    assertEquals(0, lyrics.index(8));
    assertEquals(2, lyrics.index(10));
    assertEquals(3, lyrics.index(30));
    assertEquals(0, lyrics.index(9));
  }

  @Test
  public void lrcAndPresentationOffsetsHaveTheSameConvention() {
    LyricsTimeline lyrics =
        new LyricsTimeline("[offset:500]\n[00:10]<00:10>你<00:11>好\n[00:12][00:14]重复");
    assertEquals(9.5, lyrics.lines.get(0).time, 0.0001);
    assertEquals(9.5, lyrics.lines.get(0).words.get(0).time, 0.0001);
    assertEquals(3, lyrics.lines.size());
    assertEquals(-1, lyrics.index(9.4));
    assertEquals(0, lyrics.index(9.4 + 0.1)); // Right button: advance lyrics.
    assertEquals(-1, lyrics.index(9.5 - 0.1)); // Left button: delay lyrics.
    assertEquals(0.5f, LyricsTimeline.progress(10, 9.5, 10.5), 0.0001);
  }

  @Test
  public void emptyPlainAndNegativeOffset() {
    assertTrue(new LyricsTimeline("").lines.isEmpty());
    assertEquals("无时间轴歌词", new LyricsTimeline("无时间轴歌词").plain);
    assertEquals(1.5, new LyricsTimeline("[offset:-500]\n[00:01]歌词").lines.get(0).time, 0.0001);
    assertEquals(0, LyricsTimeline.progress(-1, 0, 1), 0);
    assertEquals(1, LyricsTimeline.progress(2, 0, 1), 0);
  }

  @Test
  public void largeTimelineSupportsRandomSeeks() {
    StringBuilder text = new StringBuilder();
    for (int i = 0; i < 10000; i++) text.append('[').append(i).append(":00]歌词\n");
    LyricsTimeline lyrics = new LyricsTimeline(text.toString());
    assertEquals(9999, lyrics.index(9999 * 60));
    assertEquals(5, lyrics.index(5 * 60));
    assertEquals(-1, lyrics.index(-1));
  }
}
