import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
test("CLI init, context, advance and replay use a separate process", async () => {
  const dir = await mkdtemp(join(tmpdir(), "stage-cli-"));
  try {
    const file = join(dir, "state.json"),
      now = "2026-10-04T00:00:00Z",
      plugin = resolve("dist/plugins/ticket.js");
    const run = (args) => {
      const p = spawnSync(
        process.execPath,
        ["dist/cli.js", ...args, "--store", file, "--plugin", plugin],
        { encoding: "utf8" },
      );
      assert.equal(p.status, 0, p.stderr);
      return JSON.parse(p.stdout);
    };
    assert.equal(
      run(["init", "--id", "ticket-1", "--now", now]).instance.nodeId,
      "open",
    );
    assert.equal(run(["context"]).stageName, "Open");
    const event = join(dir, "event.json");
    await writeFile(
      event,
      JSON.stringify({
        id: "e",
        type: "close",
        observedAt: now,
        facts: { resolved: true },
      }),
    );
    const args = ["advance", "--event", event, "--revision", "0", "--now", now];
    assert.equal(run(args).instance.nodeId, "closed");
    assert.equal(run(args).instance.revision, 1);
    assert.equal(run(["show"]).instance.revision, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
