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
- `terminal.watch` adds `terminal.watch.list` (metadata only: id, status, exit code, name, retained
  output byte count) and `terminal.watch.attach` {terminalId, maxBytes 1024–262144, default 65536}. Attach
  returns the newest bytes of retained scrollback (cut on a character boundary) with `truncated`, or a
  `stale` result for an unknown id. Neither operation sends input, resizes or creates; live output keeps
  using `terminal.output`/`terminal.exit` events, and relays apply their own per-channel buffering limits.
- `harnesses.blockDetail` {runId, blockId, outputChars 1–64000 (default 16000), chatLimit 1–50 (default 20),
  chatBefore} returns the newest output characters, counts, and a newest-first Chatbox page (text clipped to
  4000 characters, `chatNextBefore` to continue). It excludes prompts, the definition and run input.
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
