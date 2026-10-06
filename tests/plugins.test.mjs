import { test } from "node:test";
import assert from "node:assert/strict";
import { createRegistry, createInstance, advance } from "../dist/index.js";
import {
  plugin as ui,
  definition as uiDefinition,
} from "../dist/plugins/quality-gate.js";
import {
  plugin as ticket,
  definition as ticketDefinition,
} from "../dist/plugins/ticket.js";
const now = "2026-10-04T00:00:00Z";
const e = (type, facts = {}) => ({ id: type, type, observedAt: now, facts });
const run = (d, p, events, data = {}) => {
  const r = createRegistry([p]);
  let i = createInstance(d, r, "i", now, data);
  for (const event of events) i = advance(d, i, event, r, now).instance;
  return i;
};
test("quality gate readonly review delivers; editing waits for evidence, failure returns to edit", () => {
  const r = createRegistry([ui]),
    d = uiDefinition;
  let i = createInstance(d, r, "i", now, { mode: "review" });
  for (const ev of [
    e("baseline", { ready: true }),
    e("diagnosis", { ready: true }),
  ])
    i = advance(d, i, ev, r, now).instance;
  assert.equal(i.nodeId, "deliver");
  i = run(
    d,
    ui,
    [
      e("baseline", { ready: true }),
      e("diagnosis", { ready: true }),
      e("patch", { ready: true }),
    ],
    { mode: "edit" },
  );
  assert.equal(i.nodeId, "verify");
  assert.equal(
    advance(
      d,
      i,
      e("verification", { result: "verified", passed: true }),
      r,
      now,
    ).instance.nodeId,
    "verify",
  );
  assert.equal(
    advance(
      d,
      i,
      e("verification", {
        result: "verified",
        passed: false,
        evidence: ["shot"],
      }),
      r,
      now,
    ).instance.nodeId,
    "edit",
  );
  assert.equal(
    advance(
      d,
      i,
      e("verification", {
        result: "partial",
        passed: true,
        evidence: ["static"],
      }),
      r,
      now,
    ).instance.nodeId,
    "verify",
  );
  assert.equal(
    advance(
      d,
      i,
      e("verification", {
        result: "verified",
        passed: true,
        evidence: ["browser"],
      }),
      r,
      now,
    ).instance.nodeId,
    "deliver",
  );
});
test("independent plugin extends kernel with no core business dependency", () => {
  assert.equal(
    run(ticketDefinition, ticket, [e("close", { resolved: true })]).nodeId,
    "closed",
  );
});
