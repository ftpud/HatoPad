# @hatopad/test-fixtures

A scripted ACP agent and provider definition for end-to-end tests of Core and
its clients. No network or model access. See `agent/fake-agent.mjs` for the
prompt keywords (`PERMISSION`, `QUESTION`, `EDIT`, `SLOW`).

```ts
import { writeFile } from "node:fs/promises";
import { fixtureProviderDefinition } from "@hatopad/test-fixtures";
await writeFile(`${dir}/fixture-agent.json`, JSON.stringify(fixtureProviderDefinition()));
// start Core with HATOPAD_PROVIDER_DEFINITIONS_DIR=dir
```
