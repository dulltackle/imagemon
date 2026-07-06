# 移动端编辑任务闭环第一版实现方案

本文描述手机端第一版编辑任务闭环的实现方案。目标是让设备使用者能从支持编辑的内置图鉴条目选择系统相册图片，填写文本输入，发起编辑任务，并在图片结果与任务历史中回看产出、完整提示词和编辑输入附件。

## 已确认范围

- 继续遵守 ADR 0178：编辑任务输入只来自设备相册或文件选择器；本次只实现系统相册入口。
- 只支持 `image` 文件输入；声明 `mask` 的编辑图鉴条目继续标记为暂不可执行。
- 系统相册选图后保留原图，不做裁剪、旋转、滤镜、压缩或格式转换。
- 本地安全上限为文件不超过 `20MB`，像素不超过 `25MP`；不通过时要求重新选图，不创建任务历史。
- 编辑输入在创建任务前复制为任务历史专属内部附件，任务快照保存内部附件路径，不保存相册原始 URI。
- 图片规格面沿用当前生成任务：设备使用者只选择尺寸，`quality: "auto"`、`format: "png"`、`n: 1` 固定。
- `/images/edits` 调用采用 OpenAI 兼容 multipart 请求语义，参考现有 CLI `editImage` 行为。

## 明确不做

- 不提供从应用内图片结果直接发起编辑。
- 不提供文件选择器入口。
- 不提供拍照入口。
- 不支持 `mask` 选择、预览、校验和上传。
- 不引入任务素材库、附件共享表、附件引用计数或附件去重。
- 不做编辑任务的失败后重新填写。
- 不做业务调用提示、入口红点或全局状态 UI 的扩展。
- 不做图片结果删除、任务历史删除、附件清理、ZIP 备份恢复等后续闭环。
- 不暴露 `input_fidelity`、背景、压缩率、多图数量等高级图片规格。

## 依赖决策

- `CONTEXT.md`：`编辑任务`、`编辑任务闭环`、`任务历史内部附件`。
- ADR 0016：首版不建立独立任务素材资产。
- ADR 0017：任务历史内部附件随历史删除清理。
- ADR 0052：首版普通模板输入按文本处理，只有 `image` 和 `mask` 是文件输入。
- ADR 0178：编辑任务输入只来自设备相册或文件选择器。
- ADR 0179：编辑任务输入文件在调用前本地校验。
- ADR 0183：编辑输入本地校验只做最小检查与固定安全上限。
- ADR 0192：图片数量语义对生成任务与编辑任务一致适用。
- ADR 0204：编辑任务输入复制为任务专属内部附件。

## 外部参考

- Expo ImagePicker 官方文档：<https://docs.expo.dev/versions/latest/sdk/imagepicker/>
- Expo ImagePicker 教程：<https://docs.expo.dev/tutorial/image-picker/>

实现时用 `npx expo install expo-image-picker` 安装 SDK 兼容版本，不手写版本号。

## 数据流

1. 设备使用者打开一个内置编辑图鉴条目。
2. 如果条目声明 `mask`，详情页显示暂不可执行，不提供提交入口。
3. 如果条目只声明 `image`，详情页显示系统相册选择按钮。
4. 选择图片时调用 `ImagePicker.launchImageLibraryAsync`：
   - `mediaTypes: ["images"]`
   - `allowsEditing: false`
   - `quality: 1`
   - `base64: false`
   - 单选
5. 选择取消时不改变已有输入。
6. 选择成功后做本地校验：
   - 文件可读取。
   - MIME 或文件扩展能判断为图片。
   - 文件大小 `<= 20 * 1024 * 1024`。
   - `width * height <= 25_000_000`。
7. 校验通过后在表单中展示图片预览、尺寸和文件大小。
8. 设备使用者填写普通文本输入并选择尺寸。
9. 点击提交时：
   - 检查默认图片模型配置是否为就绪模型配置。
   - 获取全局模型调用锁，调用类型建议新增 `imageEdit`。
   - 渲染图鉴条目，生成完整提示词。
   - 预生成任务历史 ID。
   - 将相册图片复制到应用私有目录下的任务历史内部附件路径。
   - 创建进行中的 `edit` 任务历史，快照写入附件路径。
   - 读取模型配置凭据。
   - 发起 `/images/edits` multipart 请求。
   - 保存返回图片为图片结果，并弱引用该任务历史。
   - 标记任务历史为完成；失败时标记为失败并保存错误摘要。
