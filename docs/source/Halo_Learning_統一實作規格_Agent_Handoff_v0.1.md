# Halo Learning 統一實作規格

## 魔法之手 × 標記英文 × 互動敘事引擎

**文件類型：** Product Requirements Document + Technical Design + Agent Handoff  
**版本：** v0.1 Integrated Implementation Baseline  
**作者：** Neo.K  
**整合日期：** 2026-07-12  
**文件地位：** 本文件是後續實作的單一主要規格來源（single source of truth）。四份原始文件保留作為理論、設計動機與歷史方案參考；若實作細節與原始文件衝突，以本文件為準。

---

# 0. 執行摘要

Halo Learning 不是四個彼此獨立的產品，而是一套由「真實環境學習」與「受控敘事補盲」共同構成的雙軌語言學習系統。

統一後的產品層級如下：

| 名稱 | 系統地位 | 核心職責 |
|---|---|---|
| **Halo Learning** | 總系統／產品家族 | 統一學習者模型、事件資料、標記協議與跨場景調度 |
| **魔法之手（Magic Hand）** | 環境化學習介面 | 在真實網頁中偵測英文句子，以低干擾方式提供標記、提示、解釋與行為紀錄 |
| **Halo Story** | 受控互動敘事介面 | 根據學習者盲點生成故事、選擇與受控暴露，補足野生閱讀無法保證的詞彙與語法覆蓋 |
| **標記英文（Marking English）** | 共用表示協議／教學方法 | 將詞性、語法結構與難點轉為可漸進顯示的視覺認知地圖 |
| **Halo Learning Core** | 共用技術核心 | NLP、標記引擎、學習者模型、事件儲存、缺口規劃、內容供應商介面 |

核心閉環是：

```text
真實閱讀遭遇
    ↓
魔法之手記錄困難、查詢與遷移表現
    ↓
共用學習者模型更新掌握度與信心
    ↓
缺口規劃器找出重要但暴露不足的詞彙／語法
    ↓
Halo Story 生成受控敘事進行補盲與練習
    ↓
新掌握度回寫魔法之手
    ↓
在真實閱讀中降低支架、測試遷移
```

本文件做出七項實作級決策：

1. **以 Halo Learning 為總系統，禁止再把魔法之手、標記英文與故事生成器拆成互不相容的資料孤島。**
2. **MVP 採 local-first。** 所有核心學習資料預設保存在本機 IndexedDB；雲端同步不是首版必要條件。
3. **瀏覽器擴充功能是第一主要介面，故事 Web App 是第二主要介面；兩者共享同一套 contracts、storage、learner model 與 marking engine。**
4. **AI／LLM 與 NLP 供應商必須透過 adapter 接入。** 不把 Gemini、OpenAI、spaCy 或任何單一服務寫死在核心領域模型中。
5. **採事件驅動學習者模型。** 原始互動先記錄為不可變事件，再由投影器計算掌握度；避免只保存一個無法追溯的分數。
6. **敘事吸引力可以保留，但外在遊戲化預設關閉。** 不以積分、排行榜、連續登入或黏著時間取代學習成效。
7. **舊文件中的效率提升百分比、母語化時數、留存率與市場預測全部視為待驗證假說，不列入工程驗收。**

---

# 1. 文件整合範圍與衝突裁決

## 1.1 四份原始文件的角色

| 原始文件 | 保留的主要價值 | 在本規格中的位置 |
|---|---|---|
| 《魔法之手：環境化語言學習系統的交互邏輯與理論架構》 | 延遲觸發、漸進揭示、瀏覽器環境、野生學習、跨平台與 NLP 延遲設計 | 互動模型、擴充功能架構、效能與隱私 |
| 《設計動機論：為什麼魔法之手必須是環境化而非產品化的學習系統》 | 學習即使用、降低情境切換、雙軌補盲、反產品化哲學 | 產品原則、非目標、雙軌閉環 |
| 《標記英文整合故事生成系統：概念產品白皮書》 | 標記方法、自適應密度、故事生成、學習追蹤與認知分層 | 標記協議、缺口規劃、故事引擎 |
| 《Halo Learning：互動敘事語言學習引擎技術整合設計文檔》 | 既有 React／TypeScript 技術雛形、資料模型、API、測試與部署想法 | Repo 結構、共享模組、Web App 與 API 基線 |

## 1.2 已裁決的主要衝突

### 衝突 A：環境化工具或封閉產品

裁決：**Halo Learning 是平台核心，但魔法之手必須保持環境化；Halo Story 只是補盲介面，不得反過來要求所有學習都回到產品內部。**

### 衝突 B：無遊戲化或重度遊戲化

裁決：

- 允許故事、角色、選擇、懸念與敘事進度。
- 不在 MVP 使用積分、排行榜、連續登入懲罰、抽卡、能量值或強制每日任務。
- 後續若加入成就，只能作為可關閉的學習回顧，不得成為核心動機機制。

### 衝突 C：固定模型供應商

裁決：**所有生成與解釋服務都使用 provider adapter。** 核心套件只能依賴抽象介面，例如 `TextGenerationProvider`、`ExplanationProvider`、`NLPProvider`，不得直接依賴特定模型 SDK。

### 衝突 D：純前端或後端服務

裁決：採三層能力模式：

| 模式 | 能力 | 隱私／成本 |
|---|---|---|
| Local Basic | 瀏覽器內句子分割、簡化 POS、標記、事件紀錄 | 預設；不傳送頁面內容 |
| Remote Assist | 單句解釋、故事生成、進階語義分析 | 使用者明確啟用；只傳送必要片段 |
| High Precision | 伺服器 NLP、同步、進階模型 | 後續可選；不屬於首版必要條件 |

### 衝突 E：掌握度由單一公式直接覆寫

裁決：改為**事件來源 + 可重算投影**。任何 mastery score 都必須能追溯到哪些觀測事件、使用了哪個算法版本以及信心有多高。

---

# 2. 產品原則

## 2.1 核心原則

