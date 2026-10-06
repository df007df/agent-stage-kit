import assert from "node:assert/strict";
import {
  createRegistry,
  createInstance,
  migrate,
  advance,
} from "../dist/index.js";
import { plugin, definition } from "../dist/plugins/ticket.js";
const registry = createRegistry([plugin]),
  now = "2026-10-04T00:00:00Z",
  instance = createInstance(definition, registry, "migration-1", now);
const next = {
  ...definition,
  version: "2",
  initial: "pending",
  nodes: [
    { id: "pending", label: "等待处理" },
    { id: "closed", label: "已处理", terminal: true },
  ],
  edges: [{ id: "close", from: "pending", to: "closed", guard: "resolved" }],
};
const result = migrate(
  definition,
  next,
  instance,
  { open: "pending" },
  registry,
  now,
);
assert.equal(result.instance.nodeId, "pending");
assert.equal(result.instance.definitionVersion, "2");
const closed = advance(
  next,
  result.instance,
  { id: "close", type: "close", observedAt: now, facts: { resolved: true } },
  registry,
  now,
);
assert.equal(closed.instance.nodeId, "closed");
console.log(result);
console.log("版本迁移：显式映射旧节点，迁移后继续推进。");
