# Pine Windows 沙箱交接

## 当前目标

让 `apps/desktop` 在 Windows 11 开发环境中启动时完成 Windows 沙箱配置，并修复
`CreateProcessWithLogonW(srt-sandbox): 拒绝访问 (0x80070005)` 导致的反复配置弹窗。

## 已完成

- `7baf076 fix(desktop): gate Windows startup on sandbox setup`
  - 移除设置页中的 Windows 沙箱配置项。
  - Windows 启动时在创建主窗口前检查沙箱；未配置时触发 UAC 安装。
  - 用户取消后显示“重试 / 退出 Pine”，未完成配置不会进入主界面。
  - 移除旧的沙箱设置 IPC 和对应文案。
- 当前未提交改动：
  - `apps/desktop/src/main/windowsSandbox.ts`
    - 检查并启动 `seclogon`（Secondary Logon）服务。
    - 在 WFP 预检前为 `srt-win.exe` 配置 `srt-sandbox` 仅读/执行 ACL，并禁止写入。
    - Pine 退出时释放启动阶段临时 ACL。
    - 启动预检包含真实 `verifyWindowsWfpEgress`，避免进入界面后才发现网络隔离失效。
  - `apps/desktop/src/agent/sandbox/policy.ts`
    - Windows 配置将解析后的 `srt-win.exe` 加入 `allowRead` 和 `denyWrite`。
  - `apps/desktop/src/main.ts`
    - 在 `will-quit` 释放启动阶段 ACL。
  - `apps/desktop/src/agent/__tests__/sandbox.test.ts`
    - 断言 Windows 策略包含 `srt-win.exe` 的读权限和写保护。

## 根因与证据

Parallels 中的 Windows 11 是 ARM64，Pine 实际使用：

```text
C:\Users\kw\pine-main\node_modules\@anthropic-ai\sandbox-runtime\vendor\srt-win\arm64\srt-win.exe
```

该文件原本没有 `srt-sandbox:(RX)` ACL。直接执行 `srt-win exec` 或 `wfp verify` 时，
`CreateProcessWithLogonW` 因此返回 `0x80070005`。手动给准确的 `srt-win.exe` 授予
`srt-sandbox:(RX)` 后，WFP 探针返回：

```text
{"egress_probe":"blocked","runner_exit":0,...}
```

这证明循环不是 UAC 本身失败，而是 runner 无法读取自身的 `srt-win.exe`。

## 检查结果

- `seclogon`：`RUNNING`。
- `srt-win user status`：账户、凭据、SID 和 sandbox group 均存在。
- `checkWindowsDependenciesAsync`：`errors: []`。
- ARM64 `wfp verify`：授予 ACL 后成功返回 `egress_probe: blocked`。
- macOS 工作区：`bun run check` 通过。
  - 72 个测试文件；478 passed，37 skipped。

## Windows VM 信息

- Parallels VM：`Windows 11`
- UUID：`{64f8aaa7-99fe-458b-8ae1-05bd667aad57}`
- Windows 项目副本：`C:\Users\kw\pine-main`

启动开发进程：

```text
prlctl exec "Windows 11" --current-user cmd.exe /c "cd /d C:\Users\kw\pine-main && start \"Pine dev\" /b cmd.exe /c npm run --workspace @pine/desktop start"
```

查找进程：

```text
prlctl exec "Windows 11" powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'electron|node|npm|forge|srt-win' } | Select-Object Name,ProcessId,ParentProcessId,CommandLine"
```

安全停止开发树时，杀掉 `electron-forge.exe` 的 PID：

```text
prlctl exec "Windows 11" taskkill.exe /PID <electron-forge-pid> /T /F
```

## 交接时的下一步

1. 运行上面的启动命令。
2. 如果出现 `srt-win.exe` UAC 提示，点击“是”。这是修复后的首次授权流程。
3. 确认 Pine 主窗口出现，不再显示“需要配置 Windows 沙箱”循环对话框。
4. 在 Pine 中创建/打开项目，执行一个简单命令，确认不再出现
   `Sandbox setup failed: WFP egress fence could not be verified`。
5. 在 macOS 工作区提交当前四个未提交文件；提交前再次运行 `bun run check`。

## 注意事项

- 当前交接前一次 Windows 重启在 UAC 提示阶段被中断，随后截图中 Pine/开发进程已不在前台；需要按“交接时的下一步”重新启动验证。
- 不要把临时诊断脚本复制进项目；本交接文档生成时已清理这些脚本。
- 不要提交 Windows VM 内的 `node_modules`、`.vite` 或临时日志。
