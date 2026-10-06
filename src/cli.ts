#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRegistry, projectContext } from "./index.js";
import { JsonStore } from "./json-store.js";
import type { Definition, Plugin, StageEvent, Data } from "./types.js";
async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      store: { type: "string" },
      plugin: { type: "string" },
      definition: { type: "string" },
      id: { type: "string" },
      event: { type: "string" },
      data: { type: "string" },
      revision: { type: "string" },
      now: { type: "string" },
      mapping: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "agent-stage-kit <init|show|context|advance|migrate> --store file --plugin trusted-module.js [--definition file --id id --data file --event file --revision n --now ISO --mapping file]",
    );
    return;
  }
  const command = positionals[0];
  if (
    positionals.length !== 1 ||
    !["init", "show", "context", "advance", "migrate"].includes(command ?? "")
  )
    throw new Error("INVALID_COMMAND");
  if (!values.store || !values.plugin)
    throw new Error("REQUIRED: --store --plugin");
  // Explicit local code supplied by the operator, not untrusted workflow data.
  const module = (await import(pathToFileURL(resolve(values.plugin)).href)) as {
    plugin: Plugin;
    definition?: Definition;
  };
  const registry = createRegistry([module.plugin]),
    store = new JsonStore(values.store, registry);
  const load = async <T>(file: string | undefined): Promise<T> => {
    if (!file) throw new Error("REQUIRED_FILE");
    return JSON.parse(await readFile(file, "utf8")) as T;
  };
  const revision = () => {
    if (
      !values.revision ||
      !/^\d+$/.test(values.revision) ||
      !Number.isSafeInteger(Number(values.revision))
    )
      throw new Error("REQUIRED_VALID_REVISION");
    return Number(values.revision);
  };
  const now = () => {
    if (!values.now) throw new Error("REQUIRED: --now ISO");
    return values.now;
  };
  let result: unknown;
  switch (command) {
    case "init": {
      const d = values.definition
        ? await load<Definition>(values.definition)
        : module.definition;
      if (!d || !values.id) throw new Error("REQUIRED: definition and --id");
      result = await store.init(
        d,
        values.id,
        now(),
        values.data ? await load<Data>(values.data) : {},
      );
      break;
    }
    case "advance":
      result = await store.dispatch({
        expectedRevision: revision(),
        event: await load<StageEvent>(values.event),
        now: now(),
      });
      break;
    case "migrate":
      result = await store.migrate(
        await load<Definition>(values.definition),
        await load<Record<string, string>>(values.mapping),
        revision(),
        now(),
      );
      break;
    case "context": {
      const s = await store.read();
      result = projectContext(s.definition, s.instance, registry);
      break;
    }
    default:
      result = await store.read();
  }
  console.log(JSON.stringify(result, null, 2));
}
main().catch((error) => {
  console.error(
    JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});
