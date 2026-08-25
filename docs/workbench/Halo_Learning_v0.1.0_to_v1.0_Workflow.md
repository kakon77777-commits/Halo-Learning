# Halo Learning v0.1.0 → v1.0.0 Workbench Workflow

> Status: Proposed engineering release ladder derived from the canonical Halo Learning integrated baseline and the completed Basic MVP v0.1.0. Exact semantic-version mapping after v0.1.0 is a new execution plan, not wording copied from the original spec.

## Canonical invariants

- Local-first.
- Provider-agnostic core.
- English + Traditional Chinese first.
- Semantic state is separate from visual projection.
- Visual channels are user-configurable and reversible.
- Event-sourced learner evidence once introduced.
- Privacy-minimized and fail-closed on sensitive sites.
- Remote AI/NLP is optional progressive enhancement.
- v1.0 excludes billing/subscription, mobile native, teacher backend, cloud sync, and own-model training unless a new ADR explicitly changes scope.

## Release ladder

| Version | Stage | Objective | Gate | Status |
|---|---|---|---|---|
| v0.1.0 | Basic Marking RC | 建立可安裝的中／英文基本標記 MVP：SemanticToken → MarkingProfile → RenderToken → 可逆 DOM overlay。 | 16/16 tests；MV3；local-only；可逆標記；基本中英 POS；可配置 label/color/density。 | Complete |
| v0.2.0 | Lexical Data Layer | 把中／英文開源字典與詞彙資料變成可驗證、可替換、可離線索引的資料供應層。 | 至少各一個 EN/ZH corpus importer；license/provenance/sha256 完整；核心仍可無 corpus 啟動。 | Complete |
| v0.3.0 | Semantic Annotation Engine | 把 POS 擴成可配置的語意附加層：lemma、morphology、grammar role、chunk、tense/aspect、gloss refs 等，但 renderer 仍只投影使用者選擇的 channels。 | SemanticAnnotation contract 穩定；簡化 POS fixture macro-F1 ≥ 0.90；所有 channel 都可獨立關閉。 | Not Started |
| v0.4.0 | Browser Runtime & UX | 把 Basic renderer 升成可在真實網站長時間使用的低干擾瀏覽器 runtime。 | 20 類 fixture sites E2E；動態 DOM/SPA 可重掃；敏感網站封鎖；performance budget 達標。 | Not Started |
| v0.5.0 | Local Data & Event Store | 加入 local-first IndexedDB、append-only learning events、可匯出/刪除/重建的資料基礎。 | 事件不可原地 update；projection 可重播；JSON/JSONL export/delete-by-scope 完整。 | Not Started |
| v0.6.0 | Learner Model & Adaptive Scaffolding | 把事件轉成可重算 mastery/confidence，並控制標記密度、觸發門檻、transfer probe 與 gap planning。 | mastery/confidence 分離；同 event log 重建一致；低信心不過度降低支架。 | Not Started |
| v0.7.0 | Halo Story Basic | 加入受控敘事補盲：GapPlan → StorySpec → provider/template → validation → story events。 | target coverage ≥0.80；provider 失敗有 deterministic fallback；story events 回寫同一 event contract。 | Not Started |
| v0.8.0 | Cross-Surface & Optional AI Assist | 完成 Magic Hand ↔ Learner Model ↔ Gap Planner ↔ Halo Story 閉環，並加入可選高精度 NLP／解釋 provider，但保持本機 fallback。 | 完整閉環 E2E；remote failure 不讓核心功能失效；遠端只傳必要片段且有 request log。 | Not Started |
| v0.9.0 | Productization & Hardening | 把功能完整的 Halo Learning 收斂成可公開發佈的 RC：安全、效能、可用性、授權、遷移、打包全部固定。 | security/privacy/performance/a11y/browser E2E/upgrade migration/reproducible build 全綠。 | Not Started |
| v1.0.0 | Stable Product Release | 凍結第一代 Halo Learning 穩定產品邊界與可交接工程基線，完成全規格 acceptance 與 release evidence。 | 所有 v1.0 blocking acceptance gate 通過；contracts/schema/migrations/release artifact/documentation freeze。 | Not Started |

