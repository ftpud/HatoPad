# Early Access bundles

Run **Actions → Bundle Create → Run workflow** on the commit or branch you want
packaged. Packaging script, bundle workflow, and renderer navigation policy
changes pushed to `main` also start Bundle Create automatically. The workflow
temporarily builds macOS applications only and uploads `hatopad-early-access-macos-15`.
Windows application bundles and release promotion are paused. Linux Core bundles
are still built for remote hosts. Download and extract the artifact wrapper;
it contains a Gateway installer, a standalone Desktop ZIP, and JSON manifests
with their version, source commit and SHA-256 checksum. No GitHub release is
published automatically. Change the root `package.json` version before building
bundles for a new version.

## Promote a build to a GitHub release

Once the **Bundle Release** workflow is on the default branch:

1. Open a successful **Bundle Create** run and copy its numeric run ID from the
   Actions URL (`.../actions/runs/123456789`). Existing builds can be promoted.
2. Open **Actions → Bundle Release → Run workflow**. Enter that run ID and a
   new tag matching the bundle version, for example `v0.1.0`, then run the workflow.

The action publishes full GitHub releases and marks them **Latest**. The tag must
match the version in the macOS Gateway bundle manifest (taken from the root
`package.json` when built). For each new release, bump the root `package.json`
version (for example from `0.1.0` to `0.1.1`), build again, and publish `v0.1.1`.
The applications remain Early Access; release notes retain that label and the
signing information. Promoting a build preserves its embedded version and filenames.

The action verifies the macOS Gateway DMG against its manifest
and source commit, creates the tag at the build's commit, and publishes only
the macOS Gateway installer and its JSON manifest on the repository's **Releases**
page. Gateway includes the embedded Desktop; standalone Desktop bundles remain
available as build artifacts. It promotes the existing files
without rebuilding. The built-in GitHub token supplies the required permissions;
no additional secret is needed. Existing tags and releases are refused.

Promote before the application artifacts expire (30 days after the build).
Expired or deleted artifacts require another **Bundle Create** run. Release
assets remain available independently of workflow artifact retention. If an
upload fails after draft creation, inspect and remove the incomplete draft and
its tag before retrying with the same tag, or use a new tag.

Gateway downloads use native installation formats: open the Apple Silicon macOS
`.dmg` and drag **HatoPad Gateway** to **Applications**, or run the Windows x64
`-setup.exe`. Windows installs for the current user without administrator access,
adds a Start menu shortcut, and supports uninstalling from Windows Settings.
Close Gateway and its embedded Editor before reinstalling or upgrading.
Standalone Desktop downloads remain portable ZIPs; extract the entire ZIP before
launching and keep the Windows application's files together.
Start with **HatoPad Gateway** to configure connections and workspaces. Gateway
contains its own complete Desktop application; users can also download Desktop
separately to connect to an existing Core.

Existing ZIP-only build runs cannot be promoted by the installer release action;
run **Bundle Create** again after this packaging change.

These are unsigned Early Access distributions (macOS uses ad-hoc signing).
macOS builds can opt into Developer ID signing and notarization as described
below. Windows certificate signing is not configured.
Test the resulting downloads on clean macOS and Windows machines
before distributing them outside the Early Access group.

## Signed macOS builds

On an Apple Silicon Mac with Node 22.12+ and Xcode, import a **Developer ID
Application** certificate and its private key into the login Keychain. Confirm
it appears in `security find-identity -v -p codesigning`. Store notarization
credentials once (the command prompts for an Apple app-specific password):

```bash
xcrun notarytool store-credentials "hatopad-notary" \
  --apple-id "YOUR_APPLE_ACCOUNT_EMAIL" --team-id "YOUR_TEAM_ID"
```

Keep certificates, private keys and passwords outside the repository. Select the
certificate by its full name from `security find-identity`, then build:

