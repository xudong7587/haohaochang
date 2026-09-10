package home.haohaochang.tv;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** User-initiated, bounded broadcast discovery; never scans an IP range. */
final class LanDiscovery {
    private volatile boolean cancelled;
    private volatile DatagramSocket socket;
    static final class Server {
        final String address;
        Server(String address) { this.address = address; }
    }
    void cancel() { cancelled = true; DatagramSocket current = socket; if (current != null) current.close(); }

    List<Server> search() {
        List<Server> found = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        String nonce = UUID.randomUUID().toString().replace("-", "");
        try (DatagramSocket channel = new DatagramSocket()) {
            socket = channel;
            if (cancelled) return found;
            channel.setBroadcast(true);
            channel.setSoTimeout(400);
            Set<InetAddress> targets = new LinkedHashSet<>();
            for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!network.isUp() || network.isLoopback()) continue;
                for (InterfaceAddress address : network.getInterfaceAddresses()) {
                    if (address.getAddress() instanceof Inet4Address && ConnectionPolicy.privateIpv4(address.getAddress().getHostAddress()) && address.getBroadcast() != null)
                        targets.add(address.getBroadcast());
                }
            }
            if (targets.isEmpty()) return found;
            targets.add(InetAddress.getByName("255.255.255.255"));
            byte[] query = new JSONObject().put("protocol",ConnectionPolicy.PROTOCOL).put("nonce",nonce).toString().getBytes(StandardCharsets.UTF_8);
            long deadline = System.nanoTime() + 8000000000L;
            long nextSend = 0;
            while (!cancelled && System.nanoTime() < deadline && seen.size() < 8) {
                if (System.nanoTime() >= nextSend) {
                    for (InetAddress target : targets) {
                        try { channel.send(new DatagramPacket(query,query.length,target,ConnectionPolicy.DISCOVERY_PORT)); } catch (Exception ignored) {}
                    }
                    nextSend = System.nanoTime() + 2000000000L;
                }
                byte[] bytes = new byte[1025];
                DatagramPacket packet = new DatagramPacket(bytes,bytes.length);
                try { channel.receive(packet); } catch (java.net.SocketTimeoutException timeout) { continue; }
                String source = packet.getAddress().getHostAddress();
                if (packet.getLength() > 1024 || !ConnectionPolicy.privateIpv4(source)) continue;
                try {
                    JSONObject answer = new JSONObject(new String(bytes,0,packet.getLength(),StandardCharsets.UTF_8));
                    int port = answer.optInt("port",0);
                    if (!ConnectionPolicy.PROTOCOL.equals(answer.optString("protocol")) || !nonce.equals(answer.optString("nonce")) || !"haohaochang".equals(answer.optString("service")) || port < 1 || port > 65535) continue;
                    // Only the UDP source address is trusted as an address, never an advertised URL.
                    String endpoint = "http://" + source + ":" + port;
                    if (seen.add(endpoint) && identifiesServer(endpoint)) found.add(new Server(endpoint));
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) { /* The manual connection screen remains available. */ }
        finally { socket = null; }
        return found;
    }

    private boolean identifiesServer(String endpoint) {
        if (cancelled) return false;
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(endpoint + "/api/server-info").openConnection();
            connection.setConnectTimeout(1200); connection.setReadTimeout(1200);
            connection.setInstanceFollowRedirects(false);
            if (connection.getResponseCode() != 200) return false;
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[512]; int count;
                while ((count = input.read(buffer)) != -1) { output.write(buffer,0,count); if (output.size()>4096 || cancelled) return false; }
                JSONObject info = new JSONObject(output.toString("UTF-8"));
                return "haohaochang".equals(info.optString("service")) && ConnectionPolicy.PROTOCOL.equals(info.optString("protocol"));
            }
        } catch (Exception error) { return false; }
        finally { if (connection != null) connection.disconnect(); }
    }
}
