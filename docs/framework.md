# Pine 框架文档 v0.2

> [!IMPORTANT]
> 本文档中“项目等同于单个工作目录”、“项目元数据位于 `.pine/`”和“每项目一窗口”等设计已停止作为实现基准。新的 Project System 以 [Project System v1](./project-system.md) 为准。本文档的其他产品想法仅作历史讨论记录。

> 状态：讨论稿，已根据 Pi 仓库源码与可用轮子深化  
> 目标：确定 Pine 的产品形态、技术栈、模块边界与第一层实现路径，作为 MVP 的开发基准。

---

## 1. 一句话定位

**Pine 是一个本地优先、开源的通用任务 Agent 桌面客户端。**

它把「编辑器 + 文件管理器 + 轻量版本管理 + Agent 对话界面」混合在一个 Electron 工作区里；强调 Human-in-the-loop，用一组最小、最原子的工具让 Agent 自行派生复杂 use case；并允许 Agent 为自己编写可复用的 skill 文件，实现低门槛的自举扩展。

---

## 2. 核心哲学

- **冷静客观的 Agent**：不扮演热情助手、不堆砌 hype。Agent 是用户思考与执行的工具，不是替代品。
- **失败即暂停 + 选项**：Agent 遇到失败时停下来，清晰说明原因，提供可选下一步；不自作主张重试或绕过。
- **重复检测后建议生成 Skill**：当 Agent 检测到某个工作流被重复执行时，主动建议用户保存为 Skill；Skill 是用户教 Agent 的主要方式。
- **AGENTS.md 作为项目约定**：项目根目录支持 `AGENTS.md`，Agent 读取其中内容作为项目级上下文。当 Agent 检测到稳定用户偏好时，先询问用户，再写入 `AGENTS.md`。
- **上下文内嵌帮助 + 执行时解释**：UI 关键区域提供可点击的帮助入口；Agent 在执行时根据 verbose 等级向用户解释自己的计划与工具调用。
- **Workflow 优先于线性 TODO**：Agent 规划复杂工作时不必被传统 TODO list 限制；可以动态生成带时序、依赖、并行与阻塞关系的 workflow，并在 UI 中以流程图展示。
- **阶段性 Takeaway**：任务阶段性完成后，Agent 可以自动生成 takeaway 块，总结本次 Agent 使用方式、工具调用逻辑与任务相关知识要点。
- **Human-in-the-loop**：默认询问、允许打断、随时接管。Agent loop 是协作，不是自动运行。
- **教科书式产品**：界面和交互本身应该教会用户什么是 Agent Loop、什么是工具调用、什么是上下文。
- **自举式扩展**：先提供最小原子能力，再让 Agent 和用户一起写出更具体的 skill，装回到自己身上。
- **不预设具体用户场景**：保持泛用性，让 Agent 通过原子工具和 skill 派生具体 use case。
- **Sóber 哲学原则性影响**：Pine 保持冷静、客观、反 hype、精确的气质；不模仿过度热情或销售式语言。Agent 语气可通过 verbose 等级在「通俗详细」与「透明专业」之间切换。
- **失败即暂停 + 选项**：Agent 遇到工具失败、模型错误或任务卡住时，默认停下来向用户说明原因并提供可选下一步，而不是在用户看不见的地方自救。

---

## 3. 产品形态

### 3.1 平台

- **第一版：Electron 桌面应用**，跨平台（macOS / Windows / Linux）。
- **模型配置采用「全局基础 + 项目覆盖」**：全局保存 provider/baseURL/API key 等连接信息；每个项目可覆盖活跃模型和思考级别。
- **多项目采用「每项目一窗口」**：一个 Pine 窗口绑定一个项目，多项目时开多个窗口。
- **项目元数据位于项目内 `.pine/` 目录**：settings、session、annotations、skills、checkpoints 都放这里，便于项目迁移/共享。
- **Web / 网络工具标记为保留项**：P0 不包含，架构上预留。

### 3.2 用户入口

用户打开 Pine 后看到「项目空间」：

1. **新建项目** → Pine 在本地自动创建隔离目录（类似容器/沙盒）。
2. **打开已有项目** → 以项目卡片/列表呈现，用户不直接操作文件系统路径。
3. **导入文件** → Pine 把文件复制/链接到项目目录中，并自动索引。

> 下沉市场用户不需要知道项目存在哪个 `~/Documents/...` 路径下；需要时可在设置里查看或导出。

### 3.3 主界面布局

