# Standard Notes Markdown Notes+ Editor
## Coding Agent Implementation Specification

> 目標：實作一個以「完整 Markdown 筆記」為核心、同時具備強化 Task workflow 與 Mind Map 視覺化能力的 Standard Notes 自訂編輯器。
>
> 本文件應被視為 coding agent 的主要實作規格。若現有程式碼與本文件衝突，除非 Standard Notes API 或第三方套件的實際限制明確阻止，否則應優先遵循本文件。

---

# 1. 專案定位

本專案不是 Task App，也不是單純的 Markdown Previewer。

產品定位：

> **Markdown Notes Editor + Enhanced Tasks + Mind Map**

核心原則：

1. **筆記優先**
   - 一般 Markdown 筆記體驗必須完整。
   - Task 只是 Markdown 的一級能力，不是整個資料模型。
   - Mind Map 是同一份 Markdown 的衍生視圖，不是第二份資料。

2. **Markdown 是唯一 authoritative source**
   - Standard Notes `content.text` 必須持續保存純 Markdown。
   - 不另外建立 task JSON。
   - 不另外建立 mindmap JSON。
   - 不將編輯器狀態寫進 Markdown 內容，除非該狀態本身就是使用者的 Markdown。
   - 任何 UI projection 都必須可以由 Markdown 重新推導。

3. **高可攜性**
   - 使用者切回 Standard Notes 其他 Markdown editor、VS Code、Obsidian、Joplin、GitHub 等，內容仍必須合理可讀。
   - Task 使用標準 GFM：
     - `- [ ] open task`
     - `- [x] completed task`

4. **不破壞 Markdown**
   - 不應因為 Task UI、Mind Map、Outline 等功能而重排、重新格式化、trim、normalize 使用者原始 Markdown。
   - 除非使用者執行明確的編輯操作，否則 editor 不可製造無意義 diff。

---

# 2. 技術選型

## 2.1 建議主技術棧

- Language: TypeScript
- UI: React
- Standard Notes integration: `@standardnotes/editor-kit`
- Primary writing editor: Milkdown
- Markdown source mode: CodeMirror 6
- Mind Map:
  - `markmap-lib`
  - `markmap-view`
- Markdown flavor: CommonMark + GFM
- Build: Vite 優先
- Styling:
  - CSS variables
  - Standard Notes theme bridge
  - 不綁死單一 light/dark theme

## 2.2 Milkdown 的角色

Milkdown 作為主要 Writing Editor，負責：

- headings
- paragraphs
- bold
- italic
- strikethrough
- inline code
- fenced code block
- bullet list
- numbered list
- task list
- blockquote
- links
- images
- tables
- horizontal rule
- keyboard input rules
- slash command
- undo/redo
- selection/cursor behavior

應以：

- `@milkdown/kit`
- commonmark preset
- GFM preset
- 自訂 ProseMirror/Milkdown plugin

為基礎。

避免直接把 Crepe 當不可拆的黑盒子。

## 2.3 CodeMirror 6 的角色

CodeMirror 6 只作為 Source Mode：

- 顯示真正的 Markdown
- 精準保留 whitespace
- search
- replace
- syntax highlighting
- Markdown editing
- keyboard shortcuts
- raw troubleshooting

Source Mode 與 Writing Mode 必須共用同一份文字狀態。

## 2.4 Markmap 的角色

Markmap 只作為 derived view：

```text
Markdown
   ↓
markmap Transformer
   ↓
tree
   ↓
markmap-view
   ↓
SVG
```

不得將 Markmap tree 當成 durable storage。

---

# 3. Standard Notes 整合

## 3.1 EditorKit

使用 `@standardnotes/editor-kit`。

建議初始化概念：

```ts
new EditorKit(delegate, {
  mode: 'markdown',
  supportsFileSafe: false,
})
```

若實際 EditorKit 版本需要不同設定，以當前 API 為準，但必須保持 Markdown note 行為。

## 3.2 接收筆記內容

EditorKit delegate 收到：

```ts
setEditorRawText(text: string)
```

時：

1. 不可 `trim()`
2. 不可 normalization newline
3. 不可自動格式化
4. 更新 editor document
5. 更新 derived views：
   - task index
   - completed panel
   - outline
   - mindmap
6. 不得觸發 recursive save

## 3.3 儲存

使用者編輯後：

```ts
editorKit.onEditorValueChanged(markdown)
```

必須送回完整 Markdown。

