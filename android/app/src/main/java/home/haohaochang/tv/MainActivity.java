package home.haohaochang.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Native media playback with a shared NAS-backed WebView song catalogue. */
public final class MainActivity extends Activity {
    private WebView web;
    private NativePlayback nativePlayback;
    private FrameLayout root;
    private View overlay,fullVideo;
    private WebChromeClient.CustomViewCallback fullCallback;
    private SharedPreferences preferences;
    private String server="";
    private long exitPressedAt;
    private boolean backPending,loading,destroyed,television;
    private int generation;
    private AppUpdater updater;
    private LanDiscovery discovery;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final ExecutorService executor=Executors.newSingleThreadExecutor();

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);updater=new AppUpdater(this);
        television=(getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_TYPE_MASK)==android.content.res.Configuration.UI_MODE_TYPE_TELEVISION || !getPackageManager().hasSystemFeature("android.hardware.touchscreen");
        if(television)setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        if(Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,this::handleBack);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        preferences=getSharedPreferences("connection",MODE_PRIVATE);root=new FrameLayout(this);root.setBackgroundColor(Color.rgb(16,14,25));setContentView(root);createWeb();
        server=preferences.getString("server","");if(server.isEmpty())discover();else connect(server);
    }
    private void createWeb() {
        web=new WebView(this);web.setBackgroundColor(Color.TRANSPARENT);web.setFocusable(true);web.setFocusableInTouchMode(true);root.addView(web,0,new FrameLayout.LayoutParams(-1,-1));
        web.getSettings().setJavaScriptEnabled(true);web.getSettings().setDomStorageEnabled(true);web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);web.getSettings().setLoadWithOverviewMode(true);web.getSettings().setUseWideViewPort(true);
        web.getSettings().setUserAgentString(web.getSettings().getUserAgentString()+" HaohaochangTV/"+BuildConfig.VERSION_NAME);
        nativePlayback = new NativePlayback(this, root, web);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return navigate(request.getUrl().toString(),request.isForMainFrame());}
            @Override public boolean shouldOverrideUrlLoading(WebView view,String url){return navigate(url,true);}
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon) {
                nativePlayback.navigating(url,server);
                if(!ConnectionPolicy.sameOrigin(url,server))return;
                loading=true;int current=++generation;showLoading();
                handler.postDelayed(()->{if(current==generation&&loading)failed("页面加载时间较长","请确认 NAS 已启动、地址正确。也可以重新寻找家庭歌房。");},25000);
            }
            @Override public void onPageFinished(WebView view,String url){nativePlayback.installBridge();if(loading)checkReady(generation);}
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame()&&loading)failed("暂时连不上歌房","请检查电视网络与 NAS 地址，然后重新连接。");}
            @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse response){if(request.isForMainFrame()&&loading)failed("服务器暂时无法打开页面","服务器返回 HTTP "+response.getStatusCode()+"。请检查 NAS 服务后重试。");}
            @Override public void onReceivedSslError(WebView view,android.webkit.SslErrorHandler callback,android.net.http.SslError error){callback.cancel();if(loading)failed("服务器证书无法验证","请检查 HTTPS 域名与证书，或使用家庭网络中的 NAS 地址。");}
            @Override public boolean onRenderProcessGone(WebView view,android.webkit.RenderProcessGoneDetail detail){nativePlayback.destroy();root.removeView(view);view.destroy();createWeb();failed("电视播放页面已停止","可以重新连接。若重复出现，请更新电视系统的 Android System WebView。");return true;}
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onShowCustomView(View view,CustomViewCallback callback){if(fullVideo!=null){callback.onCustomViewHidden();return;}fullVideo=view;fullCallback=callback;root.addView(view,new FrameLayout.LayoutParams(-1,-1));web.setVisibility(View.GONE);view.setFocusableInTouchMode(true);view.requestFocus();}
            @Override public void onHideCustomView(){exitFull();}
        });
    }
    private boolean navigate(String url,boolean mainFrame){if(mainFrame&&"haohaochang://connection".equals(url)&&ConnectionPolicy.sameOrigin(web.getUrl(),server)){settings();return true;}return !ConnectionPolicy.sameOrigin(url,server);}
    private void checkReady(int current) {
        if(!loading||current!=generation||destroyed)return;
        web.evaluateJavascript("(function(){var b=window.haohaochangBoot;return b&&b.failed?'failed':b&&b.loaded?'ready':document.querySelector('#root .app,#root .login')?'ready':'waiting';})()",value->{
            if(current!=generation||!loading||destroyed)return;
            if("\"failed\"".equals(value)){failed("播放页面未能启动","请重新加载。若仍失败，请更新电视系统的 Android System WebView。");return;}
            if("\"ready\"".equals(value)){loading=false;preferences.edit().putString("server",server).apply();hideOverlay();web.requestFocus();return;}
            handler.postDelayed(()->checkReady(current),500);
        });
    }
    private void connect(String address) {
        cancelDiscovery();exitFull();try{server=ConnectionPolicy.normalize(address);}catch(IllegalArgumentException error){settings();return;}
        android.view.inputmethod.InputMethodManager keyboard=(android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE);if(keyboard!=null)keyboard.hideSoftInputFromWindow(root.getWindowToken(),0);
        ++generation;loading=true;showLoading();web.loadUrl(server+(television?"/tv":"/play"));
    }
    private void showLoading(){ConnectionScreen screen=screen("正在打开你的歌房","连接后显示二维码，手机确认即可开唱。");screen.loading(server);showOverlay(screen);}
    private void cancelDiscovery(){if(discovery!=null){discovery.cancel();discovery=null;}}
    private void stopLoading(){++generation;loading=false;web.stopLoading();}
    private void discover() {
        cancelDiscovery();stopLoading();exitFull();final int current=generation;
        ConnectionScreen screen=screen("寻找家庭歌房","正在寻找同一网络中的好好唱服务器，大约需要 8 秒。");screen.searching(preferences.getString("server",""));showOverlay(screen);
        LanDiscovery search=new LanDiscovery();discovery=search;
        executor.execute(()->{
            List<LanDiscovery.Server> found=search.search();handler.post(()->{
                if(destroyed||current!=generation||discovery!=search)return;discovery=null;
                if(found.size()==1){connect(found.get(0).address);return;}
                if(found.isEmpty()){ConnectionScreen manual=screen("还没有找到歌房","确认电视与 NAS 在同一网络，并已启用 LAN 自动发现。也可以直接输入服务器地址。");manual.manual(server,!preferences.getString("server","").isEmpty());showOverlay(manual);}
                else{ConnectionScreen choices=screen("找到 "+found.size()+" 个家庭歌房","请选择这台电视要连接的服务器。");choices.servers(found);showOverlay(choices);}
            });
        });
    }
    private ConnectionScreen screen(String title,String message) {
        return new ConnectionScreen(this,new ConnectionScreen.Actions(){
            public void scan(){discover();}public void manual(){settings();}public void connect(String address){MainActivity.this.connect(address);}
            public void cancel(){String old=preferences.getString("server","");if(!old.isEmpty())MainActivity.this.connect(old);}
        },title,message);
    }
    private void settings(){cancelDiscovery();stopLoading();exitFull();ConnectionScreen screen=screen("连接你的家庭歌房","填入 NAS 地址或 HTTPS 域名。成功连接后会自动记住，下次打开即可进入。");screen.manual(server,!preferences.getString("server","").isEmpty());showOverlay(screen);}
    private void failed(String title,String message){stopLoading();ConnectionScreen screen=screen(title,message);screen.failure(server,webVersion());showOverlay(screen);}
    private String webVersion(){String agent=web.getSettings().getUserAgentString();java.util.regex.Matcher match=java.util.regex.Pattern.compile("Chrome/([0-9.]+)").matcher(agent);return "Android "+Build.VERSION.RELEASE+(match.find()?" · WebView "+match.group(1):"");}
    private void showOverlay(View view){nativePlayback.foreground(false);if(overlay!=null)root.removeView(overlay);overlay=view;web.setVisibility(View.INVISIBLE);root.addView(view,new FrameLayout.LayoutParams(-1,-1));}
    private void hideOverlay(){nativePlayback.foreground(true);if(overlay!=null){root.removeView(overlay);overlay=null;}web.setVisibility(View.VISIBLE);}
    private void exitFull(){if(fullVideo!=null){root.removeView(fullVideo);fullVideo=null;web.setVisibility(View.VISIBLE);web.requestFocus();if(fullCallback!=null){fullCallback.onCustomViewHidden();fullCallback=null;}}}
    private void reloadInterface(){if(server.isEmpty()){settings();return;}cancelDiscovery();exitFull();web.clearCache(true);web.loadUrl(server+(television?"/tv":"/play")+"?refresh="+System.currentTimeMillis(),java.util.Collections.singletonMap("Cache-Control","no-cache"));}
    @Override public boolean dispatchKeyEvent(KeyEvent event){if(event.getAction()==KeyEvent.ACTION_DOWN&&event.getKeyCode()==KeyEvent.KEYCODE_MENU){new AlertDialog.Builder(this).setTitle("好好唱设置").setItems(new String[]{"热更新网页","连接设置","重新自动发现","检查应用更新"},(d,w)->{if(w==0)reloadInterface();else if(w==1)settings();else if(w==2)discover();else updater.check();}).show();return true;}return super.dispatchKeyEvent(event);}
    @Override public void onBackPressed(){handleBack();}
    private void handleBack(){
        if(fullVideo!=null){exitFull();exitPressedAt=0;return;}if(overlay!=null){exitOrHint();return;}if(backPending)return;backPending=true;
        web.evaluateJavascript("typeof window.haohaochangBack === 'function' && window.haohaochangBack()",result->{backPending=false;if(isFinishing()||isDestroyed())return;if("true".equals(result)){exitPressedAt=0;return;}exitOrHint();});
    }
    private void exitOrHint(){long now=SystemClock.elapsedRealtime();if(exitPressedAt!=0&&now-exitPressedAt<2500){finish();return;}exitPressedAt=now;Toast.makeText(this,"再按一次返回退出好好唱",Toast.LENGTH_SHORT).show();}
    @Override protected void onPause(){super.onPause();nativePlayback.foreground(false);web.onPause();}
    @Override protected void onResume(){super.onResume();if(web!=null)web.onResume();if(nativePlayback!=null)nativePlayback.foreground(overlay==null);if(updater!=null)updater.resume();}
    @Override public void onConfigurationChanged(android.content.res.Configuration config){super.onConfigurationChanged(config);if(overlay!=null){if(loading)showLoading();else if(discovery!=null)discover();else settings();}}
    @Override protected void onDestroy(){destroyed=true;cancelDiscovery();handler.removeCallbacksAndMessages(null);executor.shutdownNow();updater.destroy();nativePlayback.destroy();web.destroy();super.onDestroy();}
}
