import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { render } from "ink-testing-library";
import { ChatCodexTui } from "../../src/cli/tui/app.js";
import { RuntimeLogStore, RuntimeLogView, RuntimeTuiTranscriptSink } from "../../src/cli/tui/runtime-log.js";
import type { LauncherActions, LauncherDashboard } from "../../src/cli/actions/launcher-actions.js";

test("Ink TUI renders dashboard and navigates to core pages", async () => {
  const actions = mockActions(dashboardFixture());
  const view = render(<ChatCodexTui actions={actions} onDone={() => undefined} />);
  await waitForInk();

  assert.match(view.lastFrame() ?? "", /Chat Codex/);
  assert.match(view.lastFrame() ?? "", /渠道/);
  assert.match(view.lastFrame() ?? "", /聊天绑定/);
  assert.match(view.lastFrame() ?? "", /权限/);
  assert.match(view.lastFrame() ?? "", /工作目录/);
  assert.match(view.lastFrame() ?? "", /\/repo/);

  view.stdin.write("c");
  await waitForInk();
  assert.match(view.lastFrame() ?? "", /管理渠道/);
  assert.match(view.lastFrame() ?? "", /w 微信/);
  assert.match(view.lastFrame() ?? "", /f 飞书/);

  view.stdin.write("\u001B");
  await waitForInk();
  view.stdin.write("b");
  await waitForInk();
  assert.match(view.lastFrame() ?? "", /聊天绑定/);
  assert.match(view.lastFrame() ?? "", /飞书 \/ default \/ 张三/);
  assert.match(view.lastFrame() ?? "", /微信 \/ wx-main \/ 主聊天/);
  assert.match(view.lastFrame() ?? "", /待生效/);

  view.stdin.write("\u001B");
  await waitForInk();
  view.stdin.write("p");
  await waitForInk();
  assert.match(view.lastFrame() ?? "", /默认权限设置/);
  assert.match(view.lastFrame() ?? "", /审批模式/);

  view.stdin.write("\u001B");
  await waitForInk();
  view.stdin.write("d");
  await waitForInk();
  assert.match(view.lastFrame() ?? "", /工作目录/);
  assert.match(view.lastFrame() ?? "", /当前终端目录/);

  view.unmount();
});

test("Ink TUI handles help, Feishu form back, and start confirmation", async () => {
  let result: { start: boolean } | undefined;
  const view = render(<ChatCodexTui actions={mockActions(dashboardFixture())} onDone={(next) => { result = next; }} />);
  await waitForInk();

  view.stdin.write("?");
  await waitForInk();
  assert.match(view.lastFrame() ?? "", /快捷键/);

  view.stdin.write("\r");
  await waitForInk();
  view.stdin.write("f");
  await waitForInk();
  assert.match(view.lastFrame() ?? "", /添加飞书机器人/);
  view.stdin.write("\u001B");
  await waitForInk();
  assert.match(view.lastFrame() ?? "", /管理渠道/);

  view.unmount();

  const startView = render(<ChatCodexTui actions={mockActions(dashboardFixture())} onDone={(next) => { result = next; }} />);
  await waitForInk();
  startView.stdin.write("\r");
  await waitForInk();
  assert.match(startView.lastFrame() ?? "", /启动服务/);
  assert.match(startView.lastFrame() ?? "", /确认后会启动 Bridge，并进入运行日志面板/);
  assert.match(startView.lastFrame() ?? "", /新聊天策略\s+首条消息自动创建新 session/);
  startView.stdin.write("\r");
  await waitForInk();
  assert.deepEqual(result, { start: true });
  startView.unmount();
});

test("Ink TUI first run guides user to add channels with Enter and number shortcuts", async () => {
  const view = render(<ChatCodexTui actions={mockActions(emptyDashboardFixture())} onDone={() => undefined} />);
  await waitForInk();

  assert.match(view.lastFrame() ?? "", /首次配置/);
  assert.match(view.lastFrame() ?? "", /1\. 添加微信账号/);
  assert.match(view.lastFrame() ?? "", /2\. 添加飞书机器人/);
  assert.match(view.lastFrame() ?? "", /4\. 工作目录/);
  assert.match(view.lastFrame() ?? "", /↑↓ 选择/);
  assert.match(view.lastFrame() ?? "", /0\/q 退出/);

  view.stdin.write("\r");
  await waitForInk();
  assert.match(view.lastFrame() ?? "", /添加微信账号/);
  assert.match(view.lastFrame() ?? "", /请使用微信扫码/);
  assert.match(view.lastFrame() ?? "", /QR-CODE/);

  view.stdin.write("\u001B");
  await waitForInk();
  view.stdin.write("2");
  await waitForInk();
  assert.match(view.lastFrame() ?? "", /添加飞书机器人/);

  view.unmount();
});

