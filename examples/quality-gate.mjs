import assert from "node:assert/strict";
import {
  createRegistry,
  createInstance,
  advance,
  projectContext,
} from "../dist/index.js";
import { plugin, definition } from "../dist/plugins/quality-gate.js";
const registry = createRegistry([plugin]),
  now = "2026-10-04T00:00:00Z";
function scenario(mode, events) {
  let instance = createInstance(definition, registry, mode, now, { mode });
  for (const [i, [type, facts, expected]] of events.entries()) {
    const before = instance.nodeId;
    instance = advance(
      definition,
      instance,
      { id: `${mode}-${i}`, type, observedAt: now, facts },
      registry,
      now,
    ).instance;
    assert.equal(instance.nodeId, expected);
    console.log(`${mode}/${type}: ${before} → ${instance.nodeId}`);
  }
  assert.equal(instance.nodeId, "deliver");
  console.log(projectContext(definition, instance, registry));
}
scenario("review", [
  ["baseline", { ready: true }, "diagnose"],
  ["diagnosis", { ready: true }, "deliver"],
]);
scenario("edit", [
  ["baseline", { ready: true }, "diagnose"],
  ["diagnosis", { ready: true }, "edit"],
  ["patch", { ready: true }, "verify"],
  [
    "verification",
    { result: "partial", passed: true, evidence: ["static-check"] },
    "verify",
  ],
  ["verification", { result: "verified", passed: false }, "edit"],
  ["patch", { ready: true }, "verify"],
  [
    "verification",
    { result: "verified", passed: true, evidence: ["demo-host-evidence"] },
    "deliver",
  ],
]);
console.log(
  "只读诊断后交付；编辑验证后交付。证据是模拟输入，没有执行真实产物检查。",
);
