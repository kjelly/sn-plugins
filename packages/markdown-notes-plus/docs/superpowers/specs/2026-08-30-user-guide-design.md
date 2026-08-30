# Design Specification: 使用者功能說明手冊 (User Guide)

## 1. Overview & Goals

為 `markdown-notes-plus` 撰寫一份完整的繁體中文使用者功能說明手冊，讓終端使用者能系統性地了解並操作此編輯器的所有已上線功能。

### 核心目標

1. **功能全覆蓋**：手冊涵蓋使用者實際看得到、用得到的所有已上線功能。
2. **終端使用者導向**：以操作步驟、快捷鍵、Markdown 語法範例、注意事項呈現；不講內部架構、模組邊界或資料流。
3. **教學型深度**：每個功能提供「操作步驟 + 語法範例 + 注意事項」三段式結構，讀者可從零開始跟做。
4. **可查找性**：附錄集中收錄快捷鍵總表、Markdown 語法速查、狀態訊息一覽，方便隨查隨用。

### 非目標（明確排除）

- Review 診斷面板（`ReviewDiagnostics.ts` / `ReviewPanel.tsx` 引擎已實作但 UI 未掛載至 `App.tsx`）。
- spec.md 中的待實作功能：Callouts、Code Block 輔助工具、Smart Paste、Navigation Palette、UI Preferences 同步。
- 開發者內部架構（CanonicalDocument / EditorKitBridge / round-trip 保證機制等）僅在「使用者可感知的行為」層級描述（例如「Writing 顯示會自動切到 Source」），不深入原始碼層。

---

## 2. Scope & Audience

| 項目 | 決定 |
|------|------|
| 語言 | 繁體中文（UI 按鈕名稱保留英文原文） |
| 目標讀者 | 終端使用者 |
| 檔案位置 | `docs/user-guide.md`（單一完整手冊） |
| 組織方式 | 單一長文件，含目錄 |
| 內容深度 | 完整教學型 |
| 涵蓋範圍 | 僅已上線（已掛載至 UI）的功能 |

### 已上線功能盤點（手冊必涵蓋）

依據 `src/app/App.tsx` 實際掛載的 UI 與已合併的功能 commits：

1. **四種編輯模式**：Writing（Milkdown）、Source（CodeMirror 6）、Split、Mind Map（Markmap），含心智圖適用性自動偵測（`isMindmapSuitable`）與模式按鈕自動降級。
2. **Writing 模式**：工具列（Task / H1 / H2 / Bullet / Quote / Code / Table / Link / Divider）、Slash 選單（命令、即時過濾、鍵盤導航）、格式快捷鍵（Ctrl/Cmd+B、+I、+K、+E、Ctrl/Cmd+Shift+X）、結構快捷鍵（Alt+↑↓ 移動列表項/表格列、Alt+←→ 標題升降級、Tab/Shift+Tab 縮排切換/表格導航）、表格浮動工具列（增刪行列、移動行列、對齊）、標題折疊與 fold gutter、已完成任務隱藏列投影。
3. **Source 模式**：CodeMirror 6 編輯、Search / Replace 面板、Ctrl/Cmd+Click 開啟 Markdown 連結至新分頁、Source fallback 行為（Writing 無法無損序列化時自動切換並顯示 "Source fallback · edit to apply"）。
4. **Split 模式**：Writing + Mind Map 並列，心智圖工具列。
5. **Mind Map 模式**：Markmap SVG、任務過濾（All / Open only / Hide tasks）、範圍切換（Entire note / Current section）、Pan / Zoom / Fit、點擊 checkbox 直接切換任務、點擊連結以新分頁開啟、動畫（尊重 prefers-reduced-motion）。
6. **側邊欄 Inspector**（Ctrl+\ 開關）：大綱面板（折疊/展開全部、拖拽重排子樹、promote/demote/duplicate、點擊跳轉、章節聚焦 Focus 模式與 breadcrumbs）、Completed 任務面板（依標題分組、單項 Uncheck/Delete、分組批次操作、全域 Uncheck all / Delete completed）、章節批次任務操作（Check all / Uncheck all / Delete completed per section）、視窗 ≤768px 自動收合行為。
7. **任務系統**：GFM task list 語法、跨模式切換同步、循環任務 `@repeat()` / `@done(YYYY-MM-DD)` 標籤、完成自動標記、取消自動清除、開啟筆記時逾期自動重置。
8. **多裝置同步與衝突處理**：3-way 行級自動合併、無法自動合併時衝突橫幅（Keep local / Accept remote）、自動存檔排程與 blur / hidden / unload flush。
9. **狀態列與全域 UI**：狀態訊息（Ready / Edited · save pending / Edited · save requested / Remote update pending / Writing read-only / Source fallback / Locked · read-only）、Undo / Redo、鎖定筆記唯讀行為、主題跟隨 Standard Notes、頁尾任務/章節統計。

---

## 3. 手冊結構（大綱）