```
┌─────────────────────────────────────────────────────────────────────┐
│  项目栏（切换项目 / 新建 / 导入 / 设置）                               │
├───────────┬───────────────────────────────┬────────────────────────┤
│           │                               │                        │
│  文件树   │      编辑器 / 预览器            │    Agent 对话           │
│  + 搜索   │      （Monaco / 预览）          │    + 上下文             │
│           │                               │                        │
│           │  ┌────────────────────────┐   │   ┌────────────────┐   │
│           │  │  内联批注 → Agent       │   │   │ 工具确认弹窗    │   │
│           │  └────────────────────────┘   │   └────────────────┘   │
├───────────┴───────────────────────────────┴────────────────────────┤
│  状态栏：当前模型 / token / 最近 checkpoint / 任务进度 / 安全模式       │
└─────────────────────────────────────────────────────────────────────┘
```

- 三栏可折叠/调整宽度。
- 编辑器与预览器根据文件类型切换。
- Agent 对话栏与当前打开文件绑定：文件内批注可直接作为上下文发给 Agent。

---

## 4. 技术栈（深化版）

### 4.1 Agent Loop：复用 Pi 的核心层，但不复用 TUI/CLI

Pi 仓库是 monorepo，包含 5 个包：

| 包                                | 职责                                                                                | Pine 是否使用  |
| --------------------------------- | ----------------------------------------------------------------------------------- | -------------- |
| `@earendil-works/pi-agent-core`   | `AgentHarness` / `Agent` / `NodeExecutionEnv` / `Session` / skill 加载 / compaction | **核心依赖**   |
| `@earendil-works/pi-ai`           | providers、模型发现、`Models` 集合、streaming/complete API、auth                    | **核心依赖**   |
| `@earendil-works/pi-coding-agent` | CLI/TUI 包装、内置 read/bash/edit/write/grep/find/ls 工具                           | **不直接依赖** |
| `@earendil-works/pi-tui`          | 终端 UI 组件                                                                        | **不使用**     |
| `@earendil-works/pi-orchestrator` | 多 Agent 编排                                                                       | 第一版不需要   |

**关键结论**：

1. `pi-agent-core` **不耦合 TUI**。它的依赖只有 `pi-ai`、`ignore`、`typebox`、`yaml`，可以在 Electron 主进程中直接使用。
2. `pi-coding-agent` 的工具实现虽然有用，但依赖 `pi-tui` 做渲染。Pine 需要**参考其 `execute` 逻辑**，移除 TUI 渲染层后重写为自己的工具。
3. `pi-ai` 的 `createProvider()` 可以构建任意 OpenAI-compatible 自定义 provider；`Models` 集合统一负责 auth 解析和请求路由。

### 4.2 为什么选择 `AgentHarness` 而不是底层 `Agent`

`AgentHarness` 已经帮 Pine 做了：

- 绑定 `ExecutionEnv`（文件系统 + shell）
- 绑定 `Session`（持久化聊天记录，支持 tree/fork/checkpoint）
- 绑定 `Models`（pi-ai providers）
- 工具注册与激活管理
- Skill / prompt template resources 注入系统提示
- compaction（上下文压缩）和 branch summary
- 更完整的事件流（`tool_call`、`tool_result`、`before_agent_start` 等）

Pine 主进程只需要初始化一次 `AgentHarness`，然后把它的事件通过 IPC 转发到渲染层。

### 4.4 依赖策略

- **核心不重复造轮子**：Agent Loop、providers、session、skill 格式直接用 Pi 的成熟实现。
- **工具层半自制**：参考 Pi 的 execute 逻辑，剥离 TUI 渲染层后封装成 Pine 的工具。
- **UI 层尽量用现成组件**：shadcn-vue + Monaco + 文件预览库，减少自写复杂组件。

### 4.3 总体分层