1. **學習發生在使用之中。** 使用者正在讀的內容優先於系統預設課程。
2. **支架必須逐步淡出。** 系統的成功不是讓使用者查得更多，而是讓同類結構逐漸不必查。
3. **保留期望困難。** 不立即翻譯整句，不把所有資訊一次攤開，不替使用者消除所有推理。
4. **最小干擾。** 預設沉默，只在使用者停留、選取、快捷鍵或主動點擊時介入。
5. **使用者保有元控制權。** 標記密度、觸發方式、資料保存、遠端模型、網站權限均可調整。
6. **資料屬於使用者。** 本機預設、可匯出、可刪除、可檢查；不以隱藏分析換取黏著度。
7. **模型可替換，資料契約不可漂移。** AI 供應商可以更換，但事件、內容、學習者模型與版本遷移必須穩定。
8. **觀測不等於真相。** 停留時間、未展開、快速滑過都只能作為弱證據，不能單獨宣告掌握。

## 2.2 非目標

MVP 不追求：

- 成為完整翻譯器；
- 自動替使用者翻譯所有頁面；
- 成為考試題庫平台；
- 在所有 PDF、電子書、桌面應用與手機 App 中同時運作；
- 以眼動追蹤推斷注意力；
- 建立教師／班級管理後台；
- 建立公開社群、排行榜或內容市場；
- 宣稱能在固定時數內達到母語水準；
- 在首版訓練自有大型語言模型。

---

# 3. 主要使用情境

## 3.1 情境 A：真實網頁閱讀

使用者閱讀新聞、論文、技術文件或社群貼文。魔法之手只處理目前可見或即將進入可視區域的英文段落。當使用者在句子上停留時：

1. 先出現淡化句子焦點與最小詞性標記；
2. 持續停留後顯示第一層核心卡片；
3. 使用者主動點擊才顯示深度解析；
4. 所有互動轉為事件寫入本機；
5. 不需要離開原頁面。

## 3.2 情境 B：故事補盲

系統依據最近的野生閱讀事件找出：

- 頻繁遇到但反覆查詢的結構；
- 學過但在新情境中遷移失敗的結構；
- 對使用者領域重要、但自然暴露不足的詞彙；
- 掌握度低且信心足夠的語法。

Halo Story 以這些缺口生成一段可選擇的英文故事。故事必須通過生成後驗證，確認目標詞彙／語法實際出現，且整體難度落在指定區間。

## 3.3 情境 C：跨場景遷移

某個語法在 Halo Story 中練習後，魔法之手在真實網頁再次遇到時可短暫降低支架密度，觀測是否能無輔助通過。這是低干擾的 transfer probe，而不是考試。

## 3.4 情境 D：資料控制

使用者可以：

- 查看本機保存了哪些事件與句子；
- 匯出 JSON／JSONL；
- 刪除指定網站、指定日期或全部資料；
- 禁止特定網站運作；
- 關閉遠端解釋與雲端同步；
- 重建學習者模型。

---

# 4. 統一系統架構

## 4.1 邏輯架構

```text
┌─────────────────────────────────────────────────────────────┐
│                         UI Surfaces                         │
│  ┌────────────────────────┐   ┌──────────────────────────┐ │
│  │ Magic Hand Extension   │   │ Halo Story Web App       │ │
│  │ DOM / Hover / Cards    │   │ Story / Choice / Review  │ │
│  └────────────┬───────────┘   └────────────┬─────────────┘ │
└───────────────┼─────────────────────────────┼───────────────┘
                │ shared commands/events      │
┌───────────────▼─────────────────────────────▼───────────────┐
│                    Halo Learning Core                       │
│ Sentence Pipeline │ Marking Engine │ Trigger Controller    │
│ Learner Projector │ Gap Planner    │ Story Orchestrator     │
│ Provider Adapters │ Privacy Guard  │ Export / Migration     │
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │ optional
┌───────────────▼──────────────┐   ┌──────────▼──────────────┐
│ Local Data Layer             │   │ Remote Services         │
│ IndexedDB + event log        │   │ NLP / LLM / Sync API    │
│ settings / cache / queue     │   │ provider-agnostic       │
└──────────────────────────────┘   └─────────────────────────┘
```

## 4.2 建議 Monorepo 結構

```text
halo-learning/
├─ apps/
│  ├─ extension/              # Chrome/Chromium Manifest V3
│  └─ story-web/              # Halo Story Web App
├─ packages/
│  ├─ contracts/              # TypeScript types, schemas, event names
│  ├─ sentence-pipeline/      # DOM text extraction, sentence segmentation
│  ├─ nlp-core/               # tokenizer/POS/dependency provider abstraction
│  ├─ marking-engine/         # simplified tags, density, selection, render model
│  ├─ trigger-controller/     # hover/long-press/explicit trigger state machine
│  ├─ learner-model/          # event projection, mastery, confidence, gaps
│  ├─ story-engine/           # prompt plans, validation, retry, chapter state
│  ├─ event-store/            # append-only event API and projections
│  ├─ storage/                # IndexedDB schema, migrations, export/import
│  ├─ provider-adapters/      # LLM/NLP/TTS adapters
│  ├─ privacy-guard/          # site policy, redaction, payload minimization
│  └─ ui/                     # shared marked text, cards, settings components
├─ services/
│  ├─ api/                    # optional remote orchestration/sync
│  └─ nlp/                    # optional high-precision NLP service
├─ fixtures/
│  ├─ webpages/               # DOM regression fixtures
│  ├─ sentences/              # annotated NLP fixtures
│  └─ stories/                # generation validation fixtures
├─ docs/
│  ├─ adr/                    # architecture decision records
│  ├─ api/                    # contracts and examples
│  └─ privacy/                # data map and threat model
└─ tests/
   ├─ integration/
   └─ e2e/
```

## 4.3 技術基線

以下是建議而非不可替換的綁定：

- TypeScript 作為共享語言；
- React 作為兩個 UI surface 的元件層；
- 瀏覽器擴充功能採 Manifest V3；
- IndexedDB 作為本機主資料庫；
- schema validation 使用可序列化的 runtime validator；
- 單元測試、整合測試與瀏覽器 E2E 分層；
- 所有套件使用實作時的穩定版本，不在規格中鎖死過時版本號。

