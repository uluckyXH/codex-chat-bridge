import test from "node:test";
import assert from "node:assert/strict";
import { LimitedTurnScheduler, TurnSchedulerAbortError, UnlimitedTurnScheduler } from "../../src/bridge/turn-scheduler.js";

test("UnlimitedTurnScheduler does not serialize concurrent turns", async () => {
  const scheduler = new UnlimitedTurnScheduler();
  const release = deferred<void>();
  const order: string[] = [];

  const first = scheduler.run(turn("route-a"), async () => {
    order.push("first-start");
    await release.promise;
    order.push("first-end");
  });
  const second = scheduler.run(turn("route-b"), async () => {
    order.push("second-run");
  });

  await waitFor(() => order.includes("second-run"));
  release.resolve();
  await Promise.all([first, second]);

  assert.deepEqual(order, ["first-start", "second-run", "first-end"]);
  assert.deepEqual(scheduler.getStatus(), { mode: "unlimited", running: 0, queued: 0 });
});

test("LimitedTurnScheduler serializes turns when maxConcurrentTurns is 1", async () => {
  const scheduler = new LimitedTurnScheduler(1);
  const release = deferred<void>();
  const order: string[] = [];

  const first = scheduler.run(turn("route-a"), async () => {
    order.push("first-start");
    await release.promise;
    order.push("first-end");
  });
  const second = scheduler.run(turn("route-b"), async () => {
    order.push("second-run");
  });

  await waitFor(() => scheduler.getStatus().queued === 1);
  assert.deepEqual(order, ["first-start"]);
  release.resolve();
  await Promise.all([first, second]);

  assert.deepEqual(order, ["first-start", "first-end", "second-run"]);
  assert.deepEqual(scheduler.getStatus(), { mode: "limited", maxConcurrentTurns: 1, running: 0, queued: 0 });
});

test("LimitedTurnScheduler skips aborted queued turns before they enter Codex", async () => {
  const scheduler = new LimitedTurnScheduler(1);
  const release = deferred<void>();
  const abort = new AbortController();
  let secondRan = false;

  const first = scheduler.run(turn("route-a"), async () => {
    await release.promise;
  });
  const second = scheduler.run(turn("route-b"), async () => {
    secondRan = true;
  }, { signal: abort.signal });

  await waitFor(() => scheduler.getStatus().queued === 1);
  abort.abort();
  release.resolve();
  await first;
  await assert.rejects(second, TurnSchedulerAbortError);
  assert.equal(secondRan, false);
});

function turn(routeKey: string) {
  return {
    routeKey,
    enqueuedAt: new Date().toISOString(),
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for condition");
}
