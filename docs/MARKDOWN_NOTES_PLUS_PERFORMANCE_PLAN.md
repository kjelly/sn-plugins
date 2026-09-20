# Markdown Notes+ 編輯器效能改善計畫

> **日期**：2026-09-19
> **目標套件**：`packages/markdown-notes-plus`
> **起始程式碼版本**：`ba07fe3ca13aec98cf9d05ae17336b6985b48ba5`，已包含 `f2cd17d`、`43de10f`、`454d8e4` 與 `ba07fe3` 的 lazy-loading / bootstrap / deferred-work 改善。若正式執行不是從此 SHA 開始，必須在任何程式變更前更新本欄。
>
> **候選效能 baseline SHA**：`9cd7d461a5cb879f16399d6196d520668cc3fef1`。此 replacement Phase 0 harness-only commit 只修正 fixture、instrumentation、正式抽樣、主指標與 checkpoint/resume runner，不包含 optimization；它取代 schema 尚未完整的 `02b430c7eb3300b56bd34fe4669270608682c668`。在相同 commit 的兩批正式報告通過 <=5% 穩定性門檻，且 10k / 100k / 500k / 1m 報告全部產生前，不得把候選 SHA 宣告為正式 baseline，也不得開始計算 optimization 百分比。
> **原則**：任何效能改動都必須以 benchmark 證明改善，且不得降低 Markdown lossless round-trip、Standard Notes bridge、Writing stability、CSP 或跨裝置安全邊界。

---

## 1. 目標

這份計畫改善四條使用者可感知路徑：

1. **Open latency**：Standard Notes 把 note context 交給 extension 後，內容多久可見。
2. **Writing TTI（Time to Interactive，可開始編輯時間）**：內容出現後，Writing mode 多久真正可輸入。
3. **Typing latency（輸入延遲）**：大型筆記每次輸入是否因 full-document scan / parse / projection 重算而卡頓。
4. **Projection latency（投影延遲）**：Outline、Tasks、Kanban、Review、Mind Map 在大型筆記下多久更新，且不能阻塞核心編輯路徑。

### 最終成功條件

- 10 KB / 100 KB 一般筆記的 TTI median 不得退化 >5%，p95 不得退化 >10%；超出門檻即視為 regression。
- 500 KB / 1 MB 筆記的 Writing TTI 相較 Phase 0 baseline 至少改善 **20%**；若最終 profiling 證明瓶頸主要在不可避免的 ProseMirror DOM 建立，可改以「主執行緒 long task 與可輸入延遲」為主要成功指標，但必須在 benchmark 報告中記錄原因。
- 500 KB / 1 MB Writing typing p95 相較 baseline 至少改善 **30%**。
- 500 KB / 1 MB 載入期間 >50 ms long task 數量至少減少 **50%**。若因不可移出的 ProseMirror DOM 成本無法達標，必須同時提供 profile 證據、改善後數值，以及由維護者在 benchmark 報告中明確接受的替代數值門檻；只描述原因不算通過。
- 正常 Writing keystroke 不得再觸發不必要的多次 full-document Markdown 結構掃描。
- 所有既有 unit / integration / Writing stability / Standard Notes Web / Android contract 保持通過。

---

## 2. 不可破壞的不變條件

### P1：Canonical Markdown 不變

`CanonicalDocument` 仍是唯一 canonical source。效能改善不得：

- 以 AST 取代 canonical Markdown。
- 為了省 parse 而靜默正規化外部 Markdown。
- 跳過既有 Writing admission / live codec proof 的資料保護規則。

### P2：Writing lossless contract 不變

保留既有：

- initial admission proof。
- external replacement 與 local transaction proof 分離。
- parser / serializer / AST-equivalent 檢查。
- unsupported / normalizable / lossless capability state。
- fallback buffer ownership。

### P3：Bridge 不能變慢

目前小型 React-free bootstrap 先註冊 Standard Notes bridge、先顯示 plaintext preview 的設計保留。不得讓 React、Milkdown、Worker 或 WASM 初始化阻塞 `component-registered` / initial context。

### P4：延遲工作不得造成 stale mutation

任何 Worker、deferred analysis、idle task：

- 必須帶 document instance / revision / generation。
- 結果過期時直接丟棄。
- read-only projection 可以短暫 stale。
- 會修改 canonical 的 command 不得使用 stale analysis；若 analysis revision 落後，必須 re-resolve 或等待最新結果。

### P5：不記錄筆記內容

Performance instrumentation 只能記 duration、byte / line / heading / task count、phase 名稱、document generation / synthetic fixture id。不得把 note text、heading text、task text、URL 或使用者內容寫入 log / telemetry。

Production 預設不得持續累積 performance entries。詳細 trace 只在 benchmark/test flag 啟用；切換 document generation 時清除上一代 marks/measures。記憶體內部處理可以傳遞 note text，但不得把內容放進 mark 名稱、console、JSON report 或測試附件。

---

## 3. 目前已確認的效能熱點

### 3.1 已完成、應保留的改善

目前主線已經有：

- 小型同步 bridge shell。
- initial plaintext bootstrap preview。
- `mountApp` 動態載入。
- `WritingEditor`、`SourceEditor`、Mind Map、Review、Template、Palette 延遲載入。
- `App` 共用單次 `analyzeMarkdown(snapshot.text)` 結果。
- recurring task initial evaluation 延後到 initial delivery 之後。
- synchronous bridge shell `< 100 KB` artifact budget。

後續工作不得把這些 lazy boundary 合併回 initial chunk。

`ba07fe3` 仍在 App module evaluation 時以 `writingEditorPromise = import(...)` 提前抓取 Writing chunk。它避免一般 Writing note 的 fetch waterfall，但也代表「dynamic import」不等於「Source-only note 不下載 Milkdown」。Phase 5 必須改成 conditional prefetch，並用 network assertion 驗證，而不能只依賴 bundle 靜態檢查。

### 3.2 Writing initial admission 的重複工作

目前初始 Writing 路徑可能重複執行：

```text
WritingEditor mount
  -> scanWritingNormalization(value)
  -> Milkdown Editor.create()
  -> synchronizeWritingEditorValue()
       -> scanWritingNormalization(value)
       -> serialize current AST
       -> assessWritingRoundTrip()
            -> scanWritingNormalization(source)
            -> lexical / structure checks
            -> 特定情況再 parse / serialize proof
```

第一個目標是讓同一 document revision 的純文字 preflight / structure scan 只計算一次並沿 pipeline 傳遞。