---

# 5. 核心領域模型

## 5.1 統一識別與版本欄位

所有可持久化物件至少包含：

```ts
interface EntityMeta {
  id: string;
  schemaVersion: number;
  createdAt: string;   // ISO 8601
  updatedAt: string;
  deviceId: string;
}
```

所有算法輸出至少包含：

```ts
interface AlgorithmProvenance {
  algorithmId: string;
  algorithmVersion: string;
  providerId?: string;
  modelId?: string;
  generatedAt: string;
  confidence: number;  // 0..1
}
```

## 5.2 學習者設定

```ts
interface LearnerProfile extends EntityMeta {
  locale: string;
  nativeLanguage: string;
  targetLanguage: string;
  estimatedCEFR?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  preferredDomains: string[];
  goals: LearningGoal[];
  preferences: {
    markingDensity: number;          // 0..1
    triggerMode: 'adaptive-hover' | 'explicit-only' | 'hybrid';
    baseHoverThresholdMs: number;
    remoteAssistance: boolean;
    saveSentenceText: 'never' | 'on-open' | 'on-save' | 'always';
    ttsAutoplay: boolean;
    nonStandardUsageMode: 'strict' | 'gentle' | 'off';
  };
}
```

## 5.3 句子與分析結果

```ts
interface SentenceSnapshot extends EntityMeta {
  sourceId: string;
  text?: string;                // 依隱私設定保存
  textHash: string;
  language: string;
  domain: string;
  charCount: number;
  tokenCount?: number;
  domLocator?: SerializableDomLocator;
  capturedReason: 'visible' | 'hovered' | 'opened' | 'saved' | 'story';
  privacyClass: 'public' | 'sensitive' | 'blocked';
}

interface AnalysisResult extends EntityMeta {
  sentenceId: string;
  tokens: AnalyzedToken[];
  grammarFeatures: GrammarFeature[];
  complexity: SentenceComplexity;
  nonStandardFlags: NonStandardFlag[];
  provenance: AlgorithmProvenance;
}
```

## 5.4 標記資料

```ts
interface MarkedToken {
  tokenId: string;
  text: string;
  start: number;
  end: number;
  simplifiedPos?: 'n' | 'v' | 'adj' | 'adv' | 'prep' | 'conj' | 'det' | 'pron' | 'aux' | 'modal';
  marked: boolean;
  priority: number;
  reasons: Array<'target' | 'weak-point' | 'unknown-word' | 'content-word' | 'structure'>;
}

interface MarkedSentence {
  sentenceId: string;
  density: number;
  tokens: MarkedToken[];
  firstLayer: FirstLayerContent;
  deepLayerRef?: string;
  provenance: AlgorithmProvenance;
}
```

## 5.5 學習事件

事件是系統的真實記錄。投影分數可以重算，事件不得被原地修改。

```ts
type LearningEventType =
  | 'PAGE_DISCOVERED'
  | 'SENTENCE_VISIBLE'
  | 'HOVER_STARTED'
  | 'HINT_PRIMED'
  | 'PANEL_OPENED'
  | 'TOKEN_LOOKED_UP'
  | 'TTS_PLAYED'
  | 'DEEP_LAYER_OPENED'
  | 'PANEL_CLOSED'
  | 'SENTENCE_PASSED'
  | 'SENTENCE_REVISITED'
  | 'SENTENCE_SAVED'
  | 'STORY_GENERATED'
  | 'STORY_CHOICE_MADE'
  | 'STORY_CHAPTER_COMPLETED'
  | 'COMPREHENSION_RESPONSE'
  | 'TRANSFER_PROBE_STARTED'
  | 'TRANSFER_PROBE_RESULT'
  | 'SETTINGS_CHANGED'
  | 'DATA_EXPORTED'
  | 'DATA_DELETED';

interface LearningEvent extends EntityMeta {
  type: LearningEventType;
  actorId: string;
  sessionId: string;
  source: 'magic-hand' | 'halo-story' | 'system';
  sentenceId?: string;
  storyId?: string;
  grammarIds?: string[];
  vocabularyIds?: string[];
  payload: Record<string, unknown>;
  evidenceWeight: number;       // 0..1
  privacyClass: 'local' | 'syncable' | 'never-sync';
}
```

## 5.6 掌握度投影

```ts
interface MasteryProjection extends EntityMeta {
  learnerId: string;
  itemType: 'grammar' | 'vocabulary' | 'domain';
  itemId: string;
  alpha: number;
  beta: number;
  mastery: number;
  confidence: number;
  exposureCount: number;
  assistedSuccessCount: number;
  unassistedSuccessCount: number;
  failureCount: number;
  transferScore?: number;
  lastEvidenceAt?: string;
  projectorVersion: string;
}
```

以 Beta posterior 作為可解釋的 MVP 基線：

$$m_i = \frac{\alpha_i}{\alpha_i + \beta_i}$$

其中成功證據增加 $\alpha_i$，失敗證據增加 $\beta_i$；證據增量必須依事件種類、是否有支架、是否為真實遷移與資料可信度加權。

未展開不等於成功。只有在句子確實可見、停留時間合理、沒有快速回視、沒有立即查詢，而且模型對該句難度判定有足夠信心時，才可產生低權重的正向證據。

---

# 6. 本機資料庫設計

## 6.1 IndexedDB Object Stores

