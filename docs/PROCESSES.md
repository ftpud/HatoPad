# Proc: workflow apps

Proc sits beside Timers in both sidebar layouts. Its list and badge count represent
apps explicitly started by workflow **Run App** blocks across the selected root
project's tasks and workflow sessions. Each app counts once. Provider hosts,
MCP/helper processes, AI tool commands, and workflow scripts are excluded from
this view. Both layout selections persist in workspace settings.

An entry shows the app name, command, launcher PID, workspace and available
task/run/block context. **Stop** stops that launcher and its current descendants.
A stale Stop after exit is a no-op. Other projects' apps and agent sessions stay
running.

## Core tracking and lifecycle

Core stores each explicitly launched child's PID and context in memory, and captures
its process birth identity once at launch. Child spawn, exit and error events update
the registry and broadcast changes. Listings read that registry. There is no process
monitoring timer, host-wide discovery, or reading other processes' environments.
Provider and authentication launchers use the same event-driven registry internally;
they do not appear in Proc.

`processes.list` returns registered workflow app launchers. `processes.kill` accepts
an `app:<launch identity>` ID and checks project ownership before inspecting or
signalling anything. Stop discovers descendants only beneath the selected live PID.
On Linux it reads that process's thread child lists under `/proc/<pid>/task` and
visits their children recursively. It verifies birth identities again before
signalling, stops the launcher first and then stops the captured descendants.
Permission failures identify the PID. Core shutdown and authentication cleanup also
inspect only their explicitly owned launchers' current trees when stopping them.

Run App serializes operations per workspace/name. Start reuses a running launcher;
after its exit, Start creates a fresh launch identity. Status and tail use cached
lifecycle state. Run App Kill, Proc Stop and Core shutdown use the same app Stop
path. The protocol's `processCount` is one registered launcher, not a live census
of its descendants.

## Platform and coverage limits

Keep Run App scripts in the foreground: use `exec your-server` or wait for child
commands instead of daemonizing them. When the launcher exits, its Proc entry is
removed. Core does not search the host for detached or reparented descendants and
does not adopt processes left by previous Core instances.

On other POSIX hosts, targeted `ps -p` identity queries and `pgrep -P` child queries
run only at launch or Stop as needed. Native Windows Core process-tree stopping is
unsupported; Windows Desktop can connect to a Linux Core. POSIX start timestamps
have second precision, whereas Linux uses start ticks.

Discovery and signalling are not OS-atomic: a process can fork, detach or exit
during Stop. Only descendants captured while their ancestry is available are
covered. Every captured PID is checked again before signalling. Core waits for
the launcher's exit or verifies it has stopped before reporting Stop success; it
does not run background discovery to recover detached processes.
