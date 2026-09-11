package home.haohaochang.tv;
import org.junit.Test;
import static org.junit.Assert.*;
public class UpdatePolicyTest {
    @Test public void versionedAssetsMatchTheSelectedReleaseAndExcludeDebug() {
        assertEquals(2, UpdatePolicy.assetPriority("haohaochang-tv-v0.4.0.apk", "v0.4.0"));
        assertEquals(1, UpdatePolicy.assetPriority("haohaochang-tv.apk", "v0.4.0"));
        assertEquals(0, UpdatePolicy.assetPriority("haohaochang-tv-v0.4.1.apk", "v0.4.0"));
        assertEquals(0, UpdatePolicy.assetPriority("haohaochang-tv-v0.4.0-debug.apk", "v0.4.0"));
        assertEquals(0, UpdatePolicy.assetPriority("haohaochang-tv.apk", "v0.4.0-beta"));
    }
    @Test public void versions() {
        assertTrue(UpdatePolicy.newer("v0.3.10","0.3.9"));
        assertFalse(UpdatePolicy.newer("v0.3.9","0.3.10"));
        assertFalse(UpdatePolicy.newer("v0.3.10-beta","0.3.9"));
        assertFalse(UpdatePolicy.newer("0.3.10","0.3.10"));
    }
    @Test public void downloadHosts() {
        assertTrue(UpdatePolicy.allowed("https://github.com/xudong7587/haohaochang/releases/download/v0.3.11/a.apk",true));
        assertFalse(UpdatePolicy.allowed("https://github.com/other/repo/releases/download/v1/a.apk",true));
        assertFalse(UpdatePolicy.allowed("https://github.com@evil.com/xudong7587/haohaochang/releases/download/v1/a.apk",true));
        assertFalse(UpdatePolicy.allowed("http://release-assets.githubusercontent.com/a",false));
        assertFalse(UpdatePolicy.allowed("https://release-assets.githubusercontent.com/a",true));
        assertTrue(UpdatePolicy.allowed("https://release-assets.githubusercontent.com/a",false));
    }
}
