# Protocol-compatible Core releases

`protocol-versions.json` declares the Core server wire version and the client
minimum/maximum independently. Run `node scripts/sync-protocol.mjs` after changing
it. This generates Protocol and Gateway metadata; Gateway imports no sibling
workspace runtime. CI checks that generated declarations are current.

The dedicated `Protocol tags` workflow validates declarations, generated metadata
and protocol tests for pushes to `main` or `dev`, then creates immutable Git tags.
It operates independently of the manually disabled full CI workflow:

- `core-protocol-<server>-v0.<commit-count>.<commit-prefix-number>`
- `client-protocol-<minimum>-<maximum>-v0.<commit-count>.<commit-prefix-number>`

The final numeric component is the first twelve hexadecimal commit characters
converted to a number. It avoids collisions between branches with equal commit
counts. Re-running CI is idempotent; an existing tag is never replaced. Tags do
not publish packages, create downloadable binary releases, or deploy machines.

Gateway source provisioning fetches tags and selects the newest compatible Core
tag reachable from the configured branch. It never substitutes an incompatible
branch HEAD. Disabling auto-update preserves a previously selected commit only
while its tag remains compatible with the current client. No compatible tag means
installation stops with an explanation. Manually published Early Access bundles
include each Core's server protocol version; unknown/incompatible bundles are
never proposed as cloud Core updates. SSH installation can fall back to source
provisioning when a bundle is incompatible.

