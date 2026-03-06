import test from "node:test";
import assert from "node:assert/strict";
import { createCl100kEstimator } from "../src/index.js";

test("createCl100kEstimator returns estimator function", async () => {
  const estimator = await createCl100kEstimator();
  assert.equal(typeof estimator, "function");
  const tokens = estimator("hello world");
  assert.equal(Number.isInteger(tokens), true);
  assert.equal(tokens > 0, true);
});
