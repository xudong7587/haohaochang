package home.haohaochang.tv;

import java.net.URI;

final class UpdatePolicy {
  static final String REPO = "xudong7587/haohaochang";

  static int assetPriority(String name, String tag) {
    if (!tag.matches("v?\\d+\\.\\d+\\.\\d+")) return 0;
    String version = assetVersion(name, tag);
    if (!version.isEmpty() && version.split("\\.").length == 4) return 3;
    if (("haohaochang-tv-v" + tag.replaceFirst("^v", "") + ".apk").equals(name)) return 2;
    return "haohaochang-tv.apk".equals(name) ? 1 : 0;
  }

  static String assetVersion(String name, String tag) {
    String release = tag.replaceFirst("^v", "");
    if (!release.matches("\\d+\\.\\d+\\.\\d+")) return "";
    if (name.equals("haohaochang-tv.apk")) return release;
    if (!name.startsWith("haohaochang-tv-v") || !name.endsWith(".apk")) return "";
    String version = name.substring("haohaochang-tv-v".length(), name.length() - 4);
    return version.equals(release)
            || version.matches(java.util.regex.Pattern.quote(release) + "\\.\\d+")
        ? version
        : "";
  }

  static boolean allowed(String value, boolean initial) {
    try {
      URI u = new URI(value);
      if (!"https".equals(u.getScheme())
          || u.getUserInfo() != null
          || (u.getPort() != -1 && u.getPort() != 443)) return false;
      return ("github.com".equals(u.getHost())
              && u.getPath().startsWith("/" + REPO + "/releases/download/"))
          || (!initial
              && ("release-assets.githubusercontent.com".equals(u.getHost())
                  || "objects.githubusercontent.com".equals(u.getHost())));
    } catch (Exception e) {
      return false;
    }
  }

  static boolean newer(String next, String current) {
    if (!next.matches("v?\\d+\\.\\d+\\.\\d+(\\.\\d+)?")
        || !current.matches("v?\\d+\\.\\d+\\.\\d+(\\.\\d+)?")) return false;
    try {
      String[] a = next.replaceFirst("^v", "").split("\\."),
          b = current.replaceFirst("^v", "").split("\\.");
      for (int i = 0; i < 4; i++) {
        long x = i < a.length ? Long.parseLong(a[i]) : 0,
            y = i < b.length ? Long.parseLong(b[i]) : 0;
        if (x != y) return x > y;
      }
    } catch (NumberFormatException e) {
      return false;
    }
    return false;
  }
}
