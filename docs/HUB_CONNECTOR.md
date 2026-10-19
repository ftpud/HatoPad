# Optional hub connector

Core can keep an outbound WSS connection to a hub so a browser or phone can
reach it without port forwarding. It is off by default; direct Desktop-to-Core
use is unchanged and never requires a hub. The relay envelope is versioned
independently of the Core protocol (`@hatopad/relay`, wire range 1–1).

```sh
# One-time, on the Core machine. Prints a single-use code; after a signed-in user claims it in the hub UI,
# names that user and asks you locally to accept before the hub issues anything.
npm run core -- --hub-pair https://hub.example
# Then start Core with the connector (or set HATOPAD_HUB_CONNECT=1).
npm run core -- --workspace /path/to/project --hub-connect
```

- The hub origin must be `https://` (plain `http://` is accepted only for loopback tests).
- Pairing stores a per-Core device credential in `~/.hatopad/hub/pairing.json`
  (directory `0700`, file `0600`; override with `HATOPAD_HUB_PAIRING_FILE`).
  It is separate from the local Core session token and never leaves this machine
  except to authenticate to the hub. Delete the file to unpair locally; the owner
  must also revoke the device in the hub.
- Each browser channel gets its own local Core WebSocket, so root/task selections
  stay independent. The connector dials only `ws://127.0.0.1:<core port>` and
  overwrites the `token` in each channel's `protocol.handshake`; the browser and
  hub never receive the local token.
- Pairing gives the hub's signed-in owner (and anyone they grant) control of the
  whole Core, including its roots and command execution.
- The connector reconnects with backoff and jitter and opens fresh channels.
  Losing the hub never cancels Core work, and interrupted requests are never
  replayed. A revoked credential or incompatible relay version stops the
  connector instead of retrying.
- The hub is trusted with relayed content; TLS protects each leg and there is
  no end-to-end encryption. Logs contain status only, never credentials, codes
  or content.

Hub-facing contract. Every pairing call carries `Authorization: Bearer <proof>`,
a random 256-bit value only this process knows:

1. `POST /api/pairing/start` (`PairingStartRequest`) -> pending `pairingId`, `expiresAt`.
2. `GET /api/pairing/{id}` -> pending, plus `claimedBy: { name, email }` once a
   signed-in browser user claims the code (`POST /api/pairings/claim`). Polls never carry a credential.
3. `POST /api/pairing/{id}/confirm` `{ accept }` after local acceptance -> the
   credential, exactly once. A lost response is not replayed; pair again.

The relay socket is `wss://<origin>/relay/connector`; its first frame is `hello`
with the device credential. Browsers use `/relay/browser?coreId=<uuid>`.

## Cross-task attention summary

`overview.summary` is a root-agnostic (no `rootId`) read-only request for
overview screens. It lists pending permissions and questions across every root
and active task with stable targets (`rootId`, optional `taskId`, `provider`,
`sessionId`, `requestId`), plus per-root running/attention counts. It never selects
a root or task and never restores or creates sessions, so other clients'
selections are unaffected. Results are bounded (default 50, maximum 100 items;
at most 200 active tasks per root, otherwise `truncated`; text clipped to 180
characters) and ordered deterministically. Page with `nextCursor`; a cursor from
an older `revision` restarts at the first page with `restarted: true`. Treat the
result as ephemeral and refresh on `ai.changed`/`tasks.changed` events. Resolve an
item with the existing `ai.permission.resolve`/`ai.question.answer` `target`
after selecting its root, revalidating that the `requestId` is still pending.
Wire version 19 is unchanged, so older Cores answer this request with
`INVALID_REQUEST`; clients should treat that as "upgrade Core to see cross-task
attention".

## Bounded reads for phones and capability detection

A compatible handshake now returns `capabilities` (see `coreCapabilities` in
`@hatopad/protocol`); older Cores omit it and answer newer requests with
`INVALID_REQUEST`. Wire version 19 is unchanged because every change is additive
and Desktop behavior is unchanged.

- `ai.messages` returns a newest-first page of the selected task's conversation
  (`limit` 1–100, default 30; `before` message id from `nextBefore`; text clipped to
  `maxTextLength`, default 4000, max 20000, with clipped ids listed; attachment
  `content` omitted) plus status and any pending permission/question.
