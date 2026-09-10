package home.haohaochang.tv;

import org.junit.Test;
import static org.junit.Assert.*;

public class ConnectionPolicyTest {
    @Test public void normalizesPastedPlayerAddressAndBareLanAddress() {
        assertEquals("http://192.168.1.2:43210",ConnectionPolicy.normalize("192.168.1.2:43210"));
        assertEquals("https://ktv.example.com",ConnectionPolicy.normalize(" https://ktv.example.com/play/ "));
        assertEquals("http://192.168.1.2:3210",ConnectionPolicy.normalize("http://192.168.1.2:3210/tv"));
    }
    @Test public void rejectsCredentialsQueriesUnsupportedSchemesAndPaths() {
        for (String input : new String[]{"", "file:///sdcard", "javascript:alert(1)", "http://u:p@example.com", "https://example.com?token=secret", "https://example.com#token", "http://example.com:70000", "http://example.com:0", "https://example.com/not-a-server"}) {
            try { ConnectionPolicy.normalize(input); fail("Accepted " + input); } catch (IllegalArgumentException expected) {}
        }
    }
    @Test public void discoveryAcceptsOnlyPrivateIpv4AndOriginComparisonUsesEffectivePorts() {
        for (String ip:new String[]{"192.168.1.2","10.0.0.1","172.16.1.1","172.31.255.254"}) assertTrue(ip,ConnectionPolicy.privateIpv4(ip));
        for (String ip:new String[]{"127.0.0.1","8.8.8.8","172.32.1.1","192.168.1.999","192.168.1","192.168.1.-1","::1"}) assertFalse(ip,ConnectionPolicy.privateIpv4(ip));
        assertTrue(ConnectionPolicy.sameOrigin("http://nas:80/tv","http://nas"));
        assertFalse(ConnectionPolicy.sameOrigin("https://nas/tv","http://nas"));
        assertFalse(ConnectionPolicy.sameOrigin("http://nas:3210/tv","http://nas:43210"));
    }
}
