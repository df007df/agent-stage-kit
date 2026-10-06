import assert from "node:assert/strict";
import {
  createRegistry,
  createInstance,
  advance,
  projectContext,
} from "../dist/index.js";
const plugin = {
  id: "routing",
  version: "1",
  guards: {
    blocked: ({ event }) => ({
      pass: event.facts.blocked === true,
      reason: "优先处理阻断",
    }),
    ready: ({ event }) => ({
      pass: event.type === "inspect" && event.facts.ready === true,
      reason: "准备完成",
    }),
    fast: ({ event }) => ({
      pass: event.facts.fast === true,
      reason: "快速通道",
    }),
    timeout: ({ event, instance, params }) => ({
      pass:
        event.type === "timer" &&
        event.facts.stageId === instance.nodeId &&
        typeof event.facts.elapsedHours === "number" &&
        event.facts.elapsedHours >= params,
      reason: "宿主计时已到期",
    }),
  },
  onEvent: ({ instance, event }) => ({
    ...instance.data,
    inspectionCount:
      (instance.data.inspectionCount ?? 0) + (event.type === "inspect" ? 1 : 0),
  }),
  context: ({ instance }) => ({
    stage: instance.nodeId,
    inspectionCount: instance.data.inspectionCount ?? 0,
  }),
};
const definition = {
  id: "routing",
  version: "1",
  plugin: { id: plugin.id, version: plugin.version },
  initial: "queued",
  cascade: true,
  nodes: [
    { id: "queued", label: "待处理" },
    { id: "review", label: "评审" },
    { id: "done", label: "完成", terminal: true },
    { id: "blocked", label: "阻断", terminal: true },
    { id: "expired", label: "超时", terminal: true },
  ],
  edges: [
    { id: "blocked", from: "queued", to: "blocked", guard: "blocked" },
    { id: "ready", from: "queued", to: "review", guard: "ready" },
    {
      id: "timeout",
      from: "queued",
      to: "expired",
      guard: "timeout",
      params: 24,
    },
    { id: "fast", from: "review", to: "done", guard: "fast" },
  ],
};
const registry = createRegistry([plugin]),
  now = "2026-10-04T00:00:00Z",
  initial = createInstance(definition, registry, "routing-1", now);
const apply = (type, facts) =>
  advance(
    definition,
    initial,
    { id: type, type, observedAt: now, facts },
    registry,
    now,
  );
assert.equal(apply("inspect", {}).instance.nodeId, "queued");
assert.equal(
  apply("inspect", { blocked: true, ready: true, fast: true }).instance.nodeId,
  "blocked",
);
const fast = apply("inspect", { ready: true, fast: true });
assert.equal(fast.transitions.length, 2);
assert.equal(fast.instance.nodeId, "done");
assert.equal(
  apply("timer", { stageId: "wrong", elapsedHours: 24 }).instance.nodeId,
  "queued",
);
assert.equal(
  apply("timer", { stageId: "queued", elapsedHours: 23 }).instance.nodeId,
  "queued",
);
assert.equal(
  apply("timer", { stageId: "queued", elapsedHours: 24 }).instance.nodeId,
  "expired",
);
console.log(
  fast.transitions,
  projectContext(definition, fast.instance, registry),
);
console.log(
  "条件路由：缺失事实等待、优先级分支、两跳级联、宿主驱动超时、计数与上下文。",
);
