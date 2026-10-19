# Hub channel policy and Core enforcement

The Hub owns account identity, Core grants, and phone policy groups. Core owns
workspace execution and credentials. The Hub must classify each pinned protocol
request and reject requests that it does not recognize before forwarding them.

## Current trust boundary

The relay `channel.open` frame contains a channel identifier and generation; it
does not carry an authenticated account identity or policy groups. The connector
opens a separate local Core socket for each channel and replaces the browser's
handshake token with the local Core session token. Core therefore authenticates
the connector as a local client. `coreAccessPolicy` cannot distinguish this socket
from Desktop or independently enforce the Hub's per-Core groups.

This is a description of current behavior, not a second enforcement layer. A
browser-supplied `hub` flag, account ID, or group list would not establish trusted
identity and must not grant permissions.

## Decision

Keep the Hub's exhaustive policy gate authoritative for the current relay
version. Add Core defense in depth through an explicitly versioned protocol
change, rather than silently treating all local-token sockets as restricted.
The future contract needs all of the following:

- A connector-authenticated, channel-scoped capability that identifies the Core,
  account, allowed groups, channel generation, and expiry.
- A restricted Core credential distinct from the unrestricted Desktop token.
  Only the trusted connector may establish this identity; browser payloads
  cannot select or replace it.
- A Core-owned operation classification that fails closed for unknown requests,
  absent scopes, expired capabilities, or a capability for a different Core.
- Revocation and policy refresh that close affected channels; interrupted
  mutations must never be replayed automatically.
- Compatibility negotiation and boundary tests for forged identities, stale
  generations, cross-Core reuse, revocation, and every policy group over a real
  relay channel.

No capability or policy is added to the wire by this document. Public protocol,
relay, and connector changes must be released as versioned registry or packed
artifacts before Hub consumes them.
