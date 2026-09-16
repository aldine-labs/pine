# Pine UI 动画改造 Handoff

更新时间：2026-09-16

## 当前用户目标

用户希望左侧文件树拥有类似主会话中思考内容和工具分组的 accordion 展开/收起动画，要求展开和收起时能看到真实的布局移动、位移和连续性，而不只是淡入淡出。

另外，首页新对话页的 Parallax 图标需要使用项目主题语义 token 中的橄榄绿色。这个颜色调整已经完成。

## 当前已做的相关改动

### 文件树

文件：`apps/desktop/src/components/project/ProjectFileTree.vue`

当前加入了：

- `renderedExpanded` / `desiredExpanded` 两套展开状态。
- 收起时延迟 500ms 再从虚拟树中移除节点。
- 后代节点淡出、轻微 `translate/scale` 过渡。
- 新出现节点在一个 `requestAnimationFrame` 内做淡入。
- `TreeVirtualizer` 容器增加 `height` 过渡和 `overflow-hidden`。
- Chevron 增加旋转过渡。

当前实现的问题：

- 实际可见的主要效果只有 opacity；行之间的布局移动不明显，不能满足用户所说的 accordion 效果。
- 文件树使用 Reka UI 的 `TreeVirtualizer`。它把树 flatten 成绝对定位的虚拟行，并通过内联 `transform: translateY(...)` 定位；展开/收起时后续行的位置会直接跳到新位置。
- 当前的 `translate/scale` 加在行内部的 `ContextMenuTrigger` 内容上，不能驱动虚拟行自身的 `translateY` 几何位置，因此无法形成真实的“子树展开、后续行顺滑下移 / 上移”。
- 收起时只是保留节点 500ms 并隐藏内容，虚拟器中的行槽位仍然固定，结束时仍可能看到跳变。

因此不要把当前文件树动画视为完成版本。下一位 agent 应优先在运行中的桌面端检查实际效果，并重新设计几何动画。

推荐方向（二选一，需结合性能评估）：

1. 保留虚拟化：改造或包裹虚拟行，保存 entering/exiting 行的前后位置，使用 FLIP 或基于虚拟行 `start` 的 `transform` 动画，让后续行同步移动；退出中的行不能只靠 opacity 隐藏。
2. 如果项目文件树规模允许，改成递归渲染的嵌套 `TreeItem` / `ul`，在每个目录的子树外层使用主会话同样的 `grid-template-rows + opacity` accordion。需要保留现有选择、键盘导航、懒加载、右键菜单、文件预览、拖拽和 watcher 行为。

不要为了动画删除文件树现有的加载、选择、拖拽、右键菜单或 watcher 逻辑。用户只要求展示层变化。

### Parallax 图标

文件：`apps/desktop/src/components/project/ProjectSessionParallaxBackground.vue`

当前状态：

- 使用 `ParallaxFloat` / `ParallaxFloatElement`。
- 固定位置 slot，图标、depth、尺寸独立随机交换。
- `sensitivity` 当前为 `-0.5`。
- opacity 已按 depth 映射：depth 越深越实，当前范围约为 `0.16` 到 `0.45`。
- 用户发出消息后按 depth 顺序错开淡出；新对话初始隐藏，再做淡入。
- 图标颜色已改为 `text-chart-2`，对应 `apps/desktop/src/index.css` 中已有的主题语义 token，当前色相为偏橄榄绿。
- 不要重新加 drop shadow；用户已经明确不需要。

相关会话逻辑在：

- `apps/desktop/src/components/project/ProjectSessionView.vue`
- `apps/desktop/src/components/project/ProjectThinkingMarker.vue`

此前已修复主会话自动滚动和思考内容内部滚动的缓动，不要回退这些改动。

## 不要丢失的现有工作区改动

当前工作区是 dirty 的，以下改动来自此前连续的 UI 需求，不要使用 reset/checkout 清除：

- `apps/desktop/components.json`
- `apps/desktop/package.json`
- `apps/desktop/src/components/project/ProjectSessionView.vue`
- `apps/desktop/src/components/project/ProjectThinkingMarker.vue`
- `apps/desktop/src/components/project/__tests__/ProjectSessionView.test.ts`
- `apps/desktop/src/index.css`
- `apps/desktop/src/views/ProjectsView.vue`
- `bun.lock`
- `apps/desktop/src/components/project/ProjectSessionParallaxBackground.vue`
- `apps/desktop/src/components/ui/flickering-grid/`
- `apps/desktop/src/components/ui/parallax-float/`

Flickering grid 已经从新对话页移到项目选择界面；新建项目按钮不应被改动。

## 参考实现

主会话中可参考：

- `apps/desktop/src/components/project/ProjectThinkingMarker.vue`
- `apps/desktop/src/components/project/ProjectToolCallGroup.vue`

它们使用：

```vue
<div
  class="grid transition-[grid-template-rows,opacity] duration-500 ease-out-expo"
  :class="isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'"
>
  <div class="min-h-0 overflow-hidden">
    <!-- content -->
  </div>
</div>
```

注意：这段模式不能直接套到当前 flatten 的 `TreeVirtualizer` 外面就得到子树 accordion；必须先解决虚拟行的 mount/unmount 和位置变化问题。

## 验证结果

最近一次 `bun run check` 已通过：

- format：通过
- lint：通过
- typecheck：通过
- Vitest：81 个测试文件通过，569 个测试通过，46 个跳过

测试运行时有现有的 Vite `configLoader: 'native'` ESM/CJS warning，但不影响退出码。完成新的文件树动画后，至少重新运行：

```sh
bun run check
```

## 交接边界

本次 handoff 之后不再继续修改代码。下一位 agent 需要先处理文件树动画的真实几何移动问题，再根据运行效果决定保留虚拟化还是采用递归 accordion。