| 层              | 技术选择                                    | 理由                                                                               |
| --------------- | ------------------------------------------- | ---------------------------------------------------------------------------------- |
| 桌面壳          | **Electron + electron-vite**                | 跨平台、成熟、能真正本地读写文件与调用 shell；electron-vite 官方提供 Vue + TS 模板 |
| 打包/更新       | **Electron Forge + Squirrel.Windows**       | macOS 使用 DMG，Windows 使用签名 Squirrel 安装包和 Electron 原生 autoUpdater        |
| 前端框架        | **Vue 3 + TypeScript**                      | 用户指定 Vue 生态                                                                  |
| UI 组件         | **shadcn-vue / reka-ui (radix-vue)**        | shadcn-vue 基于 reka-ui 原子组件，可定制、现代化                                   |
| 样式            | **Tailwind CSS v4 + @tailwindcss/vite**     | v4 推荐 Vite 原生插件，与 shadcn-vue 配合                                          |
| 图标            | **lucide-vue-next**                         | shadcn-vue 生态默认图标                                                            |
| 前端状态        | **Pinia**                                   | Vue 官方推荐状态管理                                                               |
| Electron 工具   | **@vueuse/electron**                        | 将 Electron renderer API 封装为 Composition API                                    |
| 设置持久化      | **electron-store**                          | 简单 JSON-backed 配置存储                                                          |
| 编辑器          | **Monaco Editor**                           | VS Code 同款，文件树、语法高亮、diff、批注都成熟                                   |
| Monaco Vue 封装 | **@guolao/vue-monaco-editor** 或自封装      | 社区有现成封装，但 Electron 下可能需要自定义 loader                                |
| Agent Loop      | **@earendil-works/pi-agent-core**           | 已提供 `AgentHarness`、事件流、session、skill、compaction                          |
| 模型接入        | **@earendil-works/pi-ai**                   | BYOI，自定义 provider；内置 OpenAI/Anthropic/Google/DeepSeek 等                    |
| 工具实现        | 参考 `pi-coding-agent` 的 `core/tools` 重写 | read / write / edit / bash / grep / find / ls / ask_question / create_skill        |
| 版本控制        | **isomorphic-git**                          | 纯 JS Git 实现，Electron 主进程可用；先做本地 checkpoint                           |
| 文件监听        | **chokidar**                                | 监听项目文件变化，更新文件树                                                       |
| 文件搜索        | **fast-glob + minimatch + Fuse.js**         | 目录遍历、glob 过滤、文件树内模糊搜索                                              |
| diff / patch    | **diff**                                    | edit 工具生成 diff/patch、UI 展示变更                                              |
| 文件类型检测    | **file-type**                               | 根据文件头检测 MIME，用于预览路由                                                  |
| 文本预览        | **Monaco Editor**                           | 代码、文本、CSV、JSON 等                                                           |
| Markdown 预览   | **marked** 或 **unified(remark-rehype)**    | 渲染 Markdown，必要时做语法高亮                                                    |
| PDF 预览        | **pdfjs-dist / react-pdf**                  | 基于 Mozilla PDF.js                                                                |
| Office 预览     | **mammoth (docx) + xlsx (SheetJS)**         | 解析为 HTML/表格展示                                                               |
| 媒体预览        | 原生 `<img>` / `<video>` / `<audio>`        | 无需额外库                                                                         |
| 日期/国际化     | **Intl.DateTimeFormat**                     | 原生支持，无需 moment/dayjs                                                        |
| 未来向量检索    | **sqlite-vec / better-sqlite3**             | 本地向量搜索，P2 再考虑                                                            |

### 4.4 依赖策略

- **核心不重复造轮子**：Agent Loop、providers、session、skill 格式直接用 Pi 的成熟实现。
- **工具层半自制**：参考 Pi 的 execute 逻辑，剥离 TUI 后封装成 Pine 的工具。
- **UI 层尽量用现成组件**：shadcn-vue + Monaco + 文件预览库，减少自写复杂组件。

---

## 5. 模块划分

### 5.1 Electron 主进程（`src/main/`）

