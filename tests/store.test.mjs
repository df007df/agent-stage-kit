import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore } from "../dist/json-store.js";
import { createRegistry } from "../dist/index.js";
const now = "2026-10-04T00:00:00Z",
  p = {
    id: "t",
    version: "1",
    guards: { yes: () => ({ pass: true, reason: "ok" }) },
  },
  r = createRegistry([p]);
const d = {
  id: "d",
  version: "1",
  plugin: { id: "t", version: "1" },
  initial: "a",
  nodes: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
  ],
  edges: [{ id: "ab", from: "a", to: "b", guard: "yes" }],
};
const event = { id: "e", type: "go", observedAt: now, facts: {} };
test("atomic snapshot stores replay and rejects changed payload or stale revision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "stage-store-"));
  try {
    const s = new JsonStore(join(dir, "state.json"), r);
    await s.init(d, "i", now);
    const first = await s.dispatch({ expectedRevision: 0, event, now });
    const replay = await new JsonStore(join(dir, "state.json"), r).dispatch({
      expectedRevision: 0,
      event,
      now,
    });
    assert.deepEqual(replay, first);
    await assert.rejects(
      s.dispatch({
        expectedRevision: 1,
        event: { ...event, type: "other" },
        now,
      }),
      /EVENT_CONFLICT/,
    );
    await assert.rejects(
      s.dispatch({ expectedRevision: 0, event: { ...event, id: "new" }, now }),
      /REVISION_CONFLICT/,
    );
    assert.equal((await s.read()).instance.revision, 1);
    await assert.rejects(s.init(d, "i", now), /ALREADY_EXISTS/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("exclusive writer lock fails closed; invalid event leaves state unchanged and releases lock", async () => {
  const dir = await mkdtemp(join(tmpdir(), "stage-lock-"));
  try {
    const file = join(dir, "s.json"),
      s = new JsonStore(file, r);
    await s.init(d, "i", now);
    await writeFile(file + ".lock", "owner");
    await assert.rejects(
      s.dispatch({ expectedRevision: 0, event, now }),
      /STORE_BUSY/,
    );
    await rm(file + ".lock");
    await assert.rejects(
      s.dispatch({
        expectedRevision: 0,
        event: { ...event, observedAt: "bad" },
        now,
      }),
      /INVALID_TIME/,
    );
    assert.equal((await s.read()).instance.revision, 0);
    await assert.rejects(access(file + ".lock"));
    const results = await Promise.allSettled([
      s.dispatch({ expectedRevision: 0, event, now }),
      s.dispatch({ expectedRevision: 0, event: { ...event, id: "e2" }, now }),
    ]);
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("migration updates frozen definition and preserves old receipts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "stage-migrate-"));
  try {
    const s = new JsonStore(join(dir, "s.json"), r);
    await s.init(d, "i", now);
    await s.dispatch({ expectedRevision: 0, event, now });
    const next = { ...d, version: "2" };
    await s.migrate(next, { b: "b" }, 1, now);
    const snap = await s.read();
    assert.equal(snap.definition.version, "2");
    assert.equal(snap.migrations.length, 1);
    assert.equal(snap.instance.revision, 2);
    assert.equal(Object.keys(snap.receipts).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
