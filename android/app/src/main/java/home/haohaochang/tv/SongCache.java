package home.haohaochang.tv;

import android.content.Context;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.cache.CacheDataSource;
import androidx.media3.datasource.cache.CacheWriter;
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor;
import androidx.media3.datasource.cache.SimpleCache;
import java.io.File;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/** One song's disposable disk cache. Playback never waits for the prefetch. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
final class SongCache implements AutoCloseable {
  private static boolean initialized;
  private final SimpleCache cache;
  private final File directory;
  private final CacheDataSource.Factory factory;
  private final ExecutorService workers = Executors.newSingleThreadExecutor();
  private final ArrayList<CacheWriter> writers = new ArrayList<>();
  private final HashSet<String> urls = new HashSet<>();
  private boolean closed;

  SongCache(Context context, DataSource.Factory upstream) {
    synchronized (SongCache.class) {
      if (!initialized) { clearAbandoned(context); initialized = true; }
    }
    directory = new File(context.getCacheDir(), "playing-song-" + UUID.randomUUID());
    // Keep RAM bounded even for UHD. Leave half of free storage for the device.
    long budget = Math.min(4L * 1024 * 1024 * 1024, context.getCacheDir().getUsableSpace() / 2);
    if (budget < 64L * 1024 * 1024) throw new IllegalStateException("Low cache space");
    cache = new SimpleCache(directory, new LeastRecentlyUsedCacheEvictor(budget));
    factory = new CacheDataSource.Factory().setCache(cache).setUpstreamDataSourceFactory(upstream)
        .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR);
  }

  DataSource.Factory factory() { return factory; }

  long bytes() { return cache.getCacheSpace(); }

  void prefetch(String url) {
    if (closed || !urls.add(url)) return;
    CacheWriter writer = new CacheWriter(factory.createDataSourceForDownloading(),
        new DataSpec.Builder().setUri(url).build(), new byte[128 * 1024], null);
    writers.add(writer);
    workers.execute(() -> {
      try { writer.cache(); } catch (Exception ignored) {
        // Foreground playback can still stream or reuse the already cached spans.
      }
    });
  }

  @Override public void close() {
    if (closed) return;
    closed = true;
    for (CacheWriter writer : writers) writer.cancel();
    workers.shutdownNow();
    Thread cleanup = new Thread(() -> {
      try {
        // A blocked network read exits on its timeout; don't release the cache under it.
        while (!workers.awaitTermination(1, TimeUnit.SECONDS)) { }
        cache.release();
        remove(directory);
      } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
    }, "song-cache-cleanup");
    cleanup.setDaemon(true);
    cleanup.start();
  }

  static void clearAbandoned(Context context) {
    File[] folders = context.getCacheDir().listFiles((dir, name) -> name.startsWith("playing-song-"));
    if (folders != null) for (File folder : folders) remove(folder);
  }

  private static void remove(File file) {
    File[] children = file.listFiles();
    if (children != null) for (File child : children) remove(child);
    file.delete();
  }
}
