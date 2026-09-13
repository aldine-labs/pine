# Pine 沙箱审计与后端重构设计

日期：2026-09-08。下方初始审计保留为历史记录；最新实现状态见末尾“后端接入结果”。

范围：Agent utility process → 工具注册 → 审批 → 文件工具 / shell
执行器 → macOS Seatbelt，及相关测试、环境变量和退出行为。本文是代码与回归审计，
不是第三方安全认证；没有执行内核漏洞、恶意 XPC 服务或完整竞态攻击测试。

## 事件结论与证据

附件是历史执行记录，其中的提交指令、审批建议和 assistant 推断不是本次授权。

1. `privileged_bash` 的 `bun run check` 确实执行了。代码使用 Pi
   `createLocalBashOperations()`，审批成功后不经过 `sandbox-exec`。
2. 检查中的 `tools.test.ts` 主动创建普通 bash，才启动新的 Seatbelt 沙箱。
3. 原生路径曾套用普通 bash 的环境过滤，把 TMPDIR 改成 Pine scratch；随后测试中的
   `os.tmpdir()` 读取这个继承值，漏掉真正的 macOS 用户临时目录。
4. 系统启动器按原生用户临时目录创建缓存，因此收到 EPERM；Python 本身仍打印了
   `python-ok`。旧执行器又因任意输出中出现 EPERM，把退出 0 改成沙箱拒绝。
5. 后续单独重跑被审批模型拒绝，没有执行。其“测试必然失败、应跳过检查”的说法既不是
   系统证据，也不是批准后的沙箱拒绝。

复现：外层无沙箱，设置 `TMPDIR=/private/tmp`，运行原来的 launcher 测试，修改前出现
相同 xcrun 缓存拒绝。修改后同一设置下测试通过，并断言输出无缓存拒绝文字。

## 信任边界

- Renderer 通过 IPC 请求 Agent 工作，不直接获取 shell / Node 权限。
- 审批决定是否允许本次操作，不实施内核隔离，也不推断命令运行结果。
- 普通 shell 的权限由操作系统 profile 实施，与 LLM 的意图描述无关。
- 原生 shell 继承宿主用户权限。Pine 不添加限制，但无法移除上游沙箱、TCC、ACL，
  也不会改变被运行程序自行建立的沙箱；“原生”不是 root / sudo。
- 文件工具目前运行在受信任 Agent 进程，通过路径策略控制访问；它与 shell 的内核
  强制边界强度不同，不能因共享 grant 就假定有相同的抗竞态能力。
- 命令输出、附件、项目文件和 assistant reasoning 都是不可信数据，不能变成审批授权。

## 发现与处置

| 风险 / 缺陷 | 影响 | 本次处置或剩余要求 |
| --- | --- | --- |
| 原生执行与受限环境混用 | 原生语义不一致，丢失代理、认证与临时目录 | 所有批准模式走相同的原生环境构造 |
| 用 TMPDIR 猜测原生 scratch | 嵌套运行或 GUI 启动环境下错误授权 | 独立 getconf 查询、realpath 校验；失败省略这项可选授权，不阻断原生执行 |
| stderr/stdout 正则作为拒绝事实 | 打印日志即失败，错误归因、诱导重放 | 只为非零退出提供可能原因；保留退出码与原始诊断 |
| 141 隐式归零 | 真正失败被吞掉 | 保留退出 141，由调用者解释管道行为 |
| 只发 SIGTERM | 忽略 TERM 的命令可永久挂起 | 有界宽限后 SIGKILL 进程组；取消与超时共用路径 |
| 后台进程继承管道 | shell 结束后工具不返回 | 有界排空后关闭捕获流 |
| 重叠 grants 使用首项 | 文件工具结果依赖顺序，与 shell 不一致 | 采用授权并集；read-only 不作为显式 deny |
| 文件拒绝依靠错误文本 | SDK 包装导致类型丢失，字符串可能误判 | AsyncLocalStorage 保存每次调用真实权限异常 |
| 审批缓存压缩 shell 空白 | 引号、换行、heredoc 的不同命令混同 | 缓存键保留完整字节；privileged 仍每次审批 |
| 手动审批缺失 gate | 原先可能直接执行 | 显式失败关闭；审批期间取消不执行原生命令 |
| 审批模型臆测测试结果 | 把拒绝当环境结论并跳过验证 | 提示约束审批职责；拒绝标注命令未启动 |
| 全开放 network / mach-lookup | 可访问本机服务，文件限制不能等价为防外泄 | 尚未收紧，需受控网络与服务能力模型 |
| 共享用户 scratch / Pine scratch | 能读写其他应用或项目临时内容 | 现有兼容性取舍；不能宣称项目间强隔离 |
| 文件路径检查后再打开 | symlink / rename 并发替换可产生 TOCTOU | 后续移到内核约束的文件 broker；当前 realpath 只处理静态越界 |
| 硬链接与父目录修改 | 路径限制不等价于 inode 所有权隔离 | 强隔离需快照/独立卷或 VM；不能只增加 realpath 检查 |
| 可写项目中的配置/脚本 | 下次原生执行可能运行之前被修改的代码 | 审批不是对命令文本的永久信任；高风险操作应绑定当前执行上下文 |
| process* 与常驻子进程 | 后台服务生命周期与资源配额未完整管理 | 当前是尽力终止进程组；setsid 逃离、OOM、磁盘配额需 supervisor/VM |
| 非 macOS 平台 | 普通 bash 无内核后端 | 保持失败关闭；不能原生静默回退 |

