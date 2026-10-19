# Gateway cloud port tunnels

Select a cloud server in Gateway. Under **Cloud port tunnels**, enter a local
port and a Core port, choose **Add port**, then **Run**. Leave Core port empty
to use the same number. For example, local `8080` → Core `3000` makes a dev
server on the Core available at `http://127.0.0.1:8080` on your computer.
Gateway must stay open. Saved configurations persist across Gateway restarts;
starting them remains explicit. **Stop** closes the listener and its active
connections; **Delete** also removes the saved configuration.

These are TCP forwards with traffic flowing in both directions, including HTTP,
WebSockets and database protocols. The listening endpoint is always `127.0.0.1`
on the Gateway machine; the destination is always `127.0.0.1` inside the Core's
network namespace. A Docker Core therefore reaches services running inside its
container without publishing host ports. Services bound only to IPv6 loopback
are not reachable. Reverse forwarding and UDP are not implemented.

Gateway uses its existing cloud session and one ordinary relay channel for each
configured running forward. The Hub authorizes Core ownership/operator access
and origin as it does for editor connections. Logout, expiry, grant revocation,
unpairing or connector loss closes that channel and all its TCP streams. Gateway
also stops cloud forwards when signing out or changing cloud URL. Configurations
are scoped to the Hub origin and Core ID, so switching accounts/URLs does not
silently retarget them. Any local process can access a running loopback listener;
start forwards only while you need them.

Both Gateway and Core must include this implementation. Core advertises
`ports.tunnel` in the authenticated protocol handshake; an older or incompatible
Core is refused with upgrade guidance before a local listener is created. The
new operations are additive to Core protocol 19. Relay wire 1 carries them as
ordinary Core payloads; no new relay frame or Hub transport deployment is needed.
No package or app release is implied by the source change.

The authenticated maintenance connection also permits these port operations
when protocol ranges overlap, without selecting a workspace/root/task or
starting workspace services:

| Operation                          | Purpose                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `portTunnel.open {port}`           | Connect to Core loopback; return a connection-owned opaque stream ID            |
| `portTunnel.write {streamId,data}` | Write canonical base64, at most 32 KiB decoded; acknowledge after the TCP write |
| `portTunnel.read {streamId}`       | Pull at most 32 KiB; wait up to one second, then return data/EOF                |
| `portTunnel.end {streamId}`        | Send TCP FIN while still permitting replies                                     |
| `portTunnel.close {streamId}`      | Destroy and release the stream                                                  |

Core validates ports, IDs, fields and data at the request boundary, accepts no
host/address input, and refuses forwarding to its own protocol listener. Stream
IDs belong to a single authenticated WebSocket. Each channel has at most 16
streams and Core has at most 128 active outbound sockets. Connect timeout is
10 seconds and idle TCP timeout is five minutes. Reads and writes are individually
bounded and serialized per direction, preserving backpressure and TCP half-close.
Existing Hub channel, frame and traffic quotas still apply and can constrain
how many tunnels run alongside editor connections. Tunnel payloads are not logged.

Relay loss closes active TCP streams and releases the local listener. Refresh
cloud status and Run again for future connections. OS resume can reconnect the
forward; existing connections are closed and their bytes are never replayed.
An interrupted application request can have an uncertain outcome: check the
application/service state before repeating it.

Validation:

```bash
npm run build
npm run typecheck
npm run typecheck -w @hatopad/gateway
npm test
node --test scripts/cloud-port-tunnel.test.mjs
```

The root integration check uses real Gateway and Core over a local relay bridge;
it covers concurrent binary streams, FIN replies and relay-loss cleanup. Core
tests cover input limits, stream isolation and budget cleanup. Gateway tests
cover unsupported peers, credential use, binary data, half-close and revocation.
The private Hub separately tests authorized owner/operator channel isolation,
denied third-party access and session/grant revocation with port-open payloads.
Live cloud use with released Gateway/Core builds remains a release check.