| 模块                    | 职责                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent-engine.ts`       | 每个窗口对应一个 `AgentHarness`；配置 `NodeExecutionEnv`、`Models`、session；管理模型切换、API key                                                                                         |
| `toolkit/`              | Pine 的原子工具实现：`read`、`write`、`edit`、`bash`、`grep`、`find`、`ls`、`ask_question`、`preview_file`、`create_checkpoint`、`create_skill`、`list_annotations`、`add_external_folder` |
| `project-service.ts`    | 创建/打开/导入项目；读写 `.pine/` 元数据；管理项目级外部白名单                                                                                                                             |
| `fs-service.ts`         | 基于 `NodeExecutionEnv` 的安全文件操作；路径边界检查                                                                                                                                       |
| `checkpoint-service.ts` | 基于 `isomorphic-git` 的自动 snapshot / checkpoint；支持回滚                                                                                                                               |
| `preview-service.ts`    | 文件类型检测与预览内容生成（文本/pdf/图片/office/音视频）                                                                                                                                  |
| `ipc-router.ts`         | 向渲染进程暴露安全 API：读取项目树、发 prompt、订阅事件、创建 checkpoint                                                                                                                   |
| `window.ts`             | 主窗口创建、菜单、生命周期；每项目一窗口                                                                                                                                                   |

### 5.2 Electron 渲染进程 / 前端（`src/renderer/`）

| 模块                           | 职责                                                 |
| ------------------------------ | ---------------------------------------------------- |
| `app.vue` / `workspace/`       | 三栏布局、项目切换、状态栏                           |
| `components/file-tree/`        | 文件树、新建/重命名/删除、搜索过滤、拖拽导入         |
| `components/editor-pane/`      | Monaco 编辑器、diff 视图、文件内批注组件             |
| `components/preview-pane/`     | 非代码文件预览容器（pdf/图片/office/media/markdown） |
| `components/chat-pane/`        | Agent 对话流、工具调用展示、Human-in-the-loop 确认框 |
| `components/annotation-layer/` | 管理编辑器内批注，把批注序列化为 Agent 上下文        |
| `components/skill-manager/`    | 展示、启用/禁用、让 Agent 生成新 skill               |
| `stores/`                      | Pinia stores：项目、会话、文件树、设置               |
| `composables/`                 | 复用逻辑：IPC 调用、Monaco 实例、批注状态            |

### 5.3 共享类型与配置（`src/shared/`）

- IPC channel 类型定义
- 项目元数据 schema
- Skill / Annotation / Checkpoint schema
- 自定义 provider 配置类型

---

## 6. 数据模型

### 6.1 项目（Project）

```yaml
project:
  id: uuid
  name: string # 用户可见名称
  rootPath: string # 本地目录（用户默认不可见）
  createdAt: timestamp
  updatedAt: timestamp
  settings:
    activeModel: { providerId, modelId } # 覆盖全局默认模型
    thinkingLevel: off | minimal | low | medium | high | xhigh
    autoCheckpoint: boolean # 是否在关键节点自动保存快照
    confirmBeforeTool: boolean # 是否默认工具执行前确认
    readOnlyMode: boolean
    externalFolders: [string] # 项目级外部 context 白名单
  skills:
    global: [skillRef] # ~/.pine/skills/ 下启用的
    project: [skillRef] # .pine/skills/ 下启用的
  annotations: [annotation]
  sessionPath: string # pi-agent-core JsonlSession 文件路径
```

### 6.2 批注（Annotation）

```yaml
annotation:
  id: uuid
  filePath: string
  range: { startLine, startChar, endLine, endChar } # 字符级精确范围
  text: string # 批注内容
  createdAt: timestamp
  resolved: boolean
  context: string # 选中的原文片段（可选）
```

### 6.4 AGENTS.md（项目约定）

```markdown
# Project Instructions

## 用户偏好

- 回复保持简洁，不要过度解释。
- 每次修改文件前创建 checkpoint。

## 项目约定

- 使用 TypeScript 严格模式。
- 测试文件放在 `__tests__/` 目录。
```

- Agent 自动读取项目根目录 `AGENTS.md` 作为系统提示补充。
- 当 Agent 检测到用户反复表达同一偏好或项目约定时，应询问用户：「你是否希望我把‘每次修改前创建 checkpoint’写入 AGENTS.md？」
- 用户也可以在编辑器中直接编辑 `AGENTS.md`。

```

批注会作为「可引用上下文」出现在 Agent chat 中，例如：

