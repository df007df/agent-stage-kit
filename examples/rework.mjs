import assert from "node:assert/strict";
import { createRegistry, createInstance, advance } from "../dist/index.js";
const plugin = {
  id: "review-demo",
  version: "1",
  guards: {
    submit: ({ event }) => ({
      pass: event.type === "submit",
      reason: "提交审核",
    }),
    approved: ({ event }) => ({
      pass: event.type === "review" && event.facts.passed === true,
      reason: "审核通过",
    }),
    rejected: ({ event }) => ({
      pass: event.type === "review" && event.facts.passed === false,
      reason: "返回修改",
    }),
  },
};
const definition = {
  id: "review",
  version: "1",
  plugin: { id: plugin.id, version: plugin.version },
  initial: "edit",
  nodes: [
    { id: "edit", label: "修改" },
    { id: "review", label: "审核" },
    { id: "done", label: "完成", terminal: true },
  ],
  edges: [
    { id: "submit", from: "edit", to: "review", guard: "submit" },
    { id: "approved", from: "review", to: "done", guard: "approved" },
    { id: "rejected", from: "review", to: "edit", guard: "rejected" },
  ],
};
const registry = createRegistry([plugin]),
  now = "2026-10-04T00:00:00Z";
let instance = createInstance(definition, registry, "review-1", now);
for (const [i, [type, facts]] of [
  ["submit", {}],
  ["review", { passed: false }],
  ["submit", {}],
  ["review", { passed: true }],
].entries()) {
  const before = instance.nodeId;
  instance = advance(
    definition,
    instance,
    { id: String(i), type, observedAt: now, facts },
    registry,
    now,
  ).instance;
  console.log(`${type}: ${before} → ${instance.nodeId}`);
}
assert.equal(instance.nodeId, "done");
console.log("返工后通过：跨事件可以回到旧阶段；单事件无限级联会被拒绝。");
