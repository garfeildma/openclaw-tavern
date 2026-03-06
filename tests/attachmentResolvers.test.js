import test from "node:test";
import assert from "node:assert/strict";
import {
  createHttpAttachmentResolver,
  createTelegramAttachmentResolver,
  composeAttachmentResolvers,
} from "../src/index.js";

function makeHeaders(contentType) {
  return {
    get(name) {
      if (String(name).toLowerCase() === "content-type") {
        return contentType;
      }
      return null;
    },
  };
}

test("http attachment resolver downloads url", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    headers: makeHeaders("application/json"),
    async arrayBuffer() {
      return Buffer.from('{"x":1}', "utf8");
    },
  });

  try {
    const resolver = createHttpAttachmentResolver();
    const out = await resolver({ filename: "a.json", url: "https://example.com/a.json" });
    assert.ok(Buffer.isBuffer(out.buffer));
    assert.equal(out.mimeType, "application/json");
  } finally {
    global.fetch = originalFetch;
  }
});

test("telegram attachment resolver fetches getFile then file bytes", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async (url) => {
    calls += 1;
    if (String(url).includes("getFile")) {
      return {
        ok: true,
        async json() {
          return { ok: true, result: { file_path: "docs/a.json" } };
        },
      };
    }

    return {
      ok: true,
      headers: makeHeaders("application/json"),
      async arrayBuffer() {
        return Buffer.from('{"name":"tg"}', "utf8");
      },
    };
  };

  try {
    const resolver = createTelegramAttachmentResolver({ botToken: "token" });
    const out = await resolver({ filename: "a.json", fileId: "file-123" });
    assert.ok(Buffer.isBuffer(out.buffer));
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("compose resolvers stops when buffer resolved", async () => {
  const first = async () => null;
  const second = async () => ({ buffer: Buffer.from("x") });
  let thirdCalled = false;
  const third = async () => {
    thirdCalled = true;
    return null;
  };

  const resolver = composeAttachmentResolvers(first, second, third);
  const out = await resolver({ filename: "x" });
  assert.ok(Buffer.isBuffer(out.buffer));
  assert.equal(thirdCalled, false);
});