test("Ink TUI first run exit action is selectable", async () => {
  let result: { start: boolean } | undefined;
  const view = render(<ChatCodexTui actions={mockActions(emptyDashboardFixture())} onDone={(next) => { result = next; }} />);
  await waitForInk();

  view.stdin.write("\u001B[B");
  view.stdin.write("\u001B[B");
  view.stdin.write("\u001B[B");
  view.stdin.write("\u001B[B");
  await waitForInk();
  view.stdin.write("\r");
  await waitForInk();

  assert.deepEqual(result, { start: false });
  view.unmount();
});

test("Ink TUI updates new session workdir from current directory and manual input", async () => {
  const dashboard = dashboardFixture();
  const view = render(<ChatCodexTui actions={mockActions(dashboard)} onDone={() => undefined} />);
  await waitForInk();

  view.stdin.write("d");
  await waitForInk();
  assert.match(view.lastFrame() ?? "", /当前新 session\s+\/repo/);
  assert.match(view.lastFrame() ?? "", /当前终端目录\s+\/terminal\/repo/);

  view.stdin.write("\r");
  await waitForInk();
  assert.equal(dashboard.startup.cwd, "/terminal/repo");
  assert.match(view.lastFrame() ?? "", /\/terminal\/repo/);

  view.stdin.write("m");
  await waitForInk();
  assert.match(view.lastFrame() ?? "", /输入工作目录/);

  view.stdin.write("/tmp/manual-repo");
  await waitForInk();
  view.stdin.write("\r");
  await waitForInk();
  assert.equal(dashboard.startup.cwd, "/tmp/manual-repo");
  assert.match(view.lastFrame() ?? "", /\/tmp\/manual-repo/);

  view.unmount();
});

test("Ink TUI empty channel page exposes actionable add menu", async () => {
  const view = render(<ChatCodexTui actions={mockActions(emptyDashboardFixture())} onDone={() => undefined} />);
  await waitForInk();

  view.stdin.write("c");
  await waitForInk();
  assert.match(view.lastFrame() ?? "", /管理渠道/);
  assert.match(view.lastFrame() ?? "", /1\. 添加微信账号/);
  assert.match(view.lastFrame() ?? "", /2\. 添加飞书机器人/);

  view.stdin.write("\u001B[B");
  await waitForInk();
  view.stdin.write("\r");
  await waitForInk();
  assert.match(view.lastFrame() ?? "", /添加飞书机器人/);

  view.unmount();
});

test("Runtime TUI renders startup summary and transcript logs", async () => {
  const store = new RuntimeLogStore();
  const sink = new RuntimeTuiTranscriptSink(store);
  sink.inbound({
    id: "message-1",
    channelId: "feishu-default",
    routeKey: "feishu-default:default:direct:oc_abc",
    accountId: "default",
    conversation: { kind: "direct", id: "oc_abc" },
    sender: { id: "ou_abc", displayName: "张三" },
    text: "你好",
    timestamp: "2026-05-16T00:00:00.000Z",
  }, "你好");
  sink.outbound({
    channelId: "feishu-default",
    routeKey: "feishu-default:default:direct:oc_abc",
    accountId: "default",
    conversation: { kind: "direct", id: "oc_abc" },
    recipient: { id: "ou_abc", displayName: "张三" },
  }, "收到");

  const view = render(<RuntimeLogView summary={{
    title: "Chat Codex 运行日志",
    channels: ["feishu-default"],
    cwd: "/repo",
    policy: { permissionMode: "approval", sandbox: "workspace-write" },
    routePolicy: "首条消息自动创建新 session",
  }} store={store} />);
  await waitForInk();

  assert.match(view.lastFrame() ?? "", /Chat Codex 运行日志/);
  assert.match(view.lastFrame() ?? "", /运行中/);
  assert.match(view.lastFrame() ?? "", /feishu-default/);
  assert.match(view.lastFrame() ?? "", /收到/);
  assert.match(view.lastFrame() ?? "", /发送/);
  assert.match(view.lastFrame() ?? "", /你好/);

  view.unmount();
});

