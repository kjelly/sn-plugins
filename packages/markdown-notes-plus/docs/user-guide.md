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

---

## 3. Writing 模式（所見即所得）

Writing 模式以所見即所得方式編輯：標題變大、清單有符號、表格有格線、任務有 checkbox。輸入的內容會即時轉成 Markdown 儲存。

### 3.1 工具列按鈕

| 按鈕 | 作用 |
|------|------|
| `Task` | 把目前選取範圍轉為任務清單（`- [ ]`） |
| `H1` / `H2` | 把目前區塊設為一級／二級標題 |
| `Bullet` | 轉為無序清單 |
| `Quote` | 轉為引用區塊 |
| `Code` | 轉為 fenced code block（可指定語言） |
| `Table` | 在目前位置插入表格 |
| `Link` | 插入連結（彈出 URL 輸入框，同 `Ctrl/Cmd+K`） |
| `Divider` | 插入水平分隔線 `---` |
| `Templates` | 開啟模板與片段管理員（見第 8 章） |

H3–H6、有序清單、圖片沒有專屬按鈕，請用 Slash 選單插入。

### 3.2 Slash 選單

在行首或空格之後輸入 `/`（可接續字母），會彈出命令選單，即時過濾匹配的**命令、片段、模板**（後兩者以 `Snippet` / `Template` 徽章標示）。

**操作方式**
1. 輸入 `/` 或 `/` + 關鍵字（如 `/tab`）。
2. 按 `↑` / `↓` 移動選取，`Enter` 或 `Tab` 執行，`Esc` 關閉選單。
3. 也可以直接用滑鼠點擊選項。

**命令完整清單（15 個）**

| 命令 | 別名（輸入可匹配） | 作用 |
|------|--------------------|------|
| `/heading` | `/h1` `/title` | 一級標題 |
| `/heading2` | `/h2` `/subtitle` | 二級標題 |
| `/heading3` | `/h3` `/subheading` | 三級標題 |
| `/heading4` | `/h4` | 四級標題 |
| `/heading5` | `/h5` | 五級標題 |
| `/heading6` | `/h6` | 六級標題 |
| `/bullet` | `/list` `/bullet-list` `/ul` | 無序清單 |
| `/numbered` | `/numbered-list` `/ol` | 有序清單 |
| `/task` | `/todo` `/checkbox` `/check` `/task-list` | 任務清單 |
| `/quote` | `/blockquote` `/callout` | 引用區塊 |
| `/code` | `/codeblock` `/pre` | 程式碼區塊 |
| `/table` | `/grid` | 表格 |
| `/image` | `/img` `/photo` `/picture` | 圖片（插入 `![alt text](https://)` 後再改網址） |
| `/link` | `/url` `/hyperlink` | 連結（彈出 URL 輸入框） |
| `/divider` | `/hr` `/separator` `/line` | 水平分隔線 |

**範例**：想插入二級標題，輸入 `/h2` → 按 Enter，游標所在區塊立即變為 H2。

### 3.3 格式快捷鍵

選取文字後按：

| 快捷鍵 | 效果 | 對應 Markdown |
|--------|------|---------------|
| `Ctrl/Cmd+B` | 粗體 | `**文字**` |
| `Ctrl/Cmd+I` | 斜體 | `*文字*` |
| `Ctrl/Cmd+Shift+X` | 刪除線 | `~~文字~~` |
| `Ctrl/Cmd+E` | 行內程式碼 | `` `文字` `` |
| `Ctrl/Cmd+K` | 插入/編輯連結（彈出 URL 輸入框） | `[文字](url)` |

### 3.4 結構快捷鍵

| 快捷鍵 | 效果 |
|--------|------|
| `Alt+↑` / `Alt+↓` | 把目前清單項目（或表格列）往上/往下移動 |
| `Alt+←` / `Alt+→` | 把目前標題升級（H2→H1）/ 降級（H1→H2） |
| `Tab` / `Shift+Tab` | 在清單中縮排/取消縮排目前項目；在表格中跳下一格/上一格 |

### 3.5 智慧按鍵（Smart Keys）

- 在**空的清單項目**按 `Enter`：跳出這層縮排（再按一次結束清單）。
- 在清單項目**開頭**按 `Backspace`：先減少一層縮排。
- 在**空的程式碼區塊**開頭按 `Backspace`：轉回普通段落。

### 3.6 表格浮動工具列

游標進入表格時，表格上方出現浮動工具列：

- **Row（列）**：`+↑` 上方插入列、`+↓` 下方插入列、`↑` `↓` 移動列、`🗑` 刪除列（僅剩一列時停用）。
- **Col（欄）**：`+←` 左側插入欄、`+→` 右側插入欄、`←` `→` 移動欄、`🗑` 刪除欄（僅剩一欄時停用）。
- **Align（對齊）**：`⇤` 靠左、`↔` 置中、`⇥` 靠右——作用於目前游標所在欄。

### 3.7 標題折疊

標題左側的折疊鈕可收合/展開該標題底下的內容，方便聚焦長文件。折疊只是顯示狀態，不會改動 Markdown 內容。

### 3.8 已完成任務的隱藏列

在 Writing 模式打勾任務後，該任務列會從正文中隱藏（底下的巢狀子清單仍顯示且可操作）。

**注意事項**
- 內容**沒有被刪除**——切到 Source 模式或側邊欄 Completed 面板仍可看到並操作它。
- 取消勾選（在 Completed 面板按 `Uncheck`）後該列會重新出現在 Writing 正文中。

---

## 4. Source 模式（原始 Markdown）

Source 模式以 CodeMirror 6 編輯器直接編輯筆記的原始 Markdown 字串：有行號、語法高亮、自動折行。

### 4.1 搜尋與取代

點工具列 `Search / Replace` 開啟搜尋面板（CodeMirror 內建），支援：

- 大小寫敏感/不敏感切換、正規表示式
- 逐筆取代與全部取代
- `Enter` / `Shift+Enter` 跳下一筆/上一筆

### 4.2 開啟連結

按住 `Ctrl`（Mac 為 `Cmd`）點擊 Markdown 連結文字，會在新分頁開啟該 URL（不會離開編輯器）。

### 4.3 Writing 與 Source 的無損往返

Writing 模式只會在「呈現結果能逐字還原成原始 Markdown」時才允許編輯。遇到它無法保證的內容時：

- 該筆記會顯示為 **Writing read-only**（狀態列附原因），你仍可完整閱讀，但要修改請切到 Source。
- 若是**你的某次修改**造成無法無損保存，編輯器會自動切到 Source 並顯示 `Source fallback · edit to apply`。此時你的輸入放在暫存緩衝區、**尚未寫入筆記**；在 Source 畫面繼續做任意一次編輯，整份暫存內容即正式套用為筆記內容。

**注意事項**
- Source 模式是「最終真相」：任何 Writing 辦不到的精確排版（罕見符號、特殊縮排、不支援的語法），都能在 Source 完成。
- Source 中顯示的就是實際儲存的每一個字元，不存在隱藏格式。