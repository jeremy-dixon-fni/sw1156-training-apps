"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const Checkpoints = require(path.join(__dirname, "..", "js", "checkpoints.js"));

assert.equal(Checkpoints.evaluateNumeric(9.9, 10, { absolute: 0.1 }).status, Checkpoints.RESULT.ACCEPTABLE);
assert.equal(Checkpoints.evaluateNumeric(10.15, 10, { absolute: 0.1 }).status, Checkpoints.RESULT.CLOSE);
assert.equal(Checkpoints.evaluateNumeric(11, 10, { percent: 2 }).status, Checkpoints.RESULT.INCORRECT);
assert.equal(Checkpoints.evaluateNumeric("", 10, { absolute: 0.1 }).status, Checkpoints.RESULT.INVALID);
assert.equal(Checkpoints.evaluateNumeric(102, 100, { percent: 2 }).status, Checkpoints.RESULT.ACCEPTABLE);

const values = new Map();
const storage = {
  getItem: key => values.get(key) || null,
  setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key)
};
const session = new Checkpoints.SessionState("test-module", ["one", "two"], storage);
assert.equal(session.currentId(), "one");
assert.equal(session.next(), false);
session.complete("one", { answer: 42 });
assert.equal(session.next(), true);
session.complete("two");
assert.equal(session.allComplete(), true);
assert.deepEqual(new Checkpoints.SessionState("test-module", ["one", "two"], storage).snapshot().results.one, { answer: 42 });
session.reset();
assert.equal(session.allComplete(), false);

console.log("All shared checkpoint checks passed.");