需要 debounce，但不得過度延遲。

建議：

- editor local state 立即更新
- Standard Notes bridge debounce 200–400 ms
- 在 blur / unload / mode switch 等適當情境 flush pending save

## 3.4 External update / sync update

若 Standard Notes 收到其他裝置同步內容：

- 若本地無 pending change：
  - 直接套用
- 若存在本地 pending change：
  - 不可靜默覆蓋
  - 優先依 EditorKit / Standard Notes 提供的同步 semantics
  - 不自行實作危險的 last-write-wins

## 3.5 Lock / read-only

若 note locked：

- Writing Mode read-only
- Source Mode read-only
- checkbox 不可切換
- delete task 不可操作
- batch action disabled
- Mind Map 仍可瀏覽
- Outline 仍可導航

---

# 4. Editor Modes

提供四種主要模式。

## 4.1 Writing

主模式。

定位：

> 平常做筆記使用。

特色：

- Markdown 視覺化編輯
- Markdown structure 保持 canonical
- Task checkbox 可點
- slash command
- toolbar
- inline formatting
- 完成任務從主視覺區隱藏，投影到 Completed panel

## 4.2 Split

左右分割。

可配置：

- Writing + Mind Map
- Source + Preview

MVP 至少實作：

> Writing + Mind Map

Desktop：

```text
┌────────────────────┬────────────────────┐
│ Writing            │ Mind Map           │
│                    │                    │
│ # Kubernetes       │    Kubernetes      │
│ ## Networking      │    /        \      │
│ ...                │ Network    Storage │
└────────────────────┴────────────────────┘
```

Mobile：

- 上下排列
- 不做極窄左右 pane

## 4.3 Mind Map

全 Mind Map 模式。

提供：

- pan
- zoom
- fit
- collapse
- expand
- scope filter
- task filter

## 4.4 Source

純 Markdown。

必須看到真實內容，例如：

```markdown
# Kubernetes

## TODO

- [ ] Upgrade Cilium
- [x] Backup etcd
```

此模式不能隱藏 completed task。

---

# 5. Markdown 筆記能力

MVP 必須完整支援：

## 5.1 Block

- H1–H6
- paragraph
- blockquote
- bullet list
- ordered list
- task list
- fenced code block
- horizontal rule
- GFM table

## 5.2 Inline

- bold
- italic
- strikethrough
- inline code
- link
- image

## 5.3 操作

- Undo
- Redo
- Search
- keyboard shortcuts
- copy/paste
- Markdown paste
- plain text paste
- drag selection
- mobile text editing

## 5.4 Slash command

輸入 `/` 顯示命令。

至少：

- Heading 1
- Heading 2
- Heading 3
- Bullet list
- Numbered list
- Task
- Quote
- Code block
- Table
- Image
- Divider

例：

```text
/task
```

產生 task。

```text
/code
```

產生 fenced code block。

---

# 6. Task 資料格式

只接受標準 GFM task 作為 durable task。

Open：

```markdown
- [ ] Task
```

Completed：

```markdown
- [x] Task
```

解析時應 case-insensitive 接受：

```markdown
- [X] Task
```

序列化時建議統一由 editor 原本的 serializer 規則產出，但不得對整份文件做不必要 reformat。

---

# 7. Task 核心 UX

## 7.1 Checkbox click

點：

```markdown
- [ ] Backup etcd
```

轉為：

```markdown
- [x] Backup etcd
```

完成後：

- document 裡仍在原本 logical location
- Writing View 中該 completed task 隱藏
- Completed Panel 顯示該 task

## 7.2 關鍵要求：禁止真的搬動 Markdown

不要將：

```markdown
## Deployment

- [x] Backup etcd
- [ ] Upgrade cluster
```

改成：

```markdown
## Deployment

- [ ] Upgrade cluster

## Completed

- [x] Backup etcd
```

理由：

- 破壞原章節
- uncheck 後無法正確回原位置
- nested task 更難恢復
- 污染 Markdown
- 提高 sync conflict

完成區必須是 UI projection。

---

# 8. Completed Panel

## 8.1 顯示位置

預設固定在 editor 主內容下方：

```text
────────────────────────

Completed (3)       ▾

☑ Backup etcd       🗑
☑ Run migration     🗑
☑ Update docs       🗑

[Uncheck all] [Delete completed]
```

## 8.2 Collapse

Completed Panel 可以：

- 展開
- 收合

預設：

