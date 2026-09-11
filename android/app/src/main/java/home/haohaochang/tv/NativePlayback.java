package home.haohaochang.tv;

import android.app.Activity;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.SurfaceView;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.FrameLayout;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.Tracks;
import androidx.media3.common.VideoSize;
import androidx.media3.common.MediaItem;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlaybackException;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.analytics.AnalyticsListener;
import androidx.media3.exoplayer.source.FilteringMediaSource;
import androidx.media3.exoplayer.source.LoadEventInfo;
import androidx.media3.exoplayer.source.MediaLoadData;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.MergingMediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.UUID;

/** Native demux, decode, audio clock and SurfaceView output. The web layer only
 * sends commands and draws lyrics/menus; it never decodes a second media copy. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
final class NativePlayback {
    private final Activity activity;
    private final WebView web;
    private final FrameLayout root, picture;
    private final SurfaceView surface;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private ExoPlayer player;
    private String origin = "", nonce = "", session = "", requested = "backing", chosen = "";
    private String decoder = "", failedLoad = "", warning = "", error = "";
    private JSONObject resources = new JSONObject(), bounds;
    private final ArrayList<String> sourceKinds = new ArrayList<>();
    private final HashSet<String> failed = new HashSet<>();
    private boolean foreground = true, lease, paused = true, ended, legacy, destroyed;
    private long lastCommand, droppedFrames, nextReport;
    private float videoRatio = 16f / 9f;
    private double frameRate;
    private int videoWidth, videoHeight;
    private Boolean playGate;

    NativePlayback(Activity activity, FrameLayout root, WebView web) {
        this.activity = activity; this.root = root; this.web = web;
        picture = new FrameLayout(activity); picture.setBackgroundColor(Color.BLACK);
        picture.setVisibility(View.INVISIBLE); picture.setFocusable(false);
        surface = new SurfaceView(activity); surface.setFocusable(false);
        picture.addView(surface, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));
        root.addView(picture, 0, new FrameLayout.LayoutParams(1, 1));
        web.addJavascriptInterface(new Transport(), "HaohaochangTransport");
        handler.post(tick);
    }

    // The random capability is injected only into the current trusted top
    // document. Cross-origin frames see the transport but cannot issue commands.
    private final class Transport {
        @JavascriptInterface public void postMessage(String capability, String json) {
            if (json == null || json.length() > 32768) return;
            handler.post(() -> {
                if (destroyed || !nonce.equals(capability) || nonce.isEmpty()
                    || !ConnectionPolicy.sameOrigin(web.getUrl(), origin)) return;
                try { command(new JSONObject(json)); }
                catch (JSONException | IllegalArgumentException exception) {
                    error = "原生播放参数无效，请热更新页面后重试"; report();
                }
            });
        }
    }
    void navigating(String url, String server) {
        stop();
        origin = ConnectionPolicy.sameOrigin(url, server) ? server : "";
        nonce = origin.isEmpty() ? "" : UUID.randomUUID().toString();
    }
    void installBridge() {
        if (nonce.isEmpty() || !ConnectionPolicy.sameOrigin(web.getUrl(), origin)) return;
        web.evaluateJavascript("(function(){var key=" + JSONObject.quote(nonce) + ";"
            + "window.HaohaochangPlayer={version:1,postMessage:function(value){"
            + "HaohaochangTransport.postMessage(key,JSON.stringify(value));}};"
            + "window.dispatchEvent(new Event('haohaochang-native-ready'));})()", null);
    }
    private void command(JSONObject value) throws JSONException {
        String action = value.getString("action");
        String id = value.optString("session");
        if (action.equals("load")) {
            if (id.isEmpty() || id.length() > 120) throw new IllegalArgumentException();
            JSONObject media = value.getJSONObject("resources");
            for (String kind : new String[]{"video", "vocal", "backing"}) {
                JSONObject resource = media.optJSONObject(kind);
                if (resource != null && !PlaybackPolicy.mediaAllowed(resource.getString("url"), origin))
                    throw new IllegalArgumentException();
                if (resource != null) PlaybackPolicy.offsetUs(resource.optDouble("offset", 0));
            }
            stop(); session = id; resources = media; legacy = value.optBoolean("legacy");
            failed.clear(); error = ""; warning = ""; droppedFrames = 0; decoder = "";
            requested = value.optString("variant", "backing");
            lastCommand = SystemClock.elapsedRealtime();
            build(Math.max(0, value.optLong("positionMs", 0)));
            return;
        }
        if (session.isEmpty() || !session.equals(id)) return;
        if (action.equals("stop")) { stop(); return; }
        if (action.equals("bounds")) { bounds = value; layout(); return; }
        if (action.equals("state")) {
            lastCommand = SystemClock.elapsedRealtime();
            lease = value.optBoolean("lease"); paused = value.optBoolean("paused", true);
            String variant = value.optString("variant", "backing");
            if (!variant.equals(requested)) {
                requested = variant;
                if (legacy) build(position()); else selectAudio();
            }
            updatePlay(); report();
        } else if (action.equals("seek") && player != null) {
            player.seekTo(Math.max(0, value.optLong("positionMs", 0))); ended = false; report();
        } else if (action.equals("retry") && lease && !paused) {
            failed.clear(); error = ""; warning = ""; build(position());
        }
    }
    private String availableAudio() {
        if (resources.has(requested) && !failed.contains(requested)) return requested;
        for (String kind : new String[]{"vocal", "backing"})
            if (resources.has(kind) && !failed.contains(kind)) return kind;
        return "";
    }
    private MediaSource source(String kind, int trackType) throws JSONException {
        JSONObject resource = resources.getJSONObject(kind);
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
            .setUserAgent("HaohaochangNative/" + BuildConfig.VERSION_NAME)
            .setConnectTimeoutMs(15000).setReadTimeoutMs(20000)
            .setAllowCrossProtocolRedirects(false);
        // Native media URLs are NAS asset routes, never arbitrary external URLs.
        MediaSource source = new ProgressiveMediaSource.Factory(http)
            .createMediaSource(MediaItem.fromUri(resource.getString("url")));
        if (!legacy) source = new FilteringMediaSource(source, trackType);
        return new OffsetMediaSource(source, PlaybackPolicy.offsetUs(resource.optDouble("offset", 0)));
    }
    private void build(long positionMs) {
        ended = false; failedLoad = "";
        String audio = availableAudio();
        if (audio.isEmpty()) { error = "原唱与伴奏均无法加载，请重试或重新整理歌曲"; if (player != null) player.pause(); report(); return; }
        try {
            if (player == null) {
                // SurfaceView retains full display resolution and HDR even on
                // TVs whose Android UI / WebView is rendered at 1080p.
                DefaultRenderersFactory renderers = new DefaultRenderersFactory(activity).setEnableDecoderFallback(true);
                player = new ExoPlayer.Builder(activity, renderers)
                    .setLoadControl(new DefaultLoadControl.Builder()
                        .setBufferDurationsMs(15000, 50000, 1000, 3000)
                        .setTargetBufferBytes(96 * 1024 * 1024)
                        .setPrioritizeTimeOverSizeThresholds(false).build())
                    .build();
                playGate = null;
                player.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true);
                player.setHandleAudioBecomingNoisy(true);
                player.setVideoSurfaceView(surface);
                player.addListener(new Player.Listener() {
                    @Override public void onPlaybackStateChanged(int state) {
                        if (state == Player.STATE_ENDED) finishSong();
                        report();
                    }
                    @Override public void onTracksChanged(Tracks tracks) { selectAudio(); report(); }
                    @Override public void onPlayerError(PlaybackException exception) { recover(exception); }
                    @Override public void onVideoSizeChanged(VideoSize size) {
                        videoWidth = size.width; videoHeight = size.height;
                        if (size.height > 0) videoRatio = size.width * size.pixelWidthHeightRatio / size.height;
                        layout(); report();
                    }
                });
                player.addAnalyticsListener(new AnalyticsListener() {
                    @Override public void onVideoDecoderInitialized(EventTime time, String name, long timestamp, long duration) {
                        decoder = name; report();
                    }
                    @Override public void onVideoInputFormatChanged(EventTime time, Format format,
                        androidx.media3.exoplayer.DecoderReuseEvaluation evaluation) {
                        frameRate = format.frameRate > 0 ? format.frameRate : 0;
                    }
                    @Override public void onDroppedVideoFrames(EventTime time, int count, long elapsed) { droppedFrames += count; }
                    @Override public void onLoadError(EventTime time, LoadEventInfo info, MediaLoadData data,
                        IOException exception, boolean canceled) {
                        for (String kind : new String[]{"video", "vocal", "backing"}) {
                            JSONObject item = resources.optJSONObject(kind);
                            if (item != null && info.dataSpec.uri.toString().equals(item.optString("url"))) failedLoad = kind;
                        }
                    }
                    @Override public void onLoadCompleted(EventTime time, LoadEventInfo info, MediaLoadData data) {
                        JSONObject item = resources.optJSONObject(failedLoad);
                        if (item != null && info.dataSpec.uri.toString().equals(item.optString("url"))) failedLoad = "";
                    }
                });
            }
            chosen = audio;
            sourceKinds.clear();
            ArrayList<MediaSource> sources = new ArrayList<>();
            sources.add(source(audio, C.TRACK_TYPE_AUDIO)); sourceKinds.add(audio);
            if (!legacy) {
                if (resources.has("video") && !failed.contains("video")) {
                    sources.add(source("video", C.TRACK_TYPE_VIDEO)); sourceKinds.add("video");
                }
                for (String kind : new String[]{"vocal", "backing"}) {
                    if (!kind.equals(audio) && resources.has(kind) && !failed.contains(kind)) {
                        sources.add(source(kind, C.TRACK_TYPE_AUDIO)); sourceKinds.add(kind);
                    }
                }
            }
            player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon().clearOverrides().build());
            player.setMediaSource(legacy ? sources.get(0) : new MergingMediaSource(true, false, sources.toArray(new MediaSource[0])), positionMs);
            player.prepare(); updatePlay(); layout(); report();
        } catch (JSONException | IllegalArgumentException exception) {
            error = "原生播放资源无效，请在后台重新整理"; report();
        }
    }
    private void selectAudio() {
        if (player == null || legacy) return;
        String wanted = availableAudio();
        int sourceIndex = sourceKinds.indexOf(wanted);
        for (Tracks.Group group : player.getCurrentTracks().getGroups()) {
            if (group.getType() != C.TRACK_TYPE_AUDIO || !group.getMediaTrackGroup().id.startsWith(sourceIndex + ":")) continue;
            chosen = wanted;
            if (!group.isSelected()) player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                .setOverrideForType(new TrackSelectionOverride(group.getMediaTrackGroup(), 0)).build());
            return;
        }
    }
    private void recover(PlaybackException exception) {
        long time = position();
        boolean pictureFailure = exception instanceof ExoPlaybackException
            && ((ExoPlaybackException) exception).type == ExoPlaybackException.TYPE_RENDERER
            && ((ExoPlaybackException) exception).rendererFormat != null
            && androidx.media3.common.MimeTypes.isVideo(((ExoPlaybackException) exception).rendererFormat.sampleMimeType);
        String kind = pictureFailure ? "video" : failedLoad.isEmpty() ? chosen : failedLoad;
        failed.add(kind);
        if (kind.equals("video") && !legacy) {
            warning = "画面解码或读取失败，音频继续；可在后台转换兼容画面";
            build(time);
        } else if (!availableAudio().isEmpty()) {
            warning = "当前音轨不可用，已切换到可用音轨"; build(time);
        } else { error = "原生播放失败（" + exception.getErrorCodeName() + "），请重试"; report(); }
    }
    private long position() { return player == null ? 0 : Math.max(0, player.getCurrentPosition()); }
    private void updatePlay() {
        if (player != null) {
            boolean allowed = PlaybackPolicy.mayPlay(foreground, lease, paused, SystemClock.elapsedRealtime() - lastCommand) && !ended && error.isEmpty();
            if (playGate == null || playGate != allowed) {
                playGate = allowed;
                player.setVolume(allowed ? 1f : 0f);
                player.setPlayWhenReady(allowed);
            }
        }
    }
    private void finishSong() {
        if (ended || !PlaybackPolicy.mayPlay(foreground, lease, paused, SystemClock.elapsedRealtime() - lastCommand) || !error.isEmpty()) return;
        ended = true; updatePlay(); report();
    }
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (destroyed) return;
            updatePlay();
            if (player != null && !session.isEmpty()) {
                JSONObject audio = resources.optJSONObject(chosen);
                double duration = audio == null ? 0 : audio.optDouble("duration", 0) - audio.optDouble("offset", 0);
                // The audio defines song completion, including a longer/shorter
                // independent MV. This reads position; it never seeks to sync.
                if (duration > 0 && player.isPlaying() && position() >= duration * 1000) finishSong();
                if (SystemClock.elapsedRealtime() >= nextReport) { report(); nextReport = SystemClock.elapsedRealtime() + 200; }
            }
            handler.postDelayed(this, 200);
        }
    };
    private void layout() {
        if (bounds == null) return;
        double viewport = bounds.optDouble("viewportWidth", 0);
        if (viewport <= 0 || web.getWidth() <= 0) return;
        double scale = web.getWidth() / viewport;
        int width = Math.max(1, Math.min(web.getWidth(), (int)Math.round(bounds.optDouble("width") * scale)));
        int height = Math.max(1, Math.min(web.getHeight(), (int)Math.round(bounds.optDouble("height") * scale)));
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(width, height);
        params.leftMargin = (int)Math.round(bounds.optDouble("left") * scale);
        params.topMargin = (int)Math.round(bounds.optDouble("top") * scale);
        picture.setLayoutParams(params);
        int fittedWidth = Math.min(width, Math.round(height * videoRatio));
        int fittedHeight = Math.min(height, Math.round(width / videoRatio));
        surface.setLayoutParams(new FrameLayout.LayoutParams(fittedWidth, fittedHeight, Gravity.CENTER));
        picture.setVisibility(foreground && bounds.optBoolean("visible") && player != null
            && (legacy || (resources.has("video") && !failed.contains("video"))) ? View.VISIBLE : View.INVISIBLE);
    }
    private void report() {
        if (session.isEmpty() || destroyed) return;
        try {
            JSONObject state = new JSONObject().put("session", session).put("positionMs", position())
                .put("playing", player != null && player.isPlaying()).put("ended", ended)
                .put("variant", chosen).put("decoder", decoder).put("width", videoWidth).put("height", videoHeight)
                .put("fps", frameRate).put("droppedFrames", droppedFrames)
                .put("bufferedMs", player == null ? 0 : player.getTotalBufferedDuration())
                .put("buffering", player != null && player.getPlaybackState() == Player.STATE_BUFFERING)
                .put("pictureError", failed.contains("video")).put("warning", warning).put("error", error);
            web.evaluateJavascript("window.dispatchEvent(new CustomEvent('haohaochang-native-state',{detail:" + state + "}));", null);
        } catch (JSONException ignored) { /* Only finite numeric state is emitted. */ }
    }
    void foreground(boolean value) {
        foreground = value;
        // Coming back requires a fresh lease command from the live web page.
        if (!value) lease = false;
        updatePlay(); layout();
    }
    void stop() {
        session = ""; lease = false; paused = true; ended = false; bounds = null;
        if (player != null) { player.release(); player = null; }
        playGate = null;
        picture.setVisibility(View.INVISIBLE); videoWidth = videoHeight = 0; frameRate = 0;
    }
    void destroy() {
        destroyed = true; nonce = ""; stop(); handler.removeCallbacksAndMessages(null);
        web.removeJavascriptInterface("HaohaochangTransport"); root.removeView(picture);
    }
}
