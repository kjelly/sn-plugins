# 使用者功能說明手冊 (User Guide) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 撰寫 `docs/user-guide.md`（繁體中文、終端使用者導向、完整教學型單一長文件），並在 README 加入連結。

**Architecture:** 純文件產出。依設計文件（`docs/superpowers/specs/2026-08-30-user-guide-design.md`）的大綱分 6 個撰寫任務，每個任務寫手冊的 1–2 個章節，逐段核對程式碼事實後寫出，最後一個任務做全稿驗證與 README 連結。無程式碼變更、無測試框架；「驗證」= 對照程式碼事實表 + grep 檢查關鍵數字/名稱。

**Tech Stack:** Markdown（GitHub-flavored）。

---

## 事實速查表（所有任務共用；與程式碼逐項核對過）

寫手冊時每個數字、名稱、快捷鍵以本表為準。不確定時回到原始碼再查，不得憑記憶編寫。

| 事實 | 值 | 來源 |
|------|-----|------|
| 模式 | `Writing` / `Source` / `Mindmap` / `Split`（按鈕順序：writing, source, mindmap, split） | `App.tsx:93-95` |
| 心智圖適用條件 | 有標題（ATX 或 setext）、或有任務列、或有任何列表項 | `analysisCore.ts:619-625` |
| 側邊欄快捷鍵 | `Ctrl/Cmd+\` | `App.tsx:282` |
| 側邊欄初始狀態 | 視窗寬 >900px 開啟；≤768px 點大綱自動收合 | `App.tsx:173,410` |
| Writing 格式快捷鍵 | `Ctrl/Cmd+B` 粗體、`+I` 斜體、`+K` 連結（彈 prompt）、`+E` 行內程式碼、`Ctrl/Cmd+Shift+X` 刪除線 | `WritingShortcuts.ts:14-37` |
| 結構快捷鍵 | `Alt+↑/↓` 移動列表項或表格列、`Alt+←/→` 標題升降級、`Tab/Shift+Tab` 列表縮排/表格導航 | `WritingShortcuts.ts:97-161` |
| Smart keys | 空列表項按 Enter 跳出縮排；列表項開頭按 Backspace 減少縮排；空 code block 開頭按 Backspace 轉段落 | `WritingSmartKeys.ts` |
| Slash 命令（15） | heading, heading2, heading3, heading4, heading5, heading6, bullet, numbered, task, quote, code, table, image, link, divider | `WritingCommandPlan.ts:1-17` |
| Slash 別名 | h1/title, h2/subtitle, h3/subheading, h4, h5, h6, list/bullet-list/ul, numbered-list/ol, todo/checkbox/check/task-list, blockquote/callout, codeblock/pre, grid, img/photo/picture, url/hyperlink, hr/separator/line | `WritingCommandPlan.ts:21-37` |
| Slash 選單導航 | ↑↓ 選擇、Enter/Tab 執行、Esc 關閉；即時過濾命令 | `WritingEditor.tsx:295-330` |
| Slash 選單觸發 | 行首或空格後輸入 `/` + 可選字母 | `WritingEditor.tsx:211-220` |
| Writing 工具列按鈕 | Task, H1, H2, Bullet, Quote, Code, Table, Link, Divider + "Type / for commands" 提示 | `App.tsx:427-437` |
| Source 工具列 | Search / Replace | `App.tsx:439` |
| Mind Map 工具列 | Tasks 下拉、Scope 下拉、`Pan · Zoom · Fit on refresh` 提示 | `App.tsx:505` |
| 表格浮動工具列 | Row: +↑ +↓ ↑ ↓ 🗑；Col: +← +→ ← → 🗑；Align: ⇤ ↔ ⇥ | `WritingTableControls.tsx` |
| 任務過濾 | All / Open only / Hide tasks | `MindMapView.tsx:7` |
| 心智圖範圍 | Entire note / Current section（無當前區段時 disabled） | `App.tsx:505` |
| 心智圖 checkbox | 可點擊切換 canonical 任務；連結點擊開新分頁 | `MindMapView.tsx` |
| 循環任務語法 | `@repeat(Nd/Nw/Nm/Ny/daily/weekly/monthly/yearly)`、`@done(YYYY-MM-DD)`；大小寫不敏感 | `RecurringTasks.ts` |
| 循環重置規則 | 開啟筆記時，若 `今天 >= done日期+間隔` 則 `[x]→[ ]`、清除 `@done`、保留 `@repeat` | `RecurringTasks.ts:90-121` |
| 存檔排程 | 停止輸入 300ms 後存檔；blur / page hidden / unload / teardown 強制 flush | `EditorKitBridge.ts:96` + `App.tsx:320-341` |
| 衝突橫幅 | "Another device changed this note." + `Keep local` / `Accept remote` | `App.tsx:457` |
| 自動合併 | 3-way 行級合併；成功則自動存檔 | `EditorKitBridge.ts:122-124` |
| 狀態訊息 | Ready / Edited · save pending / Edited · save requested; host confirmation unavailable / Remote update pending / Writing read-only · (reason) / Source fallback · edit to apply / Locked · read-only | `App.tsx:126-139` |
| Undo/Redo | 工具列按鈕（每個 pane 都有）；Writing/Source 各自保有本地編輯歷史 | `App.tsx:101-102` |
| Source 連結 | `Ctrl/Cmd+Click` Markdown 連結開新分頁 | `SourceEditor.tsx:61-75` |
| Writing 連結 | 直接點擊連結開新分頁 | `WritingEditor.tsx:494-514` |
| Source fallback | Writing 無法無損序列化時自動切 Source，狀態列顯示 `Source fallback · edit to apply`；在 Source 編輯即套用 | `App.tsx:503,129-130` |
| Completed 面板 | 依 headingPath 分組顯示 📁 標題（數量）；組內 Uncheck/Delete；全域 Uncheck all / Delete completed；Show/Hide 收合 | `App.tsx:532-582` |
| 大綱列按鈕 | ↑↓ 移動（限同層）、←→ 升降級、⧉ 複製子樹、🎯 聚焦/退出、☑☐ 清章節任務、🗑 刪已完成任務 | `OutlineRow.tsx` |
| 大綱任務徽章 | `已完成數/總數` | `OutlineRow.tsx:118-120` |
| 大綱拖拽 | 僅限同層 sibling 拖放（上方=before、下方=after） | `OutlinePanel.tsx:61-95` |
| 章節聚焦 | 頂部 breadcrumbs 橫幅 + `✕ Exit Focus` | `App.tsx:459-485` |
| 頁尾統計 | `N tasks · N sections · EditorKit markdown bridge` | `App.tsx:586` |
| 主題 | 跟隨 Standard Notes 主題（亮/暗自動切換） | `theme.ts` |
| 摺疊 | 大綱 ▸/▾ 按鈕 + Collapse all / Expand all；Writing 標題 fold gutter | `OutlinePanel.tsx` / `WritingFolding.ts` |

---

### Task 1: 手冊骨架 + 第 1–2 章（簡介、模式總覽）

**Files:**
- Create: `docs/user-guide.md`

- [ ] **Step 1: 建立手冊骨架與第 0 節目錄**

寫出檔頭、標題 `# Markdown Notes+ 使用者功能說明手冊`、簡介段、總目錄（GitHub 錨點連結，章節編號與設計文件大綱一致：1–10 + 附錄 A/B/C）。錨點規則：GitHub 對中文標題的錨點會保留中文字元並以 `-` 接空白，為求穩定，目錄一律用純文字列表描述（如 `1. [簡介與快速入門](#1-簡介與快速入門)`），並在骨架完成後用瀏覽器渲染檢查。目錄先放最終版（含尚未撰寫的章節名稱）。

