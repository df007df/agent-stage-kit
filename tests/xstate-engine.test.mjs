import { test } from "node:test";
import assert from "node:assert/strict";
import { createRegistry, createInstance, advance } from "../dist/index.js";
const now = "2026-10-04T00:00:00Z";
const event = { id: "event-1", type: "inspect", observedAt: now, facts: {} };
function fixture(guards, edges, extra = {}) {
  const plugin = { id: "adapter", version: "1", guards, ...extra };
  const registry = createRegistry([plugin]);
  const definition = {
    id: "flow.with.dots",
    version: "1",
    plugin: { id: plugin.id, version: plugin.version },
    initial: "draft.v1",
    cascade: true,
    nodes: [
      { id: "draft.v1", label: "Draft" },
      { id: "#review space", label: "Review" },
      { id: "done", label: "Done", terminal: true },
    ],
    edges,
  };
  return {
    definition,
    registry,
    instance: createInstance(definition, registry, "i", now),
  };
}
test("XState adapter preserves arbitrary IDs and self-edge priority without looping", () => {
  const { definition, registry, instance } = fixture(
    { yes: () => ({ pass: true, reason: "yes" }) },
    [
      { id: "keep", from: "draft.v1", to: "draft.v1", guard: "yes" },
      { id: "next", from: "draft.v1", to: "#review space", guard: "yes" },
    ],
  );
  const kept = advance(definition, instance, event, registry, now);
  assert.equal(kept.instance.nodeId, "draft.v1");
  assert.equal(kept.instance.revision, 1);
  assert.deepEqual(kept.transitions, []);
  assert.deepEqual(kept.decisions, [
    { edgeId: "keep", pass: true, reason: "yes" },
  ]);
  const nextDefinition = { ...definition, edges: definition.edges.slice(1) };
  const nextInstance = createInstance(nextDefinition, registry, "i", now);
  assert.equal(
    advance(nextDefinition, nextInstance, event, registry, now).instance.nodeId,
    "#review space",
  );
});
test("cascade guards observe reducers after each hop; final states ignore configured exits", () => {
  const { definition, registry, instance } = fixture(
    {
      yes: () => ({ pass: true, reason: "first hop" }),
      updated: ({ instance }) => ({
        pass: instance.data.reviewReady === true,
        reason: "reducer confirmed",
      }),
    },
    [
      { id: "start", from: "draft.v1", to: "#review space", guard: "yes" },
      { id: "finish", from: "#review space", to: "done", guard: "updated" },
      { id: "ignored", from: "done", to: "draft.v1", guard: "yes" },
    ],
    {
      onTransition: ({ instance }) => ({ ...instance.data, reviewReady: true }),
    },
  );
  const result = advance(definition, instance, event, registry, now);
  assert.equal(result.instance.nodeId, "done");
  assert.deepEqual(
    result.transitions.map((t) => t.reason),
    ["first hop", "reducer confirmed"],
  );
  assert.deepEqual(
    result.decisions.map((d) => d.edgeId),
    ["start", "finish"],
  );
  assert.deepEqual(instance.data, {});
});
test("invalid guard results still fail through XState without modifying caller", () => {
  const { definition, registry, instance } = fixture(
    { invalid: () => ({ pass: "true", reason: "bad" }) },
    [{ id: "bad", from: "draft.v1", to: "done", guard: "invalid" }],
  );
  assert.throws(
    () => advance(definition, instance, event, registry, now),
    /INVALID_GUARD_RESULT/,
  );
  assert.equal(instance.nodeId, "draft.v1");
  assert.equal(instance.revision, 0);
});
