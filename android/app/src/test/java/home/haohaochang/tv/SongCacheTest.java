package home.haohaochang.tv;

import static org.junit.Assert.*;
import android.content.Context;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.DefaultHttpDataSource;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public class SongCacheTest {
  @Test public void wholeSongPlaysFromDiskWithoutNetworkAndIsRemovedOnClose() throws Exception {
    Context context = RuntimeEnvironment.getApplication();
    String content = "song-data-".repeat(10000);
    AtomicInteger requests = new AtomicInteger();
    SongCache cache = new SongCache(context, new DefaultHttpDataSource.Factory());
    try {
      String url;
      try (LocalNas nas = new LocalNas((path, headers, body) -> {
        requests.incrementAndGet();
        return new LocalNas.Reply(200, content);
      })) {
        url = nas.origin() + "/song";
        cache.prefetch(url);
        cache.prefetch(url);
        for (int i = 0; i < 200 && cache.bytes() < content.length(); i++) Thread.sleep(25);
        assertEquals(content.length(), cache.bytes());
        assertEquals(1, requests.get());
      }
      DataSource source = cache.factory().createDataSource();
      ByteArrayOutputStream bytes = new ByteArrayOutputStream();
      try {
        source.open(new DataSpec.Builder().setUri(url).build());
        byte[] buffer = new byte[4096]; int n;
        while ((n = source.read(buffer, 0, buffer.length)) != -1) bytes.write(buffer, 0, n);
      } finally { source.close(); }
      assertEquals(content, bytes.toString(StandardCharsets.UTF_8));
    } finally { cache.close(); }
    for (int i = 0; i < 200; i++) {
      File[] files = context.getCacheDir().listFiles((dir, name) -> name.startsWith("playing-song-"));
      if (files == null || files.length == 0) return;
      Thread.sleep(25);
    }
    fail("Completed song cache was not removed");
  }
}