`ba07fe3` 已加入 module-level `Map<string, WritingNormalizationScan>`，最多保留 16 份完整 Markdown 與結果。這只能避免部分相同字串的重算，仍會跨 note 保留大型內容，也沒有 revision/generation identity。Phase 1 必須以 revision-scoped context 取代並移除此 cache，而不是在其上再疊一層 cache。

### 3.3 Writing 每次輸入仍可能 full-document scan

`assessWritingMutation()` 的 normal path 會呼叫 `isWritingLexicallySafe(next)`，而後者會重新 `scanMarkdownStructure(next)`。

這表示大型筆記即使只輸入一個普通字元，也可能在主執行緒重新掃整份 Markdown。這是本計畫的高優先級目標。

### 3.4 `analyzeMarkdown()` 有可疑的 worst-case complexity

目前 task 掃描會：

- 為每個 task 向後掃 continuation 以求 `itemEnd`。
- 再對每個 task 呼叫 `movableTaskSubtreeFor()` 向後掃描。
- 所有 note 即使沒有進入 Kanban，也會產生 `movableTaskSubtrees`。

dense-task 文件在 worst case 可能退化到接近 O(tasks × lines)。

### 3.5 Kanban model 不應處於核心 typing path

`App.tsx` 目前對每個 `snapshot.text` 都建立 Kanban model：

```ts
const kanban = useMemo(() => analyzeKanban(snapshot.text, analysis), ...)
```

而 `analyzeKanban()` 包含：

- 每個 section 再 `filter(analysis.sections)` 找 direct children。
- 每個 column 再掃 tasks。
- task -> section lookup。
- movable task facts。

即使使用者不在 Kanban mode，也會付出成本。

---

# 4. Phase 0 — 建立可重現 baseline 與效能契約

**優先級：P0。沒有 Phase 0，不開始後續效能重構。**

## 4.1 建立 deterministic fixture generator

新增：

- `tests/performance/generatePerfMarkdown.ts`
- `tests/performance/perfFixtures.ts`

不要提交 1 MB 靜態 fixture；以固定 seed 動態產生。

| ID | 大小 | 特徵 |
|---|---:|---|
| `plain-10k` | ~10 KB | heading + paragraph |
| `mixed-100k` | ~100 KB | headings / tasks / links / lists |
| `mixed-500k` | ~500 KB | 一般大型真實風格 |
| `mixed-1m` | ~1 MB | XL |
| `tasks-flat-{n}` | 2,500 / 5,000 / 10,000 tasks | 平坦 task control fixture |
| `tasks-nested-{n}` | 具相同語法比例的 1x / 2x / 4x 規模 | 壓測 nested itemEnd；同時記錄 bytes/lines，避免把 fixture 自身變大誤判成演算法退化 |
| `tasks-continuation-{n}` | 具 blank/continuation subtree 的 1x / 2x / 4x 規模 | 壓測 itemEnd / movable facts |
| `headings-dense-{n}` | 2,500 / 5,000 / 10,000 headings | 壓測 section / outline / kanban hierarchy |
| `fences-dense` | 大量 fenced code | 壓測 opaque range |
| `gfm-structural` | tables / task / hard break / fence | Writing codec proof |
| `source-only` | HTML / reference link / unsupported extension | 應快速落入 Source-only |
| `crlf-normalizable` | CRLF + normalization | normalization admission |

每個 fixture 要能穩定重建相同 UTF-8 bytes（以 `TextEncoder` 計算）、UTF-16 length、line count、heading count、task count，並記錄 generator version。Complexity fixture 必須至少有 1x / 2x / 4x 三個規模；不能只用單一大 fixture 判斷 Big-O。

## 4.2 建立 performance marks

新增：

- `src/performance/PerfTrace.ts`
- `src/performance/PerfNames.ts`

至少量：

```text
context_received
bootstrap_preview_rendered
mount_app_start
mount_app_end
analysis_start/end
writing_chunk_loaded
writing_preflight_start/end
milkdown_create_start/end
roundtrip_proof_start/end
writing_interactive
```

產生 measures：

- `context_to_preview_ms`
- `context_to_app_ms`
- `context_to_writing_interactive_ms`
- `analysis_ms`
- `writing_preflight_ms`
- `milkdown_create_ms`
- `roundtrip_proof_ms`

Instrumentation 不得 import React/Milkdown，也不得增加 bridge shell 的大型 dependency。

### Mark 的唯一語意

- `context_received`：Standard Notes context callback 進入、尚未更新 preview/canonical 的第一行。
- `bootstrap_preview_rendered`：`root.replaceChildren(...)` 完成後。
- `mount_app_start`：開始 dynamic import `mountApp` 前。
- `mount_app_end`：React App 第一次 commit「已收到的 initial context generation」完成後；若 App 先以空 runtime mount，不得把空畫面的 commit 當成結束，也不得在 `root.render()` 返回時提早記錄。
- `writing_chunk_loaded`：WritingEditor dynamic import resolved。
- `writing_preflight_start/end`：指定 revision 的 normalization/lexical preflight 邊界。
- `milkdown_create_start/end`：呼叫 `editor.create()` 前至 promise resolved。
- `roundtrip_proof_start/end`：initial live codec proof 邊界。
- `writing_interactive`：Milkdown create 完成、initial proof 已發布、editor 的 `editable` 狀態已設定，且非 read-only 時已完成 focus request。每個 document/editor generation 最多記錄一次。

所有 mark/measure 都必須帶內部 generation 關聯，但 performance entry 名稱不得包含 note text。測試用 trace collector 負責把 generation 與時間整理成 report。

## 4.3 建立 benchmark runner

新增：

- `scripts/benchmark-performance.mjs`
- `scripts/compare-performance.mjs`
- `tests/e2e/specs/17_editor_performance.spec.ts`

`package.json` 新增：

```json
"bench:perf": "...",
"bench:perf:compare": "...",
"test:e2e:perf": "..."
```

`mise.toml` 同時新增同名 repository tasks，並讓需要 browser/dependencies 的 task 宣告既有 `deps` / `playwright:install` 相依。人工操作、Coding Agent 與 CI 一律從 repository root 使用 `mise run bench:perf`、`mise run bench:perf:compare -- ...`、`mise run test:e2e:perf`；不得直接繞過 Mise 呼叫 npm/node/playwright。

JSON 報告至少包含 schemaVersion、baseline/head SHA、fixture generator version、fixture counts/bytes、runs、browser/version、OS/CPU、CPU governor（可取得時）、cold/warm mode、median、p95、MAD、bundle、longTasks、fast/bounded/full hit counts，以及各量測階段。報告輸出至 gitignored artifact directory，不得覆寫 source fixture。

