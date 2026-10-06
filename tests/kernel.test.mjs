import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRegistry,
  createInstance,
  advance,
  migrate,
  projectContext,
} from "../dist/index.js";
const now = "2026-10-04T00:00:00Z";
const plugin = {
  id: "test",
  version: "1",
  guards: {
    yes: () => ({ pass: true, reason: "yes" }),
    fact: ({ event }) => ({ pass: event.facts.ok === true, reason: "fact" }),
  },
  context: ({ instance }) => ({ node: instance.nodeId }),
};
const reg = createRegistry([plugin]);
const def = {
  id: "flow",
  version: "1",
  plugin: { id: "test", version: "1" },
  initial: "a",
  nodes: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C", terminal: true },
  ],
  edges: [
    { id: "ab", from: "a", to: "b", guard: "fact" },
    { id: "bc", from: "b", to: "c", guard: "yes" },
  ],
  cascade: true,
};
const ev = (facts = {}) => ({
  id: "e",
  type: "observe",
  observedAt: now,
  facts,
});
test("missing evidence stays; cascade records each hop and is deterministic", () => {
  const i = createInstance(def, reg, "i", now);
  assert.equal(advance(def, i, ev(), reg, now).instance.nodeId, "a");
  const r = advance(def, i, ev({ ok: true }), reg, now);
  assert.equal(r.instance.nodeId, "c");
  assert.equal(r.transitions.length, 2);
  assert.deepEqual(r, advance(def, i, ev({ ok: true }), reg, now));
  assert.equal(i.nodeId, "a");
  assert.equal(projectContext(def, r.instance, reg).node, "c");
});
test("terminal ignores outgoing and non-cascade only takes one hop", () => {
  const d = { ...def, cascade: false };
  const i = createInstance(d, reg, "i", now);
  const r = advance(d, i, ev({ ok: true }), reg, now);
  assert.equal(r.instance.nodeId, "b");
  const done = advance(d, r.instance, ev(), reg, now);
  assert.equal(done.instance.nodeId, "c");
  assert.equal(advance(d, done.instance, ev(), reg, now).transitions.length, 0);
});
test("invalid reference, unknown guard, duplicate registry and changed definition reject", () => {
  assert.throws(() => createRegistry([plugin, plugin]), /DUPLICATE_PLUGIN/);
  assert.throws(
    () =>
      createInstance(
        { ...def, edges: [{ id: "bad", from: "a", to: "z", guard: "yes" }] },
        reg,
        "i",
        now,
      ),
    /INVALID_GRAPH/,
  );
  assert.throws(
    () =>
      createInstance(
        {
          ...def,
          edges: [{ id: "bad", from: "a", to: "b", guard: "unknown" }],
        },
        reg,
        "i",
        now,
      ),
    /UNKNOWN_GUARD/,
  );
  const i = createInstance(def, reg, "i", now);
  assert.throws(
    () => advance({ ...def, cascade: false }, i, ev(), reg, now),
    /DEFINITION_MISMATCH/,
  );
});
test("cycles reject the event without mutating the caller", () => {
  const d = {
    ...def,
    edges: [
      { id: "ab", from: "a", to: "b", guard: "yes" },
      { id: "ba", from: "b", to: "a", guard: "yes" },
    ],
  };
  const i = createInstance(d, reg, "i", now);
  assert.throws(() => advance(d, i, ev(), reg, now), /CYCLE/);
  assert.equal(i.revision, 0);
});
test("migration maps stable IDs explicitly and validates target plugin", () => {
  const i = createInstance(def, reg, "i", now);
  const d = {
    ...def,
    version: "2",
    initial: "new",
    nodes: [{ id: "new", label: "Renamed" }],
    edges: [],
  };
  assert.throws(() => migrate(def, d, i, {}, reg, now), /MIGRATION_MAPPING/);
  const result = migrate(def, d, i, { a: "new" }, reg, now);
  assert.equal(result.instance.nodeId, "new");
  assert.equal(result.instance.revision, 1);
  assert.equal(result.record.fromVersion, "1");
});
test("plugin mutation is contained and invalid JSON or clocks reject", () => {
  const p = {
    ...plugin,
    guards: {
      yes: ({ event, instance }) => {
        event.facts.changed = true;
        instance.nodeId = "c";
        return { pass: true, reason: "yes" };
      },
    },
  };
  const r = createRegistry([p]);
  const d = { ...def, edges: [{ id: "ab", from: "a", to: "b", guard: "yes" }] };
  const i = createInstance(d, r, "i", now),
    e = ev();
  assert.equal(advance(d, i, e, r, now).instance.nodeId, "b");
  assert.deepEqual(e.facts, {});
  assert.equal(i.nodeId, "a");
  assert.throws(() => advance(d, i, ev({ bad: NaN }), r, now), /INVALID_JSON/);
  assert.throws(() => createInstance(d, r, "i", "bad"), /INVALID_TIME/);
});
