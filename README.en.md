# Codex Chat Bridge

A lightweight middleware for connecting Codex to pluggable chat channels. It lets users drive Codex from chat apps, create or resume sessions, handle approvals, stop turns, inspect status, and receive final replies or files.

Weixin is the first real channel adapter. Its communication behavior is adapted from the `@tencent-weixin/openclaw-weixin` package, but this project does not depend on the OpenClaw CLI, gateway, host runtime, or channel runtime at execution time.

- Default Simplified Chinese README: [README.md](README.md)
- Documentation index: [docs/README.md](docs/README.md)
- Multi-channel design: [docs/multi-channel-design.zh-CN.md](docs/multi-channel-design.zh-CN.md)
- Agent development guide: [docs/agent-guide.zh-CN.md](docs/agent-guide.zh-CN.md)

## Status

Implemented:

- Generic `ChannelAdapter` protocol.
- Mock, Terminal, and Weixin channel adapters.
- Bridge Core with command routing, approval management, session binding, queues, and transcript logging.
- Default `codex app-server` adapter with thread creation/resume, turn start/interrupt, token usage updates, and interactive approvals.
- `codex exec --json` fallback adapter.
- Weixin QR login, terminal QR rendering, fallback login link, local account state, text/media send, and `getupdates` polling.
- Core multi-channel kernel: `ChannelRegistry`, `SessionBindings`, and `TurnScheduler`.

Current boundaries:

- Weixin is currently treated as verified direct-chat only: `direct=true, group=false, thread=false`.
- The multi-channel CLI wizard, channel configuration UI, and persistent local runtime state are still design-stage.
- Lark/Feishu, Telegram, Slack, and other real channel adapters are not implemented yet.

## Architecture

```text
Codex Adapter
      ^
      |
Bridge Core
      |
      +--> Channel Registry
              +--> WeixinAdapter
              +--> TerminalChannelAdapter
              +--> MockChannelAdapter
              +--> future channel adapters
```

Bridge Core only deals with generic channel protocol objects:

- `ChannelMessage`
- `ChannelTarget`
- `ChannelCapabilities`
- `ChannelDeliveryPolicy`

Concrete adapters own platform login, tokens, cursors, raw message mapping, delivery throttling, retries, typing, and media upload. The stable route key is:

```text
<channelId>:<accountId>:<conversationKind>:<conversationId>
```

## Quick Start

Requirements:

- Node.js >= 22
- npm
- A working local Codex CLI

Install and test:

```bash
npm install
npm run build
npm test
```

Run local flows:

```bash
npm run cli:mock
npm run cli:terminal:mock
npm run cli:terminal:codex
```

Run Weixin + Codex:

```bash
npm run cli:weixin:status
npm run cli:weixin:login
npm run cli:weixin:codex
```

Common startup options:

```bash
npm run cli:weixin:codex -- --session last --permission approval
npm run cli:terminal:codex -- --session new --permission approval --cwd ./workspaces/demo
```

- `--session new|last|<id>` creates a new session, resumes the latest session, or binds a specific Codex session.
- `--cwd <dir>` / `--workdir <dir>` applies only to new sessions.
- `--codex-adapter app-server|exec` chooses the Codex adapter. Default: `app-server`.
- `--permission approval|full` selects sandboxed approval mode or full permission mode.
- `--yes-dangerously-full` confirms full permission mode non-interactively.
- `--progress brief|detailed|silent` sets progress delivery mode for non-Weixin channels.

Weixin login state is stored under `state/weixin/`, which is ignored by Git.

## Chat Commands

| Command | Description |
| --- | --- |
| `/help` | Show commands |
| `/new` | Create a new Codex session for the current route |
| `/resume <session>` / `/use <session>` | Resume and bind a Codex session |
| `/sessions` | List sessions owned by the current route |
| `/status` | Show session, model, token, queue, approval, permission, and channel status |
| `/stop` | Stop the current Codex turn for this route |
| `/OK` / `/P` / `/NO` | Approve, persist-approve, or deny the current approval |
| `/permission [approval|full confirm]` | Show or switch permission mode |
| `/plan [task]` / `/code [task]` | Switch collaboration mode |
| `/goal [objective]` | Show or set the experimental Codex Goal |
| `/model [model|number] [effort]` | List or switch model and reasoning effort |
| `/sendfile <task>` | Allow Codex to declare final files for this turn |
| `/progress [brief|detailed|silent]` | Progress mode command for non-Weixin channels |
| `/fff` | Weixin-only silent refresh |

Normal messages are serialized per route. Commands bypass the normal prompt queue. Different routes can run different Codex sessions concurrently.

## Documentation

- [docs/README.md](docs/README.md): documentation index.
- [docs/requirements.zh-CN.md](docs/requirements.zh-CN.md): requirements and boundaries.
- [docs/technical-design.zh-CN.md](docs/technical-design.zh-CN.md): technical architecture.
- [docs/channel-delivery-policy.zh-CN.md](docs/channel-delivery-policy.zh-CN.md): channel delivery policy.
- [docs/multi-channel-design.zh-CN.md](docs/multi-channel-design.zh-CN.md): multi-channel routing, bindings, concurrency, and configuration design.
- [docs/development-and-test.zh-CN.md](docs/development-and-test.zh-CN.md): development and testing rules.
- [docs/git-management.zh-CN.md](docs/git-management.zh-CN.md): Git hygiene.
- [reports/tests/](reports/tests/): Chinese test reports.
- [references/README.md](references/README.md): local reference source instructions.

## Development

```bash
npm run build
npm test
npm run test:unit
npm run test:integration
```

Before committing:

```bash
git status --short --ignored
npm test
```

Do not commit `node_modules/`, `dist/`, `state/`, tokens, cookies, logs, `.env`, `openclaw-weixin-npm/`, or local reference sources under `references/` except `references/README.md`.

## Security

- Full permission mode bypasses approvals and sandboxing.
- Weixin tokens are local runtime state and must not be committed or shared.
- Do not expose Codex app-server directly to the public internet.
- A Codex session can only be owned by one route in multi-channel mode.

## Roadmap

- Multi-channel CLI startup wizard and channel instance management.
- Persistent local runtime state.
- Lark/Feishu direct, group, and thread adapter.
- RouteRuntime extraction from Bridge Core.
- Richer multi-channel transcript and admin status views.

## License

[MIT License](LICENSE). Authors: 小黄 and Codex.
