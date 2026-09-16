# Writing mode 輸入穩定性契約與測試計畫

## 1. 目的

這份計畫把「Writing mode 不應在正常輸入時莫名跳回 Source mode」定義成可自動驗證的產品契約，而不是依賴個別 bug 的回歸測試。

核心目標：

1. 一份筆記通過 Writing admission 並進入可編輯狀態後，由目前 Milkdown editor 產生且能精確 round-trip 的本地修改，不得自動切換模式。
2. 使用者輸入、Enter、刪除、Undo/Redo、toolbar、slash command、貼上及核取方塊都遵守同一條契約。
3. 外部或 Source 傳入、無法證明可逆的 Markdown 仍必須保持 Source-only，不能為了避免跳轉而降低資料保護。
4. 每個新增的 Writing command 或 node view，都必須同時新增「操作後仍留在 Writing」與「後續輸入仍可保存」測試。

## 2. 不變條件

### W1：模式穩定

已經可編輯的 Writing session 完成本地操作並等候 listener／canonical handoff 後：

- Writing pane 仍可見。
- Source pane 仍隱藏。
- editor 維持 `contenteditable=true`。
- 狀態列不得出現 `Source fallback`。

### W2：內容確實保存

不能只驗證 DOM 沒有切換模式。操作後的 Markdown 必須：

- 到達 `CanonicalDocument`。
- 到達 mock Standard Notes host 的 save payload。
- 重新 parse／serialize 後保持相同 AST 與相同 Markdown。

### W3：安全邊界不退化

以下內容若來自外部或 Source，仍維持 Source-only：

- Raw HTML。
- Reference link spelling。
- 未支援的 Markdown extension。
- parser、serializer 或 AST 任一項無法證明穩定的內容。

CR／CRLF、空白行及其他可安全正規化的外部格式必須先走使用者確認流程；不能借用本地 transaction 的 live proof 靜默改寫。

### W4：本地 transaction 與外部 replacement 分離

只有目前 editor 產生的 transaction 可以使用 live codec proof。遠端更新、換筆記、Source 編輯及 programmatic replacement 不得沿用前一份 editor proof。

### W5：不以延遲掩蓋問題

E2E 必須等待超過 Milkdown listener 的 settle window 後才判斷結果，並在等待後再做一次輸入。這能抓到「畫面短暫停在 Writing，約 300ms 後才跳 Source」的問題。

## 3. 自動化測試分層

| 層級 | 責任 | 必要斷言 | 主要檔案 |
|---|---|---|---|
| Unit | capability、normalization、provenance 的純函式 | capability kind、拒絕原因、proof scope | `tests/index.test.ts` |
| Milkdown boundary | 真實 parser／serializer／ProseMirror transaction | AST 相等、序列化冪等、canonical 可接收、無 fallback | `tests/milkdown-boundary.test.ts` |
| Integration | canonical、fallback buffer、bridge save、remote update | history、save payload、fallback ownership | `tests/integration.test.ts` |
| Browser E2E | React mode、listener 延遲、DOM selection、toolbar | W1、W2、等待後可繼續輸入 | `tests/e2e/specs/16_writing_mode_stability.spec.ts` |
| Real host smoke | Standard Notes iframe 與實際 transport | host 中不切模式且內容可重開 | `tests/e2e/specs/14_standardnotes_web.spec.ts` |

## 4. 輸入矩陣

### P0：每次提交都必須通過

| 類別 | 案例 | 覆蓋 |
|---|---|---|
| 一般文字 | 插入中文字／英文、連續兩次 canonical commit | 已有 E2E |
| Enter | 段落文末、段落行中、段落／heading／bullet／task／quote／code | stability E2E |
| 刪除與歷史 | Backspace、Undo、Redo | stability E2E |
| Toolbar | H1、H2、bullet、task、quote、code、table、divider | stability E2E |
| Task | 空 task settle、連續 task、建立後繼續輸入 | 已有 E2E + Milkdown boundary |
| 空白 | 多餘空白行與 final newline 正規化後不跳模式 | 已有 E2E |
| 結構 | table、fenced code、divider 的 command provenance 與後續輸入 | integration + boundary |
| 安全負例 | HTML、reference link、未知 extension | stability E2E + unit |
| 延遲 | 每個關鍵操作等待 listener settle 後再次檢查 | stability E2E |