`bench:perf:compare -- --base <sha> --head <sha>` 必須在隔離的 temporary worktree/build directory 執行兩個 SHA，不得 checkout/reset 使用者目前的工作樹，也不得讀取目前工作樹的 stale `dist`。兩側各自透過 Mise 安裝/恢復依賴並 production build；完成或失敗都清理 temporary runtime/process，保留 JSON artifacts 供診斷。

Base SHA 必須已包含相容的 benchmark schema/fixture generator（正常情況即 Phase 0 harness-only commit）。Compare script 發現任一 SHA 缺少 harness 或 schema 不相容時必須拒絕比較，不能用 head runner 偷測不同語意的 base。若未來只修 benchmark harness，先建立同一應用程式版本的 replacement baseline 並在報告說明，不能把 harness 變更算成產品效能改善。

### Benchmark 規則

- browser benchmark：warm-up 3 次；TTI/載入指標正式至少 40 次，使 p95 不由單一 sample 決定。
- microbenchmark：warm-up 後至少 30 次。
- base/head 必須在同一機器、同一 browser version、同一 CPU governor 條件比較。
- 報告 median + p95，不使用單次最快結果。
- cold load 與 warm cache 分開。
- cold load 使用新的 browser context 並停用/清空 HTTP cache；warm load 先以同一 production assets 完成一次不計分載入，再在同一 browser process/context 測量。兩者都必須建立新的 document/editor generation，不能沿用上一 run 的 canonical state。
- debounce save 不納入 typing latency。
- base/head 執行順序至少做 ABBA 交錯，避免溫度、背景負載或 JIT 只偏向其中一方。
- 相同 commit 的兩個獨立 batch 重跑時，主要 median 的相對差異必須 <=5%，且各 batch 的 MAD/median 都必須 <=5%；任一條件不符合時報告標示 unstable 且不得用來判定 optimization 成敗。
- p95 採 nearest-rank，並輸出原始 samples。Typing 至少執行 20 個獨立 editor runs，每個 run 輸入 100 次並先計算該 run 的 p50/p95；headline `typing_p95_ms` 是 20 個 run-level p95 的 median，另報其 outer p95。不得把同一個 editor session 的 100 次按鍵當成 100 個獨立 runs。

## 4.4 Long Task 與 typing latency

Chromium perf E2E 加入 `PerformanceObserver('longtask')`，紀錄：

- >50 ms count。
- max duration。
- total blocking time：`sum(max(0, duration - 50ms))`。

Observer 必須以 Playwright `addInitScript` 在頁面應用程式執行前安裝，使用 buffered entries（若 browser 支援），並在每個 run 開始前清空 collector。

Writing typing benchmark：

- editor 已 interactive 後輸入固定 100 個一般 Unicode 字元；英文與 CJK direct input 分開報告。IME 另以 deterministic browser compositionstart/update/end harness 驗證 sequence/fallback，並以 Android/Appium 做至少一條 real IME smoke；不得把 Playwright `insertText` 當成 IME 測試。
- 以 test-only、content-free hook 記錄 input/transaction sequence 到 matching canonical revision commit 的時間，不以 debounce save completion 作終點。
- 分別輸出 p50/p95。
- 另測含 Markdown syntax 字元的 adversarial sequence：`* _ # [ ] < >`。
- 同時拆分 `transaction_to_markdown`（Milkdown full serialization）、`mutation_proof`、`canonical_commit`、`projection_schedule`；否則不能判斷 full serializer 與 scanner 各自的成本。

## 4.5 Phase 0 驗收

- [ ] benchmark 可在相同 commit 重跑並同時符合 <=5% inter-batch median variation 與 <=5% MAD/median 門檻。
- [ ] harness-only commit 不含 optimization，其完整 SHA 已回填到文件頂端與 baseline JSON。
- [ ] 10k / 100k / 500k / 1m 都有 baseline JSON。
- [ ] 能分辨 preview、App、analysis、Milkdown、proof 的時間。
- [ ] 能量到 normal typing 與 syntax typing。
- [ ] 不把 note content 寫入 log。
- [ ] 每個 mark 的 generation 與唯一觸發語意有自動測試。
- [ ] benchmark report schema 可由 compare script 驗證，base/head 環境不一致時拒絕比較。
- [ ] 現有 test suite 全部通過。

### 2026-09-19 正式 baseline 嘗試紀錄

- 候選 harness commit：`9cd7d461a5cb879f16399d6196d520668cc3fef1`；工作樹不含 optimization。
- `plain-10k` 已完成兩個獨立正式 batch。每批包含 cold/warm load 各 40 次，以及英文、CJK、syntax 各 20 個獨立 editor runs；每個 typing run 輸入 100 次。
- 執行環境為 Linux x64、Intel Core i7-6700K、Chromium 151.0.7922.34；CPU governor 無法由此 VM 取得。量測期間主機 load average 約 3.6--4.9，並有多個使用者工作負載。
- 穩定性結果為 `stable=false`：cold TTI inter-batch 6.95%、warm TTI 1.48%、英文 typing 3.34%、CJK typing 11.62%。cold/warm/CJK 的第一批 MAD/median 分別為 7.01%、8.67%、8.67%；第二批 cold/warm/英文分別為 5.58%、11.12%、7.77%。
- 另將完整 Mise workflow 固定於 CPU 1、5 重測 load；cold/warm MAD/median 反而為 8.94% / 13.09%，已排除單靠限制 CPU affinity 能在此共享主機達標。該次測試在 load checkpoint 後主動停止，未列為完整 batch。
- 報告位於 gitignored artifact directory：`baseline-9cd7d461a5cb-plain-10k-browser-batch-{1,2}.json` 與 `baseline-9cd7d461a5cb-plain-10k-browser-stability.json`。
- 依本節規則，這些不穩定報告不得作為 optimization baseline。100k / 500k / 1m 正式 batch 暫停，直到在低背景負載、固定 CPU 條件的專用 benchmark host 上重跑；不得以放寬 5% 門檻、刪除離群值或挑選較快 run 宣告通過。
- 驗證狀態：`mise run test:unit` 為 233 passed / 0 failed；lint、typecheck、integration 與 Chromium/Firefox release E2E 已在同一 harness 系列通過。Phase 0 驗收框維持未勾選，直到正式穩定 baseline 完成。

---

# 5. Phase 1 — 消除重複 Markdown structure / normalization scan

**優先級：P0。低風險、高 ROI。**

## 5.1 建立 revision-scoped analysis context

建議新增 `src/markdown/MarkdownAnalysisContext.ts`：

