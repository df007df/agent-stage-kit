import { createMachine, transition } from "xstate";
import type { Definition } from "./types.js";

type Edge = Definition["edges"][number];

/** Compile public stage definitions to XState. Generated keys keep arbitrary
 * business IDs (dots, spaces, '#', etc.) out of XState target path syntax. */
export function compileStageMachine(
  definition: Definition,
  evaluate: (edge: Edge) => boolean,
) {
  const keys = new Map(
    definition.nodes.map((node, index) => [node.id, `s${index}`]),
  );
  const outgoing = new Map<
    string,
    {
      target: string;
      guard: () => boolean;
      actions: string;
    }[]
  >();
  definition.edges.forEach((edge, index) => {
    const transitions = outgoing.get(edge.from) ?? [];
    transitions.push({
      target: keys.get(edge.to)!,
      guard: () => evaluate(edge),
      actions: `edge${index}`,
    });
    outgoing.set(edge.from, transitions);
  });
  const states = Object.fromEntries(
    definition.nodes.map((node) => [
      keys.get(node.id)!,
      node.terminal
        ? { type: "final" as const }
        : {
            on: {
              STAGE_EVENT: outgoing.get(node.id) ?? [],
            },
          },
    ]),
  );
  const machine = createMachine({
    id: "stage",
    initial: keys.get(definition.initial)!,
    states,
  });
  return {
    step(nodeId: string): { nodeId: string; edge?: Edge } {
      const snapshot = machine.resolveState({
        value: keys.get(nodeId)!,
        context: {},
      });
      // XState selects the guarded transition and returns its action descriptor;
      // pure transition never starts actors or executes external effects.
      const [next, actions] = transition(machine, snapshot, {
        type: "STAGE_EVENT",
      });
      return {
        nodeId: definition.nodes[Number((next.value as string).slice(1))]!.id,
        edge: actions.length
          ? definition.edges[Number(actions[0]!.type.slice(4))]
          : undefined,
      };
    },
  };
}
