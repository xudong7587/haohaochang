package home.haohaochang.tv;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Small isolated HTTP fixture, available under the Android unit-test boot classpath. */
final class LocalNas implements AutoCloseable {
  interface Handler {
    Reply request(String path, String headers, String body) throws Exception;
  }

  static final class Reply {
    final int status;
    final String body, headers;

    Reply(int status, String body) {
      this(status, body, "");
    }

    Reply(int status, String body, String headers) {
      this.status = status;
      this.body = body;
      this.headers = headers;
    }
  }

  private final ServerSocket server;
  private final ExecutorService workers = Executors.newCachedThreadPool();
  private volatile boolean closed;

  LocalNas(Handler handler) throws Exception {
    server = new ServerSocket(0, 20, InetAddress.getByName("127.0.0.1"));
    workers.execute(
        () -> {
          while (!closed)
            try {
              Socket socket = server.accept();
              workers.execute(() -> serve(socket, handler));
            } catch (Exception ignored) {
            }
        });
  }

  String origin() {
    return "http://127.0.0.1:" + server.getLocalPort();
  }

  private void serve(Socket socket, Handler handler) {
    try (Socket client = socket) {
      client.setSoTimeout(10000);
      InputStream in = client.getInputStream();
      ByteArrayOutputStream head = new ByteArrayOutputStream();
      int match = 0;
      byte[] end = {13, 10, 13, 10};
      while (head.size() < 32768) {
        int n = in.read();
        if (n < 0) return;
        head.write(n);
        match = n == end[match] ? match + 1 : n == 13 ? 1 : 0;
        if (match == 4) break;
      }
      String headers = new String(head.toByteArray(), StandardCharsets.UTF_8);
      int length = 0;
      for (String line : headers.split("\r\n"))
        if (line.toLowerCase().startsWith("content-length:"))
          length = Integer.parseInt(line.substring(15).trim());
      byte[] body = new byte[length];
      int count = 0;
      while (count < length) {
        int n = in.read(body, count, length - count);
        if (n < 0) return;
        count += n;
      }
      String path = headers.split(" ")[1];
      Reply response = handler.request(path, headers, new String(body, StandardCharsets.UTF_8));
      byte[] bytes = response.body.getBytes(StandardCharsets.UTF_8);
      client
          .getOutputStream()
          .write(
              ("HTTP/1.1 "
                      + response.status
                      + " Result\r\n"
                      + "Content-Type: application/json\r\n"
                      + "Connection: close\r\n"
                      + "Content-Length: "
                      + bytes.length
                      + "\r\n"
                      + response.headers
                      + "\r\n")
                  .getBytes(StandardCharsets.UTF_8));
      client.getOutputStream().write(bytes);
      client.getOutputStream().flush();
    } catch (Exception ignored) {
    }
  }

  @Override
  public void close() throws Exception {
    closed = true;
    server.close();
    workers.shutdownNow();
  }
}
