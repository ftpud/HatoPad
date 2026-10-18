# Bounded supervision APIs

Core wire 19 advertises granular capability flags. Clients must check them before
using optional supervision operations and must not replay interrupted mutations.

- `inventory.page` reads content-free, revisioned root inventories; `tasks.page`
  supports bounded task state/search/name-or-branch pages and `tasks.read` exact IDs.
- `overview.work` and `overview.events` are root-agnostic and preserve selections.
  Lifecycle events are bounded, ephemeral metadata since Core startup.
- `harnesses.control` pauses scheduling or safely retries failed stages in the same
  run; completed stages are preserved and uncertain non-replayable effects refuse
  retry. `harnesses.inspect` pages original-session transcripts and block output.
  `harnesses.invoke` permits connected AI/Chatbox calls from an active same-run caller.
- `harnesses.templates` returns template metadata without graph/prompt bodies.
- `terminal.watch.flowControl` isolates watcher sockets/workspaces and bounds
  pending/unacknowledged UTF-8 output with explicit rendered-sequence acknowledgments.
- `taskGit.files/revert` list or reverse checkpoint changes with conflict checks;
  Git/checkpoint metadata pages also enforce encoded-byte budgets without clipping IDs.
- `useful.read.maxBytes` bounds optional note previews without splitting UTF-8.

Authorization remains rooted in the Core connection. Transcript/session bindings
are checked against the run's worktree, and watcher handles cannot cross channels.
No package publication or deployment accompanies these development API additions.