- 有 completed task：顯示 header
- 無 completed task：不顯示 panel 或只顯示非常小的空狀態

## 8.3 Task row

每個 completed task 至少：

- checkbox
- task text
- delete button

可選：

- 顯示來源 section breadcrumb

例如：

```text
☑ Backup etcd
  Kubernetes › Upgrade
```

此功能很值得做，但可放 Phase 2。

---

# 9. Uncheck All

按下後：

- 所有 completed task `[x]` → `[ ]`
- 保留每一項原始位置
- 一次 transaction
- Ctrl+Z 必須可以一次 undo 整批操作

不要逐筆 dispatch 造成 30 個 undo step。

---

# 10. Delete Completed

按下後：

- 刪除所有 completed task list item
- 一次 transaction
- Ctrl+Z 必須一次恢復

建議顯示 confirm：

```text
Delete 12 completed tasks?
```

若為 1 個也可以不 confirm，產品可自行決定，但批次刪除建議確認。

---

# 11. 單筆快速刪除

每個 task 應可以快速刪除。

至少支援：

- Completed Panel row delete
- Writing View task contextual delete

可用：

- trash icon
- hover action
- touch long-press menu
- keyboard shortcut

不得只支援 hover，行動裝置也必須能操作。

---

# 12. Nested Task Semantics

這是高風險區域，必須明確定義。

例：

```markdown
- [ ] Deploy Kubernetes
  - Backup etcd
  - [ ] Upgrade Cilium
  - Verify cluster
```

## 12.1 刪除 parent task

若 parent task 是一個 list item，刪除時應刪除整個 list item subtree：

```markdown
- [ ] Deploy Kubernetes
  - Backup etcd
  - [ ] Upgrade Cilium
  - Verify cluster
```

整塊移除。

## 12.2 完成 parent task

MVP：

- 只切換 parent 自己的 checked 狀態
- 不遞迴修改 children

不要自動將所有 child task 變 completed。

Phase 2 可考慮：

- optional recursive complete
- 但必須是明確 UX，不可暗中執行

## 12.3 Completed Panel 顯示 parent

若 completed parent 包含 nested children：

- Panel 顯示 parent text
- 可選展開 nested preview
- uncheck 後仍恢復原 subtree

---

# 13. Task Parser 規則

不要只用全文件 regex。

應以 Markdown AST / ProseMirror document / Lezer tree 作主要依據。

必須避免把以下內容判斷成 Task：

````markdown
```md
- [ ] this is example text
```
````

以及：

```markdown
`- [ ] inline example`
```

與普通文字：

```text
Use "- [ ]" syntax.
```

Task 必須是合法 GFM list item。

---

# 14. Task Identity

Task 不應永久寫入 hidden ID 到 Markdown。

禁止：

```markdown
- [ ] <!-- task-id:123 --> Backup etcd
```

除非未來有非常充分理由。

MVP identity 應使用：

- current document position
- ProseMirror node position
- transaction mapping
- stable editor-local ephemeral ID

若 document edit 導致位置改變，依 editor state 重新 derive。

---

# 15. Completed Task View 實作建議

推薦流程：

```text
Milkdown/ProseMirror document
        │
        ▼
TaskIndexPlugin
        │
        ├─ open[]
        └─ completed[]
                 │
                 ▼
        CompletedPanel React UI
```

TaskIndexPlugin 不要保存 durable state。

每次 transaction 後：

- incremental update 優先
- 若複雜，可先全 document derive
- 先正確，再優化

一般筆記規模下全 derive 通常可以接受，但需 benchmark。

---

# 16. Writing View 隱藏 Completed Task

這是實作難點。

要求：

- completed task 在原 logical position 保留
- Writing Mode 不顯示該 task
- cursor navigation 不能卡死
- selection 不能產生奇怪不可見範圍
- undo/redo 正常
- Source Mode 一定要看到它

可選方案：

## 方案 A：ProseMirror Decoration

使用 decoration 對 completed task 做 visual replacement / collapse。

優點：

- document 不改
- projection 清楚

風險：

- selection
- nested list
- list numbering
- spacing

## 方案 B：只弱化，不完全隱藏

如果完全隱藏在 Milkdown/ProseMirror 有高複雜度或 selection bug，可先 MVP：

```text
☑ Backup etcd   [completed]
```

顯示成：

- 低對比
- strike-through
- collapsed height

Completed Panel 同時顯示。

但最終目標仍是可真正隱藏。

