// backend/src/modules/ai/semantic-slot.constants.ts

/** 高价值槽位列表 — 质量检查时用于判断 Flash 结果是否贫瘠 */
export const HIGH_VALUE_SLOTS = [
  'usageScenario',
  'promotionIntent',
  'bundleIntent',
  'originPreference',
  'freshness',
  'dietaryPreference',
  'flavorPreference',
  'budget',
  'audience',
] as const;

/** Flash 分类+抽取 prompt（短、快、保守） */
export const FLASH_SEMANTIC_PROMPT = `你是农脉App的语义理解器。将用户语音转录解析为结构化意图。
固定类型：navigate / search / company / transaction / recommend / chat
抽取对应槽位，未明确的字段留空。不要猜测不确定的内容。

输出 JSON：
{
  "intent": "search|recommend|navigate|transaction|company|chat",
  "confidence": 0.xx,
  "slots": {
    "query": "显式搜索词（无则null）",
    "categoryHint": "隐含品类（无则null）",
    "constraints": ["organic","fresh","low-sugar","seasonal","traceable","cold-chain","geo-certified","healthy"],
    "usageScenario": "使用场景",
    "dietaryPreference": "饮食偏好",
    "freshness": "新鲜度要求",
    "originPreference": "产地偏好",
    "flavorPreference": "口味偏好",
    "promotionIntent": "threshold-optimization|best-deal|null",
    "bundleIntent": "meal-kit|complement|null",
    "audience": "目标人群",
    "budget": null,
    "recommendThemes": ["hot","discount","tasty","seasonal","recent"]
  },
  "fallbackReason": "out-of-domain|too-vague|unsafe|null"
}`;

/** Plus 深度推断 prompt（补全隐含需求） */
export const PLUS_SEMANTIC_PROMPT = `你是农脉App的语义理解器。将用户自然语言解析为结构化意图。
即使用户没说出具体商品名，也要尽力推断隐含需求。

例如：
- "今晚做饭买什么" → intent:"recommend", usageScenario:"晚餐做饭"
- "下雨天适合吃什么" → intent:"recommend", usageScenario:"雨天暖食"
- "帮我凑个满减" → intent:"recommend", promotionIntent:"threshold-optimization"
- "有没有本地特产" → intent:"search", categoryHint:"特产", originPreference:"本地"
- "找点新鲜海鲜" → intent:"search", categoryHint:"海鲜", constraints:["fresh"]

与农产品/电商/平台无关的问题，intent 设为 "chat"，fallbackReason 设为 "out-of-domain"。
表达太模糊无法判断任何意图时，fallbackReason 设为 "too-vague"。

固定类型：navigate / search / company / transaction / recommend / chat

输出 JSON：
{
  "intent": "search|recommend|navigate|transaction|company|chat",
  "confidence": 0.xx,
  "slots": {
    "query": "显式搜索词（无则null）",
    "categoryHint": "隐含品类（无则null）",
    "constraints": ["organic","fresh","low-sugar","seasonal","traceable","cold-chain","geo-certified","healthy"],
    "usageScenario": "使用场景",
    "dietaryPreference": "饮食偏好",
    "freshness": "新鲜度要求",
    "originPreference": "产地偏好",
    "flavorPreference": "口味偏好",
    "promotionIntent": "threshold-optimization|best-deal|null",
    "bundleIntent": "meal-kit|complement|null",
    "audience": "目标人群",
    "budget": null,
    "recommendThemes": ["hot","discount","tasty","seasonal","recent"]
  },
  "fallbackReason": "out-of-domain|too-vague|unsafe|null"
}`;

/** out-of-domain 引导式 bridge prompt */
export const OUT_OF_DOMAIN_BRIDGE_PROMPT = `你是农脉App的AI助手，专注于农产品和食材推荐。
用户刚刚问了一个和平台无关的问题。

你的策略：
1. 先礼貌承认边界："我更擅长帮你挑食材和农产品"
2. 找到自然的桥接点，将话题引向平台商品
3. 给出 1-2 个具体的 suggestedActions
4. 语气亲切不生硬，像朋友聊天而非客服话术
5. 不要硬拉，先承认边界再柔性引导

输出 JSON：
{
  "reply": "自然语言回复",
  "suggestedActions": [
    { "type": "search|recommend", "label": "按钮显示文字", "resolved": { "query": "搜索词" } }
  ]
}`;

/** Flash 质量检查：判断结果是否足够好 */
export function isFlashResultGood(
  confidence: number,
  slots: Record<string, any>,
): boolean {
  if (confidence < 0.7) return false;

  const hasCategoryHint = !!slots?.categoryHint;
  const hasHighValueSlot = HIGH_VALUE_SLOTS.some((k) => {
    const v = slots?.[k];
    return v !== undefined && v !== null && v !== '';
  });
  const hasConstraints =
    Array.isArray(slots?.constraints) && slots.constraints.length >= 1;

  // categoryHint 单独存在不算好结果（避免宽泛兜底类目）
  if (hasCategoryHint && (hasHighValueSlot || hasConstraints)) return true;
  // 有高价值槽位，即使没有 categoryHint 也算好结果
  if (hasHighValueSlot) return true;
  // 有 constraints 也算好结果
  if (hasConstraints) return true;

  // 高置信度 + 明确 query（如"找鸡蛋"）→ 不升级 Plus，直接使用 Flash 结果
  const hasQuery = !!slots?.query && slots.query.trim() !== '';
  if (confidence >= 0.85 && hasQuery) return true;

  return false;
}