```ts
type MarkdownAnalysisContext = {
  token: {
    instanceId: string;
    revision: number;
    generation: number;
  };
  text: string;
  structure: MarkdownStructure;
  writingPreflight?: WritingNormalizationScan;
};
```

由 `App` 對每個 canonical token 呼叫一次 `createMarkdownAnalysisContext(token, text)`，`analyzeMarkdown(context)` 與 WritingEditor props 共用同一物件。建立 analysis 時不得在 context 之外先掃描再複製結果。任何 consumer 都必須同時驗證 token 與 text；相同 text 在不同 note/generation 仍是不同 context。

只在目前 document revision 生命週期內共用。移除現有 `writingNormalization.ts` module-level `scanCache`；不得建立 bounded 或 unbounded global string cache，也不得讓上一份 note text 因 cache 留存。

## 5.2 讓 scanner 可注入既有 structure

修改：

- `src/markdown/analysisCore.ts`
- `src/markdown/writingNormalization.ts`
- `src/editor/WritingEditorLifecycle.ts`
- `src/editor/WritingEditor.tsx`
- `src/app/App.tsx`

目標 API：

```ts
createMarkdownAnalysisContext(token, markdown)
analyzeMarkdown(context)
scanWritingNormalization(context)
isWritingLexicallySafe(context)
assessWritingRoundTrip(source, serialized, codec, context)
synchronizeWritingEditorValue({ ..., analysisContext: context })
```

`App` 必須把同一 context 傳給 `analyzeMarkdown` 與 `WritingEditor`；Writing lifecycle 再從 context 取得 preflight/structure，不得只傳 preflight 後重新建立 structure。

為維持既有 command/test API，可保留 `analyzeMarkdown(markdown)`、`scanWritingNormalization(markdown)`、`isWritingLexicallySafe(markdown)` convenience overload，但 production initial path 必須使用 context overload；所有 string overload 都是單次 pure computation，不得進入 global cache。

具體要求：

1. 同一 initial revision 可以多次讀取同一 preflight 結果，但 normalization computation 與底層 `scanMarkdownStructure()` 各最多執行一次。
2. initial App analysis 與 Writing preflight 共享 `scanMarkdownStructure()` 結果。
3. `assessWritingRoundTrip()` 接受目前 context，重用已計算 preflight 與 structure，不自行重建相同 scan。
4. external update / Source edit / reset generation 必須建立新 context；舊 context 不得再傳給 mutation command。

## 5.3 統一 line tokenization

`writingNormalization.ts` 目前另外 tokenize CR/LF。評估改用 `splitPhysicalLines()` 的 EOL 資訊，避免同一份 source 再建立另一份 line token array。

只有 benchmark 證明 allocation/CPU 有改善時保留；若 API 複雜度上升而收益低則不要合併。

## 5.4 Phase 1 correctness tests

新增 assertion：

- initial Writing admission 的 shared structure scan count。
- external replacement 必須建立新 context。
- 相同 text、不同 instanceId/revision/generation 不得共用 context identity。
- 切換 note 後舊 note text 不存在於任何 module-level cache。
- normalizable / unsupported / lossless 結果與改造前完全相同。
- CRLF / table / fence / HTML / reference link / unknown extension differential tests。

## 5.5 Phase 1 驗收

- [ ] initial Writing admission 的同 revision normalization computation <=1 次；測試必須計算實際 scanner execution，而不是只計算 public function invocation。
- [ ] 同 revision shared structure 不重建。
- [ ] 500k / 1m 的 preflight + roundtrip CPU 明顯下降；若 <10%，保留只有在程式碼也更簡單，否則 revert 無收益 abstraction。
- [ ] 10k / 100k TTI 不得退化 >5% median。
- [ ] Writing stability contract 全部通過。

---

# 6. Phase 2 — 修正 analysis / Kanban 的演算法複雜度

**優先級：P0。大型 task / heading note 的核心改善。**

## 6.1 `TaskInfo.itemEnd` 改為 single-pass

現況每個 task 向後找 subtree end。

改成以下其中一種，選 benchmark / correctness 最簡單者：

- monotonic stack 預算下一個 <= root indentation boundary。
- 在 line scanner 中維護 open list/task container 並一次 finalize。
- 預先計算 next structural boundary table。

要求：

- 常態 O(lines) 或 O(lines log lines)。
- 不允許每個 task 再向後掃整個 document。
- nested list / blank lines / blockquote / fence / heading 行為必須與現有測試完全相同。

## 6.2 `movableTaskSubtrees` 改成 lazy/on-demand

目前只有 Kanban 與 Kanban tests 實際依賴 movable facts。

重構方向：

```text
base analyzeMarkdown
  -> headings
  -> sections
  -> tasks
  -> structure

Kanban requested
  -> buildTaskMovementIndex(analysis)
```

不要讓普通 Writing / Source / Outline 使用者在每次 keypress 都計算 Kanban movement facts。

`buildTaskMovementIndex()` 必須接收目前 analysis token，回傳同 token 的 index。Kanban move command 執行前仍要用 current canonical token re-resolve；read-only model 的 on-demand 結果不能直接授權 mutation。

## 6.3 Section lookup 改成 index

`sectionAt()` 目前由尾端 linear scan。

新增：

- section starts sorted index。
- binary search `sectionAt(offset)`。
- `sectionsByAnchor` 保留 Map。
- `childrenByParentAnchor`。

## 6.4 Opaque fenced range lookup 不得為 O(lines × ranges)

目前共用 `isInOpaqueFencedRange()` 以 `ranges.some(...)` 查詢；在 normalization/lexical loop 對每行呼叫時，`fences-dense` 可能形成 O(lines × fenced ranges)。依 consumer 選擇：

- 單調遞增 line scan 使用 range cursor，總計 O(lines + ranges)。
- 隨機 offset lookup 使用 sorted range binary search，O(log ranges)。

不得只優化 `analysisCore` 私有的 binary search，卻保留 Writing normalization/lexical path 的逐行 linear range scan。

## 6.5 Kanban model 改成 O(S + T)

修改 `src/kanban/KanbanModel.ts`。

建立：

```ts
childrenByParentAnchor: Map<number | undefined, SectionInfo[]>
tasksBySectionAnchor: Map<number, TaskInfo[]>
movementByRootTaskFrom: Map<number, MovableTaskSubtree>
```

不要在 for-loop 內重複 `filter(all sections)` / `filter(all tasks)` / `find(all movement facts)`。

## 6.6 不在非 Kanban mode 建完整 Kanban model

`App.tsx`：