```

[引用批注 #a1] 文件 src/index.ts 第 12-15 行：
"这里是否应该加一个错误处理？"

````

### 6.3 Checkpoint

- 每个项目默认启用本地 git 仓库（无 remote），仓库位于 `.pine/git/`。
- Pine 在关键节点自动创建 lightweight checkpoint，快照信息记录在 `.pine/checkpoints/` 或 git reflog。
- UI 提供「时间线」视图，列出 checkpoint，支持一键回滚到某个状态。
- 不暴露 commit message / branch / push 等概念；未来可平滑升级成完整 Git 集成。

---

## 7. Agent Loop 设计

### 7.1 工具清单（第一版）

优先保持最小集合。默认 HITL 模式为 **Auto Approve**：项目目录内的 `read`/`edit`/`write`/`ls`/`find`/`grep` 等操作免确认，`bash` 等高 versatile/高风险工具需要确认。

| 工具 | 职责 | 安全策略 |
|---|---|---|
| `read` | 读取文本/图片文件，支持 offset/limit | 项目目录内免确认；外部白名单内免确认 |
| `write` | 写入新文件或覆盖文件，自动创建父目录 | 项目目录内免确认；禁止写入项目外 |
| `edit` | 精确文本替换，返回 diff/patch | 项目目录内免确认；原子锁防止并发冲突 |
| `bash` | 在项目目录下执行 shell 命令 | **默认需要确认**；超时；危险命令黑名单 |
| `ls` | 列出目录内容 | 项目目录内免确认；外部白名单内免确认 |
| `find` | 按名称查找文件 | 限制在项目目录及外部白名单 |
| `grep` | 按内容搜索文件 | 限制在项目目录及外部白名单 |
| `ask_question` | 当 Agent 需要澄清时向用户提问 | 无风险 |
| `create_skill` | Agent 生成一个新的 skill 文件 | 默认确认；保存到 `.pine/skills/` |
| `create_checkpoint` | 主动创建 checkpoint | 无风险 |
| `list_annotations` | 读取当前文件的用户批注 | 无风险 |
| `add_external_folder` | 将外部目录加入项目级 context 白名单 | 需要用户确认 |
| `update_agents_md` | 根据检测到的用户偏好更新 `AGENTS.md` | 必须先询问用户，获得明确同意 |

### 7.2 Human-in-the-loop 的实现

提供三种介入级别，用户可按项目或全局切换：

| 模式 | 行为 | 适用场景 |
|---|---|---|
| **Let Me Review** | 每个工具调用都等待用户确认 | 新手、关键项目、教育场景 |
| **Auto Approve** | Agent 自行判断是否需要确认 | 默认推荐模式 |
| **YOLO** | Agent 自主执行，只在出错时通知 | 高级用户、可信环境、重复性任务 |

**默认策略（Auto Approve）**：

- 项目目录内的 `read`、`edit`、`write`、`find`、`grep`、`ls` 等操作**不需要确认**。
- `bash` 工具作为高 versatile/高风险的工具，**默认需要确认**，并受危险命令黑名单限制。
- `create_skill`、`add_external_folder`、`update_agents_md` 等会改变 Pine 自身能力或项目约定的行为需要确认。
- 任何尝试写入项目目录外、访问白名单外外部路径的操作需要确认。
- **失败即暂停**：Agent 遇到工具失败、模型错误或任务卡住时，默认停下来向用户说明原因并提供可选下一步，不自作主张重试。

技术实现上利用 `AgentHarness` 的 `before_agent_start` 和 `tool_call` 事件：

1. 渲染层收到 `before_agent_start`，在 UI 中显示「Agent 开始工作」。
2. 在 **Let Me Review** / **Auto Approve** 模式下，工具调用触发 `tool_call` 事件，主进程暂停执行并向渲染层发送确认请求。
3. 用户点击「允许」后，主进程继续；点击「拒绝」则返回 `{ block: true, reason: "..." }`。
4. 用户可随时点击「停止」调用 `agent.abort()`。

> 在 **YOLO** 模式下，`tool_call` 事件仅用于 UI 展示，不阻塞执行。

### 7.4 Web / 网络工具（保留项）

第一版工具集以本地文件操作为主，但预留网络能力：

- `fetch_url`：读取网页/文档内容。
- `web_search`：通过配置搜索 API key 后执行搜索。

具体实现时机待定；P0 不包含。

### 7.3 Skill 自举（最小版）

- Skill 采用兼容 [Agent Skills 规范](https://agentskills.io/specification) 的 Markdown 文件。
- 格式：
  - 顶部 YAML frontmatter：`name`、`description` 必填；可选 `license`、`compatibility`、`metadata`、`allowed-tools`。
  - Markdown body：使用说明、步骤、示例。
  - 可附带 `scripts/`、`references/`、`assets/` 等脚本、参考资料和模板文件；Agent 通过资源工具按需读取，不在发现阶段全部注入上下文。
- 存放位置：
  - 项目级：`<project>/.pine/skills/`
  - 用户级：`~/.pine/skills/`
- **Skill 的生成时机**：
  - 用户明确说「以后遇到类似情况自动做」时，生成 Skill。
  - Agent 检测到某个工作流被重复执行 2-3 次后，主动建议用户保存为 Skill。
- `create_skill` 工具让 Agent 在用户请求下生成新的 skill。
- 生成后**不自动启用**，由用户在 skill manager 中启用，或下次会话时被 `loadSkills` 发现。

> 第一版不做运行时热加载 TypeScript extension，避免复杂度和安全风险。

### 7.5 Agent 可解释性与 verbose 等级

Pine 在设置面板提供 **verbose 等级**切换：

| 等级 | Agent 解释风格 |
|---|---|
| **通俗详细** | 用易懂的语言解释计划、工具调用和结果；适合一般用户和教育场景。 |
| **透明专业** | 用精确、客观、技术化的语言描述操作；适合进阶用户和高效工作。 |

UI 默认显示工具调用卡片；verbose 等级控制 Agent 是否在回复中加入额外解释。

### 7.6 Workflow 规划与流程图视图

Agent 在规划工作时可以选择两种计划表达：

1. **线性 TODO**：适合简单、短链路任务。
2. **Workflow 图**：适合多步骤、可并行、存在依赖或需要等待用户确认的复杂任务。

Workflow 不是固定模板，而是 Agent 在执行前或执行中动态生成和更新的任务图。它至少包含：

- `node`：一个可执行或可确认的工作单元，例如读取文件、修改配置、等待用户选择、运行测试、生成总结。
- `edge`：节点之间的关系，例如 `depends_on`、`can_run_parallel`、`blocks`、`produces_context_for`。
- `status`：节点状态，例如 `pending`、`running`、`blocked`、`done`、`failed`、`skipped`。
- `owner`：节点由 Agent 执行、用户确认，或外部系统完成。

UI 上，Workflow 以流程图形式展示在 Agent 对话旁或任务详情面板中：

- 用户能看到当前任务为什么执行到这一步、哪些节点可并行、哪些节点被确认或失败阻塞。
- Agent 执行工具时，对应节点状态同步更新；失败时停在失败节点，并给出可选分支。
- 用户可以暂停、跳过、重排或要求 Agent 解释某个节点。
- 对简单任务，UI 可以折叠为普通 TODO；对复杂任务，TODO 只是 workflow 的线性视图。

技术上，Workflow 事件作为 Agent event stream 的一类结构化事件向渲染层发送；渲染层负责把节点和边渲染为流程图，不把流程图逻辑耦合到模型文本回复中。

### 7.7 Takeaway 系统

Pine 支持在任务阶段性完成后，由 Agent 自动生成一个 **Takeaway 块**。它不是聊天结尾的客套总结，而是面向用户学习和复用的知识沉淀。

Takeaway 可以包含：

- **完成了什么**：用简短条目说明本阶段实际完成的任务结果。
- **Agent 如何完成**：说明关键工具调用、上下文来源、判断依据和 Human-in-the-loop 节点。
- **用户可复用的知识点**：提炼任务相关的技术、项目约定、调试方法或操作模式。
- **后续风险与检查点**：指出仍需验证的内容、可能的边界条件，以及推荐的下一步。

触发时机：

- 一个 workflow 节点或阶段完成，例如实现、验证、提交、生成 skill。
- Agent 检测到用户可能不熟悉某个概念，例如工具确认、checkpoint、依赖解析、模型配置。
- 用户显式要求「总结一下」「我应该记住什么」「这个过程有什么经验」。

UI 上，Takeaway 以独立块展示在 Agent 对话流中，并与对应 workflow 节点或工具调用记录关联。用户可以折叠、复制、保存到项目笔记，或要求 Agent 将稳定规则写入 `AGENTS.md`。

Takeaway 受 verbose 等级影响：在「通俗详细」模式下偏教学解释；在「透明专业」模式下偏精确摘要、风险和决策依据。

---

## 8. Electron 安全架构

### 8.1 进程隔离

- `contextIsolation: true`（Electron 默认且推荐）。
- preload 脚本通过 `contextBridge.exposeInMainWorld` 暴露最小 API。
- 渲染进程不直接访问 Node.js / fs / shell。

### 8.2 IPC 暴露面

只暴露必要的通道：

```ts
// 示例：渲染层可调用的受控接口
interface PineAPI {
  // 项目
  listProjects(): Promise<ProjectMeta[]>;
  createProject(name: string): Promise<ProjectMeta>;
  openProject(id: string): Promise<ProjectState>;
  importFiles(projectId: string, files: File[]): Promise<void>;

