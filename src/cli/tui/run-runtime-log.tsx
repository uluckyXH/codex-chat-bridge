import React from "react";
import { render } from "ink";
import { RuntimeLogView, type RuntimeLogStore, type RuntimeLogSummary } from "./runtime-log.js";

export async function runRuntimeLogTui(summary: RuntimeLogSummary, store: RuntimeLogStore): Promise<void> {
  const instance = render(<RuntimeLogView summary={summary} store={store} />);
  await instance.waitUntilExit();
}