- navigation 只需要 cheap `kanbanSuitable`。
- 完整 `analyzeKanban()` 只有 `mode === "kanban"` 時才建立。
- cheap suitability 從 section hierarchy index O(S) 得到。
- 加入 differential test，保證 `detectKanbanSuitability(analysis)` 與完整 model 的 `candidates.length > 0` 對 corpus 結果一致。

## 6.7 Phase 2 驗收

- [ ] `tasks-flat`、`tasks-nested`、`tasks-continuation`、`headings-dense` benchmark 不再呈現 quadratic growth。
- [ ] `fences-dense` normalization/lexical scan 使用 cursor 或 binary lookup，不再對每行 linear scan 全部 ranges。
- [ ] 在相同語法比例的 complexity fixture 上，2x input bytes/lines 的 median execution time 不得超過 2.5x；同時輸出 scanner operation counters，以排除 timer noise。若 fixture bytes 並非 2x，不得只依 task count 宣稱複雜度改善。
- [ ] 非 Kanban mode 不建立 movable task index / full Kanban model。
- [ ] 所有 Kanban model / move tests 通過。
- [ ] 普通 Writing typing 的 analysis CPU 明顯下降。

---

# 7. Phase 3 — 將非核心 projection analysis 移出同步 typing path

**優先級：P0/P1。目標是 UI responsiveness，不只是總 CPU。**

## 7.1 拆分 synchronous core 與 asynchronous projections

核心 synchronous path 只保留：

- CanonicalDocument mutation。
- Writing editor 自己的 transaction。
- 必要 save scheduling。
- 當前模式立即需要的 minimal state。

以下允許 async / deferred：

- Outline。
- Task sidebar。
- Kanban detection/model。
- Review。
- Mind Map projection。
- footer counts。

## 7.2 建立 serializable analysis data

Worker 不可直接傳函式，因此拆分：

```ts
type MarkdownAnalysisData = {
  token: {
    instanceId: string;
    revision: number;
    generation: number;
  };
  headings: HeadingInfo[];
  tasks: TaskInfo[];
  sections: SectionInfo[];
  opaqueFencedRanges: MarkdownRange[];
}
```

主執行緒建立 lightweight lookup wrapper：`sectionByAnchor`、`sectionAt` 與 indexes。

Base response 不攜帶函式、Map 或只為 movement 所需的完整 `physicalLines` object graph。Kanban 使用第二種 request kind：

```ts
type AnalysisRequest =
  | { kind: "base"; token: DocumentToken; text: string }
  | { kind: "kanban"; token: DocumentToken; text: string };
```

`kind: "kanban"` 只在目前 mode 進入 Kanban 且 token 仍 current 時排程，由 Worker/sync threshold path 建立 movement facts 與完整 Kanban model。它與 base request 共用同一 client queue/coalescing 規則；不得為了讓主執行緒 on-demand 建 movement index，又同步重掃整份 large note。

## 7.3 Web Worker protocol

新增：

- `src/workers/markdownAnalysis.worker.ts`
- `src/workers/MarkdownAnalysisClient.ts`

Protocol 帶：

- request kind（`base` / `kanban`）。
- instanceId。
- revision。
- generation。
- text。
- response analysis + timings。

規則：

- 同時最多一個 in-flight analysis。
- 新 revision 到達時先在 main-thread client 只保留最新 pending text；只有 Worker 空閒或排程點到達時才呼叫 `postMessage`。不得先對每個 keystroke structured-clone 500 KB/1 MB text 再在 Worker 端丟棄。
- 收到新 revision 時，舊中間 revision 可 coalesce。Client state machine 明確為 `idle | in-flight(token) | in-flight+latest-pending(token)`，完成或失敗後最多送出一份最新 pending。
- response token 不等於 current canonical token 時丟棄。
- Worker crash / unsupported 時：小文件可同步 fallback；大文件只能 scheduled/deferred sync fallback，期間 projection 顯示 loading/stale 並停用依賴 offset 的 mutation。不得在 input handler 中直接同步分析 500 KB/1 MB text。
- Worker 建立只能發生在 bridge 完成 initial context/preview 之後，不得加入同步 bridge shell。
- request/response 都記錄 queue delay、structured-clone/postMessage 主執行緒成本與 Worker compute duration；threshold 必須使用 end-to-end latency決定。
- Worker 以 Vite 可追蹤的 `new Worker(new URL("./markdownAnalysis.worker.ts", import.meta.url), { type: "module" })` 類型入口產生 fingerprinted asset；禁止 blob/eval worker。Production artifact test 必須確認 worker asset 存在，Standard Notes real-host/CSP E2E 必須確認可載入。若必須新增 `worker-src`，只允許實測所需的最小 `'self'`，並更新 exact CSP contract。

## 7.4 Small-note threshold

Worker structured clone 與 startup 有固定成本，不能假設所有 note 都值得進 Worker。

Phase 0 benchmark 後決定 threshold，例如 100~250 KB 區間；不要先硬編固定值。門檻集中在 `shouldUseAnalysisWorker(...)`，不散落 magic number。

Threshold 決策至少比較 main-thread sync、Worker 首次啟動、Worker warm、快速連續 10 次 edit 的 coalescing 成本；只比較 Worker 內 compute time 不足以決定門檻。

## 7.5 Stale projection safety

如果 UI 顯示 revision N analysis、canonical 已是 N+1：

- Outline/Tasks 顯示可以短暫 stale。
- UI 必須標示 analyzing/stale，且 document 切換時不得短暫顯示上一份 note 的 projection。
- mutation button 必須檢查 analysis token。
- token 不符時 disable action 到新 analysis 到達，或對 current canonical 重新解析 command 所需最小資訊。
- 絕不可用 stale offsets 修改 N+1 text。

## 7.6 Phase 3 驗收

- [ ] 500k / 1m typing 時 analysis 不再形成主執行緒 long task。
- [ ] Worker result stale 時不會覆蓋 current projection。
- [ ] Worker error 有符合文件大小門檻的 sync 或 deferred fallback；大文件 fallback 不在 input handler 形成 long task。
- [ ] 連續輸入期間，每個 in-flight interval 最多 structured-clone 一份 in-flight 與一份最後 pending text，不會對每個中間 revision 呼叫 `postMessage`。
- [ ] Android WebView / Chromium / Firefox 都驗證。
- [ ] Production worker asset、CSP 與 real-host 載入通過，沒有使用 blob/eval worker。
- [ ] 10k / 100k 因 Worker threshold 不得變慢。
- [ ] 500k / 1m long task count 至少比 baseline 減少 50%；未達標時只能使用第 1 節定義的 profile 證據與維護者核准替代數值門檻。