Coding agent 應優先實驗方案 A；若可靠性不足，再採方案 B，並在 README 註記差異。

---

# 17. Mind Map

整合目前 `sn-markmap` 核心概念。

現有可重用流程：

```ts
const { root } = transformer.transform(markdown)
await markmap.setData(root)
```

保留：

- debounce update
- fit
- zoom
- pan
- reduced motion handling

---

# 18. Mind Map 資料來源

永遠從當前 Markdown 產生。

```text
currentMarkdown
     │
     ▼
MindMapTransformPipeline
     │
     ├─ scope filtering
     ├─ task filtering
     └─ markdown projection
            │
            ▼
       markmap Transformer
```

禁止將 Markmap 修改反向直接寫 Markdown，除非未來有明確 edit semantics。

MVP Mind Map 是 read/navigation view。

---

# 19. Mind Map Modes

## 19.1 Entire Note

整篇：

```markdown
# Kubernetes
## Networking
### Cilium
### Calico
## Storage
### Ceph
```

變成整棵樹。

## 19.2 Current Section

當游標位於：

```markdown
## Networking
```

只顯示該 heading subtree：

```text
Networking
├── Cilium
└── Calico
```

這是長筆記重要功能。

MVP 可以先：

- Entire Note

Phase 2：

- Current Section

---

# 20. Task Filter in Mind Map

Mind Map 提供：

```text
Tasks:
- All
- Open only
- Hide tasks
```

## 20.1 All

保留：

```markdown
- [ ] Open
- [x] Done
```

## 20.2 Open only

只投影 open tasks。

**不能修改原 Markdown。**

## 20.3 Hide tasks

mindmap tree 中不顯示 task nodes。

---

# 21. Mind Map Navigation

Phase 2 實作：

點 mindmap node：

```text
Cilium > Upgrade
```

Writing editor：

- 切回或保持 split
- scroll 到對應 Markdown heading/list item
- 將 cursor 移到對應 block
- briefly highlight target

技術上需要建立 source mapping：

```text
Markdown AST node
   ↔
heading path
   ↔
editor position
   ↔
markmap node
```

MVP 可以先不做 exact mapping。

---

# 22. Outline

建議加入 Outline，與 Mind Map 共用 heading parser。

例：

```text
Kubernetes
  Networking
    Cilium
    Calico
  Storage
    Ceph
```

點擊 heading：

- editor scroll
- cursor jump

Outline 與 Mind Map 都是 Markdown projection，不應各自解析一套不一致規則。

建議：

```text
MarkdownAnalysisService
├─ headings
├─ tasks
├─ section ranges
└─ outline tree
```

---

# 23. Markdown Analysis Layer

建議抽象：

```ts
interface MarkdownAnalysis {
  headings: HeadingInfo[]
  tasks: TaskInfo[]
  sections: SectionInfo[]
}
```

TaskInfo：

```ts
interface TaskInfo {
  from: number
  to: number
  checked: boolean
  text: string
  depth: number
  headingPath: string[]
}
```

HeadingInfo：

```ts
interface HeadingInfo {
  level: number
  text: string
  from: number
  to: number
  path: string[]
}
```

避免：

- Completed Panel 自己解析 Markdown
- Mind Map Filter 自己解析 Markdown
- Outline 再自己解析 Markdown

應盡量共用分析層。

---

# 24. State Architecture

建議三層：

```text
1. Canonical Document State
   └─ markdown string / editor state

2. Derived State
   ├─ tasks
   ├─ headings
   ├─ outline
   └─ mindmap projection

3. UI State
   ├─ mode
   ├─ completedCollapsed
   ├─ splitRatio
   ├─ mindmapZoom
   ├─ mindmapScope
   └─ taskFilter
```

只有第 1 層需透過 Standard Notes 保存。

UI state 可：

- editor local
- component state
- Standard Notes component metadata

但不能混進 Markdown。

---

# 25. Mode Switching

切換：

```text
Writing → Source → Writing
```

不得：

- 改變 Markdown
- trim
- reorder
- convert line endings
- lose cursor unnecessarily

建議保存：

- last selection per mode
- scroll position

Writing → Mind Map：

- mindmap 即時使用最後 markdown

Mind Map → Writing：

- 回復之前 cursor

---

# 26. Undo / Redo

所有會修改 Markdown 的 operation 都要進同一 undo semantics。

包含：

- typing
- formatting
- checkbox toggle
- delete task
- uncheck all
- delete completed
- slash command insert

