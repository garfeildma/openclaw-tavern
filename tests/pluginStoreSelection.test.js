import test from "node:test";
import assert from "node:assert/strict";
import { createRPPlugin } from "../src/index.js";

test("plugin uses sqlite store when sqliteDb is provided", () => {
  let execCalled = 0;
  const sqliteDb = {
    exec(sql) {
      execCalled += 1;
      assert.match(sql, /CREATE TABLE IF NOT EXISTS rp_assets/);
    },
    prepare() {
      return {
        run() {
          return { changes: 1 };
        },
        get() {
          return undefined;
        },
        all() {
          return [];
        },
      };
    },
  };

  const plugin = createRPPlugin({ sqliteDb });
  assert.ok(plugin.services.store);
  assert.equal(plugin.services.store.constructor.name, "SqliteStore");
  assert.equal(execCalled, 1);
});