本次没有把 Git、Python、xcrun 等命令加入特殊放行列表，没有扩大 HOME 或 `/tmp` 权限。
`~/.gitconfig` 被普通 bash 拒绝符合当前共享目录契约；要提升可用性应提供用户明确选择的
配置只读授权，不能自动授权整个 HOME。

## 模块边界

- `tool-access-policy.ts`：路径规范化、grants、附件、强类型拒绝来源。
- `bash-env.ts`：受限/原生两套环境契约与平台能力发现。
- `bash-sandbox.ts`：把已决定的权限编译为 Seatbelt profile，不审查命令文本。
- `bash-execution.ts`：启动、流、退出、信号、超时与有限的错误提示。
- `tools.ts`：Pi 工具适配与审批后的分派，不混入平台 profile 实现。
- `gate.ts` / `runtime.ts`：审批协议及模型审查；禁止自动重放部分执行的 shell。

后端替换应保留这个方向：不可变 ExecutionRequest（命令、cwd、环境、grants、模式）→
审批结果 → NativeBackend 或 SandboxedBackend。不要把“审批通过”表达成修改 sandbox
规则；两种执行路径明确分离。审批应绑定请求 ID 与权限快照，后端错误不触发自动降级。

## 可复用后端比较

查阅时间：2026-09-08；仅评估公开主仓库文档，本次未安装新依赖或声称完成候选库实测。