Batch operation：

- 必須是一個 undo step

Mind Map pan/zoom 不進 document undo。

---

# 27. Search

MVP：

- Source Mode search
- Writing Mode browser/editor search

Phase 2：

- search panel
- result count
- next/previous
- match highlight

---

# 28. Toolbar

建議簡潔，不做大型 Office toolbar。

Desktop：

```text
H  B  I  S  <>  🔗  •  1.  ☑  “  Table  Image
                         Writing | Split | Map | Source
```

Mobile：

- horizontal scroll
- secondary actions 收進 menu

---

# 29. Keyboard Shortcuts

至少：

- `Ctrl/Cmd+B`: bold
- `Ctrl/Cmd+I`: italic
- `Ctrl/Cmd+Z`: undo
- `Ctrl/Cmd+Shift+Z` / `Ctrl+Y`: redo
- `Ctrl/Cmd+F`: search
- `Ctrl/Cmd+K`: link
- configurable task shortcut

建議：

- `Ctrl/Cmd+Shift+Enter`: toggle current task

但不要與 Standard Notes host shortcut 衝突；實作前先驗證。

---

# 30. Theme / Appearance

必須支援 Standard Notes 動態 theme。

不可：

- 寫死 white background
- 寫死 black text
- 寫死 light-only syntax theme

建立 CSS token：

```css
:root {
  --editor-bg: ...;
  --editor-fg: ...;
  --editor-muted: ...;
  --editor-border: ...;
  --editor-accent: ...;
  --editor-code-bg: ...;
}
```

若 Standard Notes 提供 theme variables，優先 mapping。

同時提供：

- light
- dark
- high contrast 基本可用性

Mind Map 也必須跟 theme：

- SVG background
- text
- link
- node stroke

不能因為切 dark mode 而 mindmap 仍白底。

---

# 31. Responsive Design

Desktop：

- 主要 editor
- split view
- resizable pane

Tablet：

- split 可用
- toolbar 可縮

Mobile：

- 不強迫左右分割
- Mind Map 可全畫面 editor area
- Completed Panel touch-friendly
- delete 不依賴 hover
- button target >= 約 44px

---

# 32. Performance

需要測試：

## 32.1 Normal

- 10 KB Markdown
- 50 tasks
- 50 headings

應完全流暢。

## 32.2 Large

- 100 KB Markdown
- 500 tasks
- 500 headings

仍應可用。

## 32.3 Stress

- 500 KB Markdown
- 2000 tasks

不要求 mindmap 全展開仍流暢，但：

- editor 不應 crash
- task derive 不應 freeze 幾秒
- 可限制 mindmap node 數並提示

---

# 33. Debounce 策略

不同功能不同 debounce。

Writing save：

- 200–400 ms

Mind Map rebuild：

- 300–500 ms

Markdown analysis：

- 優先跟 editor transaction incremental
- 若 full parse，50–150 ms debounce 或 idle

不要所有功能共用一個巨大 debounce。

---

# 34. Error Handling

## 34.1 Markmap transform error

不能影響編輯。

顯示：

```text
Unable to render mind map.
Markdown editing is still available.
```

## 34.2 EditorKit save error

- console error
- UI 顯示非阻塞 save status
- 不清除 local document

## 34.3 Unsupported Markdown

Source 必須保留原文字。

Writing parser 若無法理解某 extension：

- 不要刪掉內容
- 盡量 preserve raw content

---

# 35. Security

禁止：

- `innerHTML` 直接插入未 sanitize 的 Markdown
- 執行 Markdown 中 script
- unrestricted iframe
- remote HTML injection

Preview：

- sanitize HTML
- 或使用安全 Markdown renderer

Image：

- 尊重 Standard Notes / browser CSP
- 不因 preview 執行 script URL

---

# 36. Accessibility

必須：

- checkbox 使用可理解的 semantics
- toolbar button 有 aria-label
- keyboard navigation
- focus visible
- completed task delete 可鍵盤操作
- Mind Map 若 SVG 不具完整 accessibility：
  - 至少提供文字 Outline 作 alternative

---

# 37. 建議 Repo Structure

