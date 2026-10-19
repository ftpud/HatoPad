import { protocolCompatibility } from "./protocol-versions.js";
import type { Compatibility } from "./client-compatibility.js";
export type ProvisionedRelease = { commit: string; rebuilt: boolean; release: string };
const releasePattern = /^[0-9a-f]{40,64}-node[0-9]+(?:-repair-[a-zA-Z0-9]+|-bundle-[a-zA-Z0-9-]+)?$/;
function shell(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function parseProvisionedRelease(output: string): ProvisionedRelease {
  const match = output.match(/(?:^|\n)HATOPAD_RESULT:([0-9a-f]{40,64}):([01]):([^\r\n]+)(?:\r?\n|$)/);
  if (!match || !releasePattern.test(match[3]!) || !match[3]!.startsWith(`${match[1]}-node`))
    throw new Error("Remote release could not be verified");
  return { commit: match[1]!, rebuilt: match[2] === "1", release: match[3]! };
}

/** A successful probe proves the candidate accepts the versioned Core protocol. */
export function coreHealthProbe(port: number, timeoutMs = 180_000): string {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000)
    throw new Error("Invalid Core health timeout");
  return `const {WebSocket}=require('ws');
(async()=>{
 const protocolCompatibility=${JSON.stringify(protocolCompatibility)};
 const deadline=Date.now()+${timeoutMs};
 const probe=()=>new Promise(resolve=>{
  const socket=new WebSocket('ws://127.0.0.1:${port}');
  let finished=false;
  const done=ok=>{if(finished)return;finished=true;clearTimeout(timer);socket.terminate();resolve(ok)};
  const timer=setTimeout(()=>done(false),1000);
  socket.on('error',()=>done(false));socket.on('close',()=>done(false));
  socket.on('open',()=>socket.send(JSON.stringify({id:'gateway-health',type:'protocol.handshake',payload:{compatibility:protocolCompatibility,token:process.env.HATOPAD_SESSION_TOKEN}})));
  socket.on('message',data=>{try{const value=JSON.parse(String(data));if(value.id==='gateway-health')done(value.ok===true&&value.result?.compatible===true)}catch{done(false)}});
 });
 while(Date.now()<deadline){if(await probe())return;await new Promise(resolve=>setTimeout(resolve,200))}
 throw new Error('Core did not pass its protocol health check within ${timeoutMs / 1000} seconds');
})().catch(error=>{console.error(error.message);process.exitCode=1});`;
}

