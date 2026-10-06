import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistry } from "../dist/index.js";
import { JsonStore } from "../dist/json-store.js";
import { plugin, definition } from "../dist/plugins/ticket.js";
const registry = createRegistry([plugin]),
  now = "2026-10-04T00:00:00Z",
  dir = await mkdtemp(join(tmpdir(), "stage-demo-"));
try {
  const file = join(dir, "state.json"),
    store = new JsonStore(file, registry);
  await store.init(definition, "ticket-1", now);
  const input = {
    expectedRevision: 0,
    now,
    event: {
      id: "close-1",
      type: "close",
      observedAt: now,
      facts: { resolved: true },
    },
  };
  const first = await store.dispatch(input);
  const restored = new JsonStore(file, registry);
  assert.equal((await restored.read()).instance.nodeId, "closed");
  assert.deepEqual(await restored.dispatch(input), first);
  await assert.rejects(
    restored.dispatch({
      ...input,
      event: { ...input.event, facts: { resolved: false } },
    }),
    /EVENT_CONFLICT/,
  );
  console.log(
    "恢复与重放：重新打开文件后状态保留，同事件返回原结果，变更载荷被拒绝。",
  );
  console.log(`临时检查点 ${file}；演示结束自动清理。`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
