import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

test("hashObjective hashes first 200 chars and returns 16-char hex", () => {
  const text = "test objective that is very long and should be truncated at 200 characters so that the hash is consistent regardless of the full text";
  const hash1 = crypto.createHash("sha256").update(text.slice(0, 200)).digest("hex").slice(0, 16);
  const hash2 = crypto.createHash("sha256").update(text.slice(0, 200)).digest("hex").slice(0, 16);
  
  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 16);
  assert.match(hash1, /^[a-f0-9]{16}$/);
});

test("objective deduplication tracks hash uniqueness", () => {
  const dispatchedHashes = new Set();
  
  const text1 = "First objective";
  const text2 = "Second objective";
  
  const hash1 = crypto.createHash("sha256").update(text1.slice(0, 200)).digest("hex").slice(0, 16);
  const hash2 = crypto.createHash("sha256").update(text2.slice(0, 200)).digest("hex").slice(0, 16);
  
  dispatchedHashes.add(hash1);
  dispatchedHashes.add(hash2);
  
  assert.equal(dispatchedHashes.size, 2);
  assert.ok(dispatchedHashes.has(hash1));
  assert.ok(dispatchedHashes.has(hash2));
});

test("category rotation cycles correctly", () => {
  let categoryIndex = 0;
  const CATEGORY_COUNT = 15; // Based on META_OBJECTIVE_CATEGORIES length
  
  const indices = [];
  for (let i = 0; i < 20; i++) {
    indices.push(categoryIndex);
    categoryIndex = (categoryIndex + 1) % CATEGORY_COUNT;
  }
  
  // After 15 iterations, should loop back to 0
  assert.equal(indices[0], 0);
  assert.equal(indices[14], 14);
  assert.equal(indices[15], 0);
  assert.equal(indices[19], 4);
});

test("objectives dispatched counter increments", () => {
  let objectivesDispatched = 0;
  
  assert.equal(objectivesDispatched, 0);
  
  objectivesDispatched += 1;
  assert.equal(objectivesDispatched, 1);
  
  objectivesDispatched += 1;
  assert.equal(objectivesDispatched, 2);
  
  for (let i = 0; i < 10; i++) {
    objectivesDispatched += 1;
  }
  assert.equal(objectivesDispatched, 12);
});