  // 文件树
  readDir(projectId: string, path: string): Promise<FileNode[]>;
  readFile(projectId: string, path: string): Promise<{ content: string; mimeType?: string }>;
  watchProject(projectId: string, callback: (event: FileEvent) => void): () => void;

  // Agent
  sendPrompt(projectId: string, text: string, images?: ImageData[]): Promise<void>;
  onAgentEvent(projectId: string, callback: (event: AgentEvent) => void): () => void;
  confirmTool(projectId: string, toolCallId: string, allow: boolean): Promise<void>;
  abort(projectId: string): Promise<void>;

  // 批注
  listAnnotations(projectId: string, filePath?: string): Promise<Annotation[]>;
  createAnnotation(projectId: string, annotation: AnnotationCreate): Promise<Annotation>;
  resolveAnnotation(projectId: string, id: string): Promise<void>;

  // Checkpoint
  listCheckpoints(projectId: string): Promise<Checkpoint[]>;
  createCheckpoint(projectId: string, label?: string): Promise<void>;
  restoreCheckpoint(projectId: string, checkpointId: string): Promise<void>;
}
````

### 8.3 Agent 工具安全

- 所有工具执行前检查路径是否越界（`path` 必须解析到项目目录内或项目级外部白名单内）。
- **项目级外部文件夹白名单**：用户可以把外部目录（如 `~/Downloads/references`）加入某个项目的 context 白名单，Agent 才能读取其中的文件。
- `bash` 工具默认需要确认，使用受限 shell profile，禁止 `rm -rf /`、`sudo` 等危险模式；命令工作目录限制在项目目录。
- 提供三种 Human-in-the-loop 模式（Let Me Review / Auto Approve / YOLO），默认 Auto Approve。
- 工具执行超时，防止 hang 住。