| Store | Key | 主要索引 | 用途 |
|---|---|---|---|
| `profiles` | `id` | `updatedAt` | 學習者設定與目標 |
| `sources` | `id` | `origin`, `domain`, `lastSeenAt` | 網頁／故事來源 |
| `sentences` | `id` | `textHash`, `sourceId`, `createdAt` | 最小句子快照 |
| `analyses` | `id` | `sentenceId`, `algorithmVersion` | NLP 與複雜度結果 |
| `events` | `id` | `sessionId`, `type`, `createdAt`, `sentenceId` | append-only 學習事件 |
| `mastery` | `id` | `[learnerId+itemType+itemId]` | 可重算投影 |
| `goals` | `id` | `status`, `priority` | 學習目標 |
| `gaps` | `id` | `priority`, `status`, `itemId` | 缺口規劃結果 |
| `stories` | `id` | `createdAt`, `status` | 故事與生成 provenance |
| `storySessions` | `id` | `storyId`, `learnerId` | 互動進度 |
| `cache` | `key` | `expiresAt` | NLP／解釋快取 |
| `syncQueue` | `id` | `status`, `createdAt` | 可選同步佇列 |
| `settings` | `key` | 無 | UI 與權限設定 |
| `migrations` | `version` | 無 | schema 遷移紀錄 |

## 6.2 保存策略

- 預設只在 `PANEL_OPENED`、`SENTENCE_SAVED` 或故事模式保存完整句子。
- 僅可見但未互動的句子，原則上只保存 hash、長度、領域與特徵摘要。
- `blocked` 或 `sensitive` 網站不保存句子、不呼叫遠端服務、不生成學習事件。
- 快取具有 TTL；過期後可以自動清除。
- 每次 schema migration 必須可測試、可回滾或至少可從匯出檔重建。

---

# 7. 魔法之手互動狀態機

## 7.1 觸發階段

| 階段 | 預設條件 | UI | 行為 |
|---|---|---|---|
| Idle | 尚未聚焦 | 無 | 不處理 |
| Candidate | 指標進入句子 | 無或極淡邊界 | 開始計時，不呼叫遠端 |
| Primed | 約 1 秒或自適應門檻前段 | 淡 highlight + 最小標記 | 可立即移出取消 |
| Core Open | 達到自適應展開門檻 | 第一層核心卡片 | 顯示最多 2–4 個資訊單元 |
| Deep Open | 主動點擊／快捷鍵 | 第二層深度面板 | 詳細語法、例句、比較、詞源 |
| Dismissed | 移出、Esc、點擊外部 | 收起 | 記錄是否誤觸／取消 |

## 7.2 自適應觸發機率

MVP 可使用可解釋的 sigmoid：

$$P(\text{expand}\mid x)=\sigma\left(k\left[t-\tau_u-\Delta_c-\Delta_d-\Delta_h\right]\right)$$

其中：

- $t$：目前停留時間；
- $\tau_u$：使用者基礎門檻；
- $\Delta_c$：句子複雜度修正；
- $\Delta_d$：內容領域修正；
- $\Delta_h$：猶豫／滑鼠行為修正；
- $k$：曲線陡峭度。

門檻更新：

$$\tau_{u,t+1}=\operatorname{clip}\left(\tau_{u,t}+\eta_{fp}I_{fp}-\eta_{tp}I_{tp},1000,5000\right)$$

- 誤觸後提高門檻；
- 使用者常在門檻前主動點開時降低門檻；
- 每次更新幅度有限，避免 UI 行為突然漂移；
- 使用者可一鍵重設。

## 7.3 明確操作優先

任何時候，以下明確訊號都應優先於推斷：

- 點擊句子；
- 選取文字後使用快捷鍵；
- 按住 Shift／Alt 懸停；
- 右鍵選單「用魔法之手解析」；
- Popup 切換為 explicit-only。

---

# 8. 漸進揭示與內容選擇

## 8.1 第零層：最小標記

- 只顯示核心詞性的簡化標籤；
- 不改寫原文；
- 不一次標記整頁；
- 顏色只是輔助，不能是唯一辨識方式；
- 需要 Shadow DOM 或嚴格 CSS namespace，避免污染網站樣式。

## 8.2 第一層：核心卡片

第一層最多 2–4 個資訊單元，目標是「足以繼續閱讀」，不是完整教學。

選擇規則：

1. 生詞比例高：優先顯示最多 3 個關鍵詞義；
2. 依存深度或從句數高：優先顯示 chunking 與核心結構；
3. 有慣用語：先顯示整體語義，不逐字直譯；
4. 非標準用法：依設定顯示 gentle／strict 標註；
5. 沒有明顯難點：只顯示極短提示，避免製造無效資訊。

句子難度基線：

$$D=0.4V+0.4G+0.2L$$

- $V$：相對使用者詞彙模型的未知詞比例；
- $G$：依存深度、從句數與目標語法的綜合；
- $L$：句長正規化值。

## 8.3 第二層：深度解析

只由主動操作打開，可包含：

- 逐詞釋義與搭配；
- chunk／依存結構；
- 時態時間軸；
- 2–5 個例句；
- 中英對比；
- 非標準用法與標準形式；
- TTS；
- 收藏、筆記與送入故事補盲。

第二層內容必須可折疊，不得一次造成資訊海嘯。

---

# 9. 句子管線與標記引擎

## 9.1 DOM 句子管線

```text
Visible DOM roots
  → Filter unsuitable nodes
  → Extract text runs
  → Segment sentences
  → Map offsets back to DOM Range
  → Language detection
  → Privacy policy check
  → Lightweight NLP
  → Marking plan
  → Render overlay
```

需忽略：

- `script`, `style`, `noscript`, `textarea`, `input`, `code`, `pre`（除非使用者明確解析）；
- 導航列、按鈕群、ARIA hidden、不可見元素；
- 密碼、付款、醫療、網銀、Webmail 等封鎖領域；
- 字數過短、符號比例過高或非主要英文的節點。

## 9.2 懶載入

- 使用 `IntersectionObserver` 只處理 viewport 附近元素；
- 使用 `MutationObserver` 處理動態內容，但必須 debounce；
- NLP 與 DOM mapping 放入 Web Worker；
- 解析結果以 `textHash + contextHash + algorithmVersion` 快取；
- 頁面離開後釋放 Range 與 DOM reference，避免記憶體洩漏。

## 9.3 標記密度

標記密度不是固定比例，而是候選 token 的優先級選擇。

$$\rho=\operatorname{clip}\left(\rho_0(\text{level})+0.2(C-0.5)+0.1I_{target}-0.15M,0.05,0.95\right)$$

其中：

