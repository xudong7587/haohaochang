package home.haohaochang.tv;

import androidx.media3.common.C;
import androidx.media3.common.Timeline;
import androidx.media3.exoplayer.source.ForwardingTimeline;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.WrappingMediaSource;

/** media time = song time + offset. MergingMediaSource aligns the periods,
 * leaving ExoPlayer's audio clock in charge of video presentation timestamps. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
final class OffsetMediaSource extends WrappingMediaSource {
    private final long offsetUs;
    OffsetMediaSource(MediaSource source, long offsetUs) { super(source); this.offsetUs = offsetUs; }
    @Override protected void onChildSourceInfoRefreshed(Timeline timeline) {
        refreshSourceInfo(new ForwardingTimeline(timeline) {
            @Override public Window getWindow(int index, Window window, long projectionUs) {
                super.getWindow(index, window, projectionUs);
                window.positionInFirstPeriodUs += offsetUs;
                if (window.durationUs != C.TIME_UNSET) window.durationUs = Math.max(0, window.durationUs - offsetUs);
                return window;
            }
            @Override public Period getPeriod(int index, Period period, boolean setIds) {
                super.getPeriod(index, period, setIds);
                period.positionInWindowUs -= offsetUs;
                return period;
            }
        });
    }
}