10. 设备使用者可从图片列表、图片详情、历史列表和历史详情回看结果。
11. 历史详情显示编辑输入附件预览；附件缺失时显示缺失状态。

## 依赖与配置

### `apps/mobile/package.json`

- 新增 `expo-image-picker`。
- 用 `npx expo install expo-image-picker` 更新 `apps/mobile/package.json` 和根 `package-lock.json`。

### `apps/mobile/app.json`

- 在 `plugins` 中加入 `expo-image-picker`。
- 配置相册权限说明，文案保持中文，例如：

```json
[
  "expo-image-picker",
  {
    "photosPermission": "Imagemon 需要访问相册，以便选择编辑任务的输入图片。"
  }
]
```

不配置相机权限，不新增拍照能力。

## 数据模型与迁移

### 任务类型

当前移动端 `ImageTaskType` 只有 `generate`。需要改为：

```ts
export type ImageTaskType = "generate" | "edit";
```

`image_task_histories.task_type` 的 SQLite CHECK 约束也要允许 `edit`。

### Schema v4

当前 `CURRENT_SCHEMA_VERSION` 是 `3`。新增 v4：

- `createSchemaV4` 中 `image_task_histories.task_type` CHECK 改为 `('generate', 'edit')`。
- `migrateSchemaV3ToV4` 需要重建 `image_task_histories` 表，因为 SQLite 不能直接修改 CHECK 约束。
- 迁移过程：
  1. 创建 `image_task_histories_v4`，结构同原表，但 `task_type` CHECK 包含 `edit`。
  2. 将旧表数据复制进去。
  3. 删除旧表。
  4. 重命名新表。
  5. 重新保证索引存在。
  6. 写入 schema version 4。

### 任务历史创建

当前 `createRunningHistory(snapshot)` 硬编码 `taskType: "generate"`。需要改为从快照推断或显式传入：

- manual snapshot 始终是 `generate`。
- promptdex snapshot 使用 `snapshot.promptdexEntry.taskType`。

为了让附件路径包含任务历史 ID，编辑任务服务需要预生成 history ID。建议把 repository 方法扩展为：

```ts
createRunningHistory(input: {
  id?: string;
  snapshot: ImageTaskSnapshot;
  taskType?: ImageTaskType;
}): Promise<ImageTaskHistory>;
```

兼容层可保留旧调用形式，或一次性更新现有生成任务调用点。

### 快照结构

当前 `PromptdexImageTaskSnapshot.taskInputs` 可以继续只保存普通文本输入。文件输入单独进入附件快照，避免把内部路径混入普通输入展示。

新增：

```ts
export interface ImageTaskInternalAttachmentSnapshot {
  role: "image" | "mask";
  filePath: string;
  mimeType: string;
  originalFileName: string | null;
  width: number | null;
  height: number | null;
  byteSize: number | null;
}

export interface PromptdexImageTaskSnapshot {
  source: "promptdex";
  promptdexEntry: PromptdexImageTaskEntrySnapshot;
  taskInputs: Record<string, string>;
  inputAttachments?: {
    image?: ImageTaskInternalAttachmentSnapshot;
    mask?: ImageTaskInternalAttachmentSnapshot;
  };
  imageSpec: ImageTaskImageSpecSnapshot;
  modelConfiguration: ImageTaskModelConfigurationSnapshot;
  fullPrompt: string;
}
```

解析规则：

- 旧快照没有 `inputAttachments` 时仍可解析。
- `promptdexEntry.taskType === "edit"` 的新快照必须包含 `inputAttachments.image`。
- `mask` 当前不生成，但解析器可以接受合法结构，为后续保留兼容空间。

## 内部附件存储

新增或扩展 `apps/mobile/src/image-tasks/file-storage.ts`，引入 `ImageTaskInternalAttachmentStorage`。

建议接口：

