import { open, readFile, rename, unlink, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  advance,
  createInstance,
  migrate as migrateInstance,
} from "./index.js";
import { hash, validateInstance } from "./validation.js";
import type {
  Definition,
  Instance,
  Registry,
  StageEvent,
  AdvanceResult,
  MigrationRecord,
  Data,
} from "./types.js";
export interface Snapshot {
  format: 1;
  definition: Definition;
  instance: Instance;
  receipts: Record<string, { hash: string; result: AdvanceResult }>;
  transitions: AdvanceResult["transitions"];
  migrations: MigrationRecord[];
}
/** Single writer JSON adapter. A leftover lock requires explicit operator inspection. */
export class JsonStore {
  readonly path: string;
  constructor(
    path: string,
    private registry: Registry,
  ) {
    this.path = resolve(path);
  }
  async read(): Promise<Snapshot> {
    const s = JSON.parse(await readFile(this.path, "utf8")) as Snapshot;
    if (
      s.format !== 1 ||
      !s.receipts ||
      Array.isArray(s.receipts) ||
      typeof s.receipts !== "object" ||
      !Array.isArray(s.transitions) ||
      !Array.isArray(s.migrations)
    )
      throw new Error("INVALID_STORE");
    validateInstance(s.definition, s.instance, this.registry);
    return s;
  }
  private async locked<T>(work: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.path), { recursive: true });
    const lockPath = this.path + ".lock";
    const lock = await open(lockPath, "wx", 0o600).catch((e) => {
      if (e.code === "EEXIST") throw new Error("STORE_BUSY");
      throw e;
    });
    try {
      await lock.writeFile(
        JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString(),
        }),
      );
      return await work();
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }
  private async save(snapshot: Snapshot): Promise<void> {
    const tmp = this.path + "." + randomUUID() + ".tmp";
    let handle;
    try {
      handle = await open(tmp, "wx", 0o600);
      await handle.writeFile(JSON.stringify(snapshot, null, 2) + "\n");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(tmp, this.path);
    } finally {
      await handle?.close();
      await unlink(tmp).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
    }
  }
  async init(
    definition: Definition,
    id: string,
    now: string,
    data: Data = {},
  ): Promise<Snapshot> {
    return this.locked(async () => {
      try {
        await readFile(this.path);
        throw new Error("ALREADY_EXISTS");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      const s: Snapshot = {
        format: 1,
        definition: structuredClone(definition),
        instance: createInstance(definition, this.registry, id, now, data),
        receipts: {},
        transitions: [],
        migrations: [],
      };
      await this.save(s);
      return s;
    });
  }
  async dispatch(input: {
    expectedRevision: number;
    event: StageEvent;
    now: string;
  }): Promise<AdvanceResult> {
    return this.locked(async () => {
      const s = await this.read(),
        digest = hash(input.event);
      const prior = Object.hasOwn(s.receipts, input.event.id)
        ? s.receipts[input.event.id]
        : undefined;
      if (prior) {
        if (prior.hash !== digest) throw new Error("EVENT_CONFLICT");
        return prior.result;
      }
      if (s.instance.revision !== input.expectedRevision)
        throw new Error("REVISION_CONFLICT");
      const result = advance(
        s.definition,
        s.instance,
        input.event,
        this.registry,
        input.now,
      );
      s.instance = result.instance;
      s.transitions.push(...result.transitions);
      Object.defineProperty(s.receipts, input.event.id, {
        value: { hash: digest, result },
        enumerable: true,
        writable: true,
        configurable: true,
      });
      await this.save(s);
      return result;
    });
  }
  async migrate(
    next: Definition,
    mapping: Record<string, string>,
    expectedRevision: number,
    now: string,
  ): Promise<Snapshot> {
    return this.locked(async () => {
      const s = await this.read();
      if (s.instance.revision !== expectedRevision)
        throw new Error("REVISION_CONFLICT");
      const result = migrateInstance(
        s.definition,
        next,
        s.instance,
        mapping,
        this.registry,
        now,
      );
      s.definition = structuredClone(next);
      s.instance = result.instance;
      s.migrations.push(result.record);
      await this.save(s);
      return s;
    });
  }
}