## Detailed worksheets

### v0.1.0 — Basic Marking RC

**Objective:** 建立可安裝的中／英文基本標記 MVP：SemanticToken → MarkingProfile → RenderToken → 可逆 DOM overlay。

**Depends:** Halo Learning Integrated Baseline v0.1

**Release gate:** 16/16 tests；MV3；local-only；可逆標記；基本中英 POS；可配置 label/color/density。

| Task ID | Workstream | Task | Owner | Priority | Dependencies | Acceptance Evidence | Test/Gate | Deliverable | Status |
|---|---|---|---|---|---|---|---|---|---|
| V010-01 | Semantic Core | 建立英／中 SemanticToken baseline 與保守 POS 分析 | Workbench | P0 | — | 英／中 token 可產生 pos/confidence/source/priority | node --test tests/linguistics.test.js | apps/extension/src/shared/linguistics.js | Complete |
| V010-02 | Dictionary Contract | 建立 DictionaryProvider seam，不綁第三方 corpus | Workbench | P0 | V010-01 | provider.lookup(surface, lang) 契約固定 | node --test tests/linguistics.test.js | dictionary-provider.js | Complete |
| V010-03 | Projection | POS label / color / density / language / label position 分離 | Workbench | P0 | V010-01 | 同 semantic token 可投影為不同 visual channels | node --test tests/projection.test.js | projection.js + settings.js | Complete |
| V010-04 | DOM Renderer | 可逆標記；跳過 editable/code/script/style；節點與 token budget | Workbench | P0 | V010-03 | Remove 後原文恢復 | node --test tests/source-contract.test.js | content.js + content.css | Complete |
| V010-05 | Extension UI | MV3 popup、Apply/Remove、本機設定 | Workbench | P0 | V010-03,V010-04 | activeTab+scripting+storage；無 host permission | node --test tests/*.test.js | manifest + popup | Complete |
| V010-06 | Release | 打包 extension ZIP 與 validation report | Workbench | P0 | V010-01..05 | manifest 位於 ZIP root；release bundle 可交接 | full release validation | dist + docs | Complete |

### v0.2.0 — Lexical Data Layer

**Objective:** 把中／英文開源字典與詞彙資料變成可驗證、可替換、可離線索引的資料供應層。

**Depends:** v0.1.0

**Release gate:** 至少各一個 EN/ZH corpus importer；license/provenance/sha256 完整；核心仍可無 corpus 啟動。

| Task ID | Workstream | Task | Owner | Priority | Dependencies | Acceptance Evidence | Test/Gate | Deliverable | Status |
|---|---|---|---|---|---|---|---|---|---|
| V020-01 | Contracts | 定義 DatasetManifest、LicenseRecord、LexicalEntry、CorpusBuildReceipt | Workbench | P0 | v0.1.0 | schemaVersion/source/license/version/hash/locale 欄位固定 | schema round-trip tests | packages/contracts or shared/contracts | Complete |
| V020-02 | Corpus Research | 選擇至少一個英文與一個繁中相容開源資料來源並驗證授權 | Workbench | P0 | V020-01 | 來源、版本、授權、redistribution 條件有書面紀錄 | license/provenance review | docs/data-sources/ | Complete |
| V020-03 | EN Importer | 建立英文 corpus importer → normalized LexicalEntry | Workbench | P0 | V020-01,V020-02 | 固定 fixture 可重建相同 lexical index | importer fixture tests | packages/lexical-data/en/ | Complete |
| V020-04 | ZH Importer | 建立繁中 corpus importer；簡繁來源若使用轉換須保留 provenance | Workbench | P0 | V020-01,V020-02 | longest-match 可查詞、詞性、lemma/gloss refs | importer fixture tests | packages/lexical-data/zh/ | Complete |
| V020-05 | Index | 建立 compact local lexical index 與 dictionary registry | Workbench | P0 | V020-03,V020-04 | lookup p95 與 memory budget 符合 release budget | index benchmark | packages/lexical-index/ | Complete |
| V020-06 | Fallback | 保持 bootstrap/basic provider；corpus 缺失或損壞時 fail-soft | Workbench | P1 | V020-05 | 無 corpus 時 v0.1 功能仍可用 | fallback tests | dictionary registry | Complete |
| V020-07 | Reproducibility | corpus build 產生 hash、source manifest、third-party notices | Workbench | P0 | V020-03..05 | 相同輸入產生相同 index hash | rebuild verification | dist/data-manifest.json | Complete |
| V020-08 | Release Gate | 更新 docs/tests/package；不把未驗證 corpus 偷塞進核心 | Workbench | P0 | V020-01..07 | 完整授權與資料 provenance gate 通過 | full suite + data build | v0.2.0 release | Complete |

Release evidence: `docs/VALIDATION_REPORT_v0.2.0.md`, `docs/releases/v0.2.0-task-evidence.yaml`, and `node scripts/validate-v0.2.0.js`. Only synthetic format fixtures are bundled; full upstream corpora remain user-acquired local inputs.

### v0.3.0 — Semantic Annotation Engine

**Objective:** 把 POS 擴成可配置的語意附加層：lemma、morphology、grammar role、chunk、tense/aspect、gloss refs 等，但 renderer 仍只投影使用者選擇的 channels。

**Depends:** v0.2.0

**Release gate:** SemanticAnnotation contract 穩定；簡化 POS fixture macro-F1 ≥ 0.90；所有 channel 都可獨立關閉。

| Task ID | Workstream | Task | Owner | Priority | Dependencies | Acceptance Evidence | Test/Gate | Deliverable | Status |
|---|---|---|---|---|---|---|---|---|---|
| V030-01 | Contracts | 擴充 SemanticToken/AnnotationSet；新增 annotation provenance/confidence | Workbench | P0 | v0.2.0 | 舊 v0.1 token 可 migration/normalize | contract compatibility tests | shared/contracts | Not Started |
| V030-02 | English NLP | 英文 lemma + morphology + simplified POS baseline | Workbench | P0 | V030-01,V020 index | fixture 可重現；未知詞不強猜 | EN NLP fixtures | nlp/en | Not Started |
| V030-03 | Chinese NLP | 繁中 segmentation + simplified POS + lexical refs | Workbench | P0 | V030-01,V020 index | 詞界與 POS 可追溯 provider/version | ZH NLP fixtures | nlp/zh | Not Started |
| V030-04 | Grammar Layer | 加入 chunk、predicate/core role、tense/aspect 的 bounded baseline | Workbench | P1 | V030-02,V030-03 | 語法 annotation 可缺省、不可假裝確定 | grammar fixture tests | semantic-annotations | Not Started |
| V030-05 | Visual Profiles | 新增 POS/role/tense/gloss/chunk 等 channel toggle；位置與密度可設 | Workbench | P0 | V030-01,V030-04 | 每個 channel 可獨立 on/off；顏色不是唯一 carrier | projection tests | marking-engine | Not Started |
| V030-06 | Profile Migration | v0.1 settings → v0.3 MarkingProfile migration | Workbench | P1 | V030-05 | 既有使用者設定不丟失 | migration tests | settings migrations | Not Started |
| V030-07 | Quality Corpus | 建立中英標註 fixture 與 metrics harness | Workbench | P0 | V030-02,V030-03 | simplified POS macro-F1 ≥ 0.90（只對規格標籤） | metrics command | fixtures/sentences | Not Started |
| V030-08 | Release Gate | 驗證 semantic truth 與 renderer projection 無反向污染 | Workbench | P0 | V030-01..07 | 關閉所有 channel 時原文零語義 UI 污染 | full suite | v0.3.0 release | Not Started |

### v0.4.0 — Browser Runtime & UX

**Objective:** 把 Basic renderer 升成可在真實網站長時間使用的低干擾瀏覽器 runtime。

**Depends:** v0.3.0

**Release gate:** 20 類 fixture sites E2E；動態 DOM/SPA 可重掃；敏感網站封鎖；performance budget 達標。

| Task ID | Workstream | Task | Owner | Priority | Dependencies | Acceptance Evidence | Test/Gate | Deliverable | Status |
|---|---|---|---|---|---|---|---|---|---|
| V040-01 | Sentence Pipeline | Visible DOM → text runs → sentence → DOM Range mapping | Workbench | P0 | v0.3.0 | 句子 offset 與 DOM range 不錯位 | DOM mapping tests | sentence-pipeline | Not Started |
| V040-02 | Viewport | IntersectionObserver 只處理 viewport 附近 | Workbench | P0 | V040-01 | 不全頁 eager scan | browser perf test | content runtime | Not Started |
| V040-03 | Dynamic DOM | MutationObserver + debounce + SPA route handling | Workbench | P0 | V040-01 | 新增內容可增量標記；不重複包裹 | dynamic DOM E2E | content runtime | Not Started |
| V040-04 | CSS Isolation | Shadow DOM 或嚴格 namespace；render/remove/reapply idempotent | Workbench | P0 | V040-01 | 20 fixture sites 無 critical breakage | visual regression/E2E | ui renderer | Not Started |
| V040-05 | Trigger | adaptive-hover + explicit-only + hybrid；Esc/外部點擊關閉 | Workbench | P0 | V040-01 | 狀態機可測且不靠 hover 唯一路徑 | state-machine tests | trigger-controller | Not Started |
| V040-06 | Site Policy | 本站開關、optional host permissions、denylist/sensitive-site blocking | Workbench | P0 | V040-03 | 敏感 fixture 不分析、不存、不遠端 | privacy E2E | privacy-guard | Not Started |
| V040-07 | Accessibility | 鍵盤、ARIA、對比、動畫關閉；顏色有文字/形狀替代 | Workbench | P1 | V040-04,V040-05 | 核心操作不用滑鼠也能完成 | a11y tests | ui | Not Started |
| V040-08 | Performance | worker/cache/node lifecycle；p95 budget | Workbench | P0 | V040-01..03 | local analysis p95<300ms/句；long task<50ms | performance harness | runtime | Not Started |
| V040-09 | Fixture E2E | 新聞、技術、SPA、無限捲動、nested spans、code-heavy、多語等 ≥20 fixtures | Workbench | P0 | V040-01..08 | 無 critical DOM breakage | browser E2E suite | tests/e2e | Not Started |
| V040-10 | Release Gate | 真實 Chrome/Chromium smoke + clean remove + memory release | Workbench | P0 | V040-01..09 | 瀏覽器 release gate 全綠 | full browser suite | v0.4.0 release | Not Started |

### v0.5.0 — Local Data & Event Store

**Objective:** 加入 local-first IndexedDB、append-only learning events、可匯出/刪除/重建的資料基礎。

**Depends:** v0.4.0

**Release gate:** 事件不可原地 update；projection 可重播；JSON/JSONL export/delete-by-scope 完整。

| Task ID | Workstream | Task | Owner | Priority | Dependencies | Acceptance Evidence | Test/Gate | Deliverable | Status |
|---|---|---|---|---|---|---|---|---|---|
| V050-01 | Schema | 建立 IndexedDB stores: profiles/sources/sentences/analyses/events/settings/cache/migrations | Workbench | P0 | v0.4.0 | schema version + migration registry | migration tests | storage | Not Started |
| V050-02 | Event Store | append-only LearningEvent API + idempotent event ID | Workbench | P0 | V050-01 | event 不提供 update；重送不重複 | event-store tests | event-store | Not Started |
| V050-03 | Capture Policy | 只依 saveSentenceText/privacyClass 保存必要句子 | Workbench | P0 | V050-01,V040 site policy | visible-only 默認不存完整原文 | privacy tests | capture layer | Not Started |
| V050-04 | Analysis Cache | textHash+contextHash+algorithmVersion cache + TTL | Workbench | P1 | V050-01 | algorithm 升版不誤讀舊 cache | cache tests | storage/cache | Not Started |
| V050-05 | Export | JSON/JSONL export with schema/provenance | Workbench | P0 | V050-01,V050-02 | 匯出後可在空 DB 重建 | round-trip tests | export | Not Started |
| V050-06 | Delete | 按網站/日期/全部 scope 刪除；保留可解釋 audit result | Workbench | P0 | V050-01 | 刪除後查不到對應資料 | delete tests | data controls | Not Started |
| V050-07 | Replay | event replay / projection seed hook | Workbench | P0 | V050-02 | 同事件序列 deterministic | replay tests | event projector seam | Not Started |
| V050-08 | Options UI | 資料檢查、匯出、刪除、演算法版本資訊 | Workbench | P1 | V050-05,V050-06 | 使用者看得到本機保存內容 | browser E2E | options page | Not Started |
| V050-09 | Release Gate | migration interruption/quota/duplicate event failure injection | Workbench | P0 | V050-01..08 | failure injection 無資料靜默損失 | failure suite | v0.5.0 release | Not Started |

### v0.6.0 — Learner Model & Adaptive Scaffolding

**Objective:** 把事件轉成可重算 mastery/confidence，並控制標記密度、觸發門檻、transfer probe 與 gap planning。

**Depends:** v0.5.0

**Release gate:** mastery/confidence 分離；同 event log 重建一致；低信心不過度降低支架。

| Task ID | Workstream | Task | Owner | Priority | Dependencies | Acceptance Evidence | Test/Gate | Deliverable | Status |
|---|---|---|---|---|---|---|---|---|---|
| V060-01 | Evidence Rules | 固定 LearningEvent → evidence direction/weight table | Workbench | P0 | v0.5.0 | 未展開不直接判掌握 | evidence tests | learner-model | Not Started |
| V060-02 | Mastery | Beta posterior alpha/beta mastery projection | Workbench | P0 | V060-01 | 增量與 replay 結果一致 | projector tests | learner-model | Not Started |
| V060-03 | Confidence | confidence 與 mastery 分離；有效證據量控制 | Workbench | P0 | V060-02 | 少量資料不宣告 mastered | confidence tests | learner-model | Not Started |
| V060-04 | Adaptive Density | rho(level, complexity, target, mastery) 轉 MarkingProfile | Workbench | P0 | V060-02,V030 profile | 支架可逐步淡出且有下界 | density tests | marking-engine | Not Started |
| V060-05 | Adaptive Trigger | hover threshold bounded update | Workbench | P1 | V040 trigger,V060-01 | 門檻 1000..5000ms；更新幅度有限 | trigger adaptation tests | trigger-controller | Not Started |
| V060-06 | Transfer Probe | 真實頁低支架 probe + result event | Workbench | P0 | V060-02,V040 runtime | probe 不變成強制考試 | E2E + event tests | transfer | Not Started |
| V060-07 | Gap Planner | (1-m)*confidence*importance*scarcity*recency 排 priority | Workbench | P0 | V060-02,V060-03 | 每個 target 有 rationale/evidence refs | gap tests | gap-planner | Not Started |
| V060-08 | Rebuild | 一鍵 rebuild mastery/gaps from event log | Workbench | P0 | V060-02,V060-07 | clean DB replay equivalence | rebuild tests | options/core | Not Started |
| V060-09 | Release Gate | 跨場景：reading events → mastery → density/gap | Workbench | P0 | V060-01..08 | 完整 local learning loop E2E | E2E | v0.6.0 release | Not Started |

### v0.7.0 — Halo Story Basic

**Objective:** 加入受控敘事補盲：GapPlan → StorySpec → provider/template → validation → story events。

**Depends:** v0.6.0

**Release gate:** target coverage ≥0.80；provider 失敗有 deterministic fallback；story events 回寫同一 event contract。

| Task ID | Workstream | Task | Owner | Priority | Dependencies | Acceptance Evidence | Test/Gate | Deliverable | Status |
|---|---|---|---|---|---|---|---|---|---|
| V070-01 | Contracts | StorySpec/GeneratedStoryDraft/StorySession contracts | Workbench | P0 | v0.6.0 | schema version/provenance 完整 | schema tests | story-engine/contracts | Not Started |
| V070-02 | Orchestrator | GapPlan → StorySpec；不直接拼 prompt 當 domain truth | Workbench | P0 | V070-01,V060 gap | target/difficulty/genre 可審查 | orchestrator tests | story-engine | Not Started |
| V070-03 | Offline Provider | mock/template provider，完全離線也能走故事流程 | Workbench | P0 | V070-01 | 無 API key 時可 demo | provider tests | provider-adapters | Not Started |
| V070-04 | Generation Adapter | TextGenerationProvider 抽象 + optional remote skeleton | Workbench | P1 | V070-01 | 核心不 import 單一模型 SDK | contract tests | provider-adapters | Not Started |
| V070-05 | Validator | target grammar/vocab coverage + difficulty + format + continuity checks | Workbench | P0 | V070-02 | coverage 可計算；失敗不偽裝成功 | validator tests | story validator | Not Started |
| V070-06 | Retry/Fallback | 一次 targeted retry → template fallback → partial disclosure | Workbench | P0 | V070-05 | 所有失敗寫 job log | failure tests | story-engine | Not Started |
| V070-07 | Story Web UI | setup/reader/choice/chapter review/gap review/settings | Workbench | P0 | V070-01..06 | 故事可完成；學習 panel 可淡出 | browser E2E | apps/story-web | Not Started |
| V070-08 | Shared Marking | Story reader 重用同 SemanticAnnotation + MarkingProfile | Workbench | P0 | V030,V070-07 | 不建立第二套 marking semantics | integration tests | shared ui | Not Started |
| V070-09 | Events | story choice/chapter/comprehension events 寫入 v0.5 event store | Workbench | P0 | V050,V070-07 | 共享 event contract | event tests | story integration | Not Started |
| V070-10 | Release Gate | GapPlan → Story → validation → events E2E | Workbench | P0 | V070-01..09 | target coverage gate ≥0.80 | full story E2E | v0.7.0 release | Not Started |

### v0.8.0 — Cross-Surface & Optional AI Assist

**Objective:** 完成 Magic Hand ↔ Learner Model ↔ Gap Planner ↔ Halo Story 閉環，並加入可選高精度 NLP／解釋 provider，但保持本機 fallback。

**Depends:** v0.7.0

**Release gate:** 完整閉環 E2E；remote failure 不讓核心功能失效；遠端只傳必要片段且有 request log。

| Task ID | Workstream | Task | Owner | Priority | Dependencies | Acceptance Evidence | Test/Gate | Deliverable | Status |
|---|---|---|---|---|---|---|---|---|---|
| V080-01 | Cross-Surface Bus | extension/story 共用 commands/events/contracts | Workbench | P0 | v0.7.0 | 不存在兩套 learner profile/event semantics | integration tests | shared core | Not Started |
| V080-02 | Closed Loop | wild reading → mastery → gap → story → mastery → extension density | Workbench | P0 | V080-01 | 完整閉環可重播 | E2E | integration | Not Started |
| V080-03 | Explanation Provider | ExplanationProvider optional adapter + local basic fallback | Workbench | P1 | V030 semantic | 使用者主動 open 才可遠端 | provider tests | provider-adapters | Not Started |
| V080-04 | High Precision NLP | RemoteHighPrecisionNLPProvider optional adapter | Workbench | P1 | V030,V020 | remote output 帶 provider/model/version/confidence | adapter tests | provider-adapters | Not Started |
| V080-05 | Privacy Redaction | 只傳句子/必要上下文；移除 query/account/email/token/form values | Workbench | P0 | V080-03,V080-04 | 敏感 fixture 0 remote request | privacy regression | privacy-guard | Not Started |
| V080-06 | Request Log | 使用者可查看最近遠端請求 metadata，不保存多餘內容 | Workbench | P1 | V080-05 | 可審查何時/為何呼叫 remote | UI + storage tests | options | Not Started |
| V080-07 | Progressive Enhancement | local 標記先顯示，remote 結果後補；timeout/rate-limit fail-soft | Workbench | P0 | V080-03,V080-04 | remote failure 核心閱讀仍正常 | failure E2E | runtime | Not Started |
| V080-08 | Shared Profiles | 語意 channel/profile 在 extension/story 同步語義但各 surface 可有 density preset | Workbench | P1 | V030,V070 | profile migration deterministic | integration tests | marking profiles | Not Started |
| V080-09 | Release Gate | closed-loop + remote-offline/timeout/rate-limit failure injection | Workbench | P0 | V080-01..08 | 所有核心路徑可在 remote disabled 下運行 | full suite | v0.8.0 release | Not Started |

### v0.9.0 — Productization & Hardening

**Objective:** 把功能完整的 Halo Learning 收斂成可公開發佈的 RC：安全、效能、可用性、授權、遷移、打包全部固定。

**Depends:** v0.8.0

**Release gate:** security/privacy/performance/a11y/browser E2E/upgrade migration/reproducible build 全綠。

| Task ID | Workstream | Task | Owner | Priority | Dependencies | Acceptance Evidence | Test/Gate | Deliverable | Status |
|---|---|---|---|---|---|---|---|---|---|
| V090-01 | Security | threat model、permission audit、AI output sanitize、CSP/no remote code | Workbench | P0 | v0.8.0 | 無 secret in content script；模型 HTML 不可執行 | security suite | docs/security + runtime | Not Started |
| V090-02 | Privacy | data map、denylist、remote log、delete/export regression | Workbench | P0 | V090-01 | 敏感 fixture 無 remote/data capture | privacy suite | docs/privacy | Not Started |
| V090-03 | Licenses | 字典/corpus/library third-party notices 與 redistribution package review | Workbench | P0 | v0.2.0 | release 包授權鏈完整 | license audit | THIRD_PARTY_NOTICES | Not Started |
| V090-04 | Browser Matrix | Chrome/Chromium targeted matrix + ≥20 fixture types | Workbench | P0 | v0.4.0 | 無 critical DOM breakage | browser E2E | tests/e2e | Not Started |
| V090-05 | Performance | p95、memory release、long-task、cache/index budget | Workbench | P0 | V090-04 | Spec §17 budgets 達標 | perf report | docs/performance | Not Started |
| V090-06 | Accessibility | keyboard/ARIA/contrast/reduced motion/readability audit | Workbench | P1 | v0.4.0 | 核心路徑符合既定 a11y gate | a11y suite | UI | Not Started |
| V090-07 | Upgrade | v0.1→v0.9 settings/data migrations + export/import recovery | Workbench | P0 | v0.5 migrations | upgrade 不丟資料/設定 | migration E2E | migrations | Not Started |
| V090-08 | Diagnostics | 本機 diagnostics/health report；不加入 analytics by default | Workbench | P1 | V090-01..07 | debug 可定位而不蒐集使用者內容 | diagnostic tests | diagnostics | Not Started |
| V090-09 | Store Assets | README、privacy、screenshots、listing copy、reviewer notes | Workbench | P1 | V090-01..08 | 公開材料與實際權限一致 | manual release review | docs/store | Not Started |
| V090-10 | Reproducible Build | clean checkout → install/build/test/package；hash receipt | Workbench | P0 | V090-01..09 | 兩次 clean build artifact hash 可比較/解釋 | release script | dist | Not Started |
| V090-11 | RC Gate | 產出 v0.9.0 release candidate 與完整 validation dossier | Workbench | P0 | V090-01..10 | 所有 blocking gate 綠 | full release validation | v0.9.0 RC | Not Started |

### v1.0.0 — Stable Product Release

**Objective:** 凍結第一代 Halo Learning 穩定產品邊界與可交接工程基線，完成全規格 acceptance 與 release evidence。

**Depends:** v0.9.0

**Release gate:** 所有 v1.0 blocking acceptance gate 通過；contracts/schema/migrations/release artifact/documentation freeze。

| Task ID | Workstream | Task | Owner | Priority | Dependencies | Acceptance Evidence | Test/Gate | Deliverable | Status |
|---|---|---|---|---|---|---|---|---|---|
| V100-01 | Contract Freeze | 凍結 v1 contracts/events/settings/profiles/provider interfaces | Workbench | P0 | v0.9.0 | breaking change 必須 ADR/version bump | contract suite | docs/contracts | Not Started |
| V100-02 | Schema Freeze | IndexedDB schema/migrations/export format v1 | Workbench | P0 | V100-01 | clean install + upgrade + rebuild | migration suite | storage | Not Started |
| V100-03 | Acceptance Matrix | 逐條映射 canonical spec §18/19 gate → tests/evidence | Workbench | P0 | V100-01,V100-02 | 無未指派 blocking requirement | acceptance audit | docs/ACCEPTANCE_MATRIX.md | Not Started |
| V100-04 | POS Quality Gate | simplified POS annotated fixture macro-F1 ≥0.90 | Workbench | P0 | v0.3.0 | 報告 corpus/version/metric | quality harness | docs/quality | Not Started |
| V100-05 | Story Gate | target coverage ≥0.80 + deterministic fallback | Workbench | P0 | v0.7.0 | 不把 coverage 當 learning efficacy | story validation | docs/story-quality | Not Started |
| V100-06 | Closed Loop Gate | reading → events → mastery → gap → story → events → density | Workbench | P0 | v0.8.0 | 完整閉環 E2E PASS | cross-surface E2E | tests/e2e | Not Started |
| V100-07 | Privacy Gate | local default/export/delete/api-key boundary/remote log/sensitive blocking | Workbench | P0 | v0.9.0 | 所有 privacy acceptance true | privacy regression | docs/privacy | Not Started |
| V100-08 | Browser Gate | ≥20 fixture sites + no critical DOM breakage | Workbench | P0 | v0.9.0 | browser E2E 全綠 | browser suite | tests/e2e | Not Started |
| V100-09 | Performance/A11y Gate | Spec §17 + accessibility gate | Workbench | P0 | v0.9.0 | performance budget + keyboard/a11y PASS | perf+a11y suite | validation | Not Started |
| V100-10 | Release Artifact | reproducible extension + story web build + source bundle + hashes | Workbench | P0 | V100-01..09 | manifest/metadata/version 一致 | clean release build | dist/v1.0.0 | Not Started |
| V100-11 | Documentation/Handoff | README、architecture、data map、privacy、developer guide、release notes、agent handoff | Workbench | P0 | V100-01..10 | 新 Agent 只讀文件可啟動並跑測試 | handoff smoke | docs | Not Started |
| V100-12 | Stable Sign-off | git clean；full test normal exit 0；freeze tag/release note | Workbench | P0 | V100-01..11 | v1.0.0 VALIDATED；不隱藏 known limits | full release gate | v1.0.0 | Not Started |

## Explicitly deferred beyond v1.0

| Capability | Status | Reason |
|---|---|---|
| Cloud sync / login | Deferred beyond v1.0 | Canonical Phase 2 item; not required for first stable product. |
| TTS / pronunciation tracking | Deferred beyond v1.0 | Canonical Phase 2 item. |
| EPUB / PDF overlay | Deferred beyond v1.0 | PDF overlay explicitly excluded from MVP; EPUB/PDF import later. |
| Mobile / tablet native app | Deferred beyond v1.0 | Canonical Phase 3 item. |
| Teacher / researcher backend | Deferred beyond v1.0 | Explicit MVP non-goal / Phase 3. |
| Multilingual beyond EN + Traditional Chinese | Deferred beyond v1.0 | v1 roadmap keeps EN/ZH first; later phase can generalize. |
| Own local small model | Deferred beyond v1.0 | Canonical Phase 3 item. |
| Billing / subscription | Excluded from this roadmap | Canonical MVP explicitly excludes payment/subscription; add only via later ADR/product decision. |

## Workbench master prompt

See `WORKBENCH_MASTER_PROMPT.txt`.