- [ ] **Step 2: 撰寫第 1 章 簡介與快速入門**

內容必須包含：
- 一段開場：Markdown Notes+ 是 Standard Notes 的第三方 Markdown 編輯器（單一筆記為核心、四大模式、任務/大綱/心智圖投影）。
- 四模式一覽表（模式名、一句話定位、適用情境）：Writing（Milkdown 所見即所得）、Source（CodeMirror 6 原始 Markdown）、Split（Writing+心智圖並排）、Mind Map（Markmap 全屏心智圖）。
- 「3 分鐘快速導覽」編號步驟：①在 Standard Notes 選擇本編輯器開啟 Markdown 筆記 → ②用 Writing 模式輸入 `#` 標題與段落 → ③輸入 `/task` 插入待辦 → ④按 `Ctrl/Cmd+\` 開側邊欄看大綱與 Completed → ⑤切到 Mind Map 看投影。每步一句話。

- [ ] **Step 3: 撰寫第 2 章 編輯模式總覽**

內容必須包含：
- 模式切換：工具列 `Writing` / `Source` / `Mindmap` / `Split` 按鈕；心智圖適用性自動偵測——筆記需含標題或列表才會出現 Mindmap/Split 按鈕，純文字筆記只有 Writing/Source。
- Undo / Redo：每個模式工具列都有；各編輯區保有自己的歷史。
- 狀態列訊息表（7 種，見事實表「狀態訊息」），每種一行解釋。
- 唯讀（Locked）行為：所有編輯按鈕 disabled、任務/大綱操作禁用、心智圖 checkbox 鎖定。
- 主題跟隨 Standard Notes。

- [ ] **Step 4: 驗證第 1–2 章事實**

對照事實表核對：模式按鈕順序與名稱（writing, source, mindmap, split，首字母大寫顯示）、狀態訊息逐字、心智圖適用條件。用 grep 抽查原文：

```bash
grep -n "save requested; host confirmation" docs/user-guide.md
grep -n "Remote update pending" docs/user-guide.md
```

Expected: 各 1 個匹配（狀態字串逐字存在）。

- [ ] **Step 5: Commit**

```bash
git add docs/user-guide.md
git commit -m "docs(user-guide): add intro and modes overview chapters"
```

---

### Task 2: 第 3–4 章（Writing 模式、Source 模式）

**Files:**
- Modify: `docs/user-guide.md`

- [ ] **Step 1: 撰寫第 3 章 Writing 模式**

依設計文件 4.1 的三段式結構（說明 → 操作步驟 → 語法/範例 → 注意事項），必須包含：
- 工具列按鈕表：Task, H1, H2, Bullet, Quote, Code, Table, Link, Divider，各一行用途。標註 H3–H6、numbered、image 僅能由 Slash 選單使用。
- Slash 選單專節：觸發方式（行首/空格後輸 `/`）、15 個命令完整表（含全部別名，從事實表抄）、鍵盤導航 ↑↓/Enter/Tab/Esc、即時過濾。
- 格式快捷鍵表：B/I/K/E/X 五鍵 + 對應 Markdown 語法範例（`**粗體**`、`*斜體*`、`[文字](url)`、`` `code` ``、`~~刪除線~~`）。註明 Ctrl+K 彈出 URL 輸入框。
- 結構快捷鍵表：Alt+↑↓（列表項/表格列移動）、Alt+←→（標題升降級）、Tab/Shift+Tab（縮排/表格導航）。
- Smart keys 說明：空列表項 Enter 跳出、列表項開頭 Backspace 減縮、空 code block 開頭 Backspace 轉段落。
- 表格浮動工具列：游標進入表格時出現；三組按鈕（Row/Col/Align）逐鈕說明；列/行只剩 1 時刪除鈕 disabled。
- 標題折疊：標題列的 fold 按鈕可收合該標題下內容。
- 已完成任務隱藏列：打勾後該列在 Writing 隱藏（巢狀子列表仍顯示），資料未刪、可於 Source 模式或 Completed 面板操作。

- [ ] **Step 2: 撰寫第 4 章 Source 模式**

必須包含：
- CodeMirror 6 編輯器：行號、語言高亮、自動折行；`Search / Replace` 按鈕開搜尋面板（支援取代）。
- `Ctrl/Cmd+Click` 開啟 Markdown 連結（新分頁、noopener）。
- Writing ↔ Source 無損往返說明（使用者視角）：Writing 只在能無損保存原始字串時才可編輯；遇到無法保證的內容會顯示 `Writing read-only`（狀態列附原因），切 Source 可直接改。
- Source fallback 專節：Writing 判定無法無損序列化你的修改時，會自動切到 Source 並顯示 `Source fallback · edit to apply`——此時尚未動到實際筆記內容，在 Source 中繼續編輯（任意一次修改）即正式套用。
- 注意事項：Source 是最終真相，任何 Writing 做不到的排版修正都可以在 Source 完成。

- [ ] **Step 3: 驗證第 3–4 章事實**

```bash
grep -cn "heading6\|divider" docs/user-guide.md   # 15 命令名有出現
grep -n "todo\|task-list" docs/user-guide.md       # task 別名群
grep -n "Source fallback · edit to apply" docs/user-guide.md
```

Expected: 逐字包含事實表的命令名、別名與狀態字串。

- [ ] **Step 4: Commit**

```bash
git add docs/user-guide.md
git commit -m "docs(user-guide): add writing and source mode chapters"
```

---

### Task 3: 第 5–6 章（Split/Mind Map、側邊欄 Inspector）

**Files:**
- Modify: `docs/user-guide.md`

- [ ] **Step 1: 撰寫第 5 章 Split 模式與 Mind Map**

必須包含：
- Split 佈局：左 Writing、右 Mind Map；心智圖工具列在上方。
- 任務過濾下拉（All / Open only / Hide tasks）與範圍下拉（Entire note / Current section；後者需先有大綱點擊的當前區段，否則 disabled）。
- `Pan · Zoom · Fit on refresh` 說明：拖曳平移、滾輪縮放、重新整理時自動 Fit。
- 互動：點 checkbox 直接切換任務（同步回筆記）；點連結開新分頁。
- 適用性：純文字筆記不出現 Mindmap/Split 按鈕；偵測條件=有任何標題或列表項。若目前模式變成不適用，自動退回 Writing。
- 注意事項：心智圖是唯讀投影+任務切換，不能在上面編輯文字。

- [ ] **Step 2: 撰寫第 6 章 側邊欄 Inspector**

必須包含：
- 開關：`Ctrl/Cmd+\` 或各工具列 `Sidebar` 按鈕；寬 >900px 預設開啟；視窗 ≤768px 從大綱點標題會自動收合側邊欄。
- 大綱面板：▸/▾ 折疊、`Collapse all` / `Expand all`；拖拽把手 ⠿ 僅能拖到同層 sibling 的上/下方；每列動作鈕：↑↓ 移動、←→ 升降級（ATX 標題限定，setext 標題禁用）、⧉ 複製整個子樹、🎯 聚焦；任務徽章 `已完成/總數`；☑ 全勾、☐ 全取消、🗑 刪該節已完成任務。
- 點擊標題：跳到 Source 模式對應位置（游標置中）。
- 章節聚焦：🎯 開啟後頂部顯示 breadcrumbs（可點上層切換聚焦）+ `✕ Exit Focus`。
- Completed 面板：依標題路徑分組 📁 `標題 (數量)`；每任務 `Uncheck` / `Delete`；每組 `Uncheck` / `Delete`（整組）；最底 `Uncheck all` / `Delete completed`；`Show` / `Hide` 收合整個面板。
- 唯讀狀態下所有按鈕 disabled。

- [ ] **Step 3: 驗證第 5–6 章事實**

```bash
grep -n "Open only\|Hide tasks" docs/user-guide.md
grep -n "Current section" docs/user-guide.md
grep -n "Collapse all\|Expand all" docs/user-guide.md
```

Expected: 選項文字逐字與 UI 一致。

- [ ] **Step 4: Commit**

```bash
git add docs/user-guide.md
git commit -m "docs(user-guide): add mindmap and sidebar chapters"
```

---

### Task 4: 第 7 章（任務系統）

**Files:**
- Modify: `docs/user-guide.md`

- [ ] **Step 1: 撰寫第 7 章 任務系統**

必須包含：
- GFM 任務語法與範例（`- [ ]` / `- [x]`、巢狀、有序列表）。
- 跨模式同步：Writing checkbox、心智圖 checkbox、Source 直接改字串、側邊欄操作——都是同一份筆記內容。
- 循環任務專節：
  - 語法表：`@repeat(3d)` / `@repeat(2w)` / `@repeat(1m)` / `@repeat(1y)` / `@repeat(daily)` / `@repeat(weekly)` / `@repeat(monthly)` / `@repeat(yearly)`（含單位全名如 `5 days`）；大小寫不敏感。
  - 行為：打勾含 `@repeat` 的任務 → 自動附加/更新 `@done(YYYY-MM-DD)`（今天）；取消勾選 → 自動移除 `@done`；普通任務不受影響。
  - 自動重置：下次開啟筆記時，若 `今天 >= @done 日期 + 間隔`，任務自動變回未勾、清除 `@done`、保留 `@repeat`。附一個具體日期計算範例（`@done(2026-08-20)` + `@repeat(3d)` → 8/23 起開啟筆記即重置）。
  - 範例 code block：

```markdown
- [ ] 澆花 @repeat(3d)
- [x] 每週備份 @repeat(1w) @done(2026-08-22)
- [ ] 月度結算 @repeat(monthly)
- [x] 普通一次性任務
```

- [ ] **Step 2: 驗證第 7 章事實**

```bash
grep -n "@repeat(3d)" docs/user-guide.md
```

Expected: 循環任務語法範例逐字存在。

- [ ] **Step 3: Commit**

```bash
git add docs/user-guide.md
git commit -m "docs(user-guide): add tasks chapter"
```

---

### Task 5: 第 8–9 章 + 附錄（同步衝突、限制、速查表）

**Files:**
- Modify: `docs/user-guide.md`

- [ ] **Step 1: 撰寫第 9 章 多裝置同步與衝突處理**

必須包含：
- 自動存檔：停止輸入約 300 毫秒後存檔；切走焦點（blur）、切到別的分頁（page hidden）、關閉頁面（unload）都會立刻存檔。
- 3-way 自動合併：兩台裝置改了筆記、且改動在不同行，Standard Notes 同步送達時自動行級合併，無需人工處理。
- 衝突橫幅：同一行被兩邊修改而無法自動合併時，出現 `Another device changed this note.`：`Keep local`（保留本機編輯；必要時 Standard Notes 會建立衝突副本）/ `Accept remote`（捨棄本機修改、採用遠端版）。
- 狀態列對照：合併中/待遠端更新時顯示 `Remote update pending`。

- [ ] **Step 2: 撰寫第 9 章 注意事項與限制**

必須包含：
- 支援的 Markdown 子集（GFM 任務、表格、fenced code、引用、Setext 標題等），非完整 CommonMark/GFM 解析器；不支援的語法原樣保留、僅 Source 可編輯。
- Writing round-trip 邊界：Writing 顯示 ≠ 保證逐字保存；特殊內容會 read-only 或 fallback 到 Source（連回第 4 章）。
- Review 診斷面板、Callouts、Smart Paste 等功能「尚未提供」，不在本手冊範圍。

- [ ] **Step 3: 撰寫附錄 A/B/C**

- **A. 快捷鍵總表**：一張 Markdown 表彙整全手冊快捷鍵（Ctrl/Cmd+\ 側邊欄、Ctrl/Cmd+B/I/K/E、Ctrl/Cmd+Shift+X、Alt+↑↓←→、Tab/Shift+Tab、Ctrl/Cmd+Click 連結、Slash ↑↓/Enter/Tab/Esc）+ 各快捷鍵作用 + 適用模式欄位。
- **B. Markdown 語法速查**：標題、粗斜體、刪除線、行內碼、清單、任務、引用、fenced code、表格、連結、圖片、分隔線 + 循環任務標籤。
- **C. 狀態列訊息一覽**：7 種訊息逐字 + 說明（同第 2 章表格，此處彙總）。

- [ ] **Step 4: 驗證第 5 章後半與附錄事實**

```bash
grep -n "Another device changed this note" docs/user-guide.md
grep -n "300" docs/user-guide.md
grep -c "Ctrl/Cmd" docs/user-guide.md
```

Expected: 衝突橫幅文字逐字、300ms 數字、快捷鍵格式統一為 `Ctrl/Cmd+`。

- [ ] **Step 5: Commit**

```bash
git add docs/user-guide.md
git commit -m "docs(user-guide): add sync chapter, limitations, and quick reference appendices"
```

---

### Task 6: 全稿驗證 + README 連結

**Files:**
- Modify: `docs/user-guide.md`（修正驗證發現的問題）
- Modify: `README.md`（加入手冊連結）

- [ ] **Step 1: 全稿結構檢查**

```bash
grep -n "^#" docs/user-guide.md
```

Expected: 第 1–10 章與附錄 A/B/C 標題齊全、層級正確（章 `##`、節 `###`）、與目錄一致。

