import { compileStageMachine } from "./xstate-engine.js";
export type * from "./types.js";
import type {
  Definition,
  Instance,
  Registry,
  Plugin,
  StageEvent,
  AdvanceResult,
  Context,
  Data,
  MigrationRecord,
} from "./types.js";
import {
  json,
  hash,
  time,
  nonempty,
  validateDefinition,
  validateInstance,
} from "./validation.js";
export { validateDefinition } from "./validation.js";
export function createRegistry(plugins: Plugin[]): Registry {
  const entries = new Map<string, Plugin>();
  for (const p of plugins) {
    nonempty(p.id);
    nonempty(p.version);
    const key = `${p.id}@${p.version}`;
    if (entries.has(key)) throw new Error("DUPLICATE_PLUGIN");
    if (
      !p.guards ||
      Object.values(p.guards).some((v) => typeof v !== "function")
    )
      throw new Error("INVALID_PLUGIN");
    entries.set(
      key,
      Object.freeze({ ...p, guards: Object.freeze({ ...p.guards }) }),
    );
  }
  return {
    get(id, version) {
      const p = entries.get(`${id}@${version}`);
      if (!p) throw new Error(`UNKNOWN_PLUGIN: ${id}@${version}`);
      return p;
    },
  };
}
export function createInstance(
  d: Definition,
  r: Registry,
  id: string,
  now: string,
  data: Data = {},
): Instance {
  nonempty(id);
  time(now);
  json(data);
  const i = {
    id,
    definitionId: d.id,
    definitionVersion: d.version,
    definitionHash: hash(d),
    nodeId: d.initial,
    revision: 0,
    enteredAt: now,
    data: structuredClone(data),
  };
  validateInstance(d, i, r);
  return i;
}
export function advance(
  d: Definition,
  input: Instance,
  event: StageEvent,
  r: Registry,
  now: string,
): AdvanceResult {
  validateInstance(d, input, r);
  time(now);
  json(event);
  nonempty(event.id);
  nonempty(event.type);
  time(event.observedAt);
  if (
    !event.facts ||
    typeof event.facts !== "object" ||
    Array.isArray(event.facts)
  )
    throw new Error("INVALID_EVENT");
  const instance = structuredClone(input),
    p = r.get(d.plugin.id, d.plugin.version),
    result: AdvanceResult = { instance, transitions: [], decisions: [] };
  const context = (params?: Context["params"]): Context =>
    structuredClone({
      definition: d,
      instance,
      event,
      now,
      ...(params === undefined ? {} : { params }),
    });
  p.validateEvent?.(context());
  const checkData = (data: Data): Data => {
    json(data);
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("INVALID_PLUGIN_DATA");
    return structuredClone(data);
  };
  if (p.onEvent) instance.data = checkData(p.onEvent(context()));
  const engine = compileStageMachine(d, (edge) => {
    const v = p.guards[edge.guard]!(context(edge.params));
    if (!v || typeof v.pass !== "boolean" || typeof v.reason !== "string")
      throw new Error("INVALID_GUARD_RESULT");
    result.decisions.push({ edgeId: edge.id, ...v });
    return v.pass;
  });
  const visited = new Set([instance.nodeId]);
  // Cascade, cycle rejection and audit records are stage contract policies.
  // XState owns transition selection, guard priority and terminal behavior.
  while (true) {
    const step = engine.step(instance.nodeId);
    const selected = step.edge;
    const reason = result.decisions.at(-1)?.reason ?? "";
    if (!selected || step.nodeId === instance.nodeId) break;
    if (visited.has(step.nodeId)) throw new Error("CYCLE");
    visited.add(step.nodeId);
    const tr = {
      eventId: event.id,
      edgeId: selected.id,
      from: instance.nodeId,
      to: step.nodeId,
      reason,
      at: now,
      definitionVersion: d.version,
      revision: input.revision + 1,
    };
    instance.nodeId = step.nodeId;
    instance.enteredAt = now;
    result.transitions.push(tr);
    if (p.onTransition)
      instance.data = checkData(p.onTransition(context(), structuredClone(tr)));
    if (!d.cascade) break;
  }
  instance.revision++;
  validateInstance(d, instance, r);
  return result;
}
export function projectContext(d: Definition, i: Instance, r: Registry): Data {
  validateInstance(d, i, r);
  const p = r.get(d.plugin.id, d.plugin.version);
  const value = p.context?.(
    structuredClone({ definition: d, instance: i }),
  ) ?? {
    stageId: i.nodeId,
    stageName: d.nodes.find((n) => n.id === i.nodeId)!.label,
  };
  json(value);
  return structuredClone(value);
}
export function migrate(
  old: Definition,
  next: Definition,
  i: Instance,
  mapping: Record<string, string>,
  r: Registry,
  now: string,
): { instance: Instance; record: MigrationRecord } {
  validateInstance(old, i, r);
  validateDefinition(next, r);
  time(now);
  if (next.id !== old.id || next.version === old.version)
    throw new Error("MIGRATION_VERSION");
  const target = Object.hasOwn(mapping, i.nodeId)
    ? mapping[i.nodeId]
    : undefined;
  if (!next.nodes.some((n) => n.id === target))
    throw new Error("MIGRATION_MAPPING");
  const instance = {
    ...structuredClone(i),
    nodeId: target!,
    definitionVersion: next.version,
    definitionHash: hash(next),
    revision: i.revision + 1,
    enteredAt: now,
  };
  validateInstance(next, instance, r);
  return {
    instance,
    record: {
      fromVersion: old.version,
      toVersion: next.version,
      from: i.nodeId,
      to: target!,
      at: now,
      revision: instance.revision,
    },
  };
}
