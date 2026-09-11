package home.haohaochang.tv;
import org.junit.Test;
import static org.junit.Assert.*;

public class PlaybackPolicyTest {
    @Test public void onlySameServerMediaRoutesArePlayable() {
        String server="http://127.0.0.1:3099";
        assertTrue(PlaybackPolicy.mediaAllowed(server+"/api/assets/song/video?r=4&token=test",server));
        assertTrue(PlaybackPolicy.mediaAllowed(server+"/api/media/song/backing",server));
        for (String value : new String[]{"http://other.test/api/assets/song/video",server+"/api/admin/settings",server+"/api/assets/song/../video",server+"/api/assets/song/video#fragment","file:///api/assets/song/video"})
            assertFalse(value,PlaybackPolicy.mediaAllowed(value,server));
    }
    @Test public void playbackRequiresForegroundFreshLeaseAndUnpausedState() {
        assertTrue(PlaybackPolicy.mayPlay(true,true,false,7999));
        assertFalse(PlaybackPolicy.mayPlay(true,true,false,8000));
        assertFalse(PlaybackPolicy.mayPlay(false,true,false,0));
        assertFalse(PlaybackPolicy.mayPlay(true,false,false,0));
        assertFalse(PlaybackPolicy.mayPlay(true,true,true,0));
    }
    @Test public void offsetRetainsSubsecondPrecisionAndRejectsInvalidNumbers() {
        assertEquals(-1250000,PlaybackPolicy.offsetUs(-1.25));
        assertEquals(100000,PlaybackPolicy.offsetUs(.1));
        for(double value:new double[]{Double.NaN,Double.POSITIVE_INFINITY,21601}) {
            try { PlaybackPolicy.offsetUs(value); fail(); } catch(IllegalArgumentException expected) {}
        }
    }
}