---

## 9. 文件预览器策略

| 文件类型                        | 预览实现                      | 库                   |
| ------------------------------- | ----------------------------- | -------------------- |
| 代码 / 文本 / CSV / JSON / YAML | Monaco Editor                 | `monaco-editor`      |
| Markdown                        | 渲染为 HTML（安全 sanitized） | `marked` + DOMPurify |
| PDF                             | 基于 PDF.js 的 canvas 渲染    | `pdfjs-dist`         |
| DOCX                            | 转换为 HTML                   | `mammoth`            |
| XLSX / XLS / CSV                | 解析为表格数据                | `xlsx` (SheetJS)     |
| 图片                            | `<img>`                       | 原生                 |
| 视频 / 音频                     | `<video>` / `<audio>`         | 原生                 |
| 未知 / 二进制                   | 文件信息卡片 + 十六进制/下载  | 自研                 |

预览器在渲染层以组件形式实现；主进程只负责读取文件 buffer 和检测 MIME。

---

## 10. 关键用户流程

### 10.1 首次打开

1. 直接进入项目列表/创建页面，不强制教程。
2. 选择/创建第一个项目。
3. 配置模型：输入 OpenAI-compatible base URL + API key + model id（或从本地发现）。
4. 进入工作区。空项目不放置引导文档，界面本身通过标签和状态栏传达功能。

### 10.2 日常任务

1. 用户在文件内高亮一段代码 → 添加批注。
2. 批注自动出现在 Agent 上下文中（可勾选是否发送）。
3. 用户在 chat 输入任务："帮我把这些错误处理补全"。
4. Agent 调用 `read` / `edit`，每个工具执行前弹出确认框。
5. 修改完成后，Agent 提示用户：「已修改 3 处，要保存 checkpoint 吗？」
6. 用户在时间线里可查看/回滚。

### 10.3 生成 Skill

1. 用户让 Agent 完成一个重复性任务。
2. Agent 做完后，用户说：「以后遇到类似任务，能不能自动这么做？」
3. Agent 调用 `create_skill`，生成 `.pine/skills/csv-to-markdown-table/SKILL.md`。
4. 用户在 skill manager 中启用它；下次输入相关任务时，skill 自动进入上下文。

---

## 11. 实现优先级（MVP）

### P0：能跑起来的最小闭环

- [ ] 用 `create-electron-vite` 搭 Electron + Vue 3 + TypeScript + Tailwind v4 + shadcn-vue 骨架。
- [ ] 在主进程初始化 `AgentHarness`：
  - `NodeExecutionEnv({ cwd: projectRoot })`
  - `Models` 集合，注册自定义 OpenAI-compatible provider
  - `JsonlSessionRepo` 持久化会话
  - 最小工具集：`read`、`write`、`edit`、`bash`、`ask_question`
- [ ] 渲染层通过 IPC 发 prompt / 收 `AgentHarness` 事件流。
- [ ] 项目创建/打开/导入（本地目录）。
- [ ] 文件树 + Monaco 编辑。
- [ ] Agent chat 基础界面（流式输出、工具调用展示）。
- [ ] Human-in-the-loop：工具执行前确认。
- [ ] BYOI 模型配置界面。