```ts
export interface ImageTaskInternalAttachmentStorage {
  copyTaskInputAttachment(input: CopyTaskInputAttachmentInput): Promise<SavedTaskInputAttachment>;
  resolveAttachmentUri(filePath: string): Promise<string>;
  createUploadFile(filePath: string, metadata: ImageTaskInternalAttachmentSnapshot): Promise<ImageUploadFile>;
}

export interface CopyTaskInputAttachmentInput {
  historyId: string;
  role: "image" | "mask";
  sourceUri: string;
  mimeType: string;
  originalFileName?: string | null;
  width?: number | null;
  height?: number | null;
  byteSize?: number | null;
}
```

文件路径建议：

```text
task-history-attachments/<historyId>/image.<ext>
```

规则：

- 路径只保存相对应用私有目录的内部路径。
- `historyId` 和文件名片段必须走安全路径片段校验。
- 扩展名优先从原文件名或 MIME 推断；无法判断为图片时在提交前拦截。
- 复制失败发生在创建任务历史之前，不创建历史。
- 如果复制成功但创建历史失败，需要清理刚复制的附件，避免遗留孤儿文件。

内存实现用于测试：

- 保存 `sourceUri` 或字节占位。
- `resolveAttachmentUri` 返回 `memory:///...`。
- `createUploadFile` 返回可断言的测试对象。

## 图片选择与校验

建议新增 `apps/mobile/src/image-tasks/picked-image.ts` 或放入编辑任务服务旁边，封装相册选择结果到内部输入模型。

```ts
export interface PickedEditInputImage {
  uri: string;
  mimeType: string;
  fileName: string | null;
  width: number;
  height: number;
  byteSize: number;
}
```

校验：

- `uri` 非空。
- `mimeType` 是 `image/*`；若 ImagePicker 未返回 MIME，按文件扩展推断。
- 文件大小来自 ImagePicker asset 的 `fileSize`，缺失时用 `expo-file-system` 的 `File.info` 或等价能力读取。
- `width` 和 `height` 必须为正整数。
- 超过 `20MB` 或 `25MP` 返回表单级错误，不进入任务服务。

错误文案建议：

- 文件不可读取：`无法读取所选图片，请重新选择。`
- 非图片：`请选择图片文件。`
- 超过大小：`所选图片超过 20MB，请选择较小的图片。`
- 超过像素：`所选图片像素过高，请选择不超过 25MP 的图片。`

## 模型客户端

### 接口扩展

`ImageModelClient` 从只支持 `generate` 改为支持 `edit`：

```ts
export interface ImageModelClient {
  generate(input: GenerateImageModelInput): Promise<GeneratedImageModelResult>;
  edit(input: EditImageModelInput): Promise<GeneratedImageModelResult>;
}

export interface EditImageModelInput {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  prompt: string;
  image: ImageUploadFile;
  size: ImageTaskSize;
  quality: "auto";
  format: ImageResultFormat;
  n: 1;
}
```

`ImageUploadFile` 在移动端实现为 React Native multipart 可接受的 `{ uri, name, type }` 形态，测试环境可以用普通对象或 `File`。

### `/images/edits`

`createFetchImageModelClient().edit`：

- 调用 `validateEditImageOptions`。
- POST 到 `${normalizeBaseUrl(baseUrl)}/images/edits`。
- 使用 `FormData`，字段包括：
  - `model`
  - `prompt`
  - `size`
  - `quality`
  - `output_format`
  - `n`
  - `image`
- 不传 `mask`。
- 不传 `input_fidelity`。

响应解析复用现有 `extractFirstImage`。因为本版固定 `n: 1`，仍只保存第一张图片结果。

错误映射复用当前生成请求的 `ImageTaskExecutionError` 与 `ImageTaskFailureSummary` 体系。408、429、5xx 的 transient retry 可以复用现有生成请求 helper；如果实现时认为 ADR 0203 名称过窄，可后续补一条“图片任务模型请求复用瞬时失败重试”的 ADR。

## 任务服务

建议保留现有 `createPromptdexImageGenerationTaskService`，新增 `createPromptdexImageEditTaskService`，避免一次性大重构。

输入：

```ts
export interface RunPromptdexImageEditTaskInput {
  template: PromptdexTemplate;
  taskInputs: Record<string, string>;
  image: PickedEditInputImage;
  size: ImageTaskSize;
  sourceType?: PromptdexEntrySourceType;
}
```

服务流程：