```text
docs/user-guide.md
├── 0. 目錄（錨點連結）
├── 1. 簡介與快速入門
│   ├── 這是什麼：Standard Notes 的 Markdown 編輯器
│   ├── 四模式一覽表
│   └── 3 分鐘導覽：建立筆記 → 寫標題 → 打任務 → 開側邊欄
├── 2. 編輯模式總覽
│   ├── 模式切換按鈕、心智圖適用性自動偵測
│   ├── Undo / Redo
│   ├── 狀態列訊息解讀（每種狀態一行說明）
│   └── 唯讀（Locked）狀態下的行為
├── 3. Writing 模式（所見即所得）
│   ├── 工具列按鈕逐一說明
│   ├── Slash 選單：/ 命令、過濾、鍵盤導航
│   ├── 格式快捷鍵（B/I/K/E/X）+ 對應 Markdown 語法
│   ├── 結構快捷鍵（Alt+方向鍵、Tab）
│   ├── 表格浮動工具列（全部按鈕）
│   ├── 標題折疊與區塊操作
│   └── 已完成任務的隱藏列行為（含注意事項）
├── 4. Source 模式（原始 Markdown）
│   ├── CodeMirror 基本操作
│   ├── Search / Replace
│   ├── Ctrl+Click 開連結
│   └── Writing/Source 無損往返保證與 Source fallback
│       （使用者感知行為：何時自動切到 Source、如何編輯套用）
├── 5. Split 模式與 Mind Map（心智圖）
│   ├── Split 佈局
│   ├── 任務過濾器、範圍切換、Pan/Zoom/Fit
│   ├── 心智圖上直接打勾任務、點連結開新分頁
│   └── 適用性：什麼筆記會顯示/隱藏 Mind Map 模式
├── 6. 側邊欄 Inspector（Ctrl+\）
│   ├── 大綱面板：折疊、拖拽、升降級、複製、跳轉
│   ├── 章節聚焦（Focus）與 breadcrumbs
│   ├── 章節批次任務操作
│   ├── Completed 面板：分組、批次、單項操作
│   └── 行動裝置行為（≤768px）
├── 7. 任務系統
│   ├── 基礎 GFM 任務語法 + 範例
│   ├── 跨模式同步切換
│   └── 循環任務：@repeat 語法表、@done 自動標記、
│       逾期自動重置規則（含日期計算範例）
├── 8. 多裝置同步與衝突處理
│   ├── 自動合併：哪些情況會自動合併
│   ├── 衝突橫幅：Keep local / Accept remote 各自後果
│   └── 自動存檔時機（300ms debounce、blur/unload flush）
├── 9. 注意事項與限制
│   ├── 支援的 GFM 子集、不支援語法保持原樣
│   └── Writing 模式的 round-trip 邊界（何時會切 Source）
└── 附錄 A/B/C
    ├── A. 快捷鍵總表
    ├── B. Markdown 語法速查（含循環任務標籤）
    └── C. 狀態列訊息一覽
```

---

## 4. 內容規格（寫作慣例）

### 4.1 每個功能的標準結構

```markdown
### 功能名稱

一句話說明這功能做什麼。

**操作步驟**
1. （編號步驟，以使用者視角描述 UI 位置）

**語法 / 範例**
（Markdown code block，展示輸入與效果）

**注意事項**
- 邊界行為、唯讀限制、自動切換等
```

### 4.2 語言與術語慣例

- 正文繁體中文；UI 元素名稱、按鈕文字保留英文原文並以 `code` 標記。
- 首次出現的英文術語附中文說明（例如：Slash 選單（輸入 `/` 呼叫的命令選單））。
- 快捷鍵一律寫 `Ctrl/Cmd+X` 形式（macOS 對應 Cmd）。
- 不使用內部型別/函式名稱；若需提及檔案，只用使用者可見路徑（`docs/`、`README.md`）。

### 4.3 正確性依據（內容必須與程式碼一致）

手冊內容以以下程式碼事實為唯一依據，寫作時逐項核對：

| 手冊章節 | 事實來源 |
|----------|----------|
| 模式切換、工具列按鈕 | `src/app/App.tsx` |
| Writing 快捷鍵 | `src/editor/WritingShortcuts.ts` |
| Slash 命令與別名 | `src/editor/WritingCommandPlan.ts`（WRITING_COMMANDS + COMMAND_ALIASES） |
| 表格工具列 | `src/editor/WritingTableControls.tsx` |
| 循環任務語法 | `src/tasks/RecurringTasks.ts` |
| 狀態列訊息 | `StatusInfo` 元件 |
| 衝突橫幅 | `App.tsx` conflict aside |
| 存檔排程 | `EditorKitBridge.ts` scheduleSave（300ms）與 flush 時機 |
| 心智圖互動 | `src/mindmap/MindMapView.tsx` |

### 4.4 錨點與目錄

- 目錄以 GitHub 自動錨點（`#章節標題`）連結，不手寫 HTML。
- 各章頂部不重複目錄，僅第 0 節一份總目錄。

---

## 5. Deliverables

1. `docs/user-guide.md` — 手冊本體（預估 700–900 行）。
2. `README.md` — 在現有 README 開頭加入一行連結：`詳細功能說明手冊請見 docs/user-guide.md`（不重構 README 其他內容）。
3. 本設計文件 — `docs/superpowers/specs/2026-08-30-user-guide-design.md`。

### 驗收標準

- [ ] 手冊涵蓋第 2 節「已上線功能盤點」的每一項。
- [ ] 每個快捷鍵、別名、變數名、容量數字、狀態訊息與程式碼逐項核對一致。
- [ ] 無 TODO/TBD 佔位。
- [ ] 目錄錨點在 GitHub Markdown 渲染下全部可用。
- [ ] README 連結存在且相對路徑正確。

---

## 6. 錯誤處理與邊界

- 手冊是純文件，無 runtime 錯誤處理；主要風險是**內容與程式碼不一致**。緩解：寫作時逐章核對來源檔案（見 4.3 表），完稿後執行 self-review 檢查數字與名稱。
- 第二風險是**涵蓋過度**（把未掛載功能寫成可用）。緩解：Review 面板、Callouts 等僅不出現；若提及只能寫在「注意事項與限制」並明確標示「尚未提供」。
