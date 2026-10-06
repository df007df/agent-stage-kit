export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export type Data = { [key: string]: Json };
export interface Definition {
  id: string;
  version: string;
  plugin: { id: string; version: string };
  initial: string;
  nodes: { id: string; label: string; terminal?: boolean }[];
  edges: {
    id: string;
    from: string;
    to: string;
    guard: string;
    params?: Json;
  }[];
  cascade?: boolean;
  config?: Json;
}
export interface Instance {
  id: string;
  definitionId: string;
  definitionVersion: string;
  definitionHash: string;
  nodeId: string;
  revision: number;
  enteredAt: string;
  data: Data;
}
export interface StageEvent {
  id: string;
  type: string;
  observedAt: string;
  facts: Data;
  evidence?: Json;
}
export interface Context {
  definition: Definition;
  instance: Instance;
  event: StageEvent;
  now: string;
  params?: Json;
}
export interface Decision {
  edgeId: string;
  pass: boolean;
  reason: string;
}
export interface TransitionRecord {
  eventId: string;
  edgeId: string;
  from: string;
  to: string;
  reason: string;
  at: string;
  definitionVersion: string;
  revision: number;
}
export interface AdvanceResult {
  instance: Instance;
  transitions: TransitionRecord[];
  decisions: Decision[];
}
export interface MigrationRecord {
  fromVersion: string;
  toVersion: string;
  from: string;
  to: string;
  at: string;
  revision: number;
}
export interface Plugin {
  id: string;
  version: string;
  guards: Record<
    string,
    (context: Context) => { pass: boolean; reason: string }
  >;
  validateDefinition?: (definition: Definition) => void;
  validateEvent?: (context: Context) => void;
  onEvent?: (context: Context) => Data;
  onTransition?: (context: Context, transition: TransitionRecord) => Data;
  context?: (context: Pick<Context, "definition" | "instance">) => Data;
}
export interface Registry {
  get(id: string, version: string): Plugin;
}
