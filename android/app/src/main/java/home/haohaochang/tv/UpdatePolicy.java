package home.haohaochang.tv;

import java.net.URI;

final class UpdatePolicy {
    static final String REPO = "xudong7587/haohaochang";
    static int assetPriority(String name, String tag) {
        if (!tag.matches("v?\\d+\\.\\d+\\.\\d+")) return 0;
        if (("haohaochang-tv-v" + tag.replaceFirst("^v", "") + ".apk").equals(name)) return 2;
        return "haohaochang-tv.apk".equals(name) ? 1 : 0;
    }
    static boolean allowed(String value, boolean initial) {
        try {
            URI u = new URI(value);
            if (!"https".equals(u.getScheme()) || u.getUserInfo() != null || (u.getPort() != -1 && u.getPort() != 443)) return false;
            return ("github.com".equals(u.getHost()) && u.getPath().startsWith("/" + REPO + "/releases/download/")) ||
                (!initial && ("release-assets.githubusercontent.com".equals(u.getHost()) || "objects.githubusercontent.com".equals(u.getHost())));
        } catch (Exception e) { return false; }
    }
    static boolean newer(String next, String current) {
        if (!next.matches("v?\\d+\\.\\d+\\.\\d+") || !current.matches("v?\\d+\\.\\d+\\.\\d+")) return false;
        try {
            String[] a = next.replaceFirst("^v", "").split("\\."), b = current.replaceFirst("^v", "").split("\\.");
            for (int i = 0; i < 3; i++) {
                long x = Long.parseLong(a[i]), y = Long.parseLong(b[i]);
                if (x != y) return x > y;
            }
        } catch (NumberFormatException e) { return false; }
        return false;
    }
}
