import React from "react";
import { render } from "ink";
import { ChatCodexTui } from "./app.js";
import type { ChatCodexTuiResult } from "./types.js";
import type { LauncherActions } from "../actions/launcher-actions.js";

export async function runChatCodexTui(actions: LauncherActions): Promise<ChatCodexTuiResult> {
  let result: ChatCodexTuiResult = { start: false };
  const instance = render(
    <ChatCodexTui
      actions={actions}
      onDone={(nextResult) => {
        result = nextResult;
      }}
    />,
  );
  await instance.waitUntilExit();
  return result;
}
