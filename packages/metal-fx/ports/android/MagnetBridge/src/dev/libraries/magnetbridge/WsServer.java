package dev.libraries.magnetbridge;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/** A minimal RFC 6455 WebSocket server on the loopback interface: text frames
 *  out, close and ping handled, everything else ignored. Only pages whose
 *  Origin the {@link Gate} accepts get the upgrade. */
final class WsServer {
    interface Gate { boolean allow(String origin); }
    interface Listener {
        void onOpen(Client c);
        void onClose(Client c);
        void onBlocked(String origin);
        void onText(Client c, String text);
    }

    static final class Client {
        final Socket socket;
        final String origin;
        private final OutputStream out;
        Client(Socket s, String origin) throws IOException {
            this.socket = s;
            this.origin = origin;
            this.out = s.getOutputStream();
        }
        synchronized boolean send(String text) {
            byte[] p = text.getBytes(StandardCharsets.UTF_8);
            try {
                ByteArrayOutputStream f = new ByteArrayOutputStream(p.length + 10);
                f.write(0x81);
                if (p.length < 126) {
                    f.write(p.length);
                } else if (p.length < 65536) {
                    f.write(126);
                    f.write(p.length >>> 8);
                    f.write(p.length & 0xff);
                } else {
                    f.write(127);
                    for (int i = 7; i >= 0; i--) f.write((int) (((long) p.length >>> (8 * i)) & 0xff));
                }
                f.write(p);
                out.write(f.toByteArray());
                out.flush();
                return true;
            } catch (IOException e) {
                return false;
            }
        }
        synchronized void sendRaw(int opcode, byte[] p) {
            try {
                out.write(0x80 | opcode);
                out.write(p.length);
                out.write(p);
                out.flush();
            } catch (IOException ignored) {
            }
        }
        void close() {
            try { socket.close(); } catch (IOException ignored) { }
        }
    }

    private static final String GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

    final CopyOnWriteArrayList<Client> clients = new CopyOnWriteArrayList<>();
    private final int port;
    private final Gate gate;
    private final Listener listener;
    private ServerSocket server;
    private Thread acceptThread;

    WsServer(int port, Gate gate, Listener listener) {
        this.port = port;
        this.gate = gate;
        this.listener = listener;
    }

    void start() throws IOException {
        server = new ServerSocket();
        server.setReuseAddress(true);
        // Loopback only: pages on this phone can connect, nothing on the network
        // can. 127.0.0.1 spelled out: Android's getLoopbackAddress() is the IPv6
        // ::1, which does not answer the 127.0.0.1 that pages dial.
        server.bind(new java.net.InetSocketAddress(InetAddress.getByAddress(new byte[] { 127, 0, 0, 1 }), port));
        acceptThread = new Thread(() -> {
            while (!server.isClosed()) {
                try {
                    Socket s = server.accept();
                    s.setTcpNoDelay(true);
                    new Thread(() -> serve(s), "ws-client").start();
                } catch (IOException e) {
                    if (server.isClosed()) return;
                }
            }
        }, "ws-accept");
        acceptThread.start();
    }

    void stop() {
        try { if (server != null) server.close(); } catch (IOException ignored) { }
        for (Client c : clients) c.close();
        clients.clear();
    }

    void broadcast(String text) {
        for (Client c : clients) {
            if (!c.send(text)) {
                clients.remove(c);
                c.close();
                listener.onClose(c);
            }
        }
    }

