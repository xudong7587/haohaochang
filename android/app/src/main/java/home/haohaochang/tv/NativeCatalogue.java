package home.haohaochang.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.LruCache;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.GridView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.concurrent.ExecutorService;
import org.json.JSONArray;
import org.json.JSONObject;

/** Recycled native grid. Decode thumbnails off the UI thread with a bounded bitmap cache. */
final class NativeCatalogue extends LinearLayout implements AutoCloseable {
  private final Activity activity;
  private final RoomSession session;
  private final GridView grid;
  private final TextView heading, empty;
  private final EditText search;
  private final Cards adapter = new Cards();
  private final Handler main = new Handler(Looper.getMainLooper());
  private final ExecutorService images =
      new java.util.concurrent.ThreadPoolExecutor(
          2,
          2,
          0,
          java.util.concurrent.TimeUnit.SECONDS,
          new java.util.concurrent.ArrayBlockingQueue<>(32),
          new java.util.concurrent.ThreadPoolExecutor.DiscardOldestPolicy());
  private final LruCache<String, Bitmap> cache =
      new LruCache<String, Bitmap>(12 * 1024 * 1024) {
        protected int sizeOf(String key, Bitmap value) {
          return value.getAllocationByteCount();
        }
      };
  private JSONArray rows = new JSONArray();
  private String page = "songs", artist = "", tag = "", queueKey = "";
  private int generation, onlinePage = 1;
  private boolean closed;
  private final Button more;

  NativeCatalogue(Activity activity, RoomSession session) {
    super(activity);
    this.activity = activity;
    this.session = session;
    setOrientation(VERTICAL);
    setBackgroundColor(0xb315101e);
    setPadding(dp(22), dp(16), dp(22), dp(12));
    heading = TvStyle.text(activity, "歌名点歌", 24, TvStyle.INK);
    addView(heading, new LayoutParams(-1, dp(42)));
    LinearLayout query = new LinearLayout(activity);
    query.setGravity(Gravity.CENTER_VERTICAL);
    addView(query, new LayoutParams(-1, dp(46)));
    search = new EditText(activity);
    search.setSingleLine();
    search.setTextSize(16);
    search.setTextColor(TvStyle.INK);
    search.setHintTextColor(TvStyle.MUTED);
    search.setHint("歌名 / 歌手 / 拼音首字母");
    search.setBackground(TvStyle.shape(activity, TvStyle.SURFACE, 10));
    search.setPadding(dp(12), 0, dp(12), 0);
    search.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
    query.addView(search, new LayoutParams(0, -1, 1));
    Button find = TvStyle.button(activity, "搜索", "搜索", this::search);
    LayoutParams findParams = new LayoutParams(dp(72), -1);
    findParams.leftMargin = dp(10);
    query.addView(find, findParams);
    search.setOnEditorActionListener(
        (v, id, event) -> {
          if (id == EditorInfo.IME_ACTION_SEARCH) {
            search();
            return true;
          }
          return false;
        });
    grid = new GridView(activity);
    grid.setId(View.generateViewId());
    grid.setNumColumns(GridView.AUTO_FIT);
    grid.setColumnWidth(dp(132));
    grid.setStretchMode(GridView.STRETCH_COLUMN_WIDTH);
    grid.setHorizontalSpacing(dp(12));
    grid.setVerticalSpacing(dp(12));
    grid.setClipToPadding(false);
    grid.setPadding(dp(3), dp(14), dp(3), dp(5));
    grid.setSelector(TvStyle.focus(activity));
    grid.setAdapter(adapter);
    grid.setOnItemClickListener(
        (parent, view, position, id) -> select(rows.optJSONObject(position)));
    addView(grid, new LayoutParams(-1, 0, 1));
    empty = TvStyle.text(activity, "正在读取…", 16, TvStyle.MUTED);
    empty.setGravity(Gravity.CENTER);
    addView(empty, new LayoutParams(-1, dp(28)));
    grid.setEmptyView(empty);
    more =
        TvStyle.button(
            activity,
            "下一页",
            "下一页",
            () -> {
              onlinePage = Math.min(20, onlinePage + 1);
              load();
            });
    addView(more, new LayoutParams(-1, dp(38)));
    more.setVisibility(GONE);
  }

