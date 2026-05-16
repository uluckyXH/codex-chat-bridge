# Goal 状态时间显示为北京时间

## 背景

聊天内发送 `/status` 时，Goal 模式下的 `目标更新时间` 直接使用 `Date.toISOString()` 展示，实际输出是 UTC 时间。用户在中国时区使用时会看到比本地时间少 8 小时的时间，不利于判断 Goal 最近更新时间。

## 改动

- 将 `/status` 中 Goal 的 `目标更新时间` 改为显式按 `Asia/Shanghai` 格式化。
- 输出格式改为：

```text
YYYY-MM-DD HH:mm:ss（北京时间）
```

- 新增固定时间集成测试，验证 `1700000000` 秒会显示为 `2023-11-15 06:13:20（北京时间）`，并确认不再输出 ISO UTC 的 `T...Z` 格式。

## 验证

```bash
npm run build && node --test dist/tests/integration/bridge-mock.test.js
```

结果：

```text
72 passed
0 failed
```

## 结论

`/status` 的 Goal 更新时间现在会明确显示北京时间，避免用户把 UTC 时间误认为本地时间。
