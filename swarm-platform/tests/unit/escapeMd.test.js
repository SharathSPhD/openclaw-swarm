import test from "node:test";
import assert from "node:assert/strict";
import { escapeMd } from "../../src/telegramRelay.js";

test("escapeMd escapes underscores", () => {
  assert.equal(escapeMd("hello_world"), "hello\\_world");
});

test("escapeMd escapes asterisks", () => {
  assert.equal(escapeMd("**bold**"), "\\*\\*bold\\*\\*");
});

test("escapeMd escapes dots", () => {
  assert.equal(escapeMd("v1.2.3"), "v1\\.2\\.3");
});

test("escapeMd escapes parentheses", () => {
  assert.equal(escapeMd("(test)"), "\\(test\\)");
});

test("escapeMd handles null/undefined", () => {
  assert.equal(escapeMd(null), "");
  assert.equal(escapeMd(undefined), "");
  assert.equal(escapeMd(""), "");
});

test("escapeMd escapes all MarkdownV2 special chars", () => {
  const special = "_*[]()~`>#+=|{}.!-";
  const escaped = escapeMd(special);
  // Each char should be escaped with backslash
  for (const ch of special) {
    assert.ok(escaped.includes(`\\${ch}`), `char ${ch} should be escaped`);
  }
});