export function serverActivationCommand(
  workspaceId: string,
  workspace: string,
  port: number,
  release: string,
  environment: string,
): string {
  if (
    !/^[A-Za-z0-9_-]{1,200}$/.test(workspaceId) ||
    !releasePattern.test(release) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error("Invalid release activation parameters");
  const probe = shell(coreHealthProbe(port));
  return `set -eu
${environment}
umask 077
base="$HOME/.hatopad-deploy"
mkdir -p "$base"
assert_no_storage_maintenance() {
if [ -e "$base/maintenance.lock" ] || [ -L "$base/maintenance.lock" ]; then
node -e ${shell("const fs=require('node:fs'),os=require('node:os'),p=process.env.HOME+'/.hatopad-deploy/maintenance.lock';try{const raw=fs.readFileSync(p,'utf8'),owner=JSON.parse(raw);if(owner.hostname!==os.hostname()||!Number.isSafeInteger(owner.pid)||owner.pid<1)throw Error('Unknown storage maintenance owner');try{process.kill(owner.pid,0);throw Error('Storage maintenance is running; retry when it finishes')}catch(e){if(e.code!=='ESRCH')throw e}if(fs.readFileSync(p,'utf8')===raw)fs.unlinkSync(p)}catch(e){if(e.code!=='ENOENT'){console.error(e.message);process.exit(1)}}")}
fi
}
assert_no_storage_maintenance
lock="$base/activate-${workspaceId}.lock"
if ! mkdir "$lock" 2>/dev/null; then
  owner=$(cat "$lock/pid" 2>/dev/null || true)
  case "$owner" in ''|*[!0-9]*) echo "Activation is locked by an unknown owner: $lock" >&2; exit 1;; esac
  if kill -0 "$owner" 2>/dev/null; then echo "Activation is locked by PID $owner: $lock" >&2; exit 1; fi
  if mkdir "$lock/recovery" 2>/dev/null; then
    current=$(cat "$lock/pid" 2>/dev/null || true)
    if [ "$current" = "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then rm -rf "$lock"; else rmdir "$lock/recovery"; fi
  fi
  mkdir "$lock" 2>/dev/null || { echo "Activation lock is busy: $lock" >&2; exit 1; }
fi
printf '%s' "$$" > "$lock/pid"
trap 'rm -rf "$lock"' EXIT
assert_no_storage_maintenance
pidfile="$HOME/.hatopad-server-${workspaceId}.pid"
logfile="$HOME/.hatopad-server-${workspaceId}.log"
selection="$HOME/.hatopad-server-${workspaceId}.release"
tokenfile="$HOME/.hatopad-server-${workspaceId}.token"
if [ ! -f "$tokenfile" ]; then
  token_tmp="$tokenfile.$$.$RANDOM.tmp"
  node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))' > "$token_tmp"
  if ! ln "$token_tmp" "$tokenfile" 2>/dev/null; then test -f "$tokenfile" || { rm -f "$token_tmp"; exit 1; }; fi
  rm -f "$token_tmp"
fi
test ! -L "$tokenfile" || { echo 'Core token file must not be a symlink' >&2; exit 1; }
SESSION_TOKEN=$(cat "$tokenfile")
[[ "$SESSION_TOKEN" =~ ^[A-Za-z0-9_-]+$ ]] && [ "\${#SESSION_TOKEN}" -ge 32 ] && [ "\${#SESSION_TOKEN}" -le 256 ] || { echo 'Invalid Core session token file' >&2; exit 1; }
previous=$(cat "$selection" 2>/dev/null || true)
if [ -n "$previous" ] && ! [[ "$previous" =~ ^[0-9a-f]{40,64}-node[0-9]+(-repair-[a-zA-Z0-9]+|-bundle-[a-zA-Z0-9-]+)?$ ]]; then echo 'Stored release reference is invalid; inspect the release sidecar before retrying' >&2; exit 1; fi
${serverStopFunctions(workspaceId, workspace)}
start_server() {
  (cd "$1"; if [ -x "$PWD/bin/node" ]; then export PATH="$PWD/bin:$PATH"; fi; HATOPAD_HUB_PAIRING_FILE="$HOME/.hatopad/cloud-pairings/${workspaceId}.json"; export HATOPAD_HUB_PAIRING_FILE; hub_flag=""; if [ -f "$HATOPAD_HUB_PAIRING_FILE" ]; then hub_flag="--hub-connect"; fi; entry="packages/core/dist/index.js"; if [ -f scripts/core-release-service.mjs ] && grep -q HATOPAD_CORE_RELEASE_MODE packages/core/dist/index.js 2>/dev/null; then entry="scripts/core-release-service.mjs"; HATOPAD_CORE_RELEASE_ROOT="$base"; HATOPAD_CORE_RELEASE_SELECTION="$selection"; export HATOPAD_CORE_RELEASE_ROOT HATOPAD_CORE_RELEASE_SELECTION; fi; HATOPAD_SESSION_TOKEN="$SESSION_TOKEN" nohup node "$entry" $hub_flag --host 127.0.0.1 --port ${port} --gateway-workspace-id ${workspaceId} --workspace ${shell(workspace)} > "$logfile" 2>&1 < /dev/null & echo $! > "$pidfile")
}
health() { (cd "$1"; if [ -x "$PWD/bin/node" ]; then export PATH="$PWD/bin:$PATH"; fi; HATOPAD_SESSION_TOKEN="$SESSION_TOKEN" node --input-type=commonjs -e ${probe}); }
candidate="$base/releases/${release}"
test -f "$candidate/packages/core/dist/index.js"
restore_previous() {
  rollback=""
  if [ -n "$previous" ]; then rollback="$base/releases/$previous"; elif [ -f "$HOME/.vibe/packages/core/dist/index.js" ]; then rollback="$HOME/.vibe"; fi
  if [ -n "$previous" ]; then printf '%s' "$previous" > "$selection.tmp"; mv "$selection.tmp" "$selection"; else rm -f "$selection"; fi
  if [ -n "$rollback" ]; then
    start_server "$rollback"
    if health "$rollback"; then echo 'Previous Core release restored' >&2; else echo 'Previous Core also failed health verification; inspect remote logs' >&2; fi
  fi
}
switched=0
promoted=0
cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ "$switched" = 1 ] && [ "$promoted" != 1 ]; then
    if stop_server; then restore_previous || true; else echo 'Could not stop candidate safely; manual recovery required' >&2; fi
  fi
  rm -rf "$lock"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
stop_server
switched=1
if [ -f "$logfile" ]; then cp "$logfile" "$logfile.previous"; fi
start_server "$candidate"
if health "$candidate" && is_running "$(cat "$pidfile")"; then
  if [ -n "$previous" ]; then printf '%s' "$previous" > "$selection.previous.tmp"; mv "$selection.previous.tmp" "$selection.previous"; fi
  printf '%s' ${shell(release)} > "$selection.tmp"
  mv "$selection.tmp" "$selection"
  promoted=1
  echo HATOPAD_ACTIVATED:${release}
else
  echo 'Candidate Core failed its health check. Candidate log:' >&2
  tail -n 40 "$logfile" >&2 || true
  exit 1
fi`;
}

/** A marker is evidence to verify, never permission to replay activation. */
export async function activateRelease(
  release: string,
  activate: (onOutput: (line: string) => void) => Promise<unknown>,
  verify: () => Promise<unknown>,
  onOutput?: (line: string) => void,
): Promise<void> {
  let reported = false;
  try {
    await activate((line) => {
      if (line.trim() === `HATOPAD_ACTIVATED:${release}`) reported = true;
      onOutput?.(line);
    });
    if (!reported) throw new Error("Remote activation did not confirm the requested release");
  } catch (error) {
    if (!reported) throw error;
    // The remote shell can lose its channel or exit nonzero after promotion.
    // Reconnect and verify the committed release plus authenticated Core health.
    try {
      await verify();
    } catch (verificationError) {
      throw new Error(
        `Core reported activation, but its release and health could not be verified after reconnecting: ${verificationError instanceof Error ? verificationError.message : String(verificationError)}. Original activation result: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export function activatedReleaseVerificationCommand(
  workspaceId: string,
  port: number,
  release: string,
  environment: string,
): string {
  if (!releasePattern.test(release) || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid release verification parameters");
  return `set -eu
${environment}
${workspaceReleaseDirectory(workspaceId)}
[ "$release" = ${shell(release)} ] || { echo 'Selected Core release does not match the requested activation' >&2; exit 1; }
tokenfile="$HOME/.hatopad-server-${workspaceId}.token"
test ! -L "$tokenfile" || { echo 'Core token file must not be a symlink' >&2; exit 1; }
SESSION_TOKEN=$(cat "$tokenfile")
[[ "$SESSION_TOKEN" =~ ^[A-Za-z0-9_-]+$ ]] && [ "\${#SESSION_TOKEN}" -ge 32 ] && [ "\${#SESSION_TOKEN}" -le 256 ] || { echo 'Invalid Core session token file' >&2; exit 1; }
cd "$release_directory"
HATOPAD_SESSION_TOKEN="$SESSION_TOKEN" node --input-type=commonjs -e ${shell(coreHealthProbe(port, 10_000))}`;
}

/** Resolve the release belonging to this workspace, with a legacy installation fallback. */
export function workspaceReleaseDirectory(workspaceId: string): string {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(workspaceId)) throw new Error("Invalid workspace identity");
  return `release=$(cat "$HOME/.hatopad-server-${workspaceId}.release" 2>/dev/null || true); if [ -n "$release" ]; then [[ "$release" =~ ^[0-9a-f]{40,64}-node[0-9]+(-repair-[a-zA-Z0-9]+|-bundle-[a-zA-Z0-9-]+)?$ ]] || { echo 'Invalid deployed release reference' >&2; exit 1; }; release_directory="$HOME/.hatopad-deploy/releases/$release"; else release_directory="$HOME/.vibe"; fi`;
}

function serverStopFunctions(workspaceId: string, workspace: string): string {
  return `is_running() {
  kill -0 "$1" 2>/dev/null || return 1
  state=$(ps -p "$1" -o stat= 2>/dev/null || true)
  case "$state" in Z*|'') return 1;; *) return 0;; esac
}
stop_server() {
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    case "$pid" in ''|*[!0-9]*) echo 'Invalid Core PID file' >&2; return 1;; esac
    if is_running "$pid"; then
      command=$(ps -p "$pid" -o args= 2>/dev/null || true)
      expected_workspace=${shell(workspace)}
      case "$command" in
        *'packages/core/dist/index.js'*'--gateway-workspace-id ${workspaceId} '*|*'scripts/core-release-service.mjs'*'--gateway-workspace-id ${workspaceId} '*) ;;
        *'packages/core/dist/index.js'*"--workspace $expected_workspace"|*'scripts/core-release-service.mjs'*"--workspace $expected_workspace") ;;
        *) echo "Refusing to stop PID $pid: it is not this workspace's Core process" >&2; return 1;;
      esac
    fi
    kill "$pid" 2>/dev/null || true
    for ((attempt=0; attempt<350; attempt++)); do is_running "$pid" || break; sleep 0.1; done
    if is_running "$pid"; then echo "Core PID $pid did not stop; preserving its release" >&2; return 1; fi
    rm -f "$pidfile"
  fi
}
`;
}

export function serverStopCommand(workspaceId: string, workspace: string, environment: string): string {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(workspaceId)) throw new Error("Invalid workspace identity");
  return `set -eu