  private int dp(float n) {
    return TvStyle.dp(activity, n);
  }

  void show(String page) {
    this.page = page;
    artist = "";
    tag = "";
    search.setText("");
    onlinePage = 1;
    load();
  }

  boolean back() {
    if (!artist.isEmpty() || !tag.isEmpty()) {
      show(!artist.isEmpty() ? "artists" : "playlists");
      grid.requestFocus();
      return true;
    }
    return false;
  }

  void focusGrid() {
    if (rows.length() > 0) grid.requestFocus();
    else search.requestFocus();
  }

  private void search() {
    onlinePage = 1;
    load();
    android.view.inputmethod.InputMethodManager keyboard =
        (android.view.inputmethod.InputMethodManager)
            activity.getSystemService(Activity.INPUT_METHOD_SERVICE);
    if (keyboard != null) keyboard.hideSoftInputFromWindow(search.getWindowToken(), 0);
  }

  private void load() {
    int request = ++generation;
    queueKey = "";
    more.setVisibility(GONE);
    rows = new JSONArray();
    adapter.notifyDataSetChanged();
    empty.setText("正在读取…");
    heading.setText(
        !artist.isEmpty()
            ? artist
            : !tag.isEmpty()
                ? tag + "歌单"
                : page.equals("artists")
                    ? "歌星点歌"
                    : page.equals("playlists")
                        ? "分类歌单"
                        : page.equals("queue") ? "已点歌曲" : page.equals("online") ? "在线找歌" : "歌名点歌");
    search.setHint(page.equals("online") ? "输入歌名，搜索在线资源" : "歌名 / 歌手 / 拼音首字母");
    if (page.equals("queue")) {
      session.read(
          "/api/state",
          value -> {
            if (request == generation) queue((JSONObject) value);
          });
      return;
    }
    if (page.equals("playlists") && tag.isEmpty()) {
      JSONArray tags = new JSONArray();
      for (String text :
          new String[] {
            "男声", "女声", "组合", "合唱", "大陆", "港台", "欧美", "日韩", "国语", "粤语", "英语", "日语", "韩语", "流行",
            "摇滚", "怀旧", "现场", "MV", "伴奏"
          }) tags.put(RoomApi.object("tag", text, "title", text));
      setRows(tags);
      return;
    }
    if (page.equals("online") && search.getText().toString().trim().isEmpty()) {
      setRows(new JSONArray());
      empty.setText("输入歌名搜索；选择结果后可加入下载与点歌任务。");
      return;
    }
    String path =
        page.equals("artists") && artist.isEmpty()
            ? "/api/artists"
            : page.equals("online")
                ? "/api/online/songs?title="
                    + RoomApi.encode(search.getText().toString())
                    + "&page="
                    + onlinePage
                : "/api/songs?q="
                    + RoomApi.encode(search.getText().toString())
                    + "&artist="
                    + RoomApi.encode(artist)
                    + "&tag="
                    + RoomApi.encode(tag);
    session.read(
        path,
        value -> {
          if (request != generation) return;
          JSONArray result =
              value instanceof JSONArray
                  ? (JSONArray) value
                  : ((JSONObject) value).optJSONArray("items");
          if (result == null && value instanceof JSONObject)
            result = ((JSONObject) value).optJSONArray("results");
          if (result == null) result = new JSONArray();
          if (page.equals("artists")
              && artist.isEmpty()
              && !search.getText().toString().isEmpty()) {
            JSONArray filtered = new JSONArray();
            String q = search.getText().toString().toLowerCase(java.util.Locale.ROOT);
            for (int i = 0; i < result.length(); i++)
              if (result
                  .optJSONObject(i)
                  .optString("artist")
                  .toLowerCase(java.util.Locale.ROOT)
                  .contains(q)) filtered.put(result.optJSONObject(i));
            result = filtered;
          }
          setRows(result);
          more.setVisibility(
              page.equals("online")
                      && onlinePage < 20
                      && value instanceof JSONObject
                      && ((JSONObject) value).optBoolean("hasMore")
                  ? VISIBLE
                  : GONE);
        });
  }