### P1：合併前依變更範圍選跑

| 類別 | 案例 | 觸發時機 |
|---|---|---|
| Inline marks | Bold、italic、strike、inline code、link 建立／修改／移除 | mark 或 shortcut 變更 |
| Paste | 純文字、多段文字、URL、已選取文字的 smart paste | paste pipeline 變更 |
| Selection | 跨段選取、取代、拖曳選取、全選刪除 | selection command 變更 |
| List keys | Tab、Shift+Tab、空 list item Enter、list 起始 Backspace | list／smart keys 變更 |
| Node views | task checkbox、code block、callout、Mermaid code/preview 切換 | node view 變更 |
| IME | compositionstart/update/end、中文輸入法 Enter | composition handling 變更 |
| Mobile | Android WebView Enter、soft keyboard、composition | mobile editor 變更 |
| Remote | 本地輸入與 remote update／conflict 交錯 | canonical／bridge 變更 |

## 5. Proof 與 fallback 規則

本地 user transaction 的放行順序：

1. 拒絕含 CR 的 serializer output。
2. 若通過既有 lexical／structural 規則，直接接受。
3. 否則使用 live codec proof：
   - 將 serializer output 重新 parse。
   - 重新解析後的 AST 必須與目前 editor AST 相同。
   - 重新 serialize 必須逐字等於 output。
4. proof 成功才更新 canonical；失敗時保留 fallback buffer。

Proof 必須綁定目前 document instance、revision、document generation 與 editor generation，不能跨筆記或跨 reset 使用。

## 6. 新功能的 Definition of Done

任何 Writing 輸入功能完成前，PR 必須回答：

- 這個操作產生哪一種 transaction origin？
- 操作後 Markdown 是否有 AST + byte-stable proof？
- listener settle 後是否仍符合 W1？
- 操作後再輸入一個字，是否仍符合 W1 與 W2？
- Undo／Redo 是否維持 Writing？
- 外部載入相同 Markdown 時，是否仍遵守 W3？
- 是否新增或更新本文件的矩陣與對應測試？

缺少上述任一項時，不應宣稱 Writing 支援該功能。

## 7. CI 與本機執行

基礎檢查：

```sh
mise run typecheck
mise run lint
mise run test:unit
mise run test:integration
```

Writing mode 瀏覽器契約：

```sh
mise run test:e2e:writing
```

Release 前應再執行 `mise run test:e2e:release`，涵蓋 Chromium 與 Firefox。涉及 mobile keyboard 或 IME 時，另執行 `mise run test:e2e:android-app`。

## 8. 完成狀態與後續工作

- [x] 本地 serializer output 加入 live AST／冪等 proof。
- [x] Enter 文末與行中回歸測試。
- [x] Enter 支援 block matrix。
- [x] 一般輸入、Backspace、Undo／Redo 穩定性測試。
- [x] toolbar command matrix。
- [x] unsupported external Markdown 負例。
- [x] 舊版相鄰 task list marker 的 Milkdown boundary 測試。
- [ ] Inline mark 完整矩陣。
- [ ] Paste 與跨段 selection 完整矩陣。
- [ ] IME composition browser 測試。
- [ ] Android soft keyboard Writing stability 測試。
- [ ] Standard Notes real-host 重開筆記的持久化測試。

未完成項目屬於下一階段覆蓋，不影響目前 P0 的模式穩定契約；相關模組一旦修改，應優先補齊對應 P1 測試。
