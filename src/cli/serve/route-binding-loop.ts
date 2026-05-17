import type { Interface } from "node:readline/promises";
import type { CodexRunPolicy } from "../../codex/codex-cli.js";
import { formatRunPolicyForUser, formatSessionActiveTime, type BindingSummary } from "../actions/binding-actions.js";
import type { PreparedServeStartup, ServeChannelPlan } from "../launcher-types.js";
import { formatRouteBindingMenu, formatUnboundRoutePolicyForUser, formatUnboundRoutePolicyMenu, parseUnboundRoutePolicyChoice } from "../serve-wizard.js";
import { createRealCodexAdapter } from "./bridge-runtime.js";
import { createBindingActions, formatPersistedBindingList, resolveSessionIdFromChoiceInput } from "./route-binding-helpers.js";
import { routeSummary } from "./summary.js";
import { confirmFullPermission } from "./startup.js";
import { isBackText, normalizeText } from "./shortcuts.js";

export async function runRouteBindingLoop(rl: Interface, startup: PreparedServeStartup, plan: ServeChannelPlan): Promise<void> {
  for (;;) {
    console.log("");
    console.log(formatRouteBindingMenu(routeSummary(plan)));
    const answer = normalizeText(await rl.question("请选择 [1]: "));
    if (!answer || answer === "1" || answer === "bindings" || answer === "绑定") {
      await managePersistedBindings(rl, startup);
      continue;
    }
    if (answer === "2" || answer === "policy" || answer === "策略") {
      await configureUnboundRoutePolicy(rl, plan);
      continue;
    }
    if (isBackText(answer)) return;
    console.log("没有这个选项，请重新选择。");
  }
}

async function managePersistedBindings(rl: Interface, startup: PreparedServeStartup): Promise<void> {
  for (;;) {
    const actions = createBindingActions(startup);
    const bindings = actions.listBindings();
    console.log("");
    if (bindings.length === 0) {
      console.log([
        "聊天绑定",
        "",
        "还没有发现任何聊天。",
        "启动服务后，微信私聊或飞书用户私聊机器人会自动记录在这里。",
        "",
        "0. 返回",
      ].join("\n"));
      const answer = normalizeText(await rl.question("请选择 [0 返回]: "));
      if (!answer || answer === "0" || isBackText(answer)) return;
      continue;
    }
    console.log(formatPersistedBindingList(bindings));
    const answer = normalizeText(await rl.question("请选择聊天编号 [0 返回]: "));
    if (!answer || answer === "0" || isBackText(answer)) return;
    const index = Number.parseInt(answer, 10);
    if (!Number.isInteger(index) || index < 1 || index > bindings.length) {
      console.log("没有这个聊天编号，请重新选择。");
      continue;
    }
    const outcome = await manageBindingDetail(rl, startup, bindings[index - 1].route.routeKey);
    if (outcome === "home") return;
  }
}

async function manageBindingDetail(rl: Interface, startup: PreparedServeStartup, routeKey: string): Promise<"list" | "home"> {
  for (;;) {
    const actions = createBindingActions(startup);
    const binding = actions.getBinding(routeKey);
    if (!binding) {
      console.log("这个聊天记录已经不存在。");
      return "list";
    }
    console.log("");
    console.log(actions.formatBindingDetail(binding));
    const answer = normalizeText(await rl.question("请选择 [0 返回]: "));
    if (!answer || answer === "0" || isBackText(answer)) return "list";
    if (answer === "1" || answer === "switch" || answer === "切换") {
      const outcome = await switchBindingSession(rl, startup, routeKey);
      if (outcome === "home") return "home";
      continue;
    }
    if (answer === "2" || answer === "new" || answer === "新建") {
      const outcome = await createAndBindNewSession(rl, startup, routeKey);
      if (outcome === "home") return "home";
      continue;
    }
    if (answer === "3" || answer === "permission" || answer === "权限") {
      if (!binding.activeSession) {
        console.log("当前聊天还没有绑定 session，不能设置 session 级权限。");
        continue;
      }
      await configureBoundSessionPermission(rl, startup, binding);
      continue;
    }
    if (answer === "4" || answer === "unbind" || answer === "解绑") {
      const outcome = await unbindBindingSession(rl, startup, routeKey);
      if (outcome === "home") return "home";
      continue;
    }
    console.log("未识别选择，请重新输入。");
  }
}

async function switchBindingSession(rl: Interface, startup: PreparedServeStartup, routeKey: string): Promise<"detail" | "home"> {
  for (;;) {
    const actions = createBindingActions(startup);
    const choices = actions.listSessionChoices(routeKey);
    console.log("");
    console.log(actions.formatSessionChoices(routeKey, choices));
    const answer = (await rl.question("请选择 session 编号，或输入 m 手动输入 ID [0 返回]: ")).trim();
    if (!answer || answer === "0" || isBackText(answer)) return "detail";
    const sessionId = await resolveSessionIdFromChoiceInput(rl, answer, choices);
    if (!sessionId) continue;
    const result = createBindingActions(startup).bindExistingSession(routeKey, sessionId);
    if (!result.ok) {
      console.log(result.message);
      continue;
    }
    console.log("");
    console.log(createBindingActions(startup).formatBindSuccess(result));
    const next = normalizeText(await rl.question("请选择 [1 返回绑定详情 / 0 返回首页]: "));
    return next === "0" ? "home" : "detail";
  }
}

