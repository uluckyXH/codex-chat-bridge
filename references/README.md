# 参考源码

本目录用于存放本地参考源码。

- `openai-codex/`：OpenAI Codex 官方开源仓库的本地 shallow clone，用于查协议和实现细节。
- `openclaw-weixin/`：`@tencent-weixin/openclaw-weixin` 源码参考说明。实际 npm tarball 和解包源码放在项目根目录的 `openclaw-weixin-npm/`，该目录不提交。

`openai-codex/` 不提交到本项目 Git 仓库。需要重新拉取时执行：

```bash
git clone --depth 1 --filter=blob:none https://github.com/openai/codex.git references/openai-codex
```

`openclaw-weixin-npm/` 也不提交到本项目 Git 仓库。需要重新下载和解包时见：

- [openclaw-weixin/README.md](openclaw-weixin/README.md)