${environment}
base="$HOME/.hatopad-deploy"
mkdir -p "$base"
lock="$base/activate-${workspaceId}.lock"
mkdir "$lock" 2>/dev/null || { echo "Workspace activation is busy: $lock" >&2; exit 1; }
printf '%s' "$$" > "$lock/pid"
trap 'rm -rf "$lock"' EXIT
pidfile="$HOME/.hatopad-server-${workspaceId}.pid"
${serverStopFunctions(workspaceId, workspace)}
stop_server`;
}

/** Coalesce duplicate clicks and keep conflicting operations off the same workspace. */
export class WorkspaceOperations {
  private readonly pending = new Map<string, { action: string; promise: Promise<unknown> }>();
  run<T>(workspaceId: string, action: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(workspaceId);
    if (existing) {
      if (existing.action === action) return existing.promise as Promise<T>;
      return Promise.reject(
        new Error(`Workspace is busy with ${existing.action}; wait for it to finish or cancel provisioning`),
      );
    }
    const promise = Promise.resolve()
      .then(operation)
      .finally(() => {
        if (this.pending.get(workspaceId)?.promise === promise) this.pending.delete(workspaceId);
      });
    this.pending.set(workspaceId, { action, promise });
    return promise;
  }
}

/** A bundled Gateway must not replace a compatible Git release (for example a Hub-updated, supervised Core) with its bundle. */
export function keptGitReleaseCommand(release: string, environment: string): string {
  if (!releasePattern.test(release) || release.includes("-bundle-")) throw new Error("Invalid kept release identity");
  return `set -eu
