# Standard Notes Markdown Notes+ — 待實作功能規格書 (Pending Implementation Spec)
## Stock Standard Notes Custom Editor Only

> 本文件只包含 **在原版 Standard Notes（不修改 host、不 fork、不建立 Companion App）下，第三方自訂 Editor 尚未實作的待辦功能**。
>
> 核心邊界：**目前正在編輯的 Note + Editor 自身的同步設定（Component Preferences）**。
>
> 任何需要跨筆記全域查詢、全域資料庫或 Standard Notes Host 修改的能力均明確排除。

---

# 1. 待實作架構總覽

```text
Current Working Note (Canonical Markdown)
    │
    ├── [待實作 1] Note Health & Review 診斷面板 (當前筆記健康度檢查)
    │       ├── 結構診斷 (無 H1、多個 H1、跳級標題 H2→H4、空標題/章節、重複錨點)
    │       ├── 任務診斷 (未完成數、完成數、空白任務項目)
    │       ├── 內部連結診斷 (驗證目前筆記中的 #heading 本地錨點有效性)
    │       ├── 容量與複雜度監控 (Bytes, 字數, 行數, 標題/任務/表格數)
    │       ├── 容量警告級距 (500 KB 警告, 900 KB 高負載提示)
    │       ├── 最大章節分析 (Largest Sections Analysis)
    │       └── Safe Auto Fix (單步 Undo 局部安全修復)
    │
    ├── [待實作 2] GitHub-Style Callout 區塊視覺渲染
    │       ├── NOTE, TIP, IMPORTANT, WARNING, CAUTION 五種語義卡片
    │       └── Writing 模式視覺渲染 + Source / Roundtrip 保持原生 Markdown
    │
    ├── [待實作 3] Code Block 輔助工具
    │       ├── 語言標籤 (Language label)
    │       ├── 一鍵複製按鈕 (Copy code)
    │       └── 自動換行切換 (Wrap / No-wrap toggle)
    │
    ├── [待實作 4] Smart Paste 剪貼簿智慧清洗
    │       ├── 外部 HTML / Rich Text 貼上轉為乾淨語義 Markdown
    │       └── 移除追蹤碼、內聯樣式與雜訊標籤
    │
    ├── [待實作 5] Navigation Palette 當前筆記快速導航盤
    │       └── 快捷鍵呼叫快速跳轉標題、任務、章節
    │
    └── [待實作 6] UI Preferences 偏好設定跨裝置同步
            └── 透過 Component Preferences 同步介面偏好 (Sidebar、過濾條件等)
```

---

# 模組一：Note Health & Review 診斷面板 (筆記健康度檢查)

在 Sidebar 新增獨立 Review 診斷面板，對當前 Note 提供即時 AST 健康度分析與安全修復：

## 2.1 結構診斷 (Structure Diagnostics)
- **H1 檢測**：未包含任何 H1 標題、或包含多個 H1 標題。
- **標題跳級 (Level Jumps)**：檢測非階梯式跳級（例如 H1 直接接 H3、或 H2 跳至 H4/H5）。
- **空白項目**：檢測空標題（Empty Headings）或只有標題沒有任何內文的空章節（Empty Sections）。
- **重複錨點 (Duplicate Anchors)**：檢測同名標題產生的潛在錨點衝突。
- **超長章節**：檢測單一章節長度顯著過大（建議拆分子章節）。

## 2.2 任務診斷 (Task Diagnostics)
- 統計 Open Tasks 與 Completed Tasks 數量與比例。
- 檢測無內文的空白任務項目（`- [ ] `）。

## 2.3 內部錨點連結診斷 (Local Link Diagnostics)
- 解析當前筆記內所有的 `[text](#anchor)` 內部連結。
- 驗證目標錨點是否存在於目前的標題清單中，標註失效錨點（Invalid Local Anchor）。

## 2.4 容量與複雜度監控 (Size & Complexity Monitor)
- 即時統計：字元數 (Bytes)、單詞數 (Words)、行數 (Lines)、標題數 (Headings)、任務數 (Tasks)、程式碼區塊數 (Code Blocks)、表格數 (Tables)。
- **容量分級警示**：
  - `< 500 KB`：正常 (Normal)
  - `500 KB ~ 900 KB`：警示 (Warning，提示大型筆記效能注意)
  - `>= 900 KB`：高負載 (High，建議拆分或精簡)
- **最大章節分析 (Largest Sections)**：列出筆記中佔用字數 / 體積前三大的章節名稱與大小。

## 2.5 安全一鍵修復 (Safe Auto Fix)
- 提供安全的單點自動修復按鈕（以 ProseMirror 單一 Transaction 執行，支援單步 Undo）：
  - 自動修復標題跳級（例如將 H4 平滑調整為 H3）
  - 自動清除空白標題
- **禁止行為**：禁止全篇自動重寫、禁止自動破壞原始換行格式。

---

# 模組二：GitHub-Style Callouts 視覺渲染

