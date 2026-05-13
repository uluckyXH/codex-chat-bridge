# 参考源码

本目录用于存放本地参考源码。

- `openai-codex/`：OpenAI Codex 官方开源仓库的本地 shallow clone，用于查协议和实现细节。

`openai-codex/` 不提交到本项目 Git 仓库。需要重新拉取时执行：

```bash
git clone --depth 1 --filter=blob:none https://github.com/openai/codex.git references/openai-codex
```
