# Hub support needed for Gateway browser sign-in

Implement the following contract in HatoHub. Gateway will open the user's normal
browser so Google passkeys, phone prompts and browser password managers can run
outside Electron. This is a new account sign-in handoff, separate from Core
pairing. Keep existing sign-in, Core credentials and relay authorization intact.

## HTTP contract (version 1)

### GET /api/desktop/capabilities

Anonymous, no-store JSON: `200 {"version":1}`. Gateway checks this before opening
the browser. Older Hubs should continue to return their normal 404/401; Gateway
will explain that the Hub update is required.

### GET /auth/desktop

Accept exactly these query parameters, once each:

- `redirect_uri`: `http://127.0.0.1:<ephemeral-port>/callback`. Require a literal
  loopback IP, a port >=1024, this exact path, and no credentials/query/fragment.
  Never accept external redirects, `localhost`, custom schemes or other paths.
- `state`: 32–128 base64url characters; opaque to Hub. Echo it unchanged only to
  the validated loopback callback.
- `code_challenge`: exactly 43 base64url characters, S256 PKCE. Gateway retains
  the random verifier; it never goes into a browser URL.

If the browser is signed out, use the existing Google/OIDC login and preserve
this validated authorization request through its existing state/nonce/PKCE flow.
After `/auth/callback`, resume `/auth/desktop`, rather than dropping the user on
Hub's home page. Return destinations must be restricted to a valid same-origin
`/auth/desktop` request; do not add an arbitrary `returnTo` redirect.

Once signed in, show a confirmation page naming the signed-in account and asking
whether to connect HatoPad Gateway on this device. Require an explicit
**Connect Gateway** action. Keep HTML escaped, no-store, no-referrer and protected
against framing. Do not automatically grant account access on a GET.

### POST /auth/desktop/approve

Suggested browser form endpoint for the confirmation action. Require the current
Hub session, correct Origin and CSRF token. Revalidate all authorization fields;
do not trust hidden form values. Use the normal Hub input size limits.

Create a cryptographically random 32-byte base64url code (43 characters), store
only its hash, and bind it to the approving user/session, the S256 challenge,
exact redirect URI and an expiry of at most 60 seconds. Reject disabled users.

Return a 303 redirect to the validated callback, with `code` and `state` query
parameters. The code must be redeemable only once. A cancellation may redirect
to the same callback with `error=access_denied` and `state`, without issuing a code.

### POST /api/desktop/exchange

Machine endpoint, no browser Origin header. Require `application/json` and exactly:

```json
{"code":"<43 base64url characters>","verifier":"<43–128 base64url characters>","redirect_uri":"http://127.0.0.1:<port>/callback"}
```

Validate the code hash, expiry, approving user's active status, originating
session validity, exact redirect URI, and
`BASE64URL(SHA256(verifier)) == stored code_challenge` using a constant-time
comparison. Atomically consume the code and issue a NEW independent Hub session.
Do not copy, rotate or disclose the browser's existing session.

Return `200 {"ok":true}` with the standard Hub session `Set-Cookie` header
(HttpOnly, Secure on HTTPS, normal SameSite/path/expiry rules). Gateway redeems via
its isolated Electron session's fetch with `credentials: include`; that session
stores the cookie for subsequent `/api/session`, `/api/cores` and relay requests.
Never put session tokens or credentials in the redirect, HTML or JSON body.
Invalid/expired/replayed requests must not create a session; do not automatically
replay a lost exchange response.

## Boundaries and tests

- Preserve invite-only access and all existing owner/operator authorization.
- Bound and rate-limit authorization/approval/exchange requests. Expire old codes.
- Browser approval requires Origin+CSRF; exchange must reject browser Origin.
- Test external/credentialed redirects, duplicate/malformed parameters, CSRF,
  signed-out and disabled users, wrong verifier and redirect, expired codes,
  expired/revoked approving sessions, one-use replay and concurrent exchanges.
- Verify Google/OIDC callback resumes the validated desktop request and ordinary
  web login still returns to Hub normally.
- Verify the issued app cookie authenticates `/api/session` as the approving
  account, and contains no reusable credential in the callback or JSON body.
- Never log codes, verifiers, cookies, OIDC tokens or full authorization URLs.

Implement database migrations and boundary tests according to Hub's repository
rules. Run Hub build, typecheck and tests, and document the handoff in its docs
and TODO. Deploying the updated Hub is required before Gateway's browser sign-in
can work; do not claim live passkey verification from fixture tests alone.

## Gateway callback page presentation

Gateway's loopback callback now renders a standalone account-connection result
panel consistent with its login palette, including light/dark OS themes and
phone-safe spacing. Success displays “Signed in”, a connection indicator and
instructions to close the tab and return to Gateway. Cancellation, rejected
responses and failed exchanges have separate explanatory states in the same
layout. The page has no scripts or external asset requests; its embedded CSS is
permitted by an exact SHA-256 CSP source while default resource loading, framing,
forms and base URLs remain blocked. No credentials are rendered in page content.

Verified: Gateway build/typecheck, 31 renderer tests and 101 Electron tests;
Chromium desktop/phone light/dark styling and overflow checks. Live Google,
passkey and isolated Electron-session verification still require the updated
Hub deployment and a separate end-to-end check.

## Core discovery and large project replies

Gateway preloads online servers' Core lists after loading the cloud account and
retains those lists while switching between servers. Refresh updates the lists
without clearing already known roots. Opening a Core no longer repeats the
workspace-list discovery before launching Desktop; Desktop validates its root
through its own authenticated connection.

The relay accepts 64 MiB serialized frames, with 128 MiB channel/bridge buffers
and a matching Core outbound budget. Desktop keeps full conversation responses;
these transport limits also cover large project metadata. A Core reply exceeding
the negotiated relay limit closes only that channel, preserving the connector
and other clients. Gateway retains Desktop launch output in its private
`logs/desktop-launch.log`. Packaged Desktop includes its protocol/ACP runtime
imports.

Verified with 12 MiB relay/bridge fixtures, a 20 MiB Core outbound reply, and the
existing running Core's full 3,846,351-byte VibeHub session response through a
local instance of the actual Hub relay, connector and Desktop bridge. Hub stayed
online and the Desktop renderer opened without errors. The development Hub was then deployed with the updated packed relay dependency
on 2026-10-19. Its public readiness check returned 200 and the existing Core
reconnected online without a Core restart. Gateway changes still require an
updated/rebuilt Gateway on the client device.