Cloud Core updates require an owner account and a matching saved local/SSH
management connection. Gateway checks Git for a compatible release, shows the tag,
and asks before downloading/building and restarting. For hub-dev.hatopad.dev it
uses `dev`; for hub-test.hatopad.dev it uses `main`; other Hubs use the configured
branch. It pins and rechecks the commit after acquiring the workspace lock.
SSH uses existing staged provisioning, activation health checks and rollback.
Local builds are staged under Gateway userData using Node/npm from the bundle
(or the source launcher's npm). The previous process is stopped only after a
successful build; the chosen local release is saved for subsequent starts.
Local source builds require Git and any native compilation prerequisites.
Build failure leaves existing artifacts intact. Neither path retries an uncertain
activation automatically. Refresh authoritative state before a deliberate retry.

New Cores advertise `core.gitUpdate` for `core.update.check`/`core.update.apply`.
For source Cores started with `npm run core`, the Git launcher enables updates.
It refuses dirty, moved or diverged installations, wrong branches, stale approvals
and concurrent updates. It stages a detached worktree, installs/builds/smoke-checks
there, rechecks the source checkout, fast-forwards it, and runs the staged Core.
If preparation fails, the previous Core restarts. A failure after the new Core
starts requires operator inspection; this launcher does not migrate or roll back
workspace state. Generated artifacts in the original checkout are rebuilt on the
next ordinary `npm run core`. Direct/bundled Core launches report Git self-update as unavailable; use Gateway management for those installations.

The Hub consumes the public protocol as a packed artifact. Its relay only allows
installation checks/updates from the owner on the deployment's configured branch.
No browser command, path or repository URL is accepted by the Core update API.
An interrupted response is reported as uncertain and is never replayed.

Verified locally: full build and root typecheck; Protocol/Core/Gateway tests;
real Git launcher success/build-failure fixtures; tag generation/idempotency;
Gateway compatible tag selection, stale approval and local staging failures;
Hub boundary tests and browser confirmation/lost-response checks. Live cloud Core upgrades require subsequent runtime observation.

The existing `main` branch predates the current HatoPad package layout. It has not
been promoted or given a misleading Core release tag by this change. Stable
installs stop until a current compatible release is explicitly promoted to `main`
and tagged by CI; `dev` remains the development channel.

## Maintenance connections and older installations

Core update discovery uses `protocol.maintenance`, independently of the workspace
handshake. It authenticates the local token, reports workspace compatibility, and
accepts only update checks, update application and keep-alives. It never initializes
workspace services or permits normal workspace requests. The connector injects its
local token for this operation just as it does for the normal handshake; Hub grants
still apply, and only owners can check/apply installation updates. Tag selection
uses the requesting client's protocol range, which the launcher revalidates before
building a pinned release. This permits recovery from a workspace wire mismatch.

A Core/connector predating this operation needs one external upgrade through
Gateway's saved local/SSH management connection or its server launcher. An older
binary cannot acquire an updater by refreshing the browser. Unknown maintenance
requests fail before the normal handshake. Browser background summaries first
verify maintenance support and compatibility, so they do not automatically start
older/incompatible workspace services. Owners retain update guidance when Core is
offline, incompatible or unmanaged. A failed explicit connection shows an error
and a route back to update options, and stops reconnection on that view.

Temporary-Core tests verify authenticated maintenance, denied workspace operations,
repeated incompatible handshakes, and disconnects immediately after successful
handshakes without terminating Core. These do not diagnose a particular running
Core crash: its launch location and actual error/exit information are still needed.

## Gateway cloud updates from GitHub

Gateway reads the authenticated Hub `/api/environment` endpoint for its release
branch and supported client protocol range. `hub-dev` advertises `dev`; `hub-test`
advertises `main`, unless the Hub operator explicitly overrides its release branch.
Gateway intersects that range with its installed Editor's supported range and
selects the newest immutable `core-protocol-*` tag reachable from that branch.
Missing, malformed or disjoint protocol requirements fail closed with a specific
status. No branch is promoted or incompatible HEAD installed to satisfy a check.

Release discovery runs through Git on the Gateway host, independently of the
remote Core's workspace protocol, Node and Git setup. A source Gateway can use
this path without a bundled Core. Local installs build the approved Git commit
in Gateway's private release cache; SSH installs fetch and build the exact approved
commit on their host. SSH deployment still requires Git access, Node/npm and native
build prerequisites there; it can reuse a portable installed Node/npm runtime.
Both paths recheck the selection before deployment and validate the actual built
protocol, including reused cached releases. Tags alone do not establish compatibility.
The previous installed release survives build failure. Uncertain deployment outcomes
are never automatically replayed or retried through a bundled fallback.

Saved local/SSH management access and an exact Hub/Core pairing identity are
required to replace a Core. A cloud account alone does not give Gateway SSH access
to an arbitrary machine. A Core installed manually or from another Gateway profile
needs its original management connection; Gateway does not guess a workspace,
adopt credentials or replace another server. Unreachable SSH hosts are distinguished
from a successfully inspected host with no matching pairing. Apple Silicon Homebrew
Node is available in remote command PATH. A stopped local Core retains its saved
Git release identity across Gateway restarts.

Update status uses an intrinsic-height row capped at two lines with full text in
its tooltip and an independent retry button. The Core collection owns the remaining
viewport. Browser checks at 1000×700 and 800×600 verify a 30–34px status row and a
visible Core collection without page overflow. Gateway build/typecheck, 35 renderer
and 126 Electron tests pass, including Hub metadata validation, protocol-tag rejection,
actual-build protocol mismatch, immutable release preservation and independent retry.

Restart a source Gateway from the updated checkout with `npm run gateway` to load
Electron changes. Hub must also serve the new protocol metadata. These checks use
fixtures: the reported Mac/WSL hosts have not been updated or restarted, and no
Gateway bundle was published as part of this change.

## Supervised cloud Core releases

Gateway-deployed SSH cloud Cores previously ran `node packages/core/dist/index.js`
directly, so Hub reported "This installation is not managed by the Git Core launcher".
Activation now starts releases that contain `scripts/core-release-service.mjs` (and a
Core built with `HATOPAD_CORE_RELEASE_MODE`) under that supervisor; older releases
still start directly. The supervisor only manages releases located at
`~/.hatopad-deploy/releases/<commit>-node<ABI>`, otherwise Core runs unmanaged.
Non-cloud checkouts keep using `scripts/core-service.mjs` unchanged.

A Hub owner update (or Gateway's update action, which asks the Core through Hub first)
works like this: Core keeps serving while the supervisor takes the provision and
activation locks, verifies the pinned tag, clones the current release, installs,
builds, smoke-tests and publishes a new immutable release. Only then does Core stop.
The supervisor writes `.release.previous` and the selection file, starts the new Core
and waits for its ready message (`HATOPAD_CORE_READY_TIMEOUT_MS`, default 180 s). A
Core that exits or never reports ready is stopped, the previous selection restored
and the previous release restarted. A staging failure aborts before any stop, so a
failed build costs no downtime. The supervisor keeps the PID recorded by Gateway,
and Gateway's stop check recognizes it.

Gateway uses SSH only when the Core cannot take a Hub-directed update (unmanaged,
older, offline). That deployment starts the supervised launcher, so one SSH update
converts an old Core. A failure of the Hub apply request is uncertain and is never
retried over SSH. Gateway still needs its saved management connection to identify the
workspace and confirm the selected release.

Verified with fixtures: supervisor success, build-failure and unready-rollback
scenarios, unmanaged layout fallback, release-mode Core update checks, Gateway
activation/stop under the supervisor, and the Hub-first/SSH-fallback update flow. No
real cloud host has been updated.

Local Gateway Cores follow the same path: a release in Gateway's `core-releases` cache
that contains the supervisor is started under it (`HATOPAD_CORE_RELEASES_DIR` points at
the cache). The supervisor records the release it switched to in
`core-releases/selected-<workspaceId>`; Gateway prefers that file over its saved commit
on restart and when reporting the current release. Bundled (non-Git) local Cores and
source checkouts are still unmanaged and are updated through Gateway.

## Crash restart and start on boot

The release supervisor restarts a Core that exits with a non-zero code, with backoff
(1 s doubling to 30 s). After five crashes in ten minutes it stops and logs why.
Exit code 0 (a deliberate stop, SIGTERM from Gateway) and updates are unchanged.
Settings for tests: `HATOPAD_CORE_RESTART_DELAY_MS`, `HATOPAD_CORE_MAX_CRASHES`.

Gateway's cloud server page has an owner-only **Start on boot** switch. It writes
`~/.hatopad-deploy/autostart-<workspace>.sh`, which resolves the currently selected
release on every start (so a Hub-updated Core boots on its new release) and refuses
releases without the supervisor. The switch refuses to turn on for a Core that is not
managed yet. How it is installed:

| Host | Mechanism | Guarantee |
| --- | --- | --- |
| Linux with a systemd user session | `~/.config/systemd/user/hatopad-core-<id>.service`, enabled, plus `loginctl enable-linger` | Starts at boot. If lingering cannot be enabled it starts at login only, and Gateway says so |
| Linux without systemd user services | `crontab` `@reboot` entry marked `hatopad-autostart-<id>` | Starts at boot |
| macOS (local or SSH) | `~/Library/LaunchAgents/dev.hatopad.core.<id>.plist` with `RunAtLoad` | Starts when the user logs in, not at power-on |
| Windows | Not supported | |

Turning it off removes the unit, plist or cron line and the boot script; a running Core
keeps running. Stopping a Core from Gateway does not disable start on boot. The switch
is a host-level change, so it needs the saved local/SSH connection and Hub ownership,
and shares the per-workspace operation lock with updates. Hub cannot start a stopped
Core; start on boot and Gateway Start are the ways back.

Verified with fixtures: supervisor restart and crash-loop stop, the boot script for SSH
and local layouts, systemd and cron install/status/remove against stubbed tools, input
validation, and the Gateway switch (owner, operator, declined confirmation). The launchd
branch and a real reboot have not been exercised.
