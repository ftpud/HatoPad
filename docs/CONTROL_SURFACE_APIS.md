# Browser control-surface APIs

These additive Core wire 19 operations are negotiated through handshake
capabilities. A compatible wire version alone does not guarantee these features.
Clients must hide unavailable actions and show an upgrade requirement. Every
root-scoped request needs the currently selected connection root in its envelope;
changing one connection's selection does not change another connection.

- `tasks.lifecycle`: existing create/rename/status/archive/delete/merge operations.
- `automation.management`: `timers.create`, schedules/triggers list/create/update/
  enabled/delete/fire. `timers.create` takes provider, prompt, optional taskId,
  and exactly one of seconds (1–604800) or dueAt (future timestamp, up to 7 days).
  It replaces the pending continuation for that workspace/provider, matching the
  agent timer tool. Clients must make replacement explicit. Pass `rootScoped: true` to list/cancel/fire to constrain them to the addressed
  root and its registered task worktrees; omitted preserves legacy Core-wide
  behavior for Desktop/workflow continuation recovery.
- `schedules.update` takes scheduleId, input (ScheduleInput), enabled and
  expectedRevision. `triggers.update` takes triggerId and the corresponding
  TriggerInput. Obtain expectedRevision from the root-scoped list immediately
  before editing. Updates preserve identity/history and reject changed records
  or in-flight launches. Unknown definition fields are rejected. Existing
  `timers.changed` invalidates automation lists; its absent rootId means refresh
  subscribed roots, not that any particular root owns the event.
- `git.summary` returns branch/upstream, clean, totalFiles, additions/deletions,
  unknownCounts, revision, entries and optional nextOffset. Payload limit is
  1–500 (default 100), offset is nonnegative. Entries carry path, originalPath,
  index/worktree status, states, group and nullable line counts. Binary/untracked
  counts are unknown, not zero; totals sum known counts only. Responses contain
  no file bodies. Refresh if revision changes while paging.
- `taskGit.summary` takes limit 1–100 (default 25) and offset, returns checkpoints
  and nextOffset. Rows contain turn identity/provider/timestamps/status and file/
  line counts, with unknownCounts for binary, oversized or expensive comparisons.
  Prompt text, provenance and file bodies are excluded. Existing checkpoint
  review/restore operations retain their conflict checks.
- `overview.counts` adds `counts` {tasks, finishedTasks, schedules, triggers, workflowsActive} to each
  `overview.summary` root: counts only, no names or content. Count changes alter `revision` but do not
  restart attention paging.
- `client.presence` adds `client.presence` {visible: boolean} (unscoped, no rootId) and `presence`
  {active} to every `overview.summary` result. A visible report keeps that connection present for
  `presenceLeaseMs` (60 s); `visible: false` or closing the connection clears it. Desktop reports on
  visibility change and every 20 s while visible. Presence is in memory only, carries no user, window
  or workspace detail, and does not alter `revision`. Hub uses it to hold back "work finished" pushes.
- `terminal.watch` adds `terminal.watch.list` (metadata only: id, status, exit code, name, retained
  output byte count) and `terminal.watch.attach` {terminalId, maxBytes 1024–262144, default 65536}. Attach
  returns the newest bytes of retained scrollback (cut on a character boundary) with `truncated`, or a
  `stale` result for an unknown id. Neither operation sends input, resizes or creates; live output keeps
  using `terminal.output`/`terminal.exit` events, and relays apply their own per-channel buffering limits.
- `harnesses.blockDetail` {runId, blockId, outputChars 1–64000 (default 16000), chatLimit 1–50 (default 20),
  chatBefore} returns the newest output characters, counts, and a newest-first Chatbox page (text clipped to
  4000 characters, `chatNextBefore` to continue). Optional `execution` metadata reports attempt/recovery
  counts, frozen definition version, exact-run provider/model/reasoning and timer/retry dates; all text is
  clipped to 200 characters. Session overrides take precedence over frozen definition settings. Older
  Cores omit this metadata. It excludes prompts, the definition, run input and host/workspace paths.
- `automation.paging` adds `schedules.page` / `triggers.page` {limit 1–25 (default 25), cursor, query ≤100
  characters} returning root-owned, name-ordered summaries (id, revision, name, state, due/interval, target
  task id, clipped last error, action type/provider/ids only — never prompt or workflow input), `total`,
  `revision`, `nextCursor` and `restarted`. Cursors are bound to root, kind and query and restart when any
  item's revision changes. `schedules.read` / `triggers.read` {id} return the full revisioned definition for
  editing; ids outside the addressed root are `FILE_NOT_FOUND`. Updates still require `expectedRevision`.
- `tasks.commitMessage` gates get/set/update operations. Get takes taskId and
  returns the saved draft plus current head. Set takes taskId/message and saves
  a draft without committing. Update takes taskId/message/expectedHead and
  rewrites only the latest unpushed task commit, preserving its tree/author.
  Changed heads and published tips are rejected; this is an explicit separate
  action requiring user confirmation.

Core is the durable authority. After a lost mutation response, refresh and report
that the outcome is uncertain; never automatically replay that mutation. List
operations do not grant permission to send terminal input, edit files or author
workflow definitions. Terminal watcher flow control and richer cross-root summary
contracts are separate capabilities and are not provided by the flags above.

