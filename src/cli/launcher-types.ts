import type { ProgressDeliveryMode, UnboundRoutePolicy, InitialRouteBinding } from "../bridge/bridge.js";
import type { CodexCliStatus, CodexPermissionMode, CodexRunPolicy } from "../codex/codex-cli.js";
import type { FirstRouteBindingChoice } from "./serve-wizard.js";

export interface ServeStartupOptions {
  session?: string;
  permission?: CodexPermissionMode;
  codexAdapter?: RealCodexAdapterMode;
  yesDangerouslyFull?: boolean;
  cwd?: string;
  progressMode?: ProgressDeliveryMode;
  maxConcurrentTurns?: number;
  noInteractive?: boolean;
  noTui?: boolean;
}

export type RealCodexAdapterMode = "app-server" | "exec";

export interface PreparedServeStartup {
  policy: CodexRunPolicy;
  adapterMode: RealCodexAdapterMode;
  cwd: string;
  codexStatus?: CodexCliStatus;
  progressMode?: ProgressDeliveryMode;
  maxConcurrentTurns?: number;
}

export interface ServeChannelPlan {
  unboundRoutePolicy: UnboundRoutePolicy;
  initialRouteBinding?: InitialRouteBinding;
  initialSessionId?: string;
  initialSessionTitle?: string;
  firstRouteBindingChoice?: FirstRouteBindingChoice;
}
