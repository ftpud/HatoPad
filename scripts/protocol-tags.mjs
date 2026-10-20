import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const channelFlag = process.argv.indexOf("--channel");
const channel = channelFlag > 0 ? process.argv[channelFlag + 1] : process.env.PROTOCOL_CHANNEL;
if (channel !== "main" && channel !== "dev") throw Error("Protocol tags require --channel main|dev");
const { server, client } = JSON.parse(await readFile(new URL("../protocol-versions.json", import.meta.url), "utf8"));
if (
  ![server, client.minimum, client.maximum].every((v) => Number.isSafeInteger(v) && v > 0) ||
  client.minimum > client.maximum
)
  throw Error("Invalid protocol declaration");
const head = git("rev-parse", "HEAD");
const revision = `${git("rev-list", "--count", "HEAD")}.${parseInt(head.slice(0, 12), 16)}`;
const families = [
  `core-protocol-${server}-${channel}-v`,
  `client-protocol-${client.minimum}-${client.maximum}-${channel}-v`,
];
const current = families.map((family) => `${family}0.${revision}`);
if (process.argv.includes("--obsolete")) {
  // Superseded tags of the same channel and protocol declaration. Only ancestors of HEAD qualify, so a run for an
  // older commit can never remove a tag created for something newer.
  for (const family of families)
    for (const tag of git("tag", "--list", `${family}*`).split("\n").filter(Boolean)) {
      if (current.includes(tag) || !tag.startsWith(family) || !/^0\.\d+\.\d+$/.test(tag.slice(family.length))) continue;
      try {
        git("merge-base", "--is-ancestor", `refs/tags/${tag}^{commit}`, head);
      } catch {
        continue;
      }
      console.log(tag);
    }
} else
  for (const tag of current) {
    let existing;
    try {
      existing = git("rev-parse", "--verify", `refs/tags/${tag}^{commit}`);
    } catch {}
    if (existing && existing !== head) throw Error(`Refusing to replace ${tag}`);
    if (!existing) git("tag", tag);
    console.log(tag);
  }
