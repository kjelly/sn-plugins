# Writing mode 可編輯性改善計畫

## 一、目標

降低 Writing mode 因為無害格式差異而進入唯讀狀態，同時避免 Markdown 語意、資料或特殊語法被 Milkdown 靜默破壞。

預期結果：

- 普通 Markdown 幾乎都能直接編輯。
- 格式差異可被正規化時，不再直接鎖定。
- 真正可能遺失資料的語法才切換到 Source mode。
- 使用者知道即將發生的正規化內容。
- Source mode 仍能保留原始 Markdown。

## 二、目前問題

目前 Writing mode 以兩個條件判斷是否可編輯：

```ts
source === serialized
```

以及 `isWritingLexicallySafe()` 的保守規則。

因此以下差異都可能導致唯讀：

- `- item` 與 `* item`
- LF 與 CRLF
- 標題與清單之間的空白行數量
- 行尾多餘空白
- 文件最後是否有換行
- Milkdown 自動重排 Markdown

目前流程位於：

- `src/editor/WritingEditorLifecycle.ts`
- `src/editor/WritingEditor.tsx`
- `src/app/App.tsx`

核心問題是：程式把「原始文字不同」直接等同於「資料可能遺失」。

## 三、建議採用的整體策略

建議採用混合方案：

1. Source mode 保留原始 Markdown。
2. Writing mode 對格式差異進行分類。
3. 可安全正規化的內容顯示提示，經使用者確認後才正規化。
4. 真正有資料遺失風險的內容維持 Source-only。
5. 正規化完成後，Writing mode 使用正規化後的 Markdown。

流程如下：

```text
原始 Markdown
      │
      ├─ 完全可保留 ────────────────> Writing 可直接編輯
      │
      ├─ 只有格式差異，可安全正規化 ─> 顯示提示，確認後進入 Writing
      │
      └─ 可能遺失語意或資料 ─────────> Source mode 編輯
```

不建議永久維護兩份互相同步的 Markdown，因為會增加同步、Undo/Redo、遠端更新與衝突處理的複雜度。

## 四、內容分類

### A. 可直接編輯

以下內容經 Milkdown 解析與序列化後，語意及必要結構都能保留：

- 一般段落
- 標題
- 一般無序清單
- 任務清單
- 一般有序清單
- 粗體、斜體、刪除線、行內程式碼
- 一般連結與圖片

這些內容不應因為空白行、清單符號或換行形式不同而被鎖定。

### B. 可正規化後編輯

以下差異通常不影響 Markdown 語意，可以接受一次性正規化：

- `-` 與 `*` 無序清單符號
- LF、CRLF、CR 換行格式
- 標題與清單之間的空白行
- 多餘的空白行
- 文件最後是否有換行
- 不具 Markdown 語意的單一行尾空白

但行尾兩個以上空格可能代表 Markdown hard break，不能直接刪除，應列為高風險內容。

進入 Writing mode 時顯示：

```text
這份 Markdown 需要整理格式後才能使用 Writing mode。
正規化可能會統一清單符號、換行格式與空白行。
[套用並進入 Writing] [留在 Source mode]
```

使用者確認後，建立一筆可 Undo 的正規化變更。

### C. 只能使用 Source mode

以下內容應維持 Source-only，除非未來有完整的 lossless 支援：

- Raw HTML
- 無法辨識的 Markdown extension
- Hard break 或反斜線換行
- 參考式連結等需要保留原始拼寫的語法
- Milkdown 無法穩定保留的特殊節點
- 序列化後會改變實際語意的結構
- 不完整或格式錯誤的表格、程式碼區塊

訊息不應只顯示「無法編輯」，而應指出原因：

```text
Writing mode 不支援 Raw HTML，請使用 Source mode 編輯。
```

## 五、技術設計

### 1. 將 `editable: boolean` 改為能力狀態

目前只有：

```ts
{ editable: boolean; reason?: string }
```

建議改為：

```ts
type WritingCapability =
  | {
      kind: "lossless";
      editable: true;
    }
  | {
      kind: "normalizable";
      editable: false;
      normalizedMarkdown: string;
      changes: WritingNormalizationChange[];
      reason: string;
    }
  | {
      kind: "unsupported";
      editable: false;
      reason: string;
    };
```

必要時增加：

```ts
type WritingNormalizationChange = {
  category: "line-ending" | "bullet" | "blank-line" | "trailing-space" | "final-newline";
  count: number;
};
```

這樣 UI 可以區分：

- 可以直接編輯
- 確認正規化後即可編輯
- 永久只能 Source mode

### 2. 建立 Markdown 正規化器

新增例如：

```text
src/markdown/writingNormalization.ts
```

負責：

- 統一換行格式
- 判斷清單符號是否只是格式差異
- 移除不具語意的行尾空白
- 整理標題、清單與段落間距
- 保留 code block、hard break 與 HTML 原樣
- 輸出正規化結果及變更清單

不要直接使用全域的 `trim()` 或簡單正規表示式處理整份文件，避免誤刪 Markdown 語意。

### 3. 使用 AST 或結構比較，而非純文字比較

目前的核心判斷：

```ts
source !== serialized
```

應改成分層判斷：

1. 原文與序列化結果完全相同：直接通過。
2. 正規化後兩者一致，且沒有高風險節點：標記為 `normalizable`。
3. AST 結構不同，或出現不支援節點：標記為 `unsupported`。