```bash
export HATOPAD_MAC_SIGN_IDENTITY="Developer ID Application: YOUR_NAME (YOUR_TEAM_ID)"
export HATOPAD_NOTARY_PROFILE="hatopad-notary"
npm run build
npm run bundle:core -- --sign
npm run bundle:apps -- --local --sign
```

`--local` includes only macOS Core. Omit it when the matching Linux Core artifacts
from the same commit are also available. Signed app builds require a signed,
notarized macOS Core artifact from the same identity. Rebuild Core when changing
the certificate; do not edit manifests or reuse unsigned Core archives.

Core signing covers Mach-O executables and native modules before archiving and
smoke testing, and submits a temporary ZIP to notarize those binaries. Command
line tools cannot carry stapled tickets. Node retains JIT access and can load
native modules from separately installed providers. Both Electron apps are signed with the
hardened runtime, smoke-tested, notarized and stapled before archiving. Gateway's
DMG is also signed, notarized and stapled. Gatekeeper checks must pass before a
signed app build succeeds. JSON download manifests record signing identity and
notarization status, with checksums calculated after stapling.

Apple submission responses are retained beside the Core archive and Gateway DMG,
and in each packaged app's output directory. Rejections also save Apple's log;
failed notarization never produces a new successful download manifest. Apple can
take longer to process the first submission from a new developer account. If a
submission exceeds the one-hour wait, use `notarytool history` with the same
Keychain profile to inspect its status before retrying.

Without `--sign`, builds retain ad-hoc macOS signing. GitHub Actions uses
that mode until signing is enabled as described below.
Release promotion preserves the existing artifacts; it does not add signing.

### GitHub Actions signing

In repository **Settings → Secrets and variables → Actions**, add these
**repository secrets** (never put their values in workflow YAML or Git):

| Secret                        | Value                                                                     |
| ----------------------------- | ------------------------------------------------------------------------- |
| `MAC_CERTIFICATE_P12_BASE64`  | Base64-encoded Developer ID Application `.p12`, including its private key |
| `MAC_CERTIFICATE_PASSWORD`    | Password protecting the `.p12`                                            |
| `MAC_SIGN_IDENTITY`           | Full `Developer ID Application: NAME (TEAM_ID)` certificate name          |
| `APPLE_ID`                    | Apple Account email used for notarization                                 |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization                                    |
| `APPLE_TEAM_ID`               | Developer team ID                                                         |

To copy the certificate's encoded contents without writing another file, run
`base64 -i /path/to/certificate.p12 | pbcopy` on macOS and paste into the secret's
value field. Clear the clipboard afterward. Git ignores `.p12`, `.pfx`, `.p8`,
`.key`, Keychain files and `.env*` files as an additional safeguard; credentials
still belong outside the checkout.

Then add repository **variable** `HATOPAD_MAC_SIGNING` with value `true` and run
**Bundle Create**. Signing is applied to the macOS Core job and macOS app job.
Missing credentials or failed signing/notarization fail the build instead of
falling back to ad-hoc signing. Linux and Windows remain on their existing paths.

Each macOS job imports the certificate into a temporary runner Keychain, stores
notarization credentials there, deletes the imported `.p12` immediately, and
removes the Keychain in an `always()` cleanup step. Passwords are passed through
step environment variables, never written to repository files or artifacts.
Credential-management commands suppress subprocess output and sanitize failures
so command arguments cannot leak passwords into logs. Packaging steps receive
only the public identity and Keychain reference. Secrets are exposed only to the
setup step, and signing runs on trusted push/manual workflows rather than pull
request workflows. Only run signed builds from code you trust.

Release notes reflect the selected build's signing metadata, including older
unsigned builds. Enabling signing does not change already-created artifacts.

## Bundled runtime behavior

Gateway downloads include these three portable Core archives. Standalone Desktop
downloads contain the client only:

| Target         | Core host                                       |
| -------------- | ----------------------------------------------- |
| `linux-x64`    | Linux x64, including x64 WSL2 distributions     |
| `linux-arm64`  | Linux ARM64, including ARM64 WSL2 distributions |
| `darwin-arm64` | Apple Silicon Mac                               |