## Live terminal watchers

Negotiate `terminal.watch.flowControl`, then attach with `follow: true`. The
available response adds `watchId` to the bounded snapshot. Once the snapshot is
rendered, acknowledge sequence 0 with `terminal.watch.ack`; Core then delivers
`terminal.watch.output` events with watchId, terminalId, sequence, data and a
truncated flag. Acknowledge the greatest rendered sequence cumulatively. `ack`
and `detach` are bound to the same socket, root and workspace as the attach.
Detach before changing terminals. Root/task switches and disconnect remove all
watchers; reconnect attaches afresh and never replays terminal input.

Each socket has at most four watchers. Each watcher has a 64 KiB pending buffer
and a 64 KiB unacknowledged window; event chunks are at most 16 KiB. If a client
falls behind, Core retains the newest pending UTF-8 text and explicitly marks
lost output. Acknowledgements cannot grant extra credit by repeating a sequence
or acknowledging a sequence not yet sent. Exit events follow queued output.
Transport admission and slow-socket limits apply independently. Watchers neither
own nor resize the PTY and cannot steal its interactive owner's output channel.
Attach without follow retains the older snapshot-only behavior.

## Checkpoint selection and revert

`taskGit.files` returns paged metadata (limit 1–100) for a checkpoint, direction
apply or revert, without prompt/file bodies. `taskGit.review` applies selected
paths forward; `taskGit.revert` reverses selected paths, or all captured changes
when paths is omitted. Both compare live state against the captured base and
return applied/alreadyApplied/conflicts. Active task agents block these operations.
Replaced parent symlinks and paths that became directories are conflicts; they
must never redirect writes outside the workspace or remove unrelated directories.

## Automation history and next-turn configuration

`triggers.history` pages the newest 100 retained delivery records (limit 1–100,
before cursor). Records include time, clipped event description and result
started/skipped-busy/capped/failed; FIFO data is excluded. Trigger edits preserve
history and hourly fire timestamps survive restart. The dedicated
`automation.changed` event identifies schedule/trigger changes; absent rootId
means consumers refresh their current root. Legacy timers.changed is retained.

`ai.configureNext` accepts an optional provider and configuration containing only
model/reasoning string values. The advertised model must be available and reasoning
must be supported. It sets session.nextConfiguration for the next new turn;
empty configuration clears the override. The current turn is not interrupted.

## Selection-free work overview and attention details

`overview.work` is root-agnostic (no envelope root), paged with limit 1–25 and a
cursor; optional payload rootId filters registered roots. Inventory revisions
restart cursors after root/task changes, while ordinary activity does not prevent
paging. Rows contain bounded root/task identity, provider/session state and a
clipped activity preview, git counts/conflicts, terminal and workflow counts,
next timers, schedule/trigger counts and addressed issue metadata. Unknown git
counts remain explicit. No file, terminal, prompt or complete conversation bodies
are returned. Scope limits and truncated markers are exposed; response bytes are
capped. The operation never selects roots/tasks or restores provider sessions.

`attention.read` is root-scoped but selection-free within that root. Address a
provider, optional task/session and requestId to read a bounded permission or
question. A stale session/request returns resolved. Revalidate before resolution,
then use the existing targeted answer/permission operations. Truncated requests
require full review elsewhere; bounded details do not authorize blind approval.

## Explicit run scheduling control

`harnesses.control` advertises `harnesses.control.pause` (runId, paused boolean)
and `harnesses.control.retryFailed` (runId). Responses are lean run summaries;
read bounded progress/detail separately. Run/progress summaries expose paused.
Pause stops new scheduling, including watchdog recovery; in-flight calls may
finish. Resume releases the gate. Pause state is durable, while the existing
wall-clock run-duration limit still applies. Cancellation remains explicit.

Retry-failed preserves the run ID, frozen definition, successful outputs, sessions,
children and operation journal. Failed AI stages continue their previous session;
completed stages are not replayed. It rejects active provider sessions, invalid
frozen plans, interrupted script/process stages and unresolved mutation records.
A run still finalizing must be refreshed before retry. Concurrent retry admission
is serialized, including a store check that the persisted run is still failed.
This operation is a user decision after inspection, never a transport retry.


### Bounded workflow connection activity (2026-10-19)

`harnesses.progress` now includes `connectionTraces` metadata: at most the newest
128 connection records, with an optional `connectionTracesTruncated: true` when
records were omitted. Records contain only id, edge id, forward/return direction,
active/succeeded/failed state, timestamps and a nonnegative safe-integer character
count when available. Unknown fields are discarded; oversized identifiers and
timestamps are omitted with the truncation flag. The existing total progress byte
limit still applies. No transfer inputs, outputs, prompts or transcripts are
included. This is additive on wire 19; absence of the field identifies older
progress implementations, while an empty array means no connection activity.

Verification: protocol build/typecheck and 9 tests; Core build/typecheck and all
873 tests (including bounded projection and content-exclusion coverage). A running
Core must be updated to return this metadata. No deployment or package publication
was performed.