必須使用與 Writing 實際相同的 parser、serializer 與設定，避免測試結果和瀏覽器實際行為不一致。

### 4. 正規化必須是明確的文件變更

使用者點選「套用並進入 Writing」後：

1. 將正規化後 Markdown 寫入 `CanonicalDocument`。
2. 建立正常的 undo history entry。
3. 通知 Standard Notes bridge。
4. 重新建立或同步 Writing editor。
5. 將 capability 設為 `lossless`。
6. 進入 Writing mode。

不要在背景中自動改寫內容，避免使用者不知道筆記已經被修改。

### 5. Writing 編輯期間採用同樣的分類規則

後續輸入不應只要 `serialized !== source` 就立即 fallback。

應改成：

- 若只是已允許的格式正規化：接受並更新 canonical Markdown。
- 若編輯引入高風險語法：保留目前內容，切換 Source fallback。
- 若 serializer 發生未知差異：顯示明確錯誤，保留原始資料。

目前 `src/editor/WritingEditor.tsx` 的 fallback 流程應改為依照 capability 分類處理。

## 六、UI 改善

### 狀態列

目前：

```text
Writing read-only · Writing cannot preserve this Markdown exactly
```

建議改成：

```text
Writing 需要正規化格式
```

或：

```text
Writing 僅支援 Source mode：包含 Raw HTML
```

### 正規化提示

提示應包含：

- 發現哪些格式差異
- 是否會改變語意
- 正規化後的預覽
- 「套用」
- 「留在 Source」
- 「取消」

### 編輯器狀態

- `lossless`：`contenteditable=true`
- `normalizable`：可顯示提示，但尚未確認前不可編輯
- `unsupported`：唯讀並提供 Source mode 操作
- `locked`：維持既有 host lock 行為

這能避免目前所有錯誤都被混成同一種「無法編輯」。

## 七、實作階段

### Phase 1：修正最常見問題

先支援：

- LF / CRLF
- 清單 `-` / `*`
- 標題與清單間距
- 多餘空白行
- 單一行尾空白
- 最後換行

新增正規化器與能力分類，但先不處理複雜 Markdown。

### Phase 2：加入使用者確認流程

新增：

- 正規化提示元件
- 一次性確認
- 正規化的 Undo/Redo
- 明確的狀態列訊息
- Source mode 保留原文的取消路徑

### Phase 3：改善高風險語法判斷

逐步評估：

- 表格
- fenced code block
- hard break
- reference link
- blockquote
- HTML block

每一類都必須有實際 parser/serializer round-trip 測試後，才能從 Source-only 移入可正規化範圍。

### Phase 4：遠端更新與衝突驗證

確認正規化流程和以下功能相容：

- 遠端筆記更新
- multi-device merge
- pending remote conflict
- fallback buffer
- bridge save scheduling
- undo/redo
- 模式切換

尤其要避免遠端更新在使用者尚未確認正規化時，覆蓋原始內容或提示狀態。

## 八、測試計畫

### Unit tests

新增測試案例：

- 標題後沒有空白行
- 標題後有一個空白行
- 清單使用 `-`
- 清單使用 `*`
- LF
- CRLF
- 空白行含 Tab
- 單一行尾空白
- 兩個行尾空格代表 hard break
- 多餘空白行
- Raw HTML
- code block
- table
- reference link

測試應驗證：

```ts
kind === "lossless"
kind === "normalizable"
kind === "unsupported"
```

而不是只驗證 `editable`。

### Integration tests

驗證：

- 正規化後可進入 Writing mode。
- 正規化建立一筆 undo history。
- 使用者取消時，原始 Markdown 不變。
- Writing 編輯不會因無害格式差異進入 fallback。
- 高風險語法仍會正確切換 Source。
- canonical text 與 bridge save text 一致。

### E2E tests

新增瀏覽器測試：

- 使用者提供 CRLF 任務清單，顯示正規化提示。
- 使用者確認後，Writing editor 可編輯。
- 使用者取消後，Source editor 保留原文。
- `-` 與 `*` 清單可正常編輯。
- 行尾單一空格不會造成唯讀。
- hard break 仍維持 Source-only。
- Raw HTML 顯示具體原因。
- 正規化後切換模式不會重複提示。

## 九、驗收標準

改善完成後，以下內容應能直接或經確認後編輯：

```md
# 代辦事項
- [ ] Task
```

```md
# 代辦事項

* [ ] Task
```

```md
# 代辦事項\r\n
- [ ] Task\r\n
```

```md
# 代辦事項

- [x] hbac 可以增加 user 和 host 
```

最後一個案例的單一行尾空白可以被安全移除。

以下內容仍應明確提示 Source-only：

```md
<div>custom content</div>
```

```md
text  
next
```

其中兩個行尾空格代表 hard break，不應被當成普通空白刪除。

## 十、建議優先順序

最值得先做的是：

1. 將「完全相等」改成「安全等價或可正規化」。
2. 優先處理 CRLF、清單符號、空白行與單一行尾空白。
3. 加入正規化確認提示。
4. 保留真正高風險語法的 Source-only 保護。
5. 用 unit、integration、E2E 測試固定行為。

這樣可以保留目前防止資料遺失的核心目的，同時消除「只因為行尾多一個空格就完全不能編輯」這類過度嚴格的問題。