async function createAndBindNewSession(rl: Interface, startup: PreparedServeStartup, routeKey: string): Promise<"detail" | "home"> {
  const binding = createBindingActions(startup).getBinding(routeKey);
  console.log("");
  console.log([
    "新建并绑定 session",
    "",
    `聊天: ${binding?.label ?? routeKey}`,
    `工作目录: ${startup.cwd}`,
    `新 session 默认权限: ${formatRunPolicyForUser(startup.policy)}`,
    "",
    "1. 创建并绑定",
    "0. 返回",
  ].join("\n"));
  const answer = normalizeText(await rl.question("请选择 [1]: "));
  if (answer === "0" || isBackText(answer)) return "detail";
  const codex = createRealCodexAdapter(startup);
  try {
    const session = await codex.startSession({
      routeKey,
      cwd: startup.cwd,
      title: `channel:${routeKey}`,
    });
    const result = createBindingActions(startup).bindNewSession(routeKey, session);
    if (!result.ok) {
      console.log(result.message);
      return "detail";
    }
    console.log("");
    console.log([
      "已新建并绑定 session",
      "",
      `聊天: ${result.binding.label}`,
      `当前 session: ${result.session.title ?? result.session.id} / ${result.session.shortId}`,
      `最近活跃: ${formatSessionActiveTime(result.session.updatedAt, "full")}`,
      result.session.cwd ? `工作目录: ${result.session.cwd}` : undefined,
      "",
      "1. 返回绑定详情",
      "0. 返回首页",
    ].filter(Boolean).join("\n"));
    const next = normalizeText(await rl.question("请选择 [1 返回绑定详情 / 0 返回首页]: "));
    return next === "0" ? "home" : "detail";
  } finally {
    if (codex.stop) await codex.stop().catch(() => undefined);
  }
}

async function unbindBindingSession(rl: Interface, startup: PreparedServeStartup, routeKey: string): Promise<"detail" | "home"> {
  const actions = createBindingActions(startup);
  const binding = actions.getBinding(routeKey);
  if (!binding?.activeSession) {
    console.log("当前聊天没有绑定 session。");
    return "detail";
  }
  console.log("");
  console.log([
    "解绑当前 session",
    "",
    `聊天: ${binding.label}`,
    `当前 session: ${binding.activeSession.title ?? binding.activeSession.id} / ${binding.activeSession.shortId}`,
    "",
    "解绑后，这个 session 可以被其他聊天重新绑定。",
  ].join("\n"));
  const answer = await rl.question("确认解绑请输入 YES [其他输入取消]: ");
  if (answer.trim() !== "YES") {
    console.log("已取消解绑。");
    return "detail";
  }
  const result = createBindingActions(startup).unbindSession(routeKey);
  console.log("");
  if (!result.ok) {
    console.log(result.message);
    return "detail";
  }
  console.log([
    "已解绑 session",
    "",
    `聊天: ${result.binding.label}`,
    `已解绑 session: ${result.sessionId}`,
    "",
    "1. 返回绑定详情",
    "0. 返回首页",
  ].join("\n"));
  const next = normalizeText(await rl.question("请选择 [1 返回绑定详情 / 0 返回首页]: "));
  return next === "0" ? "home" : "detail";
}

async function configureBoundSessionPermission(
  rl: Interface,
  startup: PreparedServeStartup,
  binding: BindingSummary,
): Promise<void> {
  const sessionId = binding.activeSession?.id;
  if (!sessionId) return;
  const actions = createBindingActions(startup);
  const current = actions.getSessionPermission(sessionId) ?? startup.policy;
  console.log("");
  console.log([
    "当前 session 权限",
    "",
    `聊天: ${binding.label}`,
    `Session: ${binding.activeSession?.title ?? sessionId} / ${binding.activeSession?.shortId ?? sessionId}`,
    `当前: ${formatRunPolicyForUser(current)}`,
    "",
    "1. 审批模式（推荐）",
    "2. 完全权限（高风险，需要输入 YES）",
    "0. 返回",
  ].join("\n"));
  const answer = normalizeText(await rl.question("请选择 [0 返回]: "));
  if (!answer || answer === "0" || isBackText(answer)) return;
  const policy: CodexRunPolicy = answer === "2" || answer === "full"
    ? { permissionMode: "full" }
    : { permissionMode: "approval", sandbox: "workspace-write" };
  if (policy.permissionMode === "full") {
    try {
      await confirmFullPermission(rl, false);
    } catch (error) {
      console.log(error instanceof Error ? error.message : String(error));
      return;
    }
  }
  actions.setSessionPermission(sessionId, policy);
  console.log("");
  console.log([
    "已设置当前 session 权限",
    `聊天: ${binding.label}`,
    `Session: ${binding.activeSession?.title ?? sessionId} / ${binding.activeSession?.shortId ?? sessionId}`,
    `当前权限: ${formatRunPolicyForUser(policy)}`,
    "说明: 只影响这个 session 后续任务；当前正在运行的任务不会被改写。",
  ].join("\n"));
}

async function configureUnboundRoutePolicy(rl: Interface, plan: ServeChannelPlan): Promise<void> {
  console.log("");
  console.log(formatUnboundRoutePolicyMenu(plan.unboundRoutePolicy));
  const answer = await rl.question("请选择 [0 返回]: ");
  if (!answer.trim()) return;
  const choice = parseUnboundRoutePolicyChoice(answer);
  if (choice === "back") return;
  plan.unboundRoutePolicy = choice;
  console.log(`已设置新聊天策略: ${formatUnboundRoutePolicyForUser(plan.unboundRoutePolicy)}`);
}