- $\rho_0$：使用者等級的基礎密度；
- $C$：句子複雜度；
- $I_{target}$：是否包含當前目標；
- $M$：該結構的掌握度。

優先級順序：

1. 當前目標語法；
2. 已識別弱點；
3. 未知詞與重要內容詞；
4. 結構關鍵節點；
5. 一般功能詞。

## 9.4 NLP Provider 介面

```ts
interface NLPProvider {
  id: string;
  capabilities: Array<'sentence' | 'pos' | 'dependency' | 'ner' | 'wsd' | 'grammar-check'>;
  analyze(input: NLPAnalyzeInput, signal?: AbortSignal): Promise<NLPAnalyzeOutput>;
}
```

必須至少提供：

- `LocalBasicNLPProvider`：離線、快速、可接受較低精度；
- `RemoteHighPrecisionNLPProvider`：使用者啟用後可呼叫；
- fallback 邏輯：遠端失敗時仍可顯示本機基礎標記。

---

# 10. 學習者模型與證據規則

## 10.1 證據分級

| 事件 | 方向 | 建議權重 | 備註 |
|---|---:|---:|---|
| 無支架理解測驗答對 | 正 | 1.0 | 強證據 |
| 真實遷移 probe 成功 | 正 | 0.9 | 必須有足夠可見與行為資料 |
| 故事中低支架正確選擇 | 正 | 0.7 | 受控情境 |
| 有支架後理解 | 正 | 0.3 | 表示可學，不表示已掌握 |
| 反覆查詢同一結構 | 負 | 0.5 | 需排除內容特別難 |
| 明確答錯 | 負 | 1.0 | 強證據 |
| 長時間停留／回視 | 負 | 0.2 | 弱證據，不能單獨判斷 |
| 未展開快速通過 | 正 | 0.1 | 僅在模型信心足夠時使用 |

## 10.2 信心

掌握度與信心分開。資料很少時，即使 $m_i$ 高也不應宣告掌握。

一個簡單信心基線：

$$c_i = 1-e^{-n_i/\lambda}$$

其中 $n_i$ 是有效證據總量，$\lambda$ 控制信心成長速度。

## 10.3 遷移分數

$$T_g=\frac{\sum_j w_j s_j}{\sum_j w_j}$$

- $s_j\in[0,1]$ 是第 $j$ 次遷移表現；
- $w_j$ 依真實性、是否無支架、資料完整性與時間新鮮度加權。

只有在 $T_g$ 與信心同時達標時，才降低該語法的預設標記密度。

---

# 11. 缺口規劃器

## 11.1 缺口來源

- 高頻遭遇但低掌握；
- 故事中學過但真實遷移失敗；
- 使用者領域重要但暴露稀少；
- 長期未複習且掌握衰退；
- 使用者主動收藏或標記「想學」；
- 目標課程要求但尚未覆蓋。

## 11.2 優先級

$$P_i=(1-m_i)\cdot c_i\cdot u_i\cdot s_i\cdot r_i$$

- $m_i$：掌握度；
- $c_i$：證據信心；
- $u_i$：使用者實際需求／領域重要性；
- $s_i$：暴露稀缺度；
- $r_i$：新鮮度／遺忘風險。

若信心過低，系統應優先收集更多觀測，而不是立即生成大量補盲內容。

## 11.3 GapPlan

```ts
interface GapPlan extends EntityMeta {
  learnerId: string;
  targets: Array<{
    itemType: 'grammar' | 'vocabulary';
    itemId: string;
    priority: number;
    rationale: string[];
    desiredExposureCount: number;
    maxDensity: number;
  }>;
  preferredGenre?: string;
  targetDifficulty: { min: number; max: number };
  generatedBy: AlgorithmProvenance;
}
```

---

# 12. Halo Story 敘事引擎

## 12.1 職責

- 接收 `GapPlan`；
- 建立故事規格而非直接拼接 prompt；
- 呼叫文字生成 provider；
- 驗證語法與詞彙覆蓋；
- 保存生成 provenance；
- 將故事互動轉為共享學習事件。

## 12.2 Provider 介面

```ts
interface TextGenerationProvider {
  id: string;
  generateStory(request: StoryGenerationRequest, signal?: AbortSignal): Promise<GeneratedStoryDraft>;
  explainSentence?(request: ExplanationRequest, signal?: AbortSignal): Promise<ExplanationResult>;
}
```

## 12.3 生成後驗證

生成內容不能直接信任。流程：

```text
GapPlan
  → StorySpec
  → Provider draft
  → Language / safety check
  → Target grammar detection
  → Target vocabulary count
  → Difficulty analysis
  → Continuity check
  → accept / targeted retry / fallback template
```

驗證至少包含：

- 目標項目覆蓋率；
- 每個目標的出現次數；
- CEFR／難度區間；
- 非預期敏感內容；
- 章節連貫性；
- 重複與格式錯誤；
- 選項能否解析成明確狀態轉移。

## 12.4 失敗策略

1. 首次生成未達標：以 validation report 做一次定向重試；
2. 再次未達標：使用模板化故事骨架補足目標；
3. 仍未達標：顯示「部分目標未覆蓋」而不是偽裝成功；
4. 所有失敗都寫入 generation job log。

## 12.5 敘事與標記

- 預設標記密度比魔法之手略高；
- 章節內可逐步淡出；
- 新目標第一次出現可高密度標記；
- 後續重複出現降低支架；
- 選擇本身應影響故事，不得只是偽選項；
- 學習面板可隱藏，避免破壞敘事沉浸。

---

# 13. 內部命令與事件介面

## 13.1 Commands

```ts
type HaloCommand =
  | { type: 'ANALYZE_SENTENCE'; sentenceId: string }
  | { type: 'OPEN_CORE_PANEL'; sentenceId: string; trigger: string }
  | { type: 'OPEN_DEEP_PANEL'; sentenceId: string }
  | { type: 'LOOKUP_TOKEN'; sentenceId: string; tokenId: string }
  | { type: 'SAVE_SENTENCE'; sentenceId: string }
  | { type: 'PROJECT_LEARNER_MODEL'; learnerId: string; since?: string }
  | { type: 'GENERATE_GAP_PLAN'; learnerId: string }
  | { type: 'GENERATE_STORY'; gapPlanId: string }
  | { type: 'EXPORT_DATA'; learnerId: string; format: 'json' | 'jsonl' }
  | { type: 'DELETE_DATA'; scope: DeleteScope };
```

