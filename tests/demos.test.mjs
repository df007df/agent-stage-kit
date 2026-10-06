import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
for (const [file, expected] of [
  ["linear.mjs", "完成"],
  ["rework.mjs", "返工后通过"],
  ["quality-gate.mjs", "编辑验证后交付"],
  ["routing.mjs", "条件路由"],
  ["migration.mjs", "版本迁移"],
  ["checkpoint.mjs", "恢复与重放"],
])
  test(`runnable demo: ${file}`, () => {
    const result = spawnSync(process.execPath, [`examples/${file}`], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(expected), result.stdout);
  });