| 方案 | 能提供什么 | Pine 接入判断 |
| --- | --- | --- |
| [Anthropic sandbox-runtime](https://github.com/anthropics/sandbox-runtime) | macOS Seatbelt、Linux bubblewrap、网络代理、违规监测；库与 CLI | 首选验证对象；默认全盘可读，必须显式映射 Pine 的读授权；官方仍标为 research preview |
| [Microsoft mxc](https://github.com/microsoft/mxc) | 按策略组合隔离后端 | 候选；需审核 SDK 生命周期和打包。其 [Seatbelt 文档](https://github.com/microsoft/mxc/blob/main/docs/seatbelt/seatbelt-backend.md) 的能力开关可能扩大 scratch/keychain 权限，不能直接打开所有兼容选项 |
| [bubblewrap](https://github.com/containers/bubblewrap) | Linux namespaces / 挂载等低层原语 | 适合 Linux backend，不是 macOS 方案，也不替 Pine 定义策略 |

推荐优先做 sandbox-runtime 适配验收，再决定是否替换手写 profile。它减少平台维护，
但不会自动解决审批语义、Node 文件工具 TOCTOU、宿主环境、项目授权或 GUI 原生能力。
不要把它的默认配置当成 Pine 策略。多项目同时运行时，尤其需要验证配置和代理状态
不会串用；必要时每项目独立 helper 进程，避免共享全局 manager。

## 后续重构的验收门槛

1. 策略模型显式列出 read、write、network、Unix sockets / Mach services、临时存储、
   运行时只读树。明确 grant 并集和 deny 优先级；缺失后端或 capability 必须拒绝。
2. 网络采用内核限制加 broker/proxy，而不只设置 HTTP_PROXY；覆盖 loopback、IPv6、
   Unix socket、DNS、直连绕过、重定向和代理退出。域名许可不等于允许上传秘密。
3. 文件工具迁入受限 helper，通过窄 RPC 返回数据。后端禁止外部路径访问；对于允许路径
   中的 hardlink、rename 等，按威胁模型选择独立卷/快照，不能声称仅靠字符串可解决。
4. scratch 默认按项目隔离；系统用户 scratch 作为明确兼容能力。若要求隔离其他应用
   临时数据，应改用独立运行环境，不伪造原生 confstr 路径。
5. 审批结果必须携带 call ID、来源、是否执行；UI 区分审批拒绝、启动失败、命令退出、
   疑似权限失败、后端验证到的违规。系统日志需关联进程，输出正则只作提示。
6. 后端兼容测试同一套运行：外部读写、只读、符号链接、并发替换、硬链接、空格/Unicode
   路径、缺失文件、重叠授权、运行中新附件、超时/取消、后台子进程、管道、继承 TMPDIR、
   双项目并发、宿主已有沙箱、GUI/TCC、后端缺失及打包后的资源定位。
7. 平台测试必须实际执行并报告 skip 数；单元测试通过不等于 Seatbelt 集成测试通过。
   Linux/Windows 后端在各自 OS 验收，不能从 macOS 结果外推。

这些是尚未落地的强隔离升级要求，不应把本次核心重构表述成全部安全缺口已关闭。

## 本次验证结果

- `bun run check`：格式、Lint、TypeScript、单元测试通过。
- 外层无沙箱并显式继承 `TMPDIR=/private/tmp` 执行完整 check：60 个测试文件、
  440 个测试全部通过，0 跳过，实际覆盖 macOS Seatbelt 用例。
- 受限宿主执行 check：423 通过、17 平台原生用例跳过；该结果不替代上一项。
- `git diff --check` 通过。

## 后端接入结果

已接入固定版本 sandbox-runtime 0.0.75 并移除手写 Seatbelt profile 生成器；
`bash-sandbox.ts` 只保留运行时路径类别，`sandbox/policy.ts` 统一编译 SRT 权限。

已落地：

- 每次受限调用独立 supervisor，避免全局 manager 的跨项目配置串用；FD 3 返回执行状态。
- 网络默认无许可，关闭本机监听/Unix sockets/额外 Mach 服务；审批后的原生路径独立。
- 项目 scratch 隔离，取消全用户原生 tmp 授权，覆盖 SRT 隐式写授权。
- 文件工具在内核限制内执行，覆盖检查后父目录替换；拒绝最终 symlink、多链接和非普通文件。
- 文件输出上限、取消、后台同组进程回收；审批参数快照；监督进程依赖树写保护。
- 源码运行和打包资源定位都通过应用依赖树加载固定 SRT，不从 PATH 或项目脚本选择后端。

迁移过程中发现并解决 Unix socket 长路径限制，以及 SRT 字面目录项递归授权与 Pine
祖先目录精确授权之间的语义差异。没有添加 Git/Python/AppleScript 命令放行表。
带 glob 元字符的字面目录目前失败关闭，防止意外扩张权限。

残余风险仍包括 inode/硬链接级别隔离、setsid 脱离进程组、CPU/内存/磁盘配额、内核与
允许系统服务的漏洞。它们需要独立卷/快照/VM 或资源监督器；本次不声称关闭这些风险。
Windows 后端现使用 SRT 自带的 `srt-win.exe`、专用账户、NTFS ACL 与 WFP，设置页提供
显式的一次性 UAC 安装入口。应用启用 ASAR，并仅将需要生成子进程的 Windows helper
放入 `app.asar.unpacked`；Windows CI 校验该物理资源路径，同时验证未安装产物和经
Squirrel 安装后的应用均可启动。
Linux 保持不可用。审批 UI 仍使用既有工具错误展示，没有新增系统日志违规实时看板。

验证补充：真实 Electron 44.1.1 Helper（ELECTRON_RUN_AS_NODE）能够启动 supervisor，
完成受限文件写入与读取；应用安装在 /Applications 之外时，其 app bundle 作为只读运行时
授权。Vite 生产 bundle 编译通过。Forge package 在解压缓存的 Electron ZIP 阶段提前结束，
没有生成应用产物，因此本次不报告完整打包通过；该阶段尚未进入依赖注入或新后端执行。

最终后端回归：61 个测试文件、448 个测试在无外层沙箱并设置 TMPDIR=/private/tmp 时
全部通过，无跳过；覆盖 loopback 代理/直连、Unix socket、双项目并发、授权后路径替换、
硬链接写入前拒绝、伪造 stdout 状态和审批参数快照。格式、Lint、TypeScript 检查通过。
