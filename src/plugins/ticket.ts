import type { Plugin, Definition } from "../types.js";
export const plugin: Plugin = {
  id: "ticket",
  version: "1",
  guards: {
    resolved: ({ event }) => ({
      pass: event.type === "close" && event.facts.resolved === true,
      reason: "resolved",
    }),
  },
};
export const definition: Definition = {
  id: "ticket",
  version: "1",
  plugin: { id: plugin.id, version: plugin.version },
  initial: "open",
  nodes: [
    { id: "open", label: "Open" },
    { id: "closed", label: "Closed", terminal: true },
  ],
  edges: [{ id: "close", from: "open", to: "closed", guard: "resolved" }],
};
