# Markdown Notes+ 使用者功能說明手冊

Markdown Notes+ 是 Standard Notes 的 Markdown 編輯器：以「單一筆記的原始 Markdown 字串」為唯一資料真相，在其上提供四種編輯與檢視模式（Writing、Source、Split、Mind Map），並把任務清單、大綱、心智圖當作同一份內容的三種投影。本手冊涵蓋所有已上線功能，每個功能以「操作步驟 + 語法範例 + 注意事項」呈現。

## 目錄

1. [簡介與快速入門](#1-簡介與快速入門)
2. [編輯模式總覽](#2-編輯模式總覽)
3. [Writing 模式（所見即所得）](#3-writing-模式所見即所得)
4. [Source 模式（原始 Markdown）](#4-source-模式原始-markdown)
5. [Split 模式與 Mind Map（心智圖）](#5-split-模式與-mind-map心智圖)
6. [側邊欄 Inspector](#6-側邊欄-inspector)
7. [任務系統](#7-任務系統)
8. [模板與片段](#8-模板與片段)
9. [多裝置同步與衝突處理](#9-多裝置同步與衝突處理)
10. [注意事項與限制](#10-注意事項與限制)
11. [附錄 A：快捷鍵總表](#附錄-a快捷鍵總表)
12. [附錄 B：Markdown 語法速查](#附錄-bmarkdown-語法速查)
13. [附錄 C：狀態列訊息一覽](#附錄-c狀態列訊息一覽)

---

## 1. 簡介與快速入門

Markdown Notes+（Standard Notes 外掛識別碼 `markdown-notes-plus`）安裝於 Standard Notes 後，即可用來編輯任何 Markdown 筆記。它的核心設計是：**筆記內容永遠是一份純 Markdown 字串**，所有模式與面板只是同一份字串的不同呈現方式，因此在任何地方做的修改都會即時同步到其他視圖。

### 四種編輯模式一覽

| 模式 | 定位 | 適用情境 |
|------|------|----------|
| Writing | 所見即所得編輯（Milkdown 引擎） | 日常書寫、排版、插入任務與表格 |
| Source | 原始 Markdown 編輯（CodeMirror 6 引擎） | 精確控制字元、修正 Writing 無法表達的內容、搜尋取代 |
| Split | Writing 與心智圖並排 | 邊寫邊看結構投影 |
| Mind Map | 全屏心智圖（Markmap 引擎） | 檢視整份筆記的階層結構、總覽任務 |

### 3 分鐘快速導覽

1. 在 Standard Notes 中把任一 Markdown 筆記以 Markdown Notes+ 開啟。
2. 在 Writing 模式輸入 `#` 加空白開始第一個標題，正常輸入段落文字。
3. 輸入 `/task` 並按 Enter，插入一個待辦任務；打勾它。
4. 按 `Ctrl/Cmd+\` 開啟側邊欄，查看大綱與 Completed（已完成任務）面板。
5. 切到 `Mindmap` 模式，看到整份筆記的心智圖投影；點擊圖上的 checkbox 可直接切換任務。

---

## 2. 編輯模式總覽

### 2.1 模式切換

每個編輯區上方的工具列都有四個模式按鈕：`Writing`、`Source`、`Mindmap`、`Split`。點擊即切換；Writing 編輯器在模式切換間會保留自己的游標與復原歷史。

**Mind Map 適用性自動偵測**：只有當筆記包含標題（`#` 開頭或底線式標題）或任何清單項目時，`Mindmap` 與 `Split` 按鈕才會出現。純文字筆記只有 Writing / Source 兩種模式可選。若你把一篇結構化筆記改成純文字，編輯器會自動退回 Writing 模式。

### 2.2 Undo / Redo

每個模式的工具列都有 `Undo`（復原）與 `Redo`（重做）按鈕。Writing 與 Source 各自保有自己的一份編輯歷史；工具列上的 Undo/Redo 操作的是整份筆記的變更歷史（包含打勾任務、大綱搬移等結構操作）。

### 2.3 狀態列訊息

工具列右側會顯示目前狀態，共有七種訊息：

| 訊息 | 意義 |
|------|------|
| `Ready` | 內容已同步，無待存變更 |
| `Edited · save pending` | 有未存變更，等待自動存檔排程 |
| `Edited · save requested; host confirmation unavailable` | 已向 Standard Notes 送出存檔請求（主機端不會回報確認） |
| `Remote update pending` | 另一裝置的更新正在套用中 |
| `Writing read-only · …` | Writing 模式無法無損呈現這份內容（訊息附原因），請改用 Source |
| `Source fallback · edit to apply` | 你的修改無法無損保存，已切到 Source 暫存；在 Source 編輯一次即正式套用 |
| `Locked · read-only` | 筆記被鎖定，全部唯讀 |

狀態列左側同時顯示**目前所在區段**（依游標/點擊位置對應的標題路徑，如 `專案 / 本週任務`）。

### 2.4 唯讀（Locked）狀態

筆記在 Standard Notes 中被設為保護（locked）時：所有編輯按鈕停用、任務 checkbox 與刪除鈕停用、大綱結構操作停用、心智圖 checkbox 鎖定、模板插入停用。解鎖後自動恢復。

### 2.5 外觀主題

配色自動跟隨 Standard Notes 的主題設定（亮/暗模式），不需另外設定。