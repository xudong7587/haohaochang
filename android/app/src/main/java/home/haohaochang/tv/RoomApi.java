package home.haohaochang.tv;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONObject;
import org.json.JSONTokener;

/** NAS-only transport. Call on workers; redirects never carry room credentials elsewhere. */
final class RoomApi implements AutoCloseable {
  final String server;
  volatile String token;
  private volatile boolean closed;
  private final Set<HttpURLConnection> connections = Collections.synchronizedSet(new HashSet<>());

  static final class Failure extends Exception {
    final int status;
    final String code;

    Failure(int status, String message, String code) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }

  RoomApi(String server, String token) {
    this.server = server;
    this.token = token;
  }

  static String encode(String value) {
    try {
      return URLEncoder.encode(value, "UTF-8");
    } catch (Exception impossible) {
      throw new IllegalArgumentException(impossible);
    }
  }

  static JSONObject object(Object... values) {
    JSONObject result = new JSONObject();
    try {
      for (int i = 0; i < values.length; i += 2) result.put((String) values[i], values[i + 1]);
    } catch (Exception error) {
      throw new IllegalArgumentException(error);
    }
    return result;
  }

  String absolute(String path) throws Exception {
    String address = new URL(new URL(server + "/"), path).toString();
    if (!ConnectionPolicy.sameOrigin(address, server)) throw new Failure(400, "资源地址不属于当前歌房", "");
    return address;
  }

  Object json(String path, JSONObject body) throws Exception {
    return json(path, body == null ? "GET" : "POST", body);
  }

  Object json(String path, String method, JSONObject body) throws Exception {
    return new JSONTokener(
            new String(bytes(path, method, body, 12 * 1024 * 1024), StandardCharsets.UTF_8))
        .nextValue();
  }

  byte[] bytes(String path, String method, JSONObject body, int limit) throws Exception {
    if (closed) throw new IllegalStateException("连接已关闭");
    HttpURLConnection connection = (HttpURLConnection) new URL(absolute(path)).openConnection();
    connections.add(connection);
    try {
      if (closed) throw new IllegalStateException("连接已关闭");
      connection.setConnectTimeout(5000);
      connection.setReadTimeout(8000);
      connection.setInstanceFollowRedirects(false);
      connection.setRequestMethod(method);
      connection.setRequestProperty("Authorization", "Bearer " + token);
      connection.setRequestProperty("User-Agent", "HaohaochangNative/" + BuildConfig.VERSION_NAME);
      connection.setRequestProperty("Accept", "application/json");
      if (body != null) {
        byte[] data = body.toString().getBytes(StandardCharsets.UTF_8);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setDoOutput(true);
        connection.setFixedLengthStreamingMode(data.length);
        try (java.io.OutputStream out = connection.getOutputStream()) {
          out.write(data);
        }
      }
      int status = connection.getResponseCode();
      InputStream stream =
          status >= 400 ? connection.getErrorStream() : connection.getInputStream();
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      if (stream != null)
        try (InputStream in = stream) {
          byte[] buffer = new byte[8192];
          int count;
          while ((count = in.read(buffer)) != -1) {
            if (out.size() + count > limit) throw new Failure(413, "服务器返回内容过大", "");
            out.write(buffer, 0, count);
          }
        }
      byte[] data = out.toByteArray();
      if (status < 200 || status >= 300) {
        JSONObject value;
        try {
          value = new JSONObject(new String(data, StandardCharsets.UTF_8));
        } catch (Exception error) {
          value = new JSONObject();
        }
        throw new Failure(
            status, value.optString("error", "连接失败（HTTP " + status + "）"), value.optString("code"));
      }
      return data;
    } finally {
      connections.remove(connection);
      connection.disconnect();
    }
  }

  @Override
  public void close() {
    closed = true;
    synchronized (connections) {
      for (HttpURLConnection connection : connections) connection.disconnect();
      connections.clear();
    }
  }
}