## 3.1 語法規格
支援 GitHub Flavored Markdown 標準 Callout 語法：
```markdown
> [!NOTE]
> 常用於提示背景資訊、附帶說明或參考指引。

> [!TIP]
> 常用於操作技巧、效能優化建議或最佳實踐。

> [!IMPORTANT]
> 關鍵需求、必要步驟或不可忽略的核心資訊。

> [!WARNING]
> 潛在問題、相容性警示或破壞性變更提醒。

> [!CAUTION]
> 高風險操作、資料遺失警告或資安關鍵提醒。
```

## 3.2 渲染與互動要求
- **Writing 模式**：
  - 將上述 Blockquote 即時渲染為帶有專屬色彩、左側邊框、背景色調與語意圖示（Icon）的美觀卡片。
  - 支援 Callout 內部包含段落、清單、行內格式與程式碼。
- **Source 模式**：保留原始 Markdown 引用語法。
- **Round-trip 保證**：模式切換或存檔時完全不變更原始字元格式。

---

# 模組三：Code Block 輔助工具

## 4.1 Writing 模式增強
在 Writing 模式下的 Fenced Code Block（` ```lang ... ``` `）上方或浮動列提供：
1. **Language Label**：顯示當前程式碼語言（例如 `ts`, `json`, `bash`, `python`）。
2. **Copy Code 按鈕**：一鍵將程式碼純文字複製到系統剪貼簿，並給予短暫「Copied!」視覺反饋。
3. **Wrap Toggle 按鈕**：切換程式碼區塊「自動折行 (Wrap)」與「水平捲動 (No-wrap)」。

## 4.2 狀態隔離
- 折行等 UI 檢視狀態僅保留在記憶體或 Component Preferences 中，**絕對不寫入 Markdown 內文**。

---

# 模組四：Smart Paste 剪貼簿智慧清洗

## 5.1 貼上處理流程
當使用者從網頁或外部應用貼上 HTML / 富文字（Rich Text）時：
1. **語意解析**：將 HTML 標籤轉換為標準 Markdown（Headers, Paragraphs, Lists, Tables, Code, Blockquotes, Links, Image URLs）。
2. **雜訊清洗 (Clean Markdown)**：
   - 徹底移除 `style="..."`、`class="..."`、追蹤碼屬性（如 `utm_*`、`data-*`）。
   - 移除無語意的 `<span>`、`<font>`、外層排版 `<div>` 與背景顏色污染。
   - 保持簡潔俐落的純 Markdown 排版。
3. **多模式貼上選項**（可透過選單或快捷鍵切換）：
   - Clean Markdown（預設推薦）
   - Plain Text（純文字）
   - Paste as Quote（貼上為引用區塊）

---

# 模組五：Navigation Palette 當前筆記快速導航盤

## 6.1 快速呼叫與導航
- 提供快捷鍵（如 `Ctrl/Cmd + P` 或自訂不與 Host 衝突之快捷鍵）呼叫全屏/置中快速導航彈窗。
- 支援對當前筆記進行即時模糊搜尋（Fuzzy Filter）：
  - `H: ` 篩選標題 (Headings)
  - `T: ` 篩選待辦任務 (Tasks)
  - `S: ` 篩選章節 (Sections)
- 選取後立刻跳轉並聚焦至編輯器對應位置（Writing / Source 均適用）。

---

# 模組六：UI Preferences 偏好設定跨裝置同步

## 7.1 同步項目
透過 Component Preferences（Key: `uiPreferences.v1`）記錄並同步使用者的編輯器介面習慣：
- `lastMode`（最後使用的模式：writing / split / mindmap / source）
- `sidebarOpen` / `activeSidebarTab`（側邊欄開啟狀態與當前選中標籤：outline / review / tasks）
- `outlineCollapsedAnchors`（大綱折疊記憶）
- `mindMapScope`（心智圖範圍：entire-note / current-section）
- `mindMapTaskFilter`（心智圖任務過濾器：all / open / hide）
- `codeBlockWrapDefault`（程式碼區塊預設折行設定）

---

# 實作原則與硬性約束 (Hard Boundaries)

1. **零 Host 依賴原則**：只依賴 `@standardnotes/editor-kit`，不得假設存在跨筆記 API。
2. **單一資料真相 (Canonical Data)**：`note.content.text` 永遠是唯一權威儲存，禁止建立 sidecar 檔案。
3. **無損 Round-trip (Non-destructive)**：非使用者主動修改時，禁止自動全篇格式化、trim 或重排。
4. **唯讀保護 (Note Locked State)**：筆記處於 Locked 狀態時，所有修復動作與寫入指令必須自動 Disable。
5. **完整測試覆蓋 (Test Driven)**：
   - 新增功能需提供單元測試（AST / Parser / Reducer / Pure Mutations）。
   - 提供整合與 Playwright E2E 測試，確保跨模式切換與 Standard Notes Bridge 生命週期運作正常。