Each Core archive contains compiled ACP, protocol and Core packages, locked
production dependencies (including native PTY support), and a matching Node
binary and npm. AI provider agents are installed from Settings → AI providers,
and the Java runtime and language server from Settings → Tools, on the Core host.
The archive is built and smoke-tested on its own target architecture. The smoke
check starts a native PTY and starts, authenticates to, stops and restarts Core
with its staged Node runtime. CI also launches both packaged applications and
Gateway’s embedded Editor (`--hatopad`) with `--bundle-smoke-test` to check renderer/preload
loading and bundled mode before archiving. Applications only accept Core artifacts from the
same source commit and validate their SHA-256 digests before packaging.

Packaged Gateway is identified by Electron's `app.isPackaged`, and requires a
valid bundled manifest. There is no environment switch that silently falls back
to Git provisioning. Repository/branch/auto-update controls are hidden and their
IPC handler is disabled. Saved repository preferences have no effect on bundled
provisioning.

On a Mac, local connections unpack the matching bundled Core into Gateway's
application-data cache and launch it with its own Node runtime. Gateway ships the
Editor's application files, not a second Electron runtime, and starts the Editor
by running its own executable with `--hatopad`, including for SSH connections.
The Editor keeps the standalone HatoPad's settings directory. It never
fetches Desktop code from the Core host in this mode.

For SSH hosts, Gateway detects the target OS/architecture, uploads the matching
archive over SFTP into a private temporary directory, verifies the checksum
again on the host, smoke-checks the extracted runtime, and atomically installs
it under `~/.hatopad-deploy/releases/`. Release names include the source commit,
Node ABI, workflow build/attempt and target. Repeated builds and source builds
do not overwrite each other. Existing activation, authenticated health checks,
rollback and stop behavior are reused. Repair installs another immutable copy
of the shipped Core rather than rebuilding or fetching source.

Windows Gateway uses SSH connections to Linux/WSL hosts. Automatic startup in a
local WSL distribution is not implemented. Enable SSH in the intended WSL2
distribution and configure it as an SSH connection. Windows-native Core and
Intel macOS Core are not shipped. Standalone Desktop connects to an existing
Core; it does not ship Core archives or start a server.

Core hosts still need Git and the tools required by users' projects. SSH hosts
need Bash, tar and either `sha256sum` or `shasum`, and writable application-data
and workspace directories. No system Node/npm, source checkout, compiler or
application dependency installation is needed to deploy a bundled Core. Linux
builds target Ubuntu 22.04 or compatible glibc distributions; Alpine/musl is not
supported. AI account login and user-configured external tools remain host
configuration, and are not included in artifacts.

## Source edition

`npm run gateway`, development scripts and the open-source checkout retain the
existing repository settings, remote Git/install/build provisioning and
remote-built Desktop download behavior. Packaging does not change that flow.

## Local build commands

After `npm ci` and building the relevant workspaces:

- `npm run bundle:core` on each supported Core host architecture writes its
  archive and metadata to `artifacts/cores/`.
- Collect all three Core archives **and** JSON metadata from the same commit
  into `artifacts/cores/` on macOS ARM64 or Windows x64.
- `npm run build && npm run bundle:apps` creates both application downloads
  under `artifacts/downloads/` using the lockfile's Electron version. On Windows,
  install NSIS 3.11 first (`choco install nsis --version=3.11 --yes`); set
  `HATOPAD_MAKENSIS` to use a compiler outside its default Program Files location.
  macOS uses its built-in `hdiutil`. The Windows build silently installs Gateway
  into a temporary directory and smoke-tests Gateway and its embedded Editor
  before uninstalling; macOS verifies the resulting disk image. Chromium
  UI translations other than English are removed from both applications.

`artifacts/` is ignored by Git. Build workflows do not publish, commit generated
files or read local provider/MCP credentials, and have read-only permissions.
Only the manually triggered **Bundle Release** workflow has release write access.