${environment}
release_directory="$HOME/.hatopad-deploy/releases/${release}"
[ -d "$release_directory/.git" ] && [ -f "$release_directory/packages/core/dist/index.js" ] || exit 0
cd "$release_directory"
node --input-type=module -e ${shell("import { protocolCompatibility } from './packages/protocol/dist/index.js'; console.log('HATOPAD_KEPT:' + JSON.stringify(protocolCompatibility))")}`;
}
export function parseKeptGitRelease(
  output: string,
  release: string,
  gateway: Compatibility,
): ProvisionedRelease | undefined {
  const line = output.split(/\r?\n/).find((item) => item.startsWith("HATOPAD_KEPT:"));
  if (!line || !releasePattern.test(release) || release.includes("-bundle-")) return undefined;
  try {
    const range = JSON.parse(line.slice("HATOPAD_KEPT:".length)) as Compatibility;
    const valid =
      Number.isSafeInteger(range.minimum) &&
      Number.isSafeInteger(range.maximum) &&
      range.minimum >= 1 &&
      range.minimum <= range.maximum;
    if (!valid || range.minimum > gateway.maximum || gateway.minimum > range.maximum) return undefined;
    return { commit: release.slice(0, release.indexOf("-node")), rebuilt: false, release };
  } catch {
    return undefined;
  }
}