---

# 8. Phase 4 — Writing local mutation incremental proof

**優先級：P0。大型 Writing note 打字流暢度的關鍵。**

## 8.1 取消普通 keypress 的 full-document lexical scan

現況：

```text
keypress
 -> Milkdown serializer markdownUpdated
 -> assessWritingMutation()
 -> isWritingLexicallySafe(next)
 -> scanMarkdownStructure(next)
```

目標：

```text
initial document
 -> 完整 admission proof 一次

local transaction
 -> previous document 已安全
 -> derive changed region / transaction provenance
 -> 驗證受影響範圍
 -> ambiguous structural edit 才 full fallback proof
```

## 8.2 引入 `WritingSafetyState`

建議：

```ts
type WritingSafetyState = {
  documentToken: {
    instanceId: string;
    revision: number;
    generation: number;
    editorGeneration: number;
  };
  transactionSequence: number;
  structuralContexts: WritingStructuralContext[];
  lastVerifiedMarkdown: string;
}
```

必須綁 document/editor generation，不能只是 boolean。

## 8.3 建立 incremental change classifier

使用 ProseMirror transaction steps + previous/next serialized Markdown diff，但兩者用途必須分離：

- ProseMirror plugin 對每個 `docChanged` transaction 產生單調遞增 sequence、origin、composition 狀態與 step summary。
- `markdownUpdated` 必須消耗能唯一對應的 transaction sequence；若多個 transaction 被合併、遺失或順序不明，直接走 full fallback。
- ProseMirror positions 不是 Markdown byte/UTF-16 offsets，禁止直接拿 step positions 切 Markdown。
- Markdown changed range 以 previous/next serialized text 的 common-prefix/common-suffix diff 求得，再擴張到 scanner 定義的安全實體行/block boundary。
- 所有 source offsets 沿用現有 TypeScript string 的 UTF-16 code-unit index；diff/boundary 不得切在 surrogate pair 中間。UTF-8 bytes 只用於 fixture size/report，不可混作 mutation offset。
- prefix/suffix diff 本身仍是 O(document length)，必須單獨計時；它可作第一版保守方案，但若成為主要成本，後續只能以 benchmark 證明的 transaction-aware serializer/incremental mapping 取代。

### Fast path

- 普通 paragraph 內文字插入/刪除。
- 不改變 line/container boundary。
- changed range 與前後 guard window 均不形成 Markdown structural token；不能只檢查新插入字元。
- origin 是目前 local editor。
- transaction sequence 唯一、非 composition 中間狀態，且 safety state token 與 canonical/editor generation 完全相符。

Fast path 不重新 scan 整份 Markdown。

### Bounded scan path

- 修改單一 line / adjacent block。
- 擴張到安全 block boundary 後重掃局部範圍。

Bounded scanner 必須明確接收左/右初始結構狀態（例如 fence、blockquote/list container、HTML/opaque context）。若無法從已驗證 state 證明 boundary 狀態，就不能把片段當成獨立 Markdown，必須走 full fallback。

### Full proof fallback

- newline / list boundary。
- fence delimiter。
- table。
- HTML-like token。
- blockquote / heading structural change。
- serializer output 與 transaction diff 無法合理對應。
- IME composition 尚未結束、一次 callback 對應多個不明 transaction，或 plugin sequence 不連續。
- remote / Source / external replacement。

任何不確定情況都回 full proof；效能不能降低資料安全。

## 8.4 保留 codec proof

若 lexical fast path 不足：

- 仍使用 live parser/serializer/AST proof。
- proof 綁目前 editor AST。
- 不允許拿前一 revision proof 放行下一 revision。
- 可評估重用目前 `view.state.doc`，避免重新 parse 已知 AST；只有 differential tests 證明語意相同才採用。

保留改造前的 full-document classifier 作 test-only oracle。固定 corpus、Writing stability corpus，以及 deterministic property/fuzz corpus（escape、backtick、emphasis、autolink、HTML、fence、table、list indentation、tab、CRLF、Unicode、相鄰字元組合）中，fast/bounded 的允許結果不得比 oracle 更寬鬆。若兩者不同，production classifier 必須 fallback，而不是放行。

## 8.5 Phase 4 benchmark

分別測：

- 100 次一般中文字。
- 100 次英文。
- deterministic compositionstart/update/end sequence，加上 Android/Appium real IME smoke。
- Enter。
- Backspace。
- Markdown structural syntax。
- task checkbox。
- table / code / divider command。

輸出 fast / bounded / full fallback hit rate。

每種輸入類型使用新的、已完成 initial admission 的 editor generation；若某個 adversarial edit 正確觸發 Source fallback，該 run 在 fallback 點結束並記錄，不能繼續把 Source-mode 輸入混入 Writing latency samples。

同時輸出 full Markdown serialization、prefix/suffix diff、bounded/full scan、codec proof、canonical commit 各自時間。如果 full serializer 已是主要成本，Phase 4 不得宣稱只消除 scanner 就已完成；必須追加 benchmark 驅動的 serializer 策略，且在 500 KB/1 MB typing p95 改善達到 30% 前，Phase 4 與整體 DoD 都保持未完成。

## 8.6 Phase 4 驗收

- [ ] `mixed-500k` 普通輸入大多數 transaction 走 fast path。
- [ ] normal typing 不做 full-document `scanMarkdownStructure`。
- [ ] 500k / 1m typing p95 相較 Phase 0 baseline 改善 >=30%。
- [ ] structural / ambiguous edits 仍可 fallback full proof。
- [ ] fast/bounded classifier 對 differential/property corpus 不比原 full-document oracle 寬鬆。
- [ ] transaction sequence 無法唯一對應、IME composition 中間狀態、或 Markdown boundary state 不明時一律 full fallback。
- [ ] `2026-09-16-writing-mode-stability-contract.md` 所有契約保持通過。
- [ ] unsupported external Markdown 不因 fast path 被誤放行。

---

# 9. Phase 5 — Startup / bundle / render pipeline 再優化

**優先級：P1。前四階段完成後才做。**

## 9.1 Source-only 快速拒絕

對明顯不支援 Writing 的 source：

- raw HTML。
- reference link。
- unsupported extension。

在載入完整 Milkdown chunk 前做 lightweight source preflight。

只有「確定 unsupported」可以提前拒絕；需要 live codec proof 的 normalizable/lossless 仍走 Writing。

目前 `ba07fe3` 在 App module evaluation 無條件建立 `writingEditorPromise`。實作此 Phase 時必須改成明確狀態機：

