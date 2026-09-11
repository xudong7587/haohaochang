package home.haohaochang.tv;

import java.net.URI;

/** Pure policy shared by the native bridge and its JVM tests. */
final class PlaybackPolicy {
    static final long COMMAND_TIMEOUT_MS = 8000;
    static boolean mediaAllowed(String url, String server) {
        try {
            URI uri = new URI(url);
            return ConnectionPolicy.sameOrigin(url, server) && uri.getRawUserInfo() == null
                && uri.getFragment() == null && uri.getPath().matches("/api/(assets|media)/[^/]+/(video|vocal|backing)");
        } catch (Exception error) { return false; }
    }
    static boolean mayPlay(boolean foreground, boolean lease, boolean paused, long age) {
        return foreground && lease && !paused && age >= 0 && age < COMMAND_TIMEOUT_MS;
    }
    static long offsetUs(double seconds) {
        if (Double.isNaN(seconds) || Double.isInfinite(seconds) || Math.abs(seconds) > 21600)
            throw new IllegalArgumentException("Invalid media offset");
        return Math.round(seconds * 1000000);
    }
    private PlaybackPolicy() {}
}
