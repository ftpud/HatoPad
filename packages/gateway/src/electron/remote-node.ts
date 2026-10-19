/** Shared by remote provisioning, Core launch, health checks and release reads.
 * Keep /usr/local/bin as a fallback so it cannot shadow an existing PATH runtime. */
export const remoteNodeEnvironment = `export PATH="$HOME/.local/bin:$HOME/.volta/bin:$HOME/.fnm:$PATH:/usr/local/bin"
export NVM_DIR="\${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh" --no-use
  if hatopad_node_version=$(nvm version 24 2>/dev/null); then
    :
  elif hatopad_node_version=$(nvm version node 2>/dev/null); then
    :
  else
    echo 'No installed NVM Node version was found. Install Node 24 with: nvm install 24' >&2
    exit 1
  fi
  nvm use --silent "$hatopad_node_version" >/dev/null || { echo 'Could not select the NVM Node runtime for HatoPad.' >&2; exit 1; }
fi
command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 || { echo 'Node.js and npm were not found on the SSH host. Install Node 24 with NVM for this user.' >&2; exit 127; }
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 12)) { console.error("HatoPad requires Node.js 22.12+ for build and runtime; selected " + process.versions.node + ". Install Node 24 with: nvm install 24"); process.exit(1); }'`;


/** Portable SSH installs may have no system Node/npm or usable NVM installation. */
export function installedNodeEnvironment(release?: string): string {
  if (!release) return `unset HATOPAD_NODE_TOOLCHAIN\n${remoteNodeEnvironment}`;
  if (!/^[a-f0-9]{40,64}-node[0-9]+(?:-repair-[a-zA-Z0-9]+|-bundle-[a-zA-Z0-9-]+)?$/.test(release)) throw Error("Invalid installed Core release");
  return `unset HATOPAD_NODE_TOOLCHAIN
if [ -x "$HOME/.hatopad-deploy/releases/${release}/bin/node" ] && [ -x "$HOME/.hatopad-deploy/releases/${release}/bin/npm" ]; then
  export HATOPAD_NODE_TOOLCHAIN="$HOME/.hatopad-deploy/releases/${release}"
  export PATH="$HATOPAD_NODE_TOOLCHAIN/bin:$PATH"
else
${remoteNodeEnvironment}
fi`;
}
