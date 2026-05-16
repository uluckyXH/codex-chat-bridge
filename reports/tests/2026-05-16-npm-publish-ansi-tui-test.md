# npm 发布前 TUI 测试 ANSI 输出兼容

## 背景

手动执行 `npm publish` 时，发布前测试在 Ink TUI 工作目录用例失败。失败原因不是 TUI 功能异常，而是发布环境启用了彩色输出，`view.lastFrame()` 中包含 ANSI 控制码，测试正则直接匹配原始帧文本时被控制码打断。

## 改动

- 在 `tests/unit/ink-tui.test.tsx` 中新增 `cleanFrame` 辅助函数。
- 所有 Ink TUI 帧文本断言先移除 ANSI 控制码，再做内容匹配。
- 不改变运行期 TUI 行为，只增强测试在彩色终端和 npm 发布流程里的稳定性。

## 验证

```bash
FORCE_COLOR=1 npm test
```

结果：

```text
239 passed
0 failed
```

```bash
FORCE_COLOR=1 npm publish --dry-run
```

结果：

```text
+ chat-codex@0.1.0
```

## 结论

发布环境启用彩色输出时，TUI 单元测试不会再因为 ANSI 控制码误失败。真实发布仍需要 npm 账号的 2FA 验证码。
