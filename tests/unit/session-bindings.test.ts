import test from "node:test";
import assert from "node:assert/strict";
import { SessionBindings } from "../../src/state/session-bindings.js";
import type { CodexSession } from "../../src/codex/types.js";

test("SessionBindings binds new sessions to route and tracks owner", () => {
  const bindings = new SessionBindings();
  const session = sessionFor("s1");

  const binding = bindings.bindNewSession("route-a", session);

  assert.equal(binding.routeKey, "route-a");
  assert.equal(binding.sessionId, "s1");
  assert.equal(bindings.getActive("route-a")?.sessionId, "s1");
  assert.equal(bindings.getOwner("s1")?.ownerRouteKey, "route-a");
  assert.deepEqual(bindings.listRouteSessions("route-a"), ["s1"]);
});

test("SessionBindings rejects claiming a session owned by another route", () => {
  const bindings = new SessionBindings();
  bindings.bindNewSession("route-a", sessionFor("s1"));

  const result = bindings.claimSessionOwner("route-b", "s1");

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "owned_by_other_route");
    assert.equal(result.owner.ownerRouteKey, "route-a");
  }
});

test("SessionBindings claims, activates, and rolls back existing session owners", () => {
  const bindings = new SessionBindings();

  const claim = bindings.claimSessionOwner("route-a", "s1");
  assert.equal(claim.ok, true);
  assert.equal(claim.ok ? claim.newlyClaimed : false, true);
  assert.equal(bindings.getActive("route-a"), undefined);

  const activated = bindings.activateOwnedSession("route-a", sessionFor("s1"));
  assert.equal(activated.ok, true);
  assert.equal(bindings.getActive("route-a")?.sessionId, "s1");

  const claimAgain = bindings.claimSessionOwner("route-a", "s1");
  assert.equal(claimAgain.ok, true);
  assert.equal(claimAgain.ok ? claimAgain.newlyClaimed : true, false);

  const claimRollback = bindings.claimSessionOwner("route-a", "s2");
  assert.equal(claimRollback.ok, true);
  bindings.rollbackClaim("route-a", "s2");
  assert.equal(bindings.getOwner("s2"), undefined);
});

test("SessionBindings refuses to activate a session not owned by the route", () => {
  const bindings = new SessionBindings();
  bindings.bindNewSession("route-a", sessionFor("s1"));

  const activated = bindings.activateOwnedSession("route-b", sessionFor("s1"));

  assert.equal(activated.ok, false);
  if (!activated.ok) {
    assert.equal(activated.reason, "not_owned_by_route");
    assert.equal(activated.owner?.ownerRouteKey, "route-a");
  }
});

function sessionFor(id: string): CodexSession {
  return {
    id,
    cwd: "/tmp/project",
    title: `session ${id}`,
    createdAt: new Date().toISOString(),
  };
}
