# Protocol-compatible Core releases

`protocol-versions.json` declares the Core server wire version and the client
minimum/maximum independently. Run `node scripts/sync-protocol.mjs` after changing
it. This generates Protocol and Gateway metadata; Gateway imports no sibling
workspace runtime. CI checks that generated declarations are current.

After all CI verification jobs pass for a push to `main` or `dev`, CI creates
immutable Git tags:

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
Hub boundary tests and browser confirmation/lost-response checks. CI tag creation
on GitHub and live cloud Core upgrades require subsequent CI/runtime observation.

The existing `main` branch predates the current HatoPad package layout. It has not
been promoted or given a misleading Core release tag by this change. Stable
installs stop until a current compatible release is explicitly promoted to `main`
and tagged by CI; `dev` remains the development channel.
