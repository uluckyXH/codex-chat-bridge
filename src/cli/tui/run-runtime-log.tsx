import React from "react";
import { render, type RenderOptions } from "ink";
import { RuntimeLogView, type RuntimeLogStore, type RuntimeLogSummary } from "./runtime-log.js";

export async function runRuntimeLogTui(summary: RuntimeLogSummary, store: RuntimeLogStore, renderOptions: RenderOptions = {}): Promise<void> {
  const instance = render(
    <RuntimeLogView summary={summary} store={store} interactive={renderOptions.interactive !== false} />,
    { alternateScreen: true, ...renderOptions },
  );
  const stop = (): void => {
    instance.unmount();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await instance.waitUntilExit();
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