function mockActions(dashboard: LauncherDashboard): LauncherActions {
  return {
    getDashboard: async () => dashboard,
    getStartup: () => dashboard.startup,
    getPlan: () => ({ unboundRoutePolicy: "auto_new" }),
    getBinding: (routeKey: string) => dashboard.bindings.find((binding) => binding.route.routeKey === routeKey),
    startWeixinLogin: async () => ({
      started: {
        state: "login_required",
        message: "微信扫码登录已发起。",
        sessionKey: "login-session",
      },
      qrCode: "QR-CODE",
      fallbackLink: "https://login.example/qr",
    }),
    checkWeixinLogin: async () => ({ state: "pending", message: "还没有检测到扫码确认。" }),
    cancelWeixinLogin: () => ({ state: "cancelled", message: "已返回管理渠道，未添加微信账号。" }),
    listSessionChoices: () => ({ selectable: [], unavailable: [] }),
    listWeixinPrimaryChoices: () => ({ selectable: [], unavailable: [] }),
    formatRunPolicy: () => "审批模式（workspace-write 沙箱）",
    getCurrentProcessWorkdir: () => "/terminal/repo",
    setDefaultWorkdir: (input?: string, options?: { createIfMissing?: boolean }) => {
      const cwd = input?.trim() || "/terminal/repo";
      if (cwd === "/missing/repo" && !options?.createIfMissing) {
        return { ok: false, reason: "missing", cwd, message: "工作目录不存在: /missing/repo。确认后会创建这个目录。" };
      }
      dashboard.startup.cwd = cwd;
      return { ok: true, cwd, created: Boolean(options?.createIfMissing), message: `已设置新 session 工作目录：${cwd}` };
    },
    startConfirmationSummary: () => [
      "即将启动",
      "",
      "渠道",
      "- 飞书 / default: 已连接",
      "",
      "聊天绑定",
      "- 新聊天策略: 首条消息自动创建新 session",
      "- 待生效绑定: 1",
      "",
      "权限",
      "- 新 session 默认权限: 审批模式（workspace-write 沙箱）",
      "",
      "运行",
      "- 新 session 工作目录: /repo",
    ],
  } as unknown as LauncherActions;
}

function dashboardFixture(): LauncherDashboard {
  const dashboard: LauncherDashboard = {
    channels: [{
      record: {
        id: "feishu-default",
        type: "feishu",
        enabled: true,
        stateDir: "state/channels/feishu/feishu-default",
        defaultAccountId: "default",
        credentialSource: "interactive",
        createdAt: "2026-05-16T00:00:00.000Z",
        updatedAt: "2026-05-16T00:00:00.000Z",
      },
      status: {
        channelId: "feishu-default",
        state: "connected",
        account: "default",
      },
      capabilities: {
        text: true,
        media: false,
        typing: true,
        direct: true,
        group: false,
        thread: false,
        login: "none",
        messageUpdate: false,
        streamingHint: true,
      },
    }],
    bindings: [{
      route: {
        routeKey: "feishu-default:default:direct:oc_abc",
        channelId: "feishu-default",
        channelType: "feishu",
        accountId: "default",
        conversationKind: "direct",
        conversationId: "oc_abc",
        identity: {
          lastSenderDisplayName: "张三",
        },
        createdAt: "2026-05-16T00:00:00.000Z",
        updatedAt: "2026-05-16T00:00:00.000Z",
      },
      label: "飞书 / default / 张三",
    }],
    pendingBindings: [{
      id: "weixin-primary-weixin-wx-main-wx-main",
      channelId: "weixin-wx-main",
      accountId: "wx-main",
      conversationKind: "direct",
      label: "微信 / wx-main / 主聊天",
      binding: { type: "existing", sessionId: "019e3024-session" },
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:00.000Z",
    }],
    routes: {
      known: 1,
      bound: 0,
      pending: 0,
      unboundPolicy: "auto_new",
    },
    startup: {
      adapterMode: "app-server",
      cwd: "/repo",
      policy: {
        permissionMode: "approval",
        sandbox: "workspace-write",
      },
    },
    canStart: {
      ok: true,
      channels: [],
      message: "可以启动服务。",
    },
  };
  dashboard.canStart = {
    ok: true,
    channels: dashboard.channels,
    message: "可以启动服务。",
  };
  return dashboard;
}

function emptyDashboardFixture(): LauncherDashboard {
  return {
    ...dashboardFixture(),
    channels: [],
    bindings: [],
    pendingBindings: [],
    routes: {
      known: 0,
      bound: 0,
      pending: 0,
      unboundPolicy: "auto_new",
    },
    canStart: {
      ok: false,
      reason: "no_enabled_channels",
      message: "还没有启用的渠道。请先添加或启用微信账号、飞书机器人。",
    },
  };
}

async function waitForInk(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
}