## 13.2 事件匯流排要求

- 同一事件 ID 必須冪等；
- event handler 失敗不能遺失事件；
- projection 可從 event log 重建；
- 所有 schema 均帶版本；
- extension content script 不直接寫複雜投影，只傳事件給 background/core worker。

---

# 14. 可選遠端 API

MVP 核心可純本機運行；以下 API 僅在啟用遠端能力時存在。

## 14.1 NLP

```http
POST /v1/analyze
```

```json
{
  "requestId": "...",
  "text": "...",
  "language": "en",
  "capabilities": ["pos", "dependency", "grammar-check"],
  "context": { "domain": "academic" }
}
```

回應必須包含 provider/model/version/confidence，且服務端不得默認永久保存原文。

## 14.2 解釋

```http
POST /v1/explain
```

輸入只包含使用者主動打開的句子與必要上下文，不得上傳整頁。

## 14.3 故事生成

```http
POST /v1/stories/generate
```

輸入是 `StorySpec` 與抽象化的 learner gaps，不需要上傳完整閱讀歷史。

## 14.4 同步

```http
POST /v1/sync/push
GET  /v1/sync/pull?cursor=...
```

同步採增量事件；敏感事件與 never-sync 事件永遠不得上傳。

---

# 15. UI／UX 規格

## 15.1 Magic Hand Extension

### Content UI

- highlight 不改變原文排版高度；
- 卡片優先放在句子附近，但不得遮住主要文字；
- 空間不足時改用側邊浮層；
- Esc、點擊外部、移出延遲可關閉；
- 支援鍵盤操作與螢幕閱讀器；
- 不用 hover 作為唯一入口。

### Popup

最少包含：

- 本站開／關；
- 觸發模式；
- 標記密度；
- 遠端協助開／關；
- 今日事件摘要；
- 資料與隱私入口；
- 打開 Halo Story。

### Options Page

- 全域與網站規則；
- 資料保存策略；
- Provider 設定；
- 匯出／匯入／刪除；
- 演算法與模型版本資訊；
- 重建 mastery projection。

## 15.2 Halo Story Web App

主要頁面：

1. Library／Start；
2. Story setup；
3. Story reader；
4. Choice transition；
5. Chapter review；
6. Gap review；
7. Data／settings。

故事閱讀頁以內容為主，標記與學習分析是可淡出的支架。不得把學習面板永久固定在主視線中央。

## 15.3 無障礙

- 所有顏色標記具有文字或形狀替代；
- 可關閉動畫；
- 可使用鍵盤完成開啟、查看、收藏與關閉；
- ARIA 標籤不得朗讀大量重複詞性標記；
- 卡片焦點順序可預測；
- 字級與對比可調。

---

# 16. 隱私、安全與權限

## 16.1 最小權限

- 優先使用 optional host permissions；
- 使用者未授權的網站不注入；
- Content Script 不持有 API key；
- API key 只能位於 extension background、使用者安全儲存或後端；
- 不使用遠端動態程式碼；
- 不讀 cookies、密碼欄位、剪貼簿或瀏覽歷史，除非另有明確功能與同意。

## 16.2 敏感網站策略

預設封鎖：

- 網銀與支付；
- 密碼管理器；
- Webmail 與私人訊息；
- 醫療與保險；
- 政府個人資料頁；
- 後台管理、雲端密鑰與開發者 console；
- 使用者自訂 denylist。

## 16.3 遠端資料最小化

- 不上傳整頁；
- 只傳主動打開的句子；
- 上下文最多為必要前後句，且可關閉；
- 移除 URL query、帳號、email、token、表單值等可識別資訊；
- 回應只保存必要結果與 provenance；
- 使用者可查看最近遠端請求紀錄。

## 16.4 AI 輸出安全

- 所有生成 HTML 必須 sanitize；
- 預設以純文字／受控 Markdown 渲染；
- 不執行模型產生的 script、style、URL 或事件 handler；
- 故事輸出經內容政策與格式 schema 驗證；
- 外部連結需明確標示並由使用者點擊。

---

# 17. 效能目標

以下為工程門檻，不包含遠端模型不可控的網路延遲：

| 指標 | MVP 目標 |
|---|---:|
| cached/local primed highlight p95 | < 100 ms |
| local basic sentence analysis p95 | < 300 ms／句 |
| core panel 首次可見 p95 | < 500 ms（先顯示本機內容） |
| 主執行緒 long task | 不得持續 > 50 ms |
| 可視區初次掃描 | 不阻塞頁面互動 |
| 事件寫入 | 非同步、可批次、不得造成捲動卡頓 |
| 記憶體 | 離開頁面後釋放 DOM reference 與 observer |

遠端解釋採 progressive enhancement：本機標記先出現，遠端結果完成後再更新，不讓 UI 空等。

---

# 18. MVP 範圍

## 18.1 必須完成

### A. Shared Core

- contracts 與 runtime schema；
- IndexedDB schema + migrations；
- append-only event store；
- mastery projector；
- gap planner 基線；
- provider adapter 介面；
- JSON／JSONL export。

### B. Magic Hand Extension

- Chrome/Chromium Manifest V3；
- 可視段落偵測與句子分割；
- DOM Range mapping；
- adaptive-hover 與 explicit-only；
- 簡化 POS 標記；
- 第一層卡片；
- 本機事件紀錄；
- 網站開關與 denylist；
- 遠端解釋可選。

### C. Halo Story Web

- 根據 GapPlan 生成單一故事；
- 章節、選項與狀態；
- 標記文字渲染；
- 生成後目標覆蓋驗證；
- 故事事件回寫共享 learner model；
- 本機持久化。

### D. QA