  void queue(JSONObject state) {
    if (!page.equals("queue")) return;
    JSONArray queue = state.optJSONArray("queue");
    if (queue == null) queue = new JSONArray();
    String key = queue.toString();
    if (!key.equals(queueKey)) {
      queueKey = key;
      setRows(queue);
    }
  }

  private void setRows(JSONArray value) {
    rows = value;
    adapter.notifyDataSetChanged();
    empty.setText(rows.length() == 0 ? "暂无歌曲，可在 NAS 管理端导入或整理。" : "");
  }

  private void select(JSONObject row) {
    if (row == null) return;
    if (row.has("tag")) {
      tag = row.optString("tag");
      load();
      return;
    }
    if (page.equals("artists") && artist.isEmpty()) {
      artist = row.optString("artist");
      load();
      return;
    }
    if (page.equals("queue")) {
      if (rows.optJSONObject(0) == row) {
        new AlertDialog.Builder(activity)
            .setTitle(row.optString("title"))
            .setItems(
                new String[] {"切歌"},
                (d, w) ->
                    session.command(
                        "/api/control",
                        "POST",
                        RoomApi.object("action", "next", "entryId", row.optString("id")),
                        null))
            .setNegativeButton("取消", null)
            .show();
        return;
      }
      new AlertDialog.Builder(activity)
          .setTitle(row.optString("title"))
          .setItems(
              new String[] {"下一首唱", "移出队列"},
              (d, w) ->
                  session.command(
                      "/api/queue/" + RoomApi.encode(row.optString("id")) + (w == 0 ? "/top" : ""),
                      w == 0 ? "POST" : "DELETE",
                      w == 0 ? new JSONObject() : null,
                      null))
          .setNegativeButton("取消", null)
          .show();
      return;
    }
    if (page.equals("online")) {
      online(row);
      return;
    }
    session.command(
        "/api/queue",
        "POST",
        RoomApi.object("songId", row.optString("id"), "name", "电视点歌"),
        value -> {
          boolean preparing = ((JSONObject) value).optBoolean("preparing");
          android.widget.Toast.makeText(
                  activity,
                  preparing ? "正在准备，完成后自动加入队列" : "已加入点歌队列",
                  android.widget.Toast.LENGTH_SHORT)
              .show();
        });
  }

  private void online(JSONObject row) {
    LinearLayout form = new LinearLayout(activity);
    form.setOrientation(VERTICAL);
    form.setPadding(dp(20), dp(12), dp(20), 0);
    EditText title = new EditText(activity);
    title.setSingleLine();
    title.setHint("歌名");
    title.setText(search.getText());
    form.addView(title);
    EditText singer = new EditText(activity);
    singer.setSingleLine();
    singer.setHint("歌手（必填）");
    form.addView(singer);
    AlertDialog dialog =
        new AlertDialog.Builder(activity)
            .setTitle("准备在线歌曲")
            .setMessage(row.optString("title"))
            .setView(form)
            .setNegativeButton("取消", null)
            .setPositiveButton("准备并点歌", null)
            .create();
    dialog.setOnShowListener(
        d ->
            dialog
                .getButton(AlertDialog.BUTTON_POSITIVE)
                .setOnClickListener(
                    v -> {
                      if (title.getText().toString().trim().isEmpty()) {
                        title.setError("请填写歌名");
                        return;
                      }
                      if (singer.getText().toString().trim().isEmpty()) {
                        singer.setError("请填写歌手");
                        return;
                      }
                      session.command(
                          "/api/online",
                          "POST",
                          RoomApi.object(
                              "url",
                              row.optString("url"),
                              "title",
                              title.getText().toString().trim(),
                              "artist",
                              singer.getText().toString().trim(),
                              "name",
                              "电视点歌",
                              "enqueue",
                              true,
                              "onlineSelection",
                              true,
                              "client",
                              "mobile"),
                          value ->
                              android.widget.Toast.makeText(
                                      activity, "已提交准备任务", android.widget.Toast.LENGTH_SHORT)
                                  .show());
                      dialog.dismiss();
                    }));
    dialog.show();
  }

  private final class Cards extends BaseAdapter {
    public int getCount() {
      return rows.length();
    }