1. 要求 `template.taskType === "edit"`。
2. 如果模板声明 `mask`，返回 `invalid_input`，不创建历史。
3. 校验普通文本输入。
4. 调用 `renderPromptdexTemplate(template, { ...textInputs, image: image.uri })`，得到完整提示词。
5. 获取默认就绪图片模型配置。
6. 预生成 `historyId`。
7. 复制 `image` 为任务历史内部附件。
8. 创建 promptdex edit snapshot：
   - `promptdexEntry.taskType: "edit"`。
   - `taskInputs` 只保存普通文本输入。
   - `inputAttachments.image.filePath` 保存内部附件路径。
   - `fullPrompt` 保存渲染结果。
   - `imageSpec` 保存尺寸、`auto`、`png`、`n: 1`。
   - `modelConfiguration` 保存非敏感快照。
9. 创建进行中历史。
10. 获取 API Key。
11. 调用 `imageModelClient.edit`。
12. 保存图片结果并标记完成。
13. 失败时标记失败并保存错误摘要。

缺少凭据时沿用生成任务行为：

- 已创建进行中历史则标记失败。
- 清除对应模型配置就绪状态与默认引用。

## Promptdex 列表与详情页

### `apps/mobile/src/promptdex/index.ts`

调整 `BuiltInPromptdexEntryExecutionState`：

- `executable`
- `unsupported_edit_mask`

判定：

- `generate` 条目可执行。
- `edit` 且声明 `image`、未声明 `mask`，可执行。
- 声明 `mask`，暂不可执行。

### `PromptdexCatalogScreen`

展示文案：

- `generate`：`可执行`
- `edit` 且无 `mask`：`可执行`
- `edit` 且有 `mask`：`蒙版编辑后续支持`

### `PromptdexEntryDetailScreen`

将当前“生成任务表单”提炼为生成和编辑共用的结构，但不要做过度抽象。

编辑条目详情新增：

- 图片模型区：复用默认图片模型展示。
- 编辑输入区：
  - `从相册选择` 按钮。
  - 选择后显示预览、尺寸、文件大小。
  - 提供重新选择按钮。
  - 不显示相册原始 URI。
- 普通文本输入区：复用现有文本输入编辑器。
- 尺寸区：复用现有尺寸选择。
- 失败和提示区：复用现有样式。
- 主按钮文案：`编辑图片`、提交中显示 `编辑中`。

提交可用条件：

- 模板是可执行编辑条目。
- 必填普通文本输入已填。
- 已选择并校验通过 `image`。
- 存在就绪默认图片模型配置。
- 当前没有全局模型调用。
- 当前页面没有提交中的编辑任务。

声明 `mask` 的条目：

- 显示输入声明。
- 显示 `包含蒙版输入，后续支持。`
- 不显示相册选择和提交按钮。

## 历史与图片展示

### 历史列表

当前列表使用 `getImageTaskSnapshotSummary`，可继续显示图鉴条目名称。状态 badge 不需要新增。

### 图片列表

继续用关联历史摘要和图片规格展示，不需要区分生成或编辑。

### 历史详情

`PromptdexSnapshotSections` 增加编辑输入附件展示：

- 当 `snapshot.promptdexEntry.taskType === "edit"`：
  - 展示 `编辑输入` section。
  - 如果 `inputAttachments.image` 存在且文件可解析，显示图片预览。
  - 显示文件名、尺寸、大小。
  - 如果附件缺失，显示 `输入图片文件缺失。`
  - 不提供单独导出按钮。
- 完整提示词继续只读展示。
- 普通任务输入继续只展示文本输入。

`ImageDetailScreen` 不需要改动，继续链接到关联历史。

## 应用运行时

`AppRuntimeProvider` 需要新增附件存储：

```ts
imageTaskAttachmentStorage: ImageTaskInternalAttachmentStorage;
```

真实运行：

- 使用 Expo 文件系统实现。

Web 非安全上下文内存模式：

- 使用内存附件存储。

## 全局模型调用锁

`ModelCallType` 当前有 `modelConfigurationTest` 和 `imageGeneration`。新增：

```ts
export type ModelCallType =
  | "modelConfigurationTest"
  | "imageGeneration"
  | "imageEdit";
```

本次不实现全局状态 UI，只保证锁能阻止并发模型调用。

## 测试计划

### Core/mobile unit tests

新增或更新：

