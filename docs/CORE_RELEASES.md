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