```text
markdown-notes-plus/
├── public/
│   └── ext.json
├── src/
│   ├── app/
│   │   ├── App.tsx
│   │   └── AppState.ts
│   ├── editor/
│   │   ├── WritingEditor.tsx
│   │   ├── SourceEditor.tsx
│   │   ├── editorCommands.ts
│   │   └── editorTheme.ts
│   ├── standardnotes/
│   │   ├── EditorBridge.ts
│   │   └── editorKitDelegate.ts
│   ├── markdown/
│   │   ├── analysis.ts
│   │   ├── headings.ts
│   │   ├── tasks.ts
│   │   └── sections.ts
│   ├── tasks/
│   │   ├── TaskPlugin.ts
│   │   ├── TaskDecoration.ts
│   │   ├── TaskCommands.ts
│   │   ├── CompletedPanel.tsx
│   │   └── TaskRow.tsx
│   ├── mindmap/
│   │   ├── MindMapView.tsx
│   │   ├── MindMapController.ts
│   │   ├── transform.ts
│   │   └── filters.ts
│   ├── outline/
│   │   └── Outline.tsx
│   ├── toolbar/
│   │   ├── Toolbar.tsx
│   │   └── SlashMenu.tsx
│   ├── theme/
│   │   ├── tokens.css
│   │   └── standardNotesTheme.ts
│   ├── styles/
│   │   └── app.css
│   └── main.tsx
├── tests/
│   ├── markdown/
│   ├── tasks/
│   ├── mindmap/
│   └── integration/
├── package.json
├── vite.config.ts
├── tsconfig.json
└── README.md
```

---

# 38. Standard Notes ext.json

建立可安裝 editor component。

開發環境概念：

```json
{
  "identifier": "com.example.markdown-notes-plus-dev",
  "name": "Markdown Notes+ Development",
  "content_type": "SN|Component",
  "area": "editor-editor",
  "version": "0.1.0",
  "url": "http://localhost:PORT/"
}
```

實際 schema 以當前 Standard Notes Custom Editor 規格為準。

Production：

- identifier 穩定
- HTTPS
- GitHub Pages 可直接載入
- assets 使用 relative path
- Vite `base` 必須正確

---

# 39. GitHub Pages

若部署：

```text
https://<user>.github.io/<repo>/
```

必須確保：

- `index.html`
- JS/CSS relative path 正確
- ext.json URL 正確
- build 不依賴 server-side routing
- CSP 不阻擋必要 bundle
- 不從 `localhost` 載資源

---

# 40. Migration / Compatibility

現有普通 Markdown note：

```markdown
# Note

hello
```

直接打開必須正常。

現有 GFM：

```markdown
- [ ] A
- [x] B
```

必須：

- A 在 Writing
- B 在 Completed projection
- Source 完整顯示 A/B

不要求做任何 migration。

---

# 41. 與 sn-markmap 的整合策略

不要直接 merge 整個 UI。

建議只抽：

- Transformer lifecycle
- Markmap lifecycle
- fit
- zoom
- resize handling
- reduced motion
- update debounce

目前 `sn-markmap` 的 Markdown editor 應移除，不作為主 editor。

新的架構：

```text
WritingEditor ──┐
SourceEditor  ──┼── canonical markdown
                │
                ├── TaskIndex
                ├── Outline
                └── MindMapView
```

---

# 42. 不應直接照搬的 sn-markmap 部分

- `@uiw/react-markdown-editor` 作主 editor
- 整個 Editor component monolith
- 將所有 state 混在同一個 React class
- Mindmap rendering 與 Standard Notes bridge 強耦合

新的程式要拆分職責。

---

# 43. Coding Style

- TypeScript strict
- 不用 `any`，除非第三方 API 實際沒有 type
- React function components
- hooks
- service/controller 只放真正需要跨 component lifecycle 的 state
- pure functions 處理 Markdown analysis
- side effect 集中

---

# 44. Testing Strategy

## 44.1 Unit Tests

Task parse：

```markdown
- [ ] A
- [x] B
```

結果：

```text
A open
B completed
```

Code block：

````markdown
```md
- [ ] fake
```
````

不得回 task。

Nested：

```markdown
- [ ] Parent
  - [x] Child
```

必須正確 depth。

## 44.2 Command Tests

Toggle task：

```markdown
- [ ] A
```

→

```markdown
- [x] A
```

Uncheck all：

```markdown
- [x] A
- [ ] B
- [x] C
```

→

```markdown
- [ ] A
- [ ] B
- [ ] C
```

Delete completed：

```markdown
# Test

- [x] A
- [ ] B

Text
```

→

```markdown
# Test

- [ ] B

Text
```

注意不要破壞周圍 spacing。

## 44.3 Undo Tests

Delete completed 後：

