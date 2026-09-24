# 文件预览渲染层

Pine 的预览链路分为两个注册点：主进程登记允许读取的二进制格式，renderer 登记负责显示该格式的组件。文件路径的授权、读取和 `pine-project-media://` URL 仍由主进程处理；预览组件只接收经过授权的内容描述。

## 格式与渲染器

- `apps/desktop/src/main/previewFormats.ts` 声明可经媒体协议提供的扩展名、MIME 类型和预览类型。未登记的文件仍按受限文本读取规则处理；无法解码时显示不支持。
- `apps/desktop/src/components/project/file-preview/previewRenderers.ts` 按顺序登记渲染器。第一个 `supports` 命中的渲染器负责该文件，因此新库可以只替换它支持的格式，其余格式继续使用现有实现。
- `previewRenderer.ts` 定义每个渲染器共同接收的 `PreviewRendererProps`、共同发出的 `PreviewRendererEvents`，以及工具栏读取的 `PreviewRendererCapabilities`。`ProjectFilePreview.vue` 只负责文件加载、通用工具栏、错误状态和发送到会话。

新增预览库时，先实现一个适配组件：接收 `preview`、文件信息、缩放、反色和显示模式；通过 `selectionChange` 返回 `AttachmentSelection`，通过 `metadataChange` 返回页数或媒体尺寸，通过 `failed` 报告加载失败。需要在菜单打开前同步读取文本选区时，可暴露 `readSelection()`。然后在 `previewRenderers.ts` 中登记它的匹配条件和能力声明。若库需要读取新的二进制扩展名，还要在 `previewFormats.ts` 中登记对应的 MIME 类型，不能绕过主进程的文件授权。

渲染器可以继续按需加载。代码、图片和视频使用直接组件；PDF 与 Office 适配器按需加载各自的库。替换某个库不应改变文件 tab、会话附件或媒体协议的接口。
