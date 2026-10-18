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
