import assert from "node:assert/strict";
import { createRegistry, createInstance, advance } from "../dist/index.js";
export const plugin = {
  id: "linear-demo",
  version: "1",
  guards: {
    ready: ({ event, params }) => ({
      pass: event.type === params && event.facts.ready === true,
      reason: "产物已确认",
    }),
  },
};
export const definition = {
  id: "linear",
  version: "1",
  plugin: { id: plugin.id, version: plugin.version },
  initial: "research",
  nodes: [
    { id: "research", label: "调研" },
    { id: "write", label: "编写" },
    { id: "done", label: "完成", terminal: true },
  ],
  edges: [
    {
      id: "research-ready",
      from: "research",
      to: "write",
      guard: "ready",
      params: "research",
    },
    {
      id: "write-ready",
      from: "write",
      to: "done",
      guard: "ready",
      params: "write",
    },
  ],
};
const registry = createRegistry([plugin]),
  now = "2026-10-04T00:00:00Z";
let instance = createInstance(definition, registry, "linear-1", now);
for (const type of ["research", "write"]) {
  const before = instance.nodeId;
  instance = advance(
    definition,
    instance,
    { id: type, type, observedAt: now, facts: { ready: true } },
    registry,
    now,
  ).instance;
  console.log(`${before} → ${instance.nodeId}`);
}
assert.equal(instance.nodeId, "done");
console.log("完成：调研 → 编写 → 完成，无数据库参与。");