- `filesystem.readFile` accepts `maxBytes` (1 B–2 MiB) and rejects larger files with
  `FILE_TOO_LARGE` before reading them.
- `git.diff` accepts `maxBytes`; a diff whose two sides exceed it returns
  `tooLarge: true` with empty contents and hunks, so clients must not render or
  stage from it. Staging and mutating operations are unchanged.
- `overview.summary` also lists paused workflow blocks (`workflow-permission`,
  `workflow-question`; capability `overview.workflowAttention`) with a `workflow`
  address (`runId`, `blockId`, `pauseId`). Resolve them with
  `harnesses.permission.resolve` / `harnesses.answer`, not the `ai.*` operations;
  a workflow question's `target.requestId` is its pause id. At most 20 waiting runs per root are scanned.
- `harnesses.progress` (`runId`, `logLimit` 1–100, default 20) returns per-block
  status, pause details and the newest clipped log entries only — never the
  definition, prompts, outputs or chat transcripts. `harnesses.runs` with
  `summary: true` remains the bounded run list (up to 100 runs per workflow).

### Lean selection and session metadata

- `tasks.switch` accepts `includeTree: false` and then returns `tree: []`.
- `ai.get` accepts `summary: true`: session metadata with `messages: []` and
  `omittedMessages` counting what was left out.
- `ai.sessions` accepts `summary`, `limit` (1–100, default 30) and `before` (a session
  id from `nextBefore`). Without those options the legacy full list is returned.
- The handshake accepts `sessionMessageLimit` (0–100). On Cores advertising
  `session.responseLimit`, every `AiSession` in every response on that connection
  keeps only its newest N messages and sets `omittedMessages`; older Cores ignore it.
  `CoreClient.supports(capability)` reports the advertised capabilities.

### Per-connection task selection

The durable task registry's selected task is only the default for a **new**
connection. Each connection pins its own task per root on first use (and on
`tasks.switch`, `tasks.delete` of its own task, or `workspace.selectRoot`), and
`tasks.list`, `tasks.switch` and `tasks.delete` report that connection's
selection. Another client's switch no longer changes what a connection reports or
runs against. The registry is still updated, so a freshly started Desktop resumes
at the last switched task. If another client deletes a connection's pinned task,
that connection reports the root workspace; reselect with `tasks.switch`.

### Final phone additions

- `filesystem.listDirectory` (`path` optional/`""` = root, `limit` 1–100 default 50, opaque
  `cursor`) lists one directory non-recursively: directories first, then names; hides `.git`,
  Core's trash and links that escape the workspace; scans at most 20,000 entries (`truncated`).
- `workspace.selectRoot` accepts `includeTree: false` (capability `workspace.selectRoot.includeTree`);
  `CoreClient` uses it on reconnect when `leanWorkspace: true` and the Core advertises it.
- Pending permission/question text is clipped wherever it is returned to bounded clients
  (`ai.messages`, summary reads, and responses on connections with `sessionMessageLimit`):
  titles 200, details 2000, option names 200 (20 options), questions 1000 (30 fields,
  50 choices, labels 300). Identities, option ids, field ids and choice values are never altered.
- `overview.summary` also returns `activity`: up to 20 newest conversations
  (`target` without `requestId`, `updatedAt`, `status`, clipped `preview`), included in
  `revision` but not in paging cursors. At most 50 roots are scanned (`truncated`).
- `@hatopad/test-fixtures` ships a scripted ACP agent (`PERMISSION`, `QUESTION`, `EDIT`,
  `SLOW` prompt keywords) and `fixtureProviderDefinition()` for
  `HATOPAD_PROVIDER_DEFINITIONS_DIR`, for end-to-end tests without a real model.
- `workspace.open` accepts `includeTree: false` (capability `workspace.open.includeTree`): it still
  subscribes the connection to `ai.changed`/`tasks.changed`/`harness.changed` events but returns `tree: []`.
  A browser client should call it once after connecting to receive events without a tree transfer.
- When a pending permission or question was clipped or had options/fields/choices omitted, it carries
  `truncated: true` (capability `pending.truncatedFlag`). Clients must not offer approval or `accept` from
  an incomplete request; reject, decline and cancel remain safe, and the full request is in Desktop.