- [ ] **Step 2: 事實總複查**

逐項 grep 核對（清單見各 Task 驗證步驟）+ 抽查設計文件驗收標準：
- 所有快捷鍵、15 命令+別名、6 變數、3 策略、容量數字、7 狀態訊息、衝突橫幅文字、匯出檔名。
- 確認手冊**未**把以下寫成可用：Review 面板、Callouts、Smart Paste、Navigation Palette、UI Preferences。

```bash
grep -n "跨裝置同步" docs/user-guide.md   # 若出現，必須是「不會跨裝置同步」語境
```

- [ ] **Step 3: 修正發現的問題**

對 Step 1–2 發現的缺漏逐項修正後重跑 grep 確認。

- [ ] **Step 4: README 加入連結**

在 `README.md` 標題行之後（第一段之前）加入：

```markdown
> 完整功能說明手冊請見 [docs/user-guide.md](docs/user-guide.md)。
```

不更動 README 其他內容。

- [ ] **Step 5: 最終 commit**

```bash
git add docs/user-guide.md README.md
git commit -m "docs(user-guide): final verification pass and README link"
```

---

## Self-Review 記錄

- **Spec coverage**：設計文件第 2 節的 9 項已上線功能 → Task 1（模式/狀態/主題/頁尾）、Task 2（Writing+Source 全部）、Task 3（Split/MindMap+側邊欄全部）、Task 4（任務）、Task 5（同步衝突+限制+速查）。無遺漏。
- **Placeholder scan**：每個步驟都給了具體內容清單與驗證命令，無 TBD。
- **一致性**：事實速查表統一了數字/名稱/格式（`Ctrl/Cmd+`、狀態訊息逐字），各任務引用同一張表，不會出現版本漂移。
- 附錄 B「語法速查」中 fenced code 的三個反引號在 code block 內需用四個反引號外包——已在寫作時注意。
