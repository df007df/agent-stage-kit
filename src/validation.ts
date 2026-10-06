import { createHash } from "node:crypto";
import type { Definition, Instance, Registry } from "./types.js";
export function json(value: unknown): void {
  const seen = new Set<object>();
  const visit = (v: unknown): void => {
    if (v === null || typeof v === "string" || typeof v === "boolean") return;
    if (typeof v === "number" && Number.isFinite(v)) return;
    if (typeof v !== "object" || v === null || seen.has(v))
      throw new Error("INVALID_JSON");
    if (
      !Array.isArray(v) &&
      Object.getPrototypeOf(v) !== Object.prototype &&
      Object.getPrototypeOf(v) !== null
    )
      throw new Error("INVALID_JSON");
    seen.add(v);
    for (const x of Object.values(v)) visit(x);
    seen.delete(v);
  };
  visit(value);
}
export function hash(value: unknown): string {
  json(value);
  const canonical = (v: unknown): string =>
    Array.isArray(v)
      ? `[${v.map(canonical).join(",")}]`
      : v !== null && typeof v === "object"
        ? `{${Object.keys(v)
            .sort()
            .map(
              (k) =>
                `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`,
            )
            .join(",")}}`
        : JSON.stringify(v);
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export function time(value: string): void {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error("INVALID_TIME");
}
export function nonempty(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error("INVALID_ID");
}
export function validateDefinition(d: Definition, registry: Registry): void {
  json(d);
  nonempty(d.id);
  nonempty(d.version);
  nonempty(d.plugin?.id);
  nonempty(d.plugin?.version);
  const p = registry.get(d.plugin.id, d.plugin.version);
  if (!Array.isArray(d.nodes) || !d.nodes.length || !Array.isArray(d.edges))
    throw new Error("INVALID_GRAPH");
  const nodes = new Set<string>(),
    edges = new Set<string>();
  for (const n of d.nodes) {
    nonempty(n.id);
    nonempty(n.label);
    if (
      nodes.has(n.id) ||
      (n.terminal !== undefined && typeof n.terminal !== "boolean")
    )
      throw new Error("INVALID_GRAPH");
    nodes.add(n.id);
  }
  if (
    !nodes.has(d.initial) ||
    (d.cascade !== undefined && typeof d.cascade !== "boolean")
  )
    throw new Error("INVALID_GRAPH");
  for (const e of d.edges) {
    nonempty(e.id);
    if (edges.has(e.id) || !nodes.has(e.from) || !nodes.has(e.to))
      throw new Error("INVALID_GRAPH");
    edges.add(e.id);
    if (!Object.hasOwn(p.guards, e.guard))
      throw new Error(`UNKNOWN_GUARD: ${e.guard}`);
  }
  p.validateDefinition?.(structuredClone(d));
}
export function validateInstance(
  d: Definition,
  i: Instance,
  r: Registry,
): void {
  validateDefinition(d, r);
  json(i);
  nonempty(i.id);
  time(i.enteredAt);
  if (
    i.definitionId !== d.id ||
    i.definitionVersion !== d.version ||
    i.definitionHash !== hash(d)
  )
    throw new Error("DEFINITION_MISMATCH");
  if (
    !d.nodes.some((n) => n.id === i.nodeId) ||
    !Number.isSafeInteger(i.revision) ||
    i.revision < 0 ||
    !i.data ||
    Array.isArray(i.data) ||
    typeof i.data !== "object"
  )
    throw new Error("INVALID_INSTANCE");
}