- Undo 一次
- 所有 completed tasks 同時恢復

## 44.4 Mind Map Tests

Markdown：

```markdown
# A
## B
### C
## D
```

應產生：

```text
A
├ B
│ └ C
└ D
```

## 44.5 Integration Tests

Standard Notes delegate：

1. set raw text
2. editor render
3. checkbox click
4. save callback
5. emitted markdown 正確

---

# 45. Edge Cases

必測：

## Whitespace

```markdown
- [ ]  Task
```

保留 task text spacing。

## Upper X

```markdown
- [X] Task
```

視為 completed。

## Nested mixed list

```markdown
1. Parent
   - [ ] child
```

## Blockquote task

```markdown
> - [ ] quoted task
```

需決定是否當 task。

建議：

- 合法 GFM task 都可辨識
- 但 Completed projection 要保留 heading/blockquote context

若實作複雜，MVP 可只處理普通 list task，但必須測試並註記。

## Table literal

```markdown
| value |
|---|
| - [ ] |
```

不得判 task。

## HTML

```html
<div>- [ ] fake</div>
```

不得誤判。

---

# 46. Line Ending

不可在讀取後全部自動轉換，除非 editor framework 必須。

如果 framework 無法保留 CRLF：

- 明確記錄
- 測試 Standard Notes 實際 note 行為
- 不做每次 load/save 重複變更

---

# 47. Save Status

可提供：

```text
Saved
Saving…
Offline
Error
```

但不要自己假裝 Standard Notes server 已 sync。

若只能知道 editor 已呼叫 bridge：

- 用 `Edited` / `Saved locally` 類似語意
- 不要宣稱 cloud synced

---

# 48. Phase Planning

## Phase 0 — Spike

目的：

確認最風險部分可行。

只做：

1. EditorKit 載入 note
2. Milkdown 編輯
3. Source Mode
4. checkbox toggle
5. Markmap render
6. GitHub Pages install

驗收：

- 同一份 Markdown 在 Milkdown/Source/Markmap 三邊一致
- 不 trim
- Standard Notes 可保存

## Phase 1 — MVP

加入：

- 完整基本 Markdown
- task checkbox
- Completed Panel
- Uncheck All
- Delete Completed
- Delete One
- Writing
- Source
- Mind Map
- Split
- Standard Notes theme
- basic mobile

## Phase 2 — Navigation

加入：

- Outline
- Mind Map node → editor jump
- Current Section mindmap
- task heading breadcrumb
- better search

## Phase 3 — Advanced

可考慮：

- task sort
- task filtering
- section-specific completed
- configurable shortcuts
- export SVG
- print mode
- custom Markdown extensions

---

# 49. MVP Acceptance Criteria

以下全部通過才能稱為 MVP。

## Standard Notes

- [ ] 可作為 Custom Editor 安裝
- [ ] 可讀現有 Markdown note
- [ ] 可保存
- [ ] reload 後內容一致
- [ ] locked note 不可修改

## Markdown

- [ ] Heading
- [ ] Bold
- [ ] Italic
- [ ] Strike
- [ ] Code
- [ ] Code block
- [ ] Bullet
- [ ] Ordered list
- [ ] Quote
- [ ] Link
- [ ] Image
- [ ] Table
- [ ] Task
- [ ] Horizontal rule

## Task

- [ ] `[ ] → [x]`
- [ ] completed 顯示在 Completed Panel
- [ ] uncheck 回原位置
- [ ] Uncheck All
- [ ] Delete One
- [ ] Delete Completed
- [ ] batch operation single undo
- [ ] code block 中 checkbox 不誤判

## Mind Map

- [ ] 從同一份 Markdown render
- [ ] zoom
- [ ] pan
- [ ] fit
- [ ] Markdown change 後更新
- [ ] render error 不影響編輯

## Modes

- [ ] Writing
- [ ] Source
- [ ] Mind Map
- [ ] Split

## Theme

- [ ] light
- [ ] dark
- [ ] Standard Notes theme change 後可更新
- [ ] Mind Map 同步 theme

## Mobile

- [ ] checkbox 可點
- [ ] delete 可點
- [ ] toolbar 不爆版
- [ ] mindmap 可操作

---

# 50. 必須避免的錯誤設計

Coding agent 不可採用以下捷徑：

## 50.1 Regex 重寫整份 Task

禁止：

```ts
text.replace(/- \[x\].*/g, '')
```

來做 completed hide/delete。

## 50.2 `trim()`

