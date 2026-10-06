import type { Plugin, Definition } from "../types.js";
/** Example integration contract; evidence authenticity is verified by the host. */
export const plugin: Plugin = {
  id: "quality-gate",
  version: "1",
  guards: {
    ready: ({ event, params }) => ({
      pass: event.type === params && event.facts.ready === true,
      reason: "阶段产物已由宿主确认",
    }),
    readonly: ({ event, instance }) => ({
      pass:
        event.type === "diagnosis" &&
        event.facts.ready === true &&
        instance.data.mode === "review",
      reason: "只读评审交付",
    }),
    verified: ({ event }) => ({
      pass:
        event.type === "verification" &&
        event.facts.result === "verified" &&
        event.facts.passed === true &&
        Array.isArray(event.facts.evidence) &&
        event.facts.evidence.length > 0,
      reason: "产物验证通过且有证据",
    }),
    failed: ({ event }) => ({
      pass: event.type === "verification" && event.facts.passed === false,
      reason: "验证失败，返回修改",
    }),
  },
  context: ({ instance }) => ({
    stageId: instance.nodeId,
    mode: instance.data.mode ?? "edit",
    verificationBoundary: "由宿主核验产物；partial/unrun 不等于通过",
  }),
};
export const definition: Definition = {
  id: "quality-gate",
  version: "1",
  plugin: { id: plugin.id, version: plugin.version },
  initial: "baseline",
  nodes: [
    { id: "baseline", label: "范围与基线" },
    { id: "diagnose", label: "诊断" },
    { id: "edit", label: "修改" },
    { id: "verify", label: "实际验证" },
    { id: "deliver", label: "交付", terminal: true },
  ],
  edges: [
    {
      id: "baseline-ready",
      from: "baseline",
      to: "diagnose",
      guard: "ready",
      params: "baseline",
    },
    {
      id: "readonly-deliver",
      from: "diagnose",
      to: "deliver",
      guard: "readonly",
    },
    {
      id: "diagnosis-ready",
      from: "diagnose",
      to: "edit",
      guard: "ready",
      params: "diagnosis",
    },
    {
      id: "patch-ready",
      from: "edit",
      to: "verify",
      guard: "ready",
      params: "patch",
    },
    {
      id: "verified-deliver",
      from: "verify",
      to: "deliver",
      guard: "verified",
    },
    { id: "verification-failed", from: "verify", to: "edit", guard: "failed" },
  ],
};
