import test from "node:test";
import assert from "node:assert/strict";
import { ApprovalManager } from "../../src/approvals/approval-manager.js";

test("ApprovalManager creates and resolves approvals", () => {
  const manager = new ApprovalManager({ ttlMs: 60_000 });
  const pending = manager.create("mock:default:direct:user", "user", {
    kind: "command",
    sessionId: "s1",
    turnId: "t1",
    itemId: "i1",
    command: "echo ok",
  });

  assert.equal(pending.status, "pending");
  assert.match(manager.formatForChannel(pending), /\/approve/);

  const resolved = manager.decide(pending.approvalKey, pending.routeKey, "approve");
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.decision, "approve");
});

test("ApprovalManager rejects wrong route decisions", () => {
  const manager = new ApprovalManager({ ttlMs: 60_000 });
  const pending = manager.create("route-a", "user", {
    kind: "command",
    sessionId: "s1",
    turnId: "t1",
    itemId: "i1",
  });

  assert.throws(() => manager.decide(pending.approvalKey, "route-b", "deny"), /不属于当前会话/);
});
