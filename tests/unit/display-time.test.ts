import test from "node:test";
import assert from "node:assert/strict";
import {
  currentTimeZone,
  formatLocalClock,
  formatLocalDateTime,
  formatLocalDateTimeWithZone,
  formatLocalShortDateTime,
} from "../../src/time/display-time.js";

test("display time formats ISO values in the requested local timezone", () => {
  const value = "2026-05-17T15:25:10.000Z";
  assert.equal(formatLocalDateTime(value, { timeZone: "Asia/Shanghai" }), "2026-05-17 23:25:10");
  assert.equal(formatLocalShortDateTime(value, { timeZone: "Asia/Shanghai" }), "05-17 23:25");
  assert.equal(formatLocalClock(value, { timeZone: "Asia/Shanghai" }), "23:25:10");
  assert.equal(formatLocalDateTimeWithZone(value, { timeZone: "Asia/Shanghai" }), "2026-05-17 23:25:10（Asia/Shanghai）");
});

test("display time accepts seconds, milliseconds, and Date inputs", () => {
  assert.equal(formatLocalDateTime(1700000000, { timeZone: "UTC" }), "2023-11-14 22:13:20");
  assert.equal(formatLocalDateTime(1700000000000, { timeZone: "UTC" }), "2023-11-14 22:13:20");
  assert.equal(formatLocalDateTime(new Date("2023-11-14T22:13:20.000Z"), { timeZone: "Asia/Shanghai" }), "2023-11-15 06:13:20");
});

test("display time falls back to unknown for invalid values and UTC for invalid timezone", () => {
  assert.equal(formatLocalDateTime(undefined, { timeZone: "Asia/Shanghai" }), "未知");
  assert.equal(formatLocalDateTime("", { timeZone: "Asia/Shanghai" }), "未知");
  assert.equal(formatLocalDateTime("not-a-date", { timeZone: "Asia/Shanghai" }), "未知");
  assert.equal(formatLocalDateTime(1700000000, { timeZone: "Invalid/Zone" }), "2023-11-14 22:13:20");
});

test("current timezone is detected from the running machine", () => {
  assert.equal(typeof currentTimeZone(), "string");
  assert.ok(currentTimeZone().length > 0);
});