- 單元、整合與 E2E；
- DOM fixture；
- NLP fixture；
- migration 測試；
- privacy regression；
- performance budget。

## 18.2 明確不做

- 原生 PDF overlay；
- 手機 App；
- 跨裝置雲同步；
- 教師後台；
- 付款與訂閱；
- 社群、排行榜、徽章；
- 自有模型訓練；
- 全自動翻譯頁面；
- 眼動追蹤；
- 瀏覽器以外的全系統注入。

---

# 19. MVP 驗收標準

```yaml
mvp_acceptance:
  architecture:
    monorepo_shared_contracts: true
    provider_agnostic_core: true
    local_first_storage: true
    append_only_event_log: true
    rebuildable_mastery_projection: true

  extension:
    manifest_v3: true
    visible_sentence_detection: true
    dom_range_mapping: true
    adaptive_and_explicit_trigger: true
    progressive_reveal: true
    site_enable_disable: true
    sensitive_site_blocking: true
    no_full_page_upload: true

  marking:
    simplified_pos_rendering: true
    density_control: true
    target_and_weak_point_priority: true
    annotated_fixture_macro_f1_min: 0.90

  learner_model:
    mastery_and_confidence_separated: true
    event_provenance: true
    gap_plan_with_rationale: true
    transfer_events_supported: true

  story:
    gap_plan_input: true
    provider_adapter: true
    target_coverage_validation: true
    target_coverage_min: 0.80
    deterministic_fallback: true
    interaction_events_written: true

  privacy:
    local_default: true
    export_json_or_jsonl: true
    delete_by_scope: true
    api_key_not_in_content_script: true
    remote_request_log_visible: true

  testing:
    unit_tests: true
    integration_tests: true
    browser_e2e: true
    migration_tests: true
    fixture_sites_min: 20
    no_critical_dom_breakage: true
```

附加判定：

- POS F1 只針對規格定義的簡化標籤與標註 fixture，不代表完整語言學準確率。
- 故事目標覆蓋率是生成驗證指標，不代表學習成效。
- 若事件沒有 provenance 或 schema version，不視為完成。
- 若無法完整匯出與刪除使用者資料，不視為完成。

---

# 20. 測試策略

## 20.1 單元測試

- sentence segmentation；
- DOM text offset mapping；
- simplified POS mapping；
- density selection；
- trigger state machine；
- threshold update bounds；
- evidence weighting；
- mastery projector determinism；
- gap priority；
- story validation；
- privacy redaction；
- schema migration。

## 20.2 整合測試

- DOM → sentence → NLP → marking → render；
- panel interaction → event store → mastery projection；
- wild event → gap plan → story generation → validation；
- story events → learner model → extension density change；
- remote provider failure → local fallback；
- export → clean database → import → projection equivalence。

## 20.3 E2E Fixture 類型

至少涵蓋：

- 新聞文章；
- 學術 HTML；
- 技術文件；
- 社群無限捲動；
- SPA 動態路由；
- 大量 nested span；
- code-heavy page；
- 多語混合頁；
- shadow DOM；
- iframe（若權限允許）；
- 高密度廣告頁；
- 無障礙閱讀模式。

## 20.4 Failure Injection

- NLP timeout；
- provider rate limit；
- malformed AI JSON；
- IndexedDB quota；
- migration interruption；
- content script reload；
- duplicated event；
- network offline；
- DOM node removed during analysis；
- extension update with old schema。

---

# 21. Agent 實作 DAG

```text
T0 Repository Bootstrap
 ├─ T1 Contracts & Schemas
 │   ├─ T2 IndexedDB & Event Store
 │   │   ├─ T5 Learner Projector
 │   │   │   └─ T8 Gap Planner
 │   └─ T3 Provider Interfaces
 ├─ T4 Sentence Pipeline & Local NLP
 │   └─ T6 Marking Engine
 │       └─ T7 Magic Hand Extension UI
 ├─ T9 Story Engine
 │   └─ T10 Halo Story Web UI
 ├─ T11 Cross-Surface Integration
 ├─ T12 Privacy & Security Hardening
 ├─ T13 Test Fixtures & E2E
 └─ T14 Documentation & Release Candidate
```

## 21.1 任務定義

### T0 Repository Bootstrap

產出：monorepo、lint、typecheck、test runner、CI、環境範例。  
驗收：所有空套件可 build；不含 provider secret。

### T1 Contracts & Schemas

產出：所有 entity、command、event、provider interface、runtime schema。  
驗收：schema round-trip；version 欄位完整；無 app-specific import。

### T2 IndexedDB & Event Store

產出：object stores、migration、append、query、export/import。  
驗收：冪等 append；事件不可 update；匯出後可重建。

### T3 Provider Interfaces

產出：local basic NLP、mock generation provider、remote adapter skeleton。  
驗收：core test 可完全不連網；provider 可替換。

### T4 Sentence Pipeline & Local NLP

產出：DOM filter、segmentation、Range mapping、language check、worker。  
驗收：fixture mapping 不錯位；動態 DOM 可重掃；無主執行緒長阻塞。

### T5 Learner Projector

產出：evidence rules、Beta projection、confidence、rebuild command。  
驗收：同一事件序列產生相同結果；重播與增量一致。

### T6 Marking Engine

產出：tag mapping、priority、density、first-layer planner。  
驗收：fixture macro F1、density 邊界、同輸入可重現。

### T7 Magic Hand Extension UI

產出：content/background/popup/options、Shadow DOM UI、trigger state machine。  
驗收：20 個 fixture sites 不破版；Esc／鍵盤可操作；站點權限正確。

### T8 Gap Planner

產出：gap priorities、rationale、target plan。  
驗收：每個 target 有可讀理由與 evidence links；低信心不過度補盲。

### T9 Story Engine

產出：StorySpec、prompt builder、provider call、validator、retry、fallback。  
驗收：無 provider 時可用 mock／template；目標覆蓋可計算。

### T10 Halo Story Web UI

產出：story setup、reader、choice、chapter review、local persistence。  
驗收：故事流程可完成；所有互動寫入相同 event store contract。

### T11 Cross-Surface Integration