    public Object getItem(int position) {
      return rows.optJSONObject(position);
    }

    public long getItemId(int position) {
      return position;
    }

    public View getView(int position, View convert, ViewGroup parent) {
      LinearLayout card;
      ImageView image;
      TextView title, detail;
      if (convert == null) {
        card = new LinearLayout(activity);
        card.setOrientation(VERTICAL);
        card.setPadding(dp(6), dp(6), dp(6), dp(8));
        card.setBackground(TvStyle.focus(activity));
        image = new ImageView(activity);
        image.setScaleType(ImageView.ScaleType.CENTER_CROP);
        image.setBackgroundColor(0xff40314f);
        card.addView(image, new LayoutParams(-1, dp(114)));
        title = TvStyle.text(activity, "", 15, TvStyle.INK);
        title.setMaxLines(1);
        title.setEllipsize(TextUtils.TruncateAt.END);
        title.setPadding(dp(5), dp(8), dp(5), 0);
        card.addView(title, new LayoutParams(-1, dp(32)));
        detail = TvStyle.text(activity, "", 12, TvStyle.MUTED);
        detail.setSingleLine();
        detail.setEllipsize(TextUtils.TruncateAt.END);
        detail.setPadding(dp(5), 0, dp(5), 0);
        card.addView(detail, new LayoutParams(-1, dp(24)));
        card.setTag(new Object[] {image, title, detail});
        title.setDuplicateParentStateEnabled(true);
        detail.setDuplicateParentStateEnabled(true);
        title.setTextColor(TvStyle.ink());
        detail.setTextColor(TvStyle.ink());
      } else {
        card = (LinearLayout) convert;
        Object[] views = (Object[]) card.getTag();
        image = (ImageView) views[0];
        title = (TextView) views[1];
        detail = (TextView) views[2];
      }
      JSONObject row = rows.optJSONObject(position);
      boolean artistCard = page.equals("artists") && artist.isEmpty();
      title.setText(artistCard ? row.optString("artist") : row.optString("title"));
      detail.setText(
          artistCard
              ? row.optInt("count") + " 首歌曲"
              : row.has("tag")
                  ? "按此分类点歌"
                  : page.equals("queue")
                      ? (position == 0 ? "正在播放 · " : "待唱 · ") + row.optString("artist")
                      : row.optString("artist", row.optString("author", "")));
      card.setContentDescription(title.getText() + "，" + detail.getText());
      String path =
          artistCard && row.optBoolean("hasPhoto")
              ? "/api/artist-photo/"
                  + RoomApi.encode(row.optString("id"))
                  + "?v="
                  + RoomApi.encode(row.optString("photoVersion"))
              : row.optInt("hasPoster") > 0
                  ? "/api/poster/"
                      + RoomApi.encode(row.optString("song_id", row.optString("id")))
                      + "?v="
                      + RoomApi.encode(row.optString("posterVersion"))
                  : "";
      image.setTag(path);
      image.setImageDrawable(null);
      if (!path.isEmpty()) {
        Bitmap found = cache.get(path);
        if (found != null) image.setImageBitmap(found);
        else {
          final ImageView target = image;
          images.execute(
              () -> {
                try {
                  byte[] data = session.api.bytes(path, "GET", null, 8 * 1024 * 1024);
                  BitmapFactory.Options options = new BitmapFactory.Options();
                  options.inJustDecodeBounds = true;
                  BitmapFactory.decodeByteArray(data, 0, data.length, options);
                  options.inJustDecodeBounds = false;
                  options.inSampleSize = 1;
                  while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 512)
                    options.inSampleSize *= 2;
                  Bitmap bitmap = BitmapFactory.decodeByteArray(data, 0, data.length, options);
                  if (bitmap != null) {
                    cache.put(path, bitmap);
                    main.post(
                        () -> {
                          if (!closed && path.equals(target.getTag()))
                            target.setImageBitmap(bitmap);
                        });
                  }
                } catch (Exception ignored) {
                }
              });
        }
      }
      return card;
    }
  }

  @Override
  public void close() {
    closed = true;
    generation++;
    images.shutdownNow();
    main.removeCallbacksAndMessages(null);
    cache.evictAll();
  }
}
