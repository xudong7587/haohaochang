package home.haohaochang.tv;

import java.net.URI;

/** Small, platform-independent rules shared by connection and discovery. */
final class ConnectionPolicy {
    static final String PROTOCOL = "haohaochang-tv-discovery-v1";
    static final int DISCOVERY_PORT = 43212;

    static String normalize(String input) {
        String value = input.trim();
        if (!value.contains("://")) value = "http://" + value;
        try {
            URI uri = new URI(value);
            String scheme = uri.getScheme();
            String path = uri.getPath();
            if (!("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) || uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null || uri.getPort() == 0 || uri.getPort() < -1 || uri.getPort() > 65535)
                throw new Exception();
            if (path != null && !path.isEmpty() && !path.equals("/") && !path.matches("/(tv|play|admin)/?")) throw new Exception();
            return new URI(scheme.toLowerCase(java.util.Locale.ROOT), null, uri.getHost(), uri.getPort(), null, null, null).toString();
        } catch (Exception error) {
            throw new IllegalArgumentException("请输入 NAS 地址，例如 http://192.168.1.10:43210，或 HTTPS 域名");
        }
    }

    static boolean privateIpv4(String address) {
        String[] parts = address.split("\\.", -1);
        if (parts.length != 4) return false;
        int[] numbers = new int[4];
        for (int n=0;n<4;n++) {
            if (!parts[n].matches("[0-9]{1,3}")) return false;
            numbers[n] = Integer.parseInt(parts[n]);
            if (numbers[n] > 255) return false;
        }
        return numbers[0] == 10 || (numbers[0] == 192 && numbers[1] == 168) || (numbers[0] == 172 && numbers[1] >= 16 && numbers[1] <= 31);
    }

    static boolean sameOrigin(String target, String base) {
        try {
            URI a = new URI(target), b = new URI(base);
            return a.getScheme() != null && a.getScheme().equalsIgnoreCase(b.getScheme()) && a.getHost() != null && a.getHost().equalsIgnoreCase(b.getHost()) && effectivePort(a) == effectivePort(b);
        } catch (Exception error) { return false; }
    }
    private static int effectivePort(URI uri) { return uri.getPort() >= 0 ? uri.getPort() : "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80; }
}