產出：extension events → gaps → story → mastery → extension density。  
驗收：完整閉環 E2E 通過。

### T12 Privacy & Security Hardening

產出：denylist、payload redaction、remote log、delete/export、安全渲染。  
驗收：敏感 fixture 無遠端請求；AI HTML 無法執行。

### T13 Test Fixtures & E2E

產出：fixtures、Playwright 類 E2E、performance checks、failure injection。  
驗收：CI 可重現；失敗訊息可定位。

### T14 Documentation & Release Candidate

產出：README、架構圖、資料地圖、隱私說明、開發者指南、release notes。  
驗收：新 Agent 可只讀文件完成環境啟動與核心測試。

---

# 22. Agent 執行規則

實作 Agent 必須遵守：

1. 不直接從 UI 元件發明新資料欄位；先更新 contracts 與 migration。
2. 每個任務完成時同時提交測試、文件與變更摘要。
3. 不把單一模型 SDK 引入 `learner-model`、`marking-engine` 或 `contracts`。
4. 不在 content script 保存 API key。
5. 不默認抓取完整頁面或全部閱讀歷史。
6. 不以「使用者未展開」直接判定已掌握。
7. 不用 AI 產生的 HTML 直接插入頁面。
8. 不在沒有驗證報告時宣稱故事目標已覆蓋。
9. 所有 projection 必須可從事件重建。
10. 任何偏離本規格的架構決策必須新增 ADR。

每個任務的完成回報格式：

```yaml
task_id: T?
status: completed | partial | blocked
files_changed: []
contracts_changed: []
migrations_added: []
tests_added: []
tests_passed: []
acceptance_evidence: []
known_limitations: []
security_notes: []
next_dependencies: []
```

---

# 23. Architecture Decision Records

## ADR-001：Halo Learning 是總系統

魔法之手與 Halo Story 共享核心，不建立兩套 learner profile。

## ADR-002：Local-first

首版不依賴登入與雲端。使用者能在完全離線狀態使用基礎標記、事件記錄與故事模板。

## ADR-003：事件來源

學習分數是投影，不是真實原始資料。保留事件才能審查、修正算法與重新計算。

## ADR-004：Provider-agnostic

任何 AI／NLP 供應商都只能存在於 adapter 層。

## ADR-005：不保存完整頁面

預設只保存最小句子與必要特徵；敏感網站完全不處理。

## ADR-006：敘事優先於外在遊戲化

故事選擇與角色可保留，積分、排行榜與強制黏著機制不屬於核心。

## ADR-007：Chrome/Chromium First

MVP 先完成一個穩定的瀏覽器平台；Firefox、Safari、手機與 PDF 後續再適配。

## ADR-008：Progressive Enhancement

本機結果先顯示，遠端結果後補；遠端失敗不得讓核心閱讀功能失效。

---

# 24. 後續階段

## Phase 2

- 高精度 NLP service；
- 使用者登入與端對端加密同步；
- TTS 與發音追蹤；
- EPUB／導入 PDF 後轉 HTML；
- 更多故事類型；
- 學習報告與版本比較。

## Phase 3

- 手機／平板原生介面；
- 教師與研究者可選分析工具；
- 多語言標記協議；
- 本地小模型；
- 更嚴格的因果實驗與學習效果研究。

所有後續功能仍不得破壞 local-first、可匯出、可刪除與 provider-agnostic 原則。

---

# 25. 原始文件追溯矩陣

| 本規格章節 | 主要來源 |
|---|---|
| 產品原則、環境化、非目標 | 設計動機論；魔法之手理論架構 |
| 延遲觸發、漸進揭示 | 魔法之手理論架構 |
| 標記密度、語感內化 | 標記英文白皮書；魔法之手理論架構 |
| 雙軌資料閉環 | 設計動機論；魔法之手理論架構 |
| 故事生成與學習追蹤 | 標記英文白皮書；Halo Learning 技術文檔 |
| React／TypeScript、資料層與測試 | Halo Learning 技術文檔 |
| 隱私、資料所有權、支架淡出 | 魔法之手理論架構；設計動機論 |

---

# 附錄 A：可直接交給 Coding Agent 的啟動提示

```text
你正在實作 Halo Learning v0.1。

請把本規格視為單一主要實作來源。系統包含：
1. Magic Hand 瀏覽器擴充功能；
2. Halo Story Web App；
3. 兩者共享的 Halo Learning Core；
4. Marking English 共用標記協議。

首要原則：local-first、provider-agnostic、event-sourced、privacy-minimized、progressive disclosure。

執行方式：
- 先讀完整規格與 ADR；
- 依 T0 → T14 DAG 執行；
- 不跳過 contracts、migration、tests；
- 每次只完成一個可驗收任務；
- 每個任務都輸出 task completion YAML；
- 發現衝突時不要自行隱藏修改，新增 ADR proposal；
- 不把任何單一 LLM/NLP provider 寫入核心領域層；
- 不上傳完整頁面；
- 不用未展開行為直接判定掌握；
- AI 輸出必須 schema validate 和 sanitize。

第一個任務是 T0 Repository Bootstrap。
完成 T0 後停止，輸出：
- repo tree；
- build/test/typecheck 結果；
- 尚未決定的技術選項；
- 下一個任務 T1 的依賴檢查。
```

---

# 附錄 B：整合結論

四份舊文件的真正共同核心不是「再做一個語言 App」，而是建立一個連接真實閱讀、可視化語法、個人學習證據與受控敘事補盲的學習基礎設施。

魔法之手解決的是：**在需要理解的當下，如何以最小干擾提供支架。**

標記英文解決的是：**如何把抽象語法轉為可逐步內化的視覺模式。**

Halo Story 解決的是：**真實世界暴露不完整時，如何用有意義的敘事補足缺口。**

Halo Learning Core 解決的是：**如何讓這些表面不同的互動，共享同一套可追溯、可重算、可遷移的學習者模型。**

這四者合併後，才是一個可交給 Agent 實作、可以逐步驗證，也不會在第一版就被過度產品化拖垮的完整系統。
