# Codex Weixin Middleware

This project is a lightweight middleware that connects Codex to pluggable chat channels. Weixin is the first channel adapter, implemented by adapting the communication capability extracted from `@tencent-weixin/openclaw-weixin`.

This project is OpenClaw-free at runtime. It must not depend on OpenClaw CLI, OpenClaw gateway, OpenClaw host runtime, or OpenClaw channel runtime. The `openclaw-weixin` package is only used as the Weixin communication reference and adaptation source.

## Current Status

- Node.js + TypeScript project scaffold is in place.
- The official npm package archive is stored under `openclaw-weixin-npm/`.
- A generic `ChannelAdapter` protocol is implemented so future channels can reuse the same bridge core.
- Mock, Terminal, and Weixin channel adapters are implemented.
- Bridge Core, command routing, approval management, memory state, and baseline logging are implemented.
- The `codex exec --json` adapter is implemented and has been verified through the terminal channel with the real Codex CLI.
- Weixin QR login, local account token persistence, text send, and basic `getupdates` polling support are implemented.
- The `weixin codex` startup entry checks Codex availability and Weixin login state. It skips QR login when credentials are valid and starts QR login when credentials are missing.

## Commands

```bash
npm test
npm run cli:mock
npm run cli:terminal:mock
npm run cli:terminal:codex
npm run cli:weixin:status
npm run cli:weixin:login
npm run cli:weixin:codex
```

Real Codex mode supports startup options:

```bash
npm run cli:terminal:codex -- --session new --permission approval --cwd ./workspaces/demo
npm run cli:weixin:codex -- --session last --permission approval
```

- `--session new|last|<id>`: create a new session, resume the latest session, or bind a specific Codex session.
- `--cwd <dir>` / `--workdir <dir>`: used only for new sessions. Missing directories are created automatically.
- `--permission approval|full`: choose approval mode or full permission mode.
- `--yes-dangerously-full`: non-interactive confirmation for full permission mode. Full mode bypasses approvals and sandboxing and is high risk.

During interactive startup, choosing a new session displays the default working directory. If the user enters a missing directory, the middleware creates it. If an existing session is selected, the middleware uses the working directory recorded in that Codex session history.

## Channel Commands

- `/help`: show available commands.
- `/new`: create a new Codex session for the current channel context.
- `/status`: show Bridge, channel, Codex, session, and working directory status.
- `/sessions`: list sessions known to the current channel context.
- `/sessions all` or `/all-sessions`: list all discoverable Codex history session IDs.
- `/resume <session>` / `/use <session>`: resume and bind a Codex session.
- `/approve <id>`, `/approve-session <id>`, `/deny <id>`, `/cancel [id]`: handle Codex approvals or cancel the current task.

## Documentation

- [docs/README.md](docs/README.md): documentation index.
- [docs/requirements.zh-CN.md](docs/requirements.zh-CN.md): Chinese requirements.
- [docs/technical-design.zh-CN.md](docs/technical-design.zh-CN.md): Chinese technical design.
- [docs/development-and-test.zh-CN.md](docs/development-and-test.zh-CN.md): development and testing rules.
- [docs/git-management.zh-CN.md](docs/git-management.zh-CN.md): Git management rules.
- [reports/tests/](reports/tests/): Chinese test reports.

## References

- `openclaw-weixin-npm/tencent-weixin-openclaw-weixin-2.4.3.tgz`
- `openclaw-weixin-npm/extracted/openclaw-weixin-2.4.3/`
- `references/openai-codex/`
