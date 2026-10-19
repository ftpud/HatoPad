import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const { server, client } = JSON.parse(await readFile(new URL("../protocol-versions.json", import.meta.url), "utf8"));
if (
  ![server, client.minimum, client.maximum].every((v) => Number.isSafeInteger(v) && v > 0) ||
  client.minimum > client.maximum
)
  throw Error("Invalid protocol declaration");
const revision = `${git("rev-list", "--count", "HEAD")}.${parseInt(git("rev-parse", "HEAD").slice(0, 12), 16)}`;
for (const tag of [
  `core-protocol-${server}-v0.${revision}`,
  `client-protocol-${client.minimum}-${client.maximum}-v0.${revision}`,
]) {
  let existing;
  try {
    existing = git("rev-parse", "--verify", `refs/tags/${tag}^{commit}`);
  } catch {}
  if (existing && existing !== git("rev-parse", "HEAD")) throw Error(`Refusing to replace ${tag}`);
  if (!existing) git("tag", tag);
  console.log(tag);
}