禁止：

```ts
text.trim()
```

作為 canonical document。

## 50.3 Task JSON

禁止：

```json
{
  "tasks": [...]
}
```

當作 note 主資料。

## 50.4 Mindmap JSON

禁止將：

```json
{
  "nodes": [...]
}
```

當主資料。

## 50.5 完成後搬到 Markdown Completed section

禁止實體搬動。

## 50.6 Save on derived update

Mind Map rebuild 不能觸發 note save。

## 50.7 Mode switch reserialize

切 Source/Writing 不應每次 serialize 整份文件並改 formatting。

---

# 51. 架構示意

```text
                   Standard Notes
                        │
                   EditorKit Bridge
                        │
                        ▼
               Canonical Markdown
                        │
          ┌─────────────┼──────────────┐
          │             │              │
          ▼             ▼              ▼
     Milkdown       CodeMirror     Analysis Layer
      Writing         Source        │
          │                         ├─ headings
          │                         ├─ tasks
          │                         └─ sections
          │                              │
          │                   ┌──────────┼─────────┐
          │                   │          │         │
          ▼                   ▼          ▼         ▼
    Task Decorations     Completed    Outline   MindMap
                        Panel                  Projection
                                                   │
                                                   ▼
                                                Markmap
```

---

# 52. 建議的核心 API

## MarkdownDocumentController

```ts
interface MarkdownDocumentController {
  getText(): string
  setExternalText(text: string): void
  applyTransaction(tx: EditorTransaction): void
  subscribe(listener: (text: string) => void): () => void
}
```

## TaskCommands

```ts
interface TaskCommands {
  toggleTask(position: number): void
  deleteTask(position: number): void
  uncheckAll(): void
  deleteCompleted(): void
}
```

## MindMapController

```ts
interface MindMapController {
  setMarkdown(markdown: string): void
  setScope(scope: 'entire-note' | 'current-section'): void
  setTaskFilter(filter: 'all' | 'open-only' | 'hide'): void
  fit(): void
  zoomIn(): void
  zoomOut(): void
}
```

實際 API 可因 framework 調整，不需逐字照抄。

---

# 53. Coding Agent 執行順序

coding agent 請按照以下順序，不要先堆 UI。

1. 建 repo
2. Standard Notes EditorKit 可載入
3. 建 canonical markdown state
4. Milkdown round-trip 測試
5. Source Mode round-trip 測試
6. 確認 whitespace 不被破壞
7. Task AST 解析
8. toggle task transaction
9. Completed derive
10. Completed Panel
11. batch commands
12. undo behavior
13. Markmap renderer
14. Split mode
15. theme
16. mobile
17. GitHub Pages
18. integration tests
19. performance tests
20. README

---

# 54. Coding Agent 回報格式

每一階段完成後，agent 應回報：

```markdown
## Completed
- ...

## Files changed
- ...

## Tests
- command
- result

## Known limitations
- ...

## Next risk
- ...
```

避免只說：

> Done.

---

# 55. Done Definition

「完成」的最低標準：

- build pass
- typecheck pass
- lint pass
- tests pass
- Standard Notes 實際可安裝
- 可開既有 note
- 可編輯
- task 操作不破壞 Markdown
- Mind Map 不產生第二份 durable state
- GitHub Pages 可以載入
- README 有安裝方式

---

# 56. Reference Projects

## Standard Notes

- https://github.com/standardnotes/app
- https://github.com/standardnotes/editor-kit
- https://github.com/standardnotes/markdown-visual
- https://github.com/standardnotes/simple-task-editor

## Existing project

- https://github.com/kjelly/sn-markmap
- https://kjelly.github.io/sn-markmap/

## Libraries

- https://milkdown.dev/
- https://codemirror.net/
- https://markmap.js.org/

---

# 57. 最終產品原則

coding agent 在做任何設計決策前，先用以下優先順序判斷：

```text
1. 不破壞使用者 Markdown
2. 不破壞 Standard Notes sync / encryption model
3. 保持普通筆記體驗
4. Task workflow 要快
5. Mind Map 要是 projection，不是第二份資料
6. Source Mode 永遠是逃生口
7. 所有 destructive operation 可 Undo
8. Desktop / Mobile 都能完成核心操作
9. Theme 不可寫死
10. 正確性優先於花俏功能
```

若某項功能只能透過破壞上述原則才能完成，應暫緩該功能並回報限制，而不是以隱性資料轉換硬做。
