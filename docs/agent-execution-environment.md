# Agent 执行环境

## 执行与审批

普通 shell 以及 read/edit/write 的实际文件操作使用
`@anthropic-ai/sandbox-runtime@0.0.75`。macOS 使用 zsh/Seatbelt；Windows 使用
PowerShell，以及库提供的专用低权限账户、NTFS ACL 和 WFP 网络隔离后端。Linux 仍失败关闭。
`privileged_bash` / `privileged_powershell` 审批通过后走原生执行器，不添加 Pine 沙箱。
它仍受宿主 OS/TCC/上游沙箱约束，不是 sudo，也不会移除命令自行创建的沙箱。

每次受限执行启动独立监督进程，独占 SRT manager 和代理。审批参数先复制，审批期间
修改输入对象不会改变执行的命令。审批拒绝、后端启动失败和命令退出分开处理；任何
失败都不会自动重放到原生环境。监督进程通过独立 FD 返回状态，命令输出无法伪造它。

## 默认能力

- 读：共享目录、附件、项目 scratch、系统/应用/工具链运行时树；其他文件默认拒绝。
- 写：read-write 目录及项目 scratch。授权按并集合并；read-only 不覆盖另一个写 grant。
- 网络：默认无域名许可；代理拒绝所有目的地，内核阻止绕过代理的直连。loopback、
  本地监听和 Unix sockets 不开放。网络操作使用显式审批的原生执行。
- 系统服务：macOS 采用 SRT 的受限 Mach 服务集合；Windows 使用专用账户和 WFP；
  不开放 weaker network/nested sandbox 开关。
- 临时存储：`sessionsRoot` 相邻 tmp 下，按 canonical cwd 的 SHA-256 前 24 位划分。
  不再共享整个用户临时目录。SRT 的隐式 `/tmp/claude`、用户日志目录写权限显式拒绝。
- 运行时保护：监督进程依赖树和可执行文件拒绝写入；SRT 的配置/钩子保护继续生效。
  这些文件的修改可能需要原生审批，即使位于项目目录内。

macOS 监督进程自己需要短路径控制 socket，使用系统临时目录下 `pine-srt-*` 的随机私有目录；
Windows 也使用系统临时目录存放一次性控制状态。该目录不加入子进程的读写授权，正常退出时清理。

## 文件工具

Agent 先检查目录授权；具体 access/read/header/mkdir/write 通过受限文件子进程执行。
父目录在检查后被替换为外部 symlink 时，实际系统调用仍受内核约束。
最终文件使用 O_NOFOLLOW，读写要求普通文件且 link count 为 1；写入先检查再 truncate。
读取限制为 64 MiB，并对增长中的文件按流限制，不直接无限 readFile。

文件工具的单次操作有 30 秒限制，支持取消。单次 shell 结束时清理同一进程组的后台
子进程；要启动常驻服务需显式原生执行。超时/取消先 TERM 后 KILL，保留实际退出状态。
输出中的 EPERM 等只作诊断提示，不能证明是哪一层权限拒绝；退出 0 不因打印错误文字
而变为失败，141 不被隐式归零。

## 环境与路径

普通 shell 传入最小环境，保留用户目录和 PATH，并将临时目录、缓存变量指向项目 scratch。
Windows 通过 PowerShell 环境变量设置同样的隔离路径。用户目录/PATH 不隐式授予私有配置权限；原生执行保留宿主环境。

SRT 的字面路径是递归匹配，Pine 通过单字符 glob 编译精确祖先目录规则，允许运行时
发现目录但不开放兄弟文件内容；真实测试覆盖 Bun heredoc、空格/中文路径和兄弟文件拒绝。
当前 SRT API 对带 glob 元字符/控制字符的字面路径不能无歧义表示，因此保守拒绝该策略，
提示使用原生审批；不会把用户路径中的 `*` 或 `[]` 当作宽泛授权。

## 已知边界

这是本机路径/网络隔离，不是独立虚拟机或文件系统快照。预先存在的硬链接、并发创建
硬链接、独立进程组、资源耗尽与允许的系统服务仍需要更强隔离方案。文件工具的 link
检查不能等价为整个 shell 的 inode 隔离。其他应用/原生操作主动更改授权目录也不受 Pine
控制。Windows 安装包由 `windows-latest` 构建并执行打包产物启动冒烟检查；沙箱首次使用仍需用户在设置中批准一次 UAC 安装。Linux 尚未接入。

实现与验证记录见 [沙箱审计](architecture/sandbox-audit.md)。