```text
mountApp chunk 可與 bridge context 並行下載
  -> initial host context 尚未到達：不得 import WritingEditor
  -> context 到達並先顯示 plaintext preview
  -> mountApp/App chunk 中執行不依賴 React/Milkdown 的 cheap reject
       -> definitely unsupported：保持 Source-only，不請求 Writing chunk
       -> unknown/supported：呼叫一次 idempotent prefetchWritingEditor()
```

Cheap reject 可以位於 mountApp/App lazy chunk；不得為了提前幾毫秒把完整 Markdown scanner 塞回同步 bridge shell，除非 bundle benchmark 證明仍符合 budget。App 若在 context 前先 mount，只能顯示 loading/preview，不得以空 canonical 提前觸發 Writing import。

Cheap reject 與完整 `scanWritingNormalization` 必須有 differential tests：cheap reject 只允許 true-positive unsupported；任何不確定輸入回傳 `unknown` 並繼續載入完整 Writing proof。

## 9.2 保持 lazy boundaries

`tests/build-artifact.test.ts` 持續保護：

- bridge shell < 100 KB。
- `mountApp` dynamic import。
- HTML 不得 modulepreload Writing / Source / Mind Map；runtime preload 必須遵守本節的 conditional/idle 規則。

擴充 bundle report：

- raw bytes。
- gzip bytes。
- 每個 lazy chunk bytes。
- WASM（若未來導入）獨立計算。

Phase 0 量到目前 chunk 後，再設定每個 chunk 的 regression budget（建議 current +10% headroom），不要先猜絕對大小。

這裡的「不得 preload」指 HTML/module preload 與不符合條件的 runtime request。一般可進 Writing 的 note 允許在 preview 後 conditional prefetch Writing chunk；明確 Source-only fixture 必須以 Playwright request log 證明沒有請求 WritingEditor/Milkdown chunk。`build-artifact.test.ts` 的 dynamic-import assertion 不能取代此 runtime assertion。

## 9.3 Interactive 後 idle preload

Writing interactive 後，可用 idle scheduling 預先載入常用次要 chunk：

- SourceEditor。
- Palette。

不要 preload Mermaid / Review / Mind Map 除非資料顯示切換延遲值得。

`requestIdleCallback` 必須有 Android/WebView 的 `setTimeout` fallback。

## 9.4 DOM / ProseMirror 大文件觀察

WASM 無法改善 ProseMirror DOM 建立成本。

Phase 0 若顯示 `milkdown_create_ms` 仍是壓倒性瓶頸：

1. 用 Chrome performance profile 拆分 parse / state create / DOM node create。
2. 確認 NodeView（task/callout/code）是否大量增加 layout。
3. 避免 mount 完成前同步 `querySelectorAll` 全 DOM 掃描。
4. 能延後的 deadline decoration / non-critical decoration 在 editor ready 後批次執行。
5. 不在沒有明確 benchmark 前自行 virtualization ProseMirror；這會提高 selection/IME/transaction 風險。

## 9.5 Phase 5 驗收

- [ ] Source-only fixture 不載入 Milkdown。
- [ ] 一般 Writing fixture 仍在 preview 後啟動 conditional prefetch，沒有重新引入序列 fetch waterfall。
- [ ] bridge shell budget 不退化。
- [ ] lazy chunk 有 bundle regression gate。
- [ ] idle preload 不影響 cold startup。
- [ ] 若 Milkdown DOM 為主要剩餘瓶頸，profile 報告明確標出比例。

---

# 10. Phase 6 — WebAssembly 導入 / 不導入決策

**優先級：P2。不是預設方案。**

只有完成 Phase 1~5、profiling 仍證明 scanner CPU 是主要瓶頸時才開始。

## 10.1 WASM 適用範圍

只評估純 CPU / pure function：

優先：

- `scanMarkdownStructure()`
- line/token scanner
- heading/task base index

暫不允許：

- Milkdown parser 替換。
- ProseMirror AST 替換。
- DOM renderer。
- Standard Notes bridge。

## 10.2 導入條件

同時滿足才導入：

1. Phase 5 後，500k/1m 的 scanner/analysis 仍佔可改善 CPU >=35%，或 Worker analysis p95 仍超出產品 budget。
2. WASM prototype（實作語言在 POC 前另行決定）在包含 module initialization、JS<->WASM copy/serialization 與 result materialization 後，500k/1m scanner end-to-end throughput 至少為 TS 的 **1.5x**。
3. 10k/100k 不退化 >5%，或只對 large-note threshold 啟用。
4. differential corpus 100% 相容。
5. Android WebView、Firefox、Chromium initialization 都可靠。

否則記錄為 **不導入，保留 TypeScript scanner**。若 Phase 5 profile 已顯示 scanner/analysis 不符合條件 1，可直接以該 profile 作不導入結論，不必為了完成 checklist 建立 WASM prototype。

## 10.3 WASM data boundary

禁止把大型 object graph 在 JS / WASM 之間反覆轉換。優先 compact `Uint32Array` / flags。

架構：

```text
Main Thread
  -> postMessage(markdown)
Worker
  -> WASM scanner
  -> compact result
  -> postMessage(result)
Main Thread
```

## 10.4 CSP

目前 editor 有明確 `connect-src` allowlist。

若 WASM 以 runtime fetch 載入：

- 先驗證 `connect-src 'self'` 是否必要。
- 若新增 `script-src`，只允許最小 WASM compilation capability，不得為了 WASM 放寬一般 eval。
- `tests/build-artifact.test.ts` 新增 CSP contract。
- Standard Notes Web / Desktop / Android 真實 host 都跑 E2E。

## 10.5 Fallback

WASM 初始化失敗時：

- fallback TypeScript scanner。
- 大文件 fallback 遵守 Phase 3 的 deferred 規則，不得在 input handler 同步執行。
- 不得讓 editor 無法開啟。
- 只記錄 capability failure，不記 note text。

---

# 11. Phase 7 — Performance CI / regression prevention

## 11.1 Deterministic CI gates

一般 PR 必跑：

- unit / integration。
- artifact size。
- scanner invocation count。
- complexity regression tests。
- Writing stability。

不要用 shared runner 易漂移的絕對毫秒作普通 required check。

Scanner/complexity required checks 使用 test-only deterministic operation counters（例如 physical lines visited、section/task candidate visits、full-scan count），不得用 production global mutable telemetry，也不得只靠 wall-clock。Production bundle 必須 tree-shake 或停用這些 counters。

## 11.2 Timing benchmark workflow

新增專用 workflow / 本機流程：