### P1：工作区差异化能力

- [ ] 文件内批注 + 批注作为 Agent 上下文。
- [ ] 简单预览器：图片、PDF、文本、Markdown。
- [ ] 自动 checkpoint / 回滚（isomorphic-git）。
- [ ] Skill 生成与管理（最小版）。
- [ ] 文件搜索与模糊过滤。

### P2：体验打磨

- [ ] Office 文档预览（docx / xlsx / pptx）。
- [ ] 状态栏、token 统计、模型切换、thinking level。
- [ ] onboarding 引导与空状态教学。
- [ ] 快捷键、三栏布局记忆、深色模式。

### P3：未来扩展

- [ ] 云端同步 / 协作。
- [ ] 运行时 TypeScript extension（像 Pi 一样）。
- [ ] MCP 工具生态接入。
- [ ] 向量检索 / RAG（sqlite-vec）。
- [ ] 移动端 / Web 版本。

---

## 12. 风险与待定问题

| 风险                                   | 说明                                                | 缓解方案                                                                                     |
| -------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Pi SDK 的 API 稳定性                   | 仍在 0.x 版本，接口可能变化                         | 锁定版本；封装自己的 `AgentEngine` 适配层隔离                                                |
| Monaco 包体积                          | Monaco 语法包、worker、字体很大                     | 只注册常用语言；使用 `monaco-editor-webpack-plugin` / Vite 等效插件做 tree-shaking；延迟加载 |
| bash 工具安全                          | 用户可能误执行危险命令                              | 默认确认 + 危险命令黑名单 + 路径沙盒 + 只读模式                                              |
| isomorphic-git 对大文件/二进制支持有限 | 大仓库 checkpoint 可能慢                            | 先做小项目；对二进制/大文件做特殊处理                                                        |
| Skill 发现与冲突                       | 用户生成大量 skill 后如何管理                       | 项目级 vs 用户级 skill；启用/禁用开关；命名空间                                              |
| Electron 原生模块重建                  | better-sqlite3 等需要对应 Electron ABI              | P2 再引入；P0/P1 使用纯 JS / JSON 存储                                                       |
| 模型能力差异                           | 不同 OpenAI-compatible 模型对 tool calling 支持不同 | 提供兼容性设置；推荐模型清单                                                                 |

---

## 13. 下一步建议

1. **冻结本框架文档**：确认名称（Pine）、P0 范围、是否采用 `AgentHarness`。
2. **验证 Pi SDK 在 Electron 主进程中的可嵌入性**：
   - 写一个最小 demo：主进程创建 `AgentHarness`，自定义 OpenAI-compatible provider，从渲染层发 prompt，主进程跑完并回传事件。
3. **搭 Electron + Vue 骨架**：使用 `create-electron-vite` 的 `vue-ts` 模板，集成 Tailwind v4 和 shadcn-vue。
4. **实现第一个原子工具**：先实现 `read` 和 `write`，验证工具 → Agent → IPC → UI 的闭环。
5. **设计项目元数据与存储格式**：项目列表、设置、批注、checkpoints 的本地存储位置与 schema。
6. **画出关键 UI 线框图**：三栏布局、批注交互、工具确认弹窗、checkpoint 时间线。

---

## 附录 A：Pi 架构关键点摘录

- `pi-agent-core` 导出：
  - `AgentHarness`：高层封装，推荐直接使用。
  - `Agent`：底层 loop，适合完全自定义。
  - `NodeExecutionEnv`：Node.js 文件系统 + shell 实现。
  - `loadSkills`：从目录加载 Agent Skills 规范 skill。
  - `JsonlSessionRepo` / `MemorySessionRepo`：会话持久化。
  - `compact` / compaction 辅助函数。
- `pi-ai` 导出：
  - `createModels()` / `builtinModels()`：provider 集合。
  - `createProvider()`：自定义 provider 工厂。
  - `openAICompletionsApi()` / `openAIResponsesApi()`：OpenAI 兼容 API 实现。
  - `envApiKeyAuth()`：标准 API key 解析。
  - `fauxProvider()`：测试/演示用假 provider。

## 附录 B：参考与灵感来源

- **Pi Agent**：自举 skill / extension、原子工具集、事件驱动 loop。
- **Sóber system.md**：冷静客观、Human-in-the-loop、教科书式产品的个性哲学。
- **Notion**：项目空间、卡片式项目入口、低路径暴露。
