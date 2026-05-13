import test from "node:test";
import assert from "node:assert/strict";
import { buildRouteKey } from "../../src/protocol/channel.js";

test("buildRouteKey normalizes channel routing identity", () => {
  assert.equal(
    buildRouteKey({
      channelId: "weixin",
      accountId: "wx-account",
      conversationKind: "direct",
      conversationId: "user-1",
    }),
    "weixin:wx-account:direct:user-1",
  );
});

test("buildRouteKey uses default account when missing", () => {
  assert.equal(
    buildRouteKey({
      channelId: "mock",
      conversationKind: "group",
      conversationId: "group-1",
    }),
    "mock:default:group:group-1",
  );
});
