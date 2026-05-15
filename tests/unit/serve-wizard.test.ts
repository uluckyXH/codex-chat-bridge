import test from "node:test";
import assert from "node:assert/strict";
import {
  firstRouteBindingChoiceToPolicy,
  formatNoChannelGuide,
  formatServeHomeSummary,
  formatWeixinFirstRouteBindingPrompt,
  parseChannelAddChoice,
  parseFirstRouteBindingChoice,
  parseServeHomeChoice,
} from "../../src/cli/serve-wizard.js";

test("serve wizard formats Chinese first-run channel guide", () => {
  const text = formatNoChannelGuide();

  assert.ok(text.includes("未发现可启动渠道"));
  assert.ok(text.includes("1. 微信"));
  assert.ok(text.includes("2. 飞书（未实现，稍后适配）"));
  assert.equal(text.includes("Telegram"), false);
  assert.equal(text.includes("Slack"), false);
});

test("serve wizard formats home summary with Chinese actions", () => {
  const text = formatServeHomeSummary({
    codex: {
      adapterMode: "app-server",
      permissionMode: "approval",
      progressMode: "brief",
    },
    channels: [
      {
        id: "weixin",
        type: "weixin",
        enabled: true,
        status: {
          channelId: "weixin",
          state: "connected",
          account: "wx-account-1",
        },
      },
    ],
    routes: {
      known: 0,
      bound: 0,
      unboundPolicy: "auto_new",
    },
  });

  assert.ok(text.includes("Codex Chat Bridge"));
  assert.ok(text.includes("1. weixin  type=weixin  enabled=true  state=connected  account=wx-account-1"));
  assert.ok(text.includes("1. 启动服务"));
  assert.ok(text.includes("2. 管理渠道"));
  assert.ok(text.includes("3. 管理 route/session 绑定"));
});

test("serve wizard parses home and channel choices", () => {
  assert.equal(parseServeHomeChoice(""), "start");
  assert.equal(parseServeHomeChoice("2"), "manage_channels");
  assert.equal(parseServeHomeChoice("routes"), "manage_routes");
  assert.equal(parseServeHomeChoice("0"), "exit");
  assert.equal(parseChannelAddChoice(""), "weixin");
  assert.equal(parseChannelAddChoice("飞书"), "lark");
  assert.equal(parseChannelAddChoice("lark"), "lark");
  assert.equal(parseChannelAddChoice("0"), "exit");
});

test("serve wizard parses first route binding strategies", () => {
  assert.equal(parseFirstRouteBindingChoice(""), "auto_new");
  assert.equal(parseFirstRouteBindingChoice("2"), "ask");
  assert.equal(parseFirstRouteBindingChoice("3"), "bind_existing_first_route");
  assert.equal(parseFirstRouteBindingChoice("4"), "new_first_route");
  assert.equal(firstRouteBindingChoiceToPolicy("auto_new"), "auto_new");
  assert.equal(firstRouteBindingChoiceToPolicy("new_first_route"), "auto_new");
  assert.equal(firstRouteBindingChoiceToPolicy("ask"), "ask");
  assert.equal(firstRouteBindingChoiceToPolicy("bind_existing_first_route"), "ask");
});

test("serve wizard explains Weixin first route binding without account-level binding", () => {
  const text = formatWeixinFirstRouteBindingPrompt({
    channelId: "weixin-main",
    account: "wx-account-1",
    knownRoutes: 0,
  });

  assert.ok(text.includes("微信渠道 weixin-main 已登录"));
  assert.ok(text.includes("首个微信私聊 route 如何绑定 Codex session"));
  assert.ok(text.includes("首条消息自动创建新 session"));
  assert.ok(text.includes("首条消息先询问 /new 或 /resume"));
  assert.ok(text.includes("绑定给第一个私聊 route"));
  assert.equal(text.includes("账号绑定"), false);
});
