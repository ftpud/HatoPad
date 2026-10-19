# @hatopad/client

Platform-independent typed Core WebSocket client. Consumers supply the WebSocket
URL and an optional async credential provider; the package never reads Electron,
window.desktop, storage or environment credentials. A standard WebSocket global
must be provided by the host (modern browsers and Node 22+).

```ts
import { CoreClient } from '@hatopad/client';
const client = new CoreClient();
await client.connect({ url: 'wss://core.example/socket' });
const tasks = await client.request('tasks.list', {});
client.disconnect();
```

Connection performs protocol compatibility negotiation and root discovery before
resolving. Saved root selections survive reconnect. Pending calls are rejected
when the socket closes; mutations are never automatically retried. Callers own
reconnect policy, authoritative snapshot refresh and uncertain-outcome UX.
Desktop wraps this client to inject its host/port URL and main-process token.
Do not send a machine's reusable local token through an untrusted relay.

With `maintenance: true`, connection skips workspace discovery and permits only
Core update operations. A legacy Core that cannot recognize the maintenance
request fails immediately with the one-time external update message. An
uncorrelated legacy error is attributed only to a sole pending handshake or
maintenance request during negotiation; ordinary requests are left untouched.

Package 0.1.0 uses the pinned protocol dependency's Core wire range (currently
19–19). Relay wire versions are independent. Publishing is a separate release
action. Build protocol/ACP before building or packing this package. Ship MIT
notices with the complete transitive dependency set.
