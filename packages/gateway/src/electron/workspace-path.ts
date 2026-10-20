const maximumDirectoryLength = 4_096;
const maximumDiscoveredDirectories = 64;

export function validateWorkspaceDirectoryInput(directory: string): string {
  const value = directory.trim();
  if (!value) throw new Error("A remote directory is required");
  if (value.length > maximumDirectoryLength) throw new Error("The remote directory path is too long");
  if (!value.startsWith("/"))
    throw new Error("The remote directory must be an absolute path (for example /home/user/projects/api)");
  if (/[\u0000-\u001f\u007f]/.test(value))
    throw new Error("The remote directory contains unsupported control characters");
  return value;
}

export function quoteWorkspaceShellArgument(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

// A file; the Core state directory ~/.hatopad/workspaces is a different path, hence the distinct name.
const remoteWorkspaceRegistry = "$HOME/.hatopad/gateway-workspaces";

/** Lists registered workspaces first, then direct home folders and conventional project folders. */
export function workspaceDiscoveryCommand(): string {
  return `bash -lc 'set -eu; count=0; emit() { printf "%s\\n" "$1"; count=$((count + 1)); }; registry=${remoteWorkspaceRegistry}; if [ -f "$registry" ]; then while IFS= read -r child; do [ -d "$child" ] || continue; emit "$child"; [ "$count" -ge 64 ] && break; done < "$registry"; fi; [ "$count" -ge 64 ] || emit "$HOME"; for child in "$HOME"/*; do [ "$count" -lt 64 ] || break; [ -d "$child" ] || continue; emit "$child"; done; [ "$count" -ge 64 ] || for name in projects Projects workspace workspaces code Code src repos repositories; do root="$HOME/$name"; [ -d "$root" ] || continue; for child in "$root"/*; do [ -d "$child" ] || continue; emit "$child"; [ "$count" -ge 64 ] && break 2; done; done'`;
}

/** Adds a validated path to the SSH user's durable Gateway workspace registry. */
export function workspaceRegistrationCommand(directory: string): string {
  const value = validateWorkspaceDirectoryInput(directory);
  return `bash -lc ${quoteWorkspaceShellArgument(`set -eu; directory=${quoteWorkspaceShellArgument(value)}; registry=${remoteWorkspaceRegistry}; mkdir -p -- "$HOME/.hatopad"; touch -- "$registry"; grep -Fqx -- "$directory" "$registry" || printf '%s\\n' "$directory" >> "$registry"`)}`;
}

/** Removes a validated path from the SSH user's durable Gateway workspace registry. */
export function workspaceUnregistrationCommand(directory: string): string {
  const value = validateWorkspaceDirectoryInput(directory);
  return `bash -lc ${quoteWorkspaceShellArgument(`set -eu; directory=${quoteWorkspaceShellArgument(value)}; registry=${remoteWorkspaceRegistry}; [ -f "$registry" ] || exit 0; temporary="$registry.tmp.$$"; trap 'rm -f -- "$temporary"' EXIT; while IFS= read -r child; do [ "$child" = "$directory" ] || printf '%s\\n' "$child"; done < "$registry" > "$temporary"; mv -- "$temporary" "$registry"; trap - EXIT`)}`;
}

/** Creates directories, initializes Git for empty standalone workspaces, and validates access. */
export function workspaceValidationCommand(directory: string): string {
  const value = validateWorkspaceDirectoryInput(directory);
  return `bash -lc ${quoteWorkspaceShellArgument(`set -eu; directory=${quoteWorkspaceShellArgument(value)}; mkdir -p -- "$directory"; [ -d "$directory" ] || { echo "Remote directory does not exist or is not a directory" >&2; exit 1; }; [ -r "$directory" ] && [ -x "$directory" ] || { echo "Remote directory is not accessible to this SSH user" >&2; exit 1; }; if [ -z "$(ls -A -- "$directory")" ] && ! git -C "$directory" rev-parse --git-dir >/dev/null 2>&1; then git -C "$directory" init --quiet; fi; cd -- "$directory"; pwd -P`)}`;
}

export function parseDiscoveredWorkspaceDirectories(output: string): string[] {
  const directories: string[] = [];
  for (const line of output.split("\n")) {
    const value = line.trim();
    if (!value || directories.length >= maximumDiscoveredDirectories) continue;
    try {
      if (!directories.includes(validateWorkspaceDirectoryInput(value))) directories.push(value);
    } catch {
      /* Remote filenames outside the strict UI contract are not shown. */
    }
  }
  return directories;
}

export function parseValidatedWorkspaceDirectory(output: string): string {
  const lines = output.trim().split("\n").filter(Boolean);
  if (lines.length !== 1) throw new Error("Could not validate the remote directory");
  return validateWorkspaceDirectoryInput(lines[0]!);
}

/**
 * Idempotent, best-effort move of pre-rename files in the SSH user's home: server pid/log/token/release markers
 * (so a running server is still found and can be stopped) and the workspace registry (copied, because the old
 * install directory may still run). The state directory (`~/.remote-ide`) and the old deployment tree are left in
 * place: a running server may be using them, Core keeps reading the old state directory until `~/.hatopad` exists,
 * and the first connect provisions a fresh release under `~/.hatopad-deploy`. Nothing is deleted.
 */
export function legacyRemoteMigrationCommand(): string {
  const script = [
    'H="$HOME"',
    'for f in "$H"/.vibe-server-*; do [ -e "$f" ] || continue; n="${f##*/.vibe-server-}"; [ -e "$H/.hatopad-server-$n" ] || mv -- "$f" "$H/.hatopad-server-$n"; done',
    'if [ -f "$H/.vibe/workspaces" ] && [ ! -e "$H/.hatopad/gateway-workspaces" ]; then mkdir -p -- "$H/.hatopad" && cp -p -- "$H/.vibe/workspaces" "$H/.hatopad/gateway-workspaces"; fi',
    "true",
  ].join("; ");
  return `bash -lc ${quoteWorkspaceShellArgument(script)}`;
}