- base SHA benchmark。
- head SHA benchmark。
- 同 runner 連續執行。
- compare median/p95 ratio。
- 上傳 JSON artifact。

建議 gate：

| 指標 | Gate |
|---|---|
| 10k/100k TTI median | 不退化 >5% |
| 10k/100k p95 | 不退化 >10% |
| 500k/1m typing p95 | Performance PR 應改善，最終目標 >=30% |
| 500k/1m Writing TTI | 最終目標 >=20% |
| bridge shell | <100 KB |
| lazy chunks | 不超過建立後 budget |
| full scans / normal keypress | 0（Phase 4 後） |

Timing CI 連續兩次超 budget 才視為 regression，避免單次 runner noise。

「連續兩次」定義為同一 workflow、相同 base/head/environment 中執行兩個完整且獨立的 benchmark batch；兩個 batch 都超 budget 才失敗。不得依賴人工 rerun 或兩次不同 CI job。任何 batch 若被 environment/schema validation 判為 unstable，workflow 應回報 inconclusive 並保留 artifacts，不得算成通過。

## 11.3 PR performance evidence

任何 `perf(markdown-notes-plus)` PR 必附：

```text
Baseline SHA:
Head SHA:
Environment:
Fixture:
Metric:
Before median/p95:
After median/p95:
Delta:
Semantic tests:
Real-host tests:
```

不能只寫「感覺比較快」。

---

# 12. 測試矩陣

## 12.1 必跑 correctness

```sh
mise install
mise run deps
mise run typecheck
mise run lint
mise run test:unit
mise run test:integration
mise run test:artifacts
mise run test:e2e:writing
```

`mise run test:artifacts` 透過既有 task dependency 先 build，避免驗證 stale `dist`。Fresh checkout 先執行 `mise install` 與 `mise run deps`；後續 task 可依 Mise dependency cache 略過重複安裝。

Release / architecture boundary 變更：

```sh
mise run test:e2e:release
mise run test:e2e:standardnotes-web
```

Worker / CSP / WebView / input pipeline 變更：

```sh
mise run test:e2e:android-app
```

## 12.2 Performance

Phase 0 完成後：

```sh
mise run bench:perf
mise run bench:perf:compare -- --base <sha> --head <sha>
mise run test:e2e:perf
```

---

# 13. 建議實作順序與 commit 邊界

禁止一次把 Worker、scanner、WASM 全混在一起。

### Commit A — perf harness

- PerfTrace。
- fixture generator。
- benchmark JSON。
- long task / typing measurement。
- 不含 optimization；完成 baseline runs 後回填文件頂端的完整 baseline SHA。

### Commit B — shared scan context

- revision-scoped structure。
- normalization preflight reuse。
- scan-count tests。

### Commit C — linear task analysis

- itemEnd single-pass。
- complexity tests。

### Commit D — lazy movement / indexed section / Kanban

- movable facts on-demand。
- section binary search。
- opaque fenced range cursor/binary lookup。
- O(S+T) Kanban。
- non-Kanban 不建完整 model。

### Commit E — async projection Worker

- serializable analysis data。
- tokenized protocol。
- size-aware sync/deferred fallback。
- stale-action guard。

### Commit F — incremental Writing mutation proof

- WritingSafetyState。
- fast / bounded / full fallback。
- typing benchmark。

### Commit G — startup/bundle polish

- Source-only early preflight 與 Writing conditional prefetch。
- bundle budget。
- idle preload。
- DOM profile 驅動的 NodeView 改善。

### Commit H — optional WASM POC

只有導入條件 1 通過才存在；否則文件記錄不導入結論即可。

---

# 14. 完成定義（Definition of Done）

整個效能專案只有在以下全部完成才算完成：

- [ ] 有可重現 base/head benchmark，不靠主觀感受。
- [ ] 10k / 100k TTI median 不退化 >5%、p95 不退化 >10%。
- [ ] 500k / 1m Writing TTI 達成目標；若有 profile 證明不可移除的 DOM 主成本，benchmark report 必須記錄由維護者接受的替代指標名稱、baseline、目標值與理由後才能改用替代驗收。
- [ ] 500k / 1m typing p95 相較 baseline 改善 >=30%。
- [ ] 500k / 1m 載入 long task count 至少減少 50%，或具有第 1 節要求的 profile、替代數值門檻與維護者接受紀錄。
- [ ] 普通 Writing keypress 不做 full-document structure scan。
- [ ] dense tasks/headings/fences complexity 符合 Phase 2 的 2x input <=2.5x time 與 deterministic operation-counter 門檻。
- [ ] 非 Kanban mode 不計算完整 Kanban/movement model。
- [ ] large-note projection analysis 不阻塞 main thread。
- [ ] stale Worker result 無法修改 canonical。
- [ ] module-level normalization string cache 已移除，切換 note 不會因效能 cache 留存上一份 note text。
- [ ] bridge shell 仍 <100 KB。
- [ ] 明確 Source-only note 不請求 WritingEditor/Milkdown chunk；一般 Writing note 仍保有 preview 後 conditional prefetch。
- [ ] Writing stability / lossless / Source-only security boundary 無 semantic regression。
- [ ] Standard Notes Web real-host smoke 通過。
- [ ] Android WebView 路徑通過；若 capability 不支援 Worker/WASM，E2E 必須實際走過並驗證 size-aware fallback，而不只是文件描述。
- [ ] WASM 有明確導入/不導入 benchmark 結論，而不是因「理論上更快」導入。

---

# 15. Coding Agent 執行規則

1. **先跑 Phase 0 baseline，再改 code。**
2. 每個 optimization 前後都輸出同一 fixture 的 benchmark。
3. 一次只改一個主要變因，避免無法 attribution（歸因，無法判斷哪個改動帶來收益）。
4. 若 optimization 未達 benchmark 改善且增加複雜度，revert。
5. 所有 cache 必須綁 document revision/generation，禁止跨 note 隱式 reuse。
6. 所有 async/Worker response 都做 stale-token check。
7. 不以 debounce / artificial delay 隱藏主執行緒問題。
8. 不降低 Writing proof 強度換速度。
9. 不為 WASM 放寬不必要的 CSP。
10. 每一 Phase 完成後更新本文件 checklist 與實測數據，再進下一 Phase。
11. 所有 repository workflow 由 root `mise run ...` 執行；新增 benchmark workflow 時必須同步新增 `mise.toml` task。
12. 不得為了達成 p95 目標把 projection、proof 或 canonical commit 延遲到 benchmark 的量測終點之外；允許 coalesce 的只有明確標示可 stale 的 read-only projection。
