# Pine Project System v1

> 状态：实施基准  
> 范围：桌面端 Project 列表、元数据、多文件夹访问、会话隔离与导航

## 1. 概念

Pine Project 是 Pine 管理的逻辑容器，不等同于某个文件夹。一个 Project 包含：

- 一个稳定的 Project ID 和用户可见名称。
- 一个或多个 AI 可访问文件夹。
- 一个默认工作文件夹，作为新会话和 shell 的初始 cwd。
- 存储在 Pine 应用数据目录中的会话、索引和 Project 元数据。

Project 不会复制、移动或接管用户文件夹，也不会在用户文件夹内自动写入 `.pine/`。

## 2. 持久化

根目录由 Electron `app.getPath("userData")` 提供：

```text
<userData>/
└── projects/
    └── <project-id>/
        ├── project.json
        ├── sessions/
        └── cache/
            └── session-search.sqlite
```

Project 列表通过扫描 `projects/*/project.json` 获得，不维护重复的全局索引文件。`project.json` 使用同目录临时文件加 rename 原子替换。

## 3. 数据约束

- Project 名称必须非空，最长 100 个字符。
- 每个 Project 至少包含一个文件夹。
- 每个文件夹具有稳定 ID、显示名称和 `read-only | read-write` 权限。
- 同一 Project 内不允许重复或嵌套根目录。
- 必须指定一个已添加的文件夹为默认工作目录。
- 文件夹丢失时保留元数据，UI 允许重新定位。
- 删除 Project 只删除 Pine 的 Project 目录，不删除其引用的用户文件。

## 4. 进程边界

- Main process 是 Project 元数据和当前窗口 runtime 的单一事实源。
- Preload 只暴露明确的 Project、文件树和会话 API。
- Renderer 不直接读写文件系统，也不向文件 IPC 传入任意绝对路径。
- Project 文件请求使用 `{ folderId, relativePath }`，Main process 将其解析并校验在对应根目录内。
- 每个窗口同时只激活一个 Project；切换时释放旧 runtime。

## 5. UI 与导航

- `/projects`：Project Library，包含列表、空状态、创建、编辑和删除入口。
- `/projects/:projectId`：Project 工作界面。路由可直接加载，不依赖之前的 Renderer 内存状态。
- 文件树的第一层是 Project Folder，各根目录独立延迟加载。
- Project 设置支持重命名、添加/移除/重新定位文件夹、权限调整和默认目录设置。

## 6. Session 与 Agent

Session 的持久化根目录与 cwd 分离。所有 Project session 存储在 Project 应用数据目录中，新 session 的 cwd 取当时的默认文件夹。Session 搜索不按 cwd 过滤，因此修改默认文件夹不会隐藏历史会话。

文件工具按 Project Folder 权限执行。普通 Shell 从默认文件夹启动，由 macOS Seatbelt 或 Windows 专用低权限账户、NTFS ACL 与 WFP 执行目录和网络权限；运行时与临时存储能力见 [Agent 执行环境](agent-execution-environment.md)。cwd 不是安全边界。

## 7. 旧数据

新系统不写入或删除用户文件夹中已有的 `.pine/`。旧数据导入属于独立后续功能，不在 v1 启动时自动执行。
