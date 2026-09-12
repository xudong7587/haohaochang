package home.haohaochang.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.LruCache;
import android.view.Gravity;
import android.view.KeyEvent;
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
  private final TextView heading, empty, description;
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
  private final Button find;
  private final LinearLayout query;
  private int selectedPosition;
  private final LinearLayout initialsPanel;
  private final TextView initialLabel;
  private final java.util.List<Button> initialButtons = new java.util.ArrayList<>();
  private String initialQuery = "";

  NativeCatalogue(Activity activity, RoomSession session) {
    super(activity);
    this.activity = activity;
    this.session = session;
    setOrientation(VERTICAL);
    setBackgroundColor(TvStyle.BACKGROUND);
    setPadding(dp(24), dp(16), dp(20), dp(12));
    TextView breadcrumb = TvStyle.text(activity, "我的客厅    /    家庭 KTV", 9, TvStyle.MUTED);
    addView(breadcrumb, new LayoutParams(-1, dp(24)));
    heading = TvStyle.text(activity, "今晚，唱点开心的。", 26, TvStyle.INK);
    heading.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
    addView(heading, new LayoutParams(-1, dp(42)));
    description = TvStyle.text(activity, "一首熟悉的旋律，一屋子喜欢的人。", 12, TvStyle.MUTED);
    addView(description, new LayoutParams(-1, dp(28)));
    query = new LinearLayout(activity);
    query.setGravity(Gravity.CENTER_VERTICAL);
    addView(query, new LayoutParams(-1, dp(46)));
    search = new EditText(activity);
    search.setSingleLine();
    search.setTextSize(16);
    search.setTextColor(TvStyle.INK);
    search.setHintTextColor(TvStyle.MUTED);
    search.setHint("歌名 / 歌手 / 拼音首字母");
    search.setBackground(TvStyle.focus(activity));
    search.setContentDescription("搜索歌名或歌手");
    search.setPadding(dp(12), 0, dp(12), 0);
    search.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
    query.addView(search, new LayoutParams(0, -1, 1));
    find = TvStyle.button(activity, "搜索", "搜索", this::search);
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
    grid.setFocusable(true);
    grid.setFocusableInTouchMode(true);
    grid.setContentDescription("歌曲卡片");
    grid.setNumColumns(GridView.AUTO_FIT);
    grid.setColumnWidth(dp(132));
    grid.setStretchMode(GridView.STRETCH_COLUMN_WIDTH);
    grid.setHorizontalSpacing(dp(12));
    grid.setVerticalSpacing(dp(12));
    grid.setClipToPadding(false);
    grid.setPadding(dp(3), dp(14), dp(3), dp(5));
    grid.setSelector(android.R.color.transparent);
    grid.setAdapter(adapter);
    grid.setOnFocusChangeListener((view, focused) -> highlightCards());
    grid.setOnItemClickListener(
        (parent, view, position, id) -> {
          selectedPosition = position;
          select(rows.optJSONObject(position));
        });
    grid.setOnItemLongClickListener(
        (parent, view, position, id) -> {
          selectedPosition = position;
          return deleteSelection();
        });
    LinearLayout results = new LinearLayout(activity);
    addView(results, new LayoutParams(-1, 0, 1));
    initialsPanel = new LinearLayout(activity);
    initialsPanel.setOrientation(VERTICAL);
    initialsPanel.setPadding(0, dp(14), dp(14), 0);
    results.addView(initialsPanel, new LayoutParams(dp(150), -1));
    initialLabel = TvStyle.text(activity, "拼音首字母", 12, TvStyle.MUTED);
    initialLabel.setSingleLine();
    initialsPanel.addView(initialLabel, new LayoutParams(-1, dp(28)));
    for (int row = 0; row < 7; row++) {
      LinearLayout line = new LinearLayout(activity);
      initialsPanel.addView(line, new LayoutParams(-1, dp(30)));
      for (int col = 0; col < 4; col++) {
        int index = row * 4 + col;
        String text = index < 26 ? String.valueOf((char) ('A' + index)) : index == 26 ? "←" : "清";
        Button button =
            TvStyle.button(
                activity,
                text,
                index < 26 ? "首字母 " + text : index == 26 ? "退格" : "清空",
                () -> {
                  initialQuery =
                      index < 26
                          ? (initialQuery + text)
                              .substring(0, Math.min(24, initialQuery.length() + 1))
                          : index == 26
                              ? initialQuery.substring(0, Math.max(0, initialQuery.length() - 1))
                              : "";
                  search.setText("");
                  load();
                });
        button.setTextSize(12);
        button.setPadding(0, 0, 0, 0);
        initialButtons.add(button);
        line.addView(button, new LayoutParams(0, -1, 1));
      }
    }
    results.addView(grid, new LayoutParams(0, -1, 1));
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
    initialQuery = "";
    search.setText("");
    onlinePage = 1;
    load();
  }

  boolean back() {
    if (!artist.isEmpty() || !tag.isEmpty()) {
      show(!artist.isEmpty() ? "artists" : "playlists");
      grid.requestFocusFromTouch();
      return true;
    }
    return false;
  }

  void focusGrid() {
    if (rows.length() > 0) focusCard(selectedPosition);
    else search.requestFocusFromTouch();
  }

  private void focusCard(int position) {
    selectedPosition = Math.max(0, Math.min(rows.length() - 1, position));
    grid.requestFocusFromTouch();
    grid.setSelection(selectedPosition);
    highlightCards();
  }

  private void highlightCards() {
    for (int i = 0; i < grid.getChildCount(); i++)
      grid.getChildAt(i)
          .setActivated(grid.hasFocus() && grid.getFirstVisiblePosition() + i == selectedPosition);
  }

  boolean activate(View target) {
    if (target != grid) return false;
    select(rows.optJSONObject(selectedPosition));
    return true;
  }

  /** GridView scrolling and selection are explicit even when the TV starts in touch mode. */
  boolean move(int key) {
    if (initialsPanel.hasFocus()) {
      int index = initialButtons.indexOf(findFocus());
      if (key == KeyEvent.KEYCODE_DPAD_LEFT && index % 4 == 0) return false;
      if (key == KeyEvent.KEYCODE_DPAD_RIGHT && index % 4 == 3) {
        focusGrid();
        return true;
      }
      if (key == KeyEvent.KEYCODE_DPAD_UP && index < 4) {
        search.requestFocusFromTouch();
        return true;
      }
      int next =
          index
              + (key == KeyEvent.KEYCODE_DPAD_LEFT
                  ? -1
                  : key == KeyEvent.KEYCODE_DPAD_RIGHT
                      ? 1
                      : key == KeyEvent.KEYCODE_DPAD_UP ? -4 : 4);
      if (next >= initialButtons.size()) return false;
      if (next >= 0) initialButtons.get(next).requestFocusFromTouch();
      return true;
    }
    if (grid.hasFocus()) {
      int position = selectedPosition;
      int columns = Math.max(1, grid.getNumColumns());
      if (key == KeyEvent.KEYCODE_DPAD_LEFT) {
        if (position % columns == 0) {
          if (initialsPanel.isShown()) {
            initialButtons.get(3).requestFocusFromTouch();
            return true;
          }
          return false;
        }
        focusCard(position - 1);
      } else if (key == KeyEvent.KEYCODE_DPAD_RIGHT) {
        if (position % columns < columns - 1 && position + 1 < rows.length())
          focusCard(position + 1);
      } else if (key == KeyEvent.KEYCODE_DPAD_UP) {
        if (position < columns) search.requestFocusFromTouch();
        else focusCard(position - columns);
      } else if (key == KeyEvent.KEYCODE_DPAD_DOWN) {
        if (position + columns >= rows.length()) {
          if (more.isShown()) more.requestFocusFromTouch();
          else return false;
        } else focusCard(position + columns);
      }
      return true;
    }
    if (key == KeyEvent.KEYCODE_DPAD_DOWN) {
      if (rows.length() == 0 || more.hasFocus()) return false;
      focusCard(0);
    } else if (key == KeyEvent.KEYCODE_DPAD_UP && more.hasFocus()) focusCard(rows.length() - 1);
    else if (key == KeyEvent.KEYCODE_DPAD_LEFT) {
      if (find.hasFocus()) search.requestFocusFromTouch();
      else return false;
    } else if (key == KeyEvent.KEYCODE_DPAD_RIGHT && search.hasFocus())
      find.requestFocusFromTouch();
    return true;
  }

  private void search() {
    initialQuery = "";
    onlinePage = 1;
    load();
    android.view.inputmethod.InputMethodManager keyboard =
        (android.view.inputmethod.InputMethodManager)
            activity.getSystemService(Activity.INPUT_METHOD_SERVICE);
    if (keyboard != null) keyboard.hideSoftInputFromWindow(search.getWindowToken(), 0);
  }

  private void load() {
    initialsPanel.setVisibility(page.equals("songs") || page.equals("artists") ? VISIBLE : GONE);
    query.setVisibility(page.equals("queue") ? GONE : VISIBLE);
    initialLabel.setText(initialQuery.isEmpty() ? "拼音首字母" : initialQuery);
    int request = ++generation;
    selectedPosition = 0;
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
                        : page.equals("queue")
                            ? "已点歌曲"
                            : page.equals("online") ? "在线找歌" : "今晚，唱点开心的。");
    description.setText(
        page.equals("artists")
            ? "从喜欢的歌手，找到想唱的那一首。"
            : page.equals("queue")
                ? "今晚的歌单，按你的顺序唱。"
                : page.equals("online")
                    ? "找一首喜欢的歌，交给歌房准备。"
                    : page.equals("playlists") ? "换一种心情，发现下一首。" : "一首熟悉的旋律，一屋子喜欢的人。");
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
            ? "/api/artists?q="
                + RoomApi.encode(search.getText().toString())
                + "&initials="
                + RoomApi.encode(initialQuery)
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
                    + RoomApi.encode(tag)
                    + "&initials="
                    + RoomApi.encode(initialQuery);
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
    boolean focused = grid.hasFocus();
    rows = value;
    adapter.notifyDataSetChanged();
    if (focused && rows.length() > 0) focusCard(selectedPosition);
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
      initialQuery = "";
      search.setText("");
      load();
      return;
    }
    if (page.equals("queue")) {
      session.command(
          "/api/queue/" + RoomApi.encode(row.optString("id")) + "/first",
          "POST",
          new JSONObject(),
          null);
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

  boolean longActivate(View target) {
    return target == grid && deleteSelection();
  }

  private boolean deleteSelection() {
    if (!page.equals("queue")) return false;
    JSONObject row = rows.optJSONObject(selectedPosition);
    if (row == null) return false;
    String id = row.optString("id");
    boolean current = selectedPosition == 0;
    new AlertDialog.Builder(activity)
        .setTitle(row.optString("title"))
        .setItems(
            new String[] {current ? "删除并切歌" : "删除歌曲"},
            (dialog, which) -> {
              if (current)
                session.command(
                    "/api/control", "POST", RoomApi.object("action", "next", "entryId", id), null);
              else session.command("/api/queue/" + RoomApi.encode(id), "DELETE", null, null);
            })
        .setNegativeButton("取消", null)
        .show();
    return true;
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
      TextView title, detail, action;
      if (convert == null) {
        card = new LinearLayout(activity);
        card.setOrientation(VERTICAL);
        card.setPadding(dp(5), dp(5), dp(5), dp(7));
        card.setBackground(TvStyle.focus(activity));
        image = new ImageView(activity);
        image.setScaleType(ImageView.ScaleType.CENTER_CROP);
        image.setClipToOutline(true);
        card.addView(image, new LayoutParams(-1, dp(102)));
        title = TvStyle.text(activity, "", 13, TvStyle.INK);
        title.setMaxLines(1);
        title.setEllipsize(TextUtils.TruncateAt.END);
        title.setPadding(dp(5), dp(8), dp(5), 0);
        card.addView(title, new LayoutParams(-1, dp(30)));
        detail = TvStyle.text(activity, "", 10, TvStyle.MUTED);
        detail.setSingleLine();
        detail.setEllipsize(TextUtils.TruncateAt.END);
        detail.setPadding(dp(5), 0, dp(5), 0);
        card.addView(detail, new LayoutParams(-1, dp(22)));
        action = TvStyle.text(activity, "＋ 点歌", 10, TvStyle.ACCENT);
        action.setGravity(Gravity.RIGHT | Gravity.CENTER_VERTICAL);
        action.setPadding(dp(5), 0, dp(6), 0);
        card.addView(action, new LayoutParams(-1, dp(22)));
        card.setTag(new Object[] {image, title, detail, action});
        title.setDuplicateParentStateEnabled(true);
        detail.setDuplicateParentStateEnabled(true);
        action.setDuplicateParentStateEnabled(true);
        title.setTextColor(TvStyle.ink());
        detail.setTextColor(TvStyle.ink());
        action.setTextColor(TvStyle.ink());
      } else {
        card = (LinearLayout) convert;
        Object[] views = (Object[]) card.getTag();
        image = (ImageView) views[0];
        title = (TextView) views[1];
        detail = (TextView) views[2];
        action = (TextView) views[3];
      }
      JSONObject row = rows.optJSONObject(position);
      card.setActivated(grid.hasFocus() && position == selectedPosition);
      boolean artistCard = page.equals("artists") && artist.isEmpty();
      action.setText(
          artistCard
              ? "查看歌曲  ›"
              : row.has("tag") ? "打开歌单  ›" : page.equals("queue") ? "点击优先" : "＋ 点歌");
      LayoutParams imageParams =
          new LayoutParams(artistCard ? dp(84) : -1, artistCard ? dp(84) : dp(102));
      imageParams.gravity = Gravity.CENTER_HORIZONTAL;
      imageParams.topMargin = artistCard ? dp(9) : 0;
      imageParams.bottomMargin = artistCard ? dp(9) : 0;
      image.setLayoutParams(imageParams);
      GradientDrawable cover =
          new GradientDrawable(
              GradientDrawable.Orientation.TL_BR, new int[] {0xff44345d, 0xff241e31});
      cover.setCornerRadius(dp(artistCard ? 48 : 8));
      image.setBackground(cover);
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
      image.setImageDrawable(
          new TvIcon(
              activity, artistCard ? "users" : "record", ColorStateList.valueOf(0xffac9cbe), 38));
      image.setScaleType(ImageView.ScaleType.CENTER);
      if (!path.isEmpty()) {
        Bitmap found = cache.get(path);
        if (found != null) {
          image.setScaleType(ImageView.ScaleType.CENTER_CROP);
          image.setImageBitmap(found);
        } else {
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
                          if (!closed && path.equals(target.getTag())) {
                            target.setScaleType(ImageView.ScaleType.CENTER_CROP);
                            target.setImageBitmap(bitmap);
                          }
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