- `apps/mobile/src/promptdex/index.test.ts`
  - 无 `mask` 的编辑条目标记为可执行。
  - 含 `mask` 的编辑条目标记为暂不可执行。

- `apps/mobile/src/image-tasks/model-client.test.ts`
  - `edit` 调用 `/images/edits`。
  - multipart 包含 `model`、`prompt`、`size`、`quality`、`output_format`、`n`、`image`。
  - 2xx 无效响应映射为 `invalid_response`。
  - 401/403、429、5xx 等错误映射沿用生成请求规则。

- `apps/mobile/src/image-tasks/generation.test.ts` 或新建 `edit.test.ts`
  - 缺少默认就绪图片模型配置不创建历史。
  - 声明 `mask` 的模板不创建历史。
  - 成功编辑时创建 `edit` 历史、保存内部附件快照、保存图片结果。
  - 缺少凭据时创建失败历史并清除就绪状态和默认引用。
  - 模型调用失败时保留附件快照并保存错误摘要。

- `apps/mobile/src/image-tasks/snapshot.test.ts`
  - 解析含 `inputAttachments.image` 的编辑快照。
  - 克隆快照时深拷贝附件信息。
  - 旧快照没有 `inputAttachments` 仍可解析。

- `apps/mobile/src/storage/index.test.ts`
  - 初始化 schema v4。
  - v3 到 v4 迁移重建 `image_task_histories` 并允许 `edit`。

- `apps/mobile/src/image-tasks/file-storage.test.ts` 如果新增测试文件：
  - 附件路径安全校验。
  - 复制附件生成预期内部路径。
  - 解析附件 URI。

### Typecheck

运行：

```bash
npm run mobile:typecheck
```

### Mobile tests

运行：

```bash
npm run mobile:test
```

### Full mobile verification

运行：

```bash
npm run mobile:verify
```

## 手动验证

1. 启动移动端。
2. 完成或跳过首次设置。
3. 确保有就绪默认图片模型配置。
4. 打开任一编辑图鉴条目，例如 `cute-paper-craft-isometric-character`。
5. 点击从相册选择图片。
6. 确认系统相册权限按需出现。
7. 选择一张普通图片。
8. 确认页面显示预览、尺寸、文件大小。
9. 填写普通文本输入，选择尺寸。
10. 点击编辑图片。
11. 确认成功后图片结果进入图片页。
12. 打开历史详情，确认：
    - 状态为完成。
    - 图鉴条目类型为编辑。
    - 编辑输入附件可预览。
    - 完整提示词可只读查看。
    - 模型配置快照正确。

失败路径：

- 未选图片时按钮不可用或提示选择图片。
- 选择超过 `20MB` 的图片时要求重新选择。
- 选择超过 `25MP` 的图片时要求重新选择。
- 删除或破坏内部附件文件后，历史详情显示附件缺失。

## 推荐实施顺序

1. 安装并配置 `expo-image-picker`。
2. 扩展类型、快照解析和 snapshot display。
3. 增加 schema v4 迁移，让 `task_type` 支持 `edit`。
4. 增加任务历史内部附件存储。
5. 增加 ImagePicker 选择结果校验辅助。
6. 扩展 `ImageModelClient.edit`。
7. 增加 Promptdex 编辑任务服务。
8. 更新图鉴列表和详情页。
9. 更新历史详情附件展示。
10. 补齐测试。
11. 跑 `npm run mobile:verify`。

## 主要风险

- React Native `FormData` 对 `{ uri, name, type }` 的类型与测试环境不同，需要在客户端层隔离上传文件形态。
- Expo ImagePicker 在不同平台返回的 `fileSize`、`fileName`、`mimeType` 可能不完全一致，需要有推断与失败路径。
- SQLite CHECK 约束迁移需要重建表，必须避免破坏已有历史。
- 附件复制成功但历史创建失败时要清理文件，否则会留下孤儿附件。
- 本次不实现任务历史删除清理附件，因此实现后会短期存在“附件只增不删”的已知后续工作。

## 后续闭环

- 文件选择器入口。
- `mask` 输入。
- 失败或状态未知编辑任务的重新填写。
- 业务调用提示与入口可发现性。
- 任务历史删除时清理任务历史内部附件。
- ZIP 备份恢复包含内部附件。
- 多图数量、`input_fidelity` 和其他高级规格。