    private void serve(Socket s) {
        Client client = null;
        try {
            InputStream in = s.getInputStream();
            Map<String, String> h = readHeaders(in);
            if (h == null) { s.close(); return; }
            String origin = h.getOrDefault("origin", "");
            boolean upgrade = "websocket".equalsIgnoreCase(h.getOrDefault("upgrade", ""));
            OutputStream out = s.getOutputStream();
            if (!upgrade) {
                // A plain GET answers "is the bridge here?" without opening a socket.
                boolean ok = gate.allow(origin);
                String body = ok ? "{\"app\":\"MagnetBridge\",\"version\":1}" : "{\"error\":\"origin not allowed\"}";
                String resp = "HTTP/1.1 " + (ok ? "200 OK" : "403 Forbidden") + "\r\n"
                        + "Content-Type: application/json\r\n"
                        + (ok && !origin.isEmpty() ? "Access-Control-Allow-Origin: " + origin + "\r\n" : "")
                        + "Access-Control-Allow-Private-Network: true\r\n"
                        + "Content-Length: " + body.getBytes(StandardCharsets.UTF_8).length + "\r\n"
                        + "Connection: close\r\n\r\n" + body;
                out.write(resp.getBytes(StandardCharsets.UTF_8));
                out.flush();
                if (!ok) listener.onBlocked(origin);
                s.close();
                return;
            }
            if (!gate.allow(origin)) {
                out.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.UTF_8));
                out.flush();
                listener.onBlocked(origin);
                s.close();
                return;
            }
            String key = h.getOrDefault("sec-websocket-key", "");
            byte[] sha = MessageDigest.getInstance("SHA-1").digest((key + GUID).getBytes(StandardCharsets.UTF_8));
            String accept = android.util.Base64.encodeToString(sha, android.util.Base64.NO_WRAP);
            out.write(("HTTP/1.1 101 Switching Protocols\r\n"
                    + "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                    + "Sec-WebSocket-Accept: " + accept + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            out.flush();
            client = new Client(s, origin);
            clients.add(client);
            listener.onOpen(client);
            readFrames(in, client);
        } catch (Exception ignored) {
        } finally {
            if (client != null && clients.remove(client)) {
                client.close();
                listener.onClose(client);
            }
        }
    }

    private void readFrames(InputStream in, Client c) throws IOException {
        while (true) {
            int b0 = in.read(), b1 = in.read();
            if (b0 < 0 || b1 < 0) return;
            int opcode = b0 & 0x0f;
            boolean masked = (b1 & 0x80) != 0;
            long len = b1 & 0x7f;
            if (len == 126) len = (in.read() << 8) | in.read();
            else if (len == 127) { len = 0; for (int i = 0; i < 8; i++) len = (len << 8) | in.read(); }
            byte[] mask = new byte[4];
            if (masked) readFully(in, mask);
            if (len > 1 << 20) return;
            byte[] p = new byte[(int) len];
            readFully(in, p);
            if (masked) for (int i = 0; i < p.length; i++) p[i] ^= mask[i & 3];
            if (opcode == 0x8) { c.sendRaw(0x8, new byte[0]); return; }
            if (opcode == 0x9) { c.sendRaw(0xA, p); continue; }
            if (opcode == 0x1) listener.onText(c, new String(p, StandardCharsets.UTF_8));
        }
    }

    private static void readFully(InputStream in, byte[] buf) throws IOException {
        int off = 0;
        while (off < buf.length) {
            int n = in.read(buf, off, buf.length - off);
            if (n < 0) throw new IOException("eof");
            off += n;
        }
    }

    private static Map<String, String> readHeaders(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        int state = 0;
        while (state < 4) {
            int b = in.read();
            if (b < 0) return null;
            buf.write(b);
            if (buf.size() > 16384) return null;
            state = (b == '\r' && (state == 0 || state == 2)) ? state + 1
                  : (b == '\n' && (state == 1 || state == 3)) ? state + 1 : 0;
        }
        String[] lines = buf.toString("UTF-8").split("\r\n");
        Map<String, String> h = new HashMap<>();
        for (int i = 1; i < lines.length; i++) {
            int k = lines[i].indexOf(':');
            if (k > 0) h.put(lines[i].substring(0, k).trim().toLowerCase(Locale.ROOT), lines[i].substring(k + 1).trim());
        }
        return h;
    }
}
