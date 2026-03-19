# 农脉 AI 语音助手集成方案

> **权威来源**：所有 AI 语音、意图识别、大模型集成相关的设计、进度、问题均在此文档更新。

---

## 目录

1. [功能概述](#1-功能概述)
2. [技术方案选型](#2-技术方案选型)
3. [全链路架构](#3-全链路架构)
4. [服务开通与配置](#4-服务开通与配置)
5. [前端录音接入（expo-av）](#5-前端录音接入expo-av)
6. [后端 ASR 语音转文字（百炼平台）](#6-后端-asr-语音转文字百炼平台)
7. [统一语音路由器（分类器 + 槽位 + 实体 + 执行）](#7-统一语音路由器分类器--槽位--实体--执行)
8. [前端跳转执行](#8-前端跳转执行)
9. [延迟与性能分析](#9-延迟与性能分析)
10. [费用估算](#10-费用估算)
11. [常见问题](#11-常见问题)
12. [后续升级路线](#12-后续升级路线)
13. [实施进度](#13-实施进度)
14. [语义意图升级（Phase B）](#14-语义意图升级phase-b)
15. [语义意图升级路线 — Phase C](#15-语义意图升级路线--phase-c待启动)
16. [已知问题与调试记录](#16-已知问题与调试记录)

---

## 1. 功能概述

**核心交互**：用户在首页长按「AI买买」按钮录入语音 → AI 理解意图 → 自动跳转到目标页面。

**代码状态**：
- ✅ `AiOrb` 组件已实现（idle/listening/thinking/responding/error 五态动画）
- ✅ 数据库模型已定义（AiSession/AiUtterance/AiIntentResult/AiActionExecution）
- ✅ 后端 AI 模块已搭建（ai.controller.ts / ai.service.ts / asr.service.ts）
- ✅ 当前意图类型已落地（search / company / chat / navigate / transaction / recommend）
- ✅ 真实录音已接入（expo-av，WAV 16kHz 单声道）
- ✅ ASR 语音识别已接入（阿里云百炼平台 gummy-chat-v1）
- ✅ 已有可运行的语音能力（搜索 / 企业 / 页面跳转 / 订单 / 推荐）
- ✅ 已开始把语音结果结构化（search / company / transaction / recommend）
- ✅ 前端语音上传已实现（multipart 直传后端，无 OSS）
- ✅ 前端跳转逻辑已实现（search / company / chat / navigate / transaction）
- ✅ 首页语音动作导航已实现（购物车 / 结算 / 首页 / 发现 / 我的 / 订单 / AI聊天）
- ✅ 端到端联调测试（Expo Go 真机已验证）
- ✅ 无需登录即可使用语音功能（`@Public()` 装饰器）
- ✅ 录音时按钮动画反馈（脉动光环 + 扩散波纹）
- ✅ 识别中 Loading 动画（ActivityIndicator 旋转）
- ✅ chat 意图在首页展示回复，不强制跳转
- ✅ 语音入口已扩展到所有页面（浮动 AI 伴侣，含上下文菜单）
- ✅ 统一语音路由器已完成（`ASR -> 分类器 -> 槽位 -> 实体 -> 执行`）
- ✅ 推荐类语音已完成（预算导购 / 组合推荐 / 语义场景推荐）
- ✅ 交易类语音意图已完成（付款 / 订单 / 售后）
- ✅ **Phase B 语义意图升级已完成**：7 语义槽位 + Flash→Plus 管道 + Product 语义字段 + 多维评分 + out-of-domain 引导 + 真机测试通过
- ⬜ Phase C 待启动：满减凑单 / 搭配推荐 / 用户历史上下文 / Redis 热度缓存
- 🟢 AI 对话页已接入 Qwen-Plus 多轮对话（Phase 2 核心已实现）
- 🟢 聊天页已切到 `chatWithContext()` 多轮对话，支持 suggestedActions 卡片 + followUpQuestions 快捷按钮
- 🟢 首页 → 聊天页初始上下文注入已实现（"继续对话"按钮跳转）
- 🟡 聊天页语音输入（ASR → 文字 → Qwen-Plus）尚未实现

**关键文件**：

| 文件 | 作用 |
|------|------|
| `app/(tabs)/home.tsx` | AI买买按钮入口，长按触发 expo-av 真实录音 |
| `src/components/effects/AiOrb.tsx` | AI 按钮组件（五态动画） |
| `src/repos/AiAssistantRepo.ts` | AI Repo 层（Mock/真实双模式） |
| `src/repos/http/ApiClient.ts` | HTTP 客户端（含 upload 方法） |
| `src/types/domain/Ai.ts` | 语音意图类型定义（当前 `search/company/chat/navigate/transaction/recommend`） |
| `backend/src/modules/ai/asr.service.ts` | **百炼平台 WebSocket ASR 服务** |
| `backend/src/modules/ai/ai.service.ts` | 后端 AI 服务（规则引擎 + Qwen 意图识别） |
| `backend/src/modules/ai/ai.controller.ts` | 后端 AI 接口（含 voice-intent 上传端点） |
| `backend/src/modules/ai/ai.module.ts` | AI 模块注册 |
| `backend/src/modules/ai/dto/ai-request.dto.ts` | 请求 DTO |

---

## 2. 技术方案选型

### 2.1 是否需要大模型？

| 层 | 任务 | 是否需要大模型 | 当前 / 建议选型 |
|---|---|---|---|
| **语音转文字 (STT/ASR)** | 语音 → 文字 | 不需要，专用 ASR 模型 | **阿里云百炼平台 gummy-chat-v1** |
| **统一分类器** | 先判断这是搜索/企业/导航/交易/推荐中的哪一类 | 需要轻量 LLM | `qwen-flash` |
| **槽位抽取** | 抽 `query / action / mode / budget / constraints` | 需要轻量 LLM | `qwen-flash` |
| **动态实体解析** | 把「鲜果 / 清河农场」映射到当前真实分类或企业 | 需要轻量 LLM + 业务数据约束 | `qwen-flash` + 当前候选集合 |
| **受控执行** | 真正跳转、搜索、加购、交易校验 | 不需要生成式模型 | 前后端白名单 / 权限 / 上下文校验 |
| **推荐 / 预算导购** | 「我今天有100块，推荐我买什么」 | 需要更强语义理解 | 建议 `qwen-plus` |
| **多轮对话 / 连续追问** | 开放式问答、上下文连续聊天 | 需要 LLM | `qwen-plus`（后续可视效果考虑思考模式） |

**结论：语音能力不再围绕“关键词清洗”设计，而是围绕“结构化决策流水线”设计**：
- `qwen-flash` 负责分类、槽位抽取、实体纠偏
- 当前数据库负责约束模型输出
- 执行层只认结构化结果，不直接根据自然语言做危险动作
- `qwen-plus` 只留给推荐、预算导购、多轮对话

### 2.2 为什么选百炼平台？

原方案使用传统阿里云智能语音交互（NLS），实际开发中改为**百炼平台（Model Studio）**：

| 对比项 | 传统 NLS（原方案） | 百炼平台（实际采用） |
|---|---|---|
| 鉴权 | AccessKey + Token 刷新 | **一个 API Key** |
| ASR + LLM | 两个独立服务，两套鉴权 | **同一平台，同一 API Key** |
| ASR 模型 | 固定版本 | gummy-chat-v1（持续更新） |
| 价格 | 0.006元/次 | ~0.00015-0.00033元/秒（更便宜） |
| 控制台 | nls.console.aliyun.com（已下线） | 百炼控制台（统一管理） |

### 2.3 百炼内推荐模型组合（2026-03-11）

| 模型 | 适合任务 | 价格口径（非思考模式） | 当前建议 |
|------|----------|------------------------|----------|
| **Qwen-Flash** | 搜索词改写、页面跳转、购物车/结算动作、简单问答 | 输入 **0.15 元/百万 token**，输出 **1.5 元/百万 token** | **主力动作模型** |
| **Qwen-Turbo** | 历史简单意图分类 | 输入 **0.3 元/百万 token**，输出 **0.6 元/百万 token** | 现有代码仍在用，后续建议逐步替换为 `qwen-flash` |
| **Qwen-Plus** | 推荐、预算导购、复杂理解、多轮对话 | 输入 **0.8 元/百万 token**，输出 **2 元/百万 token** | **主力推荐 / 对话模型** |

> 阿里云当前官方说明中，`qwen-turbo` 属于历史模型，**新接入建议优先使用 `qwen-flash`**。

### 2.4 expo-av 在中国可用性

**结论：完全可用。** expo-av 录音功能是纯本地操作，调用手机原生麦克风 API（iOS: AVAudioRecorder / Android: MediaRecorder），不依赖任何海外服务器或 Google Play Services。与网络和地域无关。

---

## 3. 全链路架构

```
用户长按"AI买买"按钮 (400ms)
    │
    ▼
┌─────────────────────────┐
│  ① expo-av 本地录音       │  ~2-5秒（用户说话时长）
│  格式: WAV 16kHz 单声道    │
└───────────┬─────────────┘
            │ 松手
            ▼
┌─────────────────────────┐
│  ② multipart 上传到后端   │  ~200-400ms
│  POST /ai/voice-intent   │  FormData { audio: file }
│  （不走 OSS，直传后端）     │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  ③ 百炼 ASR 一句话识别    │  ~500-800ms
│  gummy-chat-v1 (WebSocket)│
│  audioBuffer → transcript │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  ④ 统一分类器             │
│  intent only             │
│  navigate/search/...     │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  ⑤ 槽位抽取 + 实体解析      │
│  slots + resolved entities│
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  ⑥ 受控执行                │  ~100ms
│  白名单 / 登录 / 上下文校验 │
│  只认结构化结果            │
└─────────────────────────┘
```

---

## 4. 服务开通与配置

### 4.1 开通百炼平台（ASR + Qwen 统一）

1. **登录百炼控制台**
   - 访问 https://bailian.console.aliyun.com/ 或从 https://ai.aliyun.com/nls/ 进入
   - 用阿里云账号登录，点击「开通」（免费）

2. **创建 API Key**
   - 进入「密钥管理」页面
   - **选择华北2（北京）地域**（语音模型仅限北京地域）
   - 点击「创建 API Key」，复制保存

3. **免费额度**
   - 新用户赠 **7000万 Tokens**（Qwen 用）
   - ASR 按量计费，初期用量极小

> **注意**：不需要单独开通传统智能语音交互（NLS），百炼平台已包含 ASR 功能。

### 4.2 环境变量配置

在 `backend/.env` 中添加：

```env
# 阿里云百炼平台（语音识别 + Qwen 大模型，统一 API Key）
DASHSCOPE_API_KEY=你的百炼API_Key
```

仅需这一个环境变量，ASR 和 Qwen 共用。

---

## 5. 前端录音接入（expo-av）

### 5.1 安装依赖（已完成）

```bash
npx expo install expo-av
```

### 5.2 录音实现（已完成）

在 `app/(tabs)/home.tsx` 中，长按 AiOrb 触发真实录音：

```typescript
import { Audio } from 'expo-av';

const recordingRef = useRef<Audio.Recording | null>(null);

// 长按：请求麦克风权限并启动录音
const handleLongPress = useCallback(async () => {
  const { granted } = await Audio.requestPermissionsAsync();
  if (!granted) {
    Alert.alert('需要麦克风权限', '请在设置中允许麦克风访问');
    return;
  }
  await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
  // WAV 16kHz 单声道，兼容百炼 ASR
  const { recording } = await Audio.Recording.createAsync({
    android: { extension: '.wav', sampleRate: 16000, numberOfChannels: 1, ... },
    ios: { extension: '.wav', outputFormat: Audio.IOSOutputFormat.LINEARPCM, sampleRate: 16000, numberOfChannels: 1, ... },
  });
  recordingRef.current = recording;
  setIsRecording(true);
}, []);

// 松手：停止录音 → 上传 → 意图识别 → 跳转
const handleOrbPressOut = useCallback(async () => {
  if (!isRecording) return;
  setIsRecording(false);
  setIsProcessing(true);
  const recording = recordingRef.current;
  await recording.stopAndUnloadAsync();
  const uri = recording.getURI();
  recordingRef.current = null;
  const result = await AiAssistantRepo.parseVoiceIntent(uri);
  if (result.ok) navigateByIntent(result.data);
}, [isRecording, navigateByIntent]);
```

### 5.3 音频上传（已完成）

`AiAssistantRepo.parseVoiceIntent` 使用 `ApiClient.upload()` 发送 multipart/form-data：

```typescript
parseVoiceIntent: async (localUri: string): Promise<Result<AiVoiceIntent>> => {
  const formData = new FormData();
  formData.append('audio', { uri: localUri, type: 'audio/wav', name: 'voice.wav' } as any);
  return ApiClient.upload<AiVoiceIntent>('/ai/voice-intent', formData);
}
```

### 5.4 权限配置

**iOS** (`app.json`)：
```json
{ "ios": { "infoPlist": { "NSMicrophoneUsageDescription": "农脉需要使用麦克风来接收你的语音指令" } } }
```

**Android** (`app.json`)：
```json
{ "android": { "permissions": ["RECORD_AUDIO"] } }
```

---

## 6. 后端 ASR 语音转文字（百炼平台）

### 6.1 技术实现（已完成）

使用百炼平台 WebSocket API 调用 **gummy-chat-v1** 模型（一句话识别专用）。

**文件**：`backend/src/modules/ai/asr.service.ts`

**关键参数**：

| 参数 | 值 | 说明 |
|------|-----|------|
| WebSocket URL | `wss://dashscope.aliyuncs.com/api-ws/v1/inference/` | 北京地域 |
| 鉴权 | `Authorization: bearer <API_KEY>` | WebSocket header |
| 模型 | `gummy-chat-v1` | 一句话识别，对停顿敏感 |
| 采样率 | 16000Hz | 与前端录音匹配 |
| 音频格式 | wav（也支持 pcm/mp3/aac/opus/amr） | 前端录 WAV |
| 音频时长 | ≤1分钟 | 用户语音指令通常 2-5 秒 |
| 超时 | 15 秒 | 含部分结果降级返回 |

**交互流程**：

```
1. 建立 WebSocket 连接（携带 Authorization header）
2. 发送 run-task JSON（model: gummy-chat-v1）
3. 收到 task-started → 开始发送音频二进制（32KB/块，无延迟一次性发完）
4. 发送完毕 → 发送 finish-task JSON
5. 收集 result-generated 事件中 sentence_end=true 的文本
   - 百炼平台使用 header.event（非 header.action）
   - 转录结果在 payload.output.transcription（非 payload.output.sentence）
6. 收到 task-finished → 返回完整转录文本
```

**WAV 自动处理**：
- 自动检测 RIFF 头部，剥离 44 字节 WAV header，以 raw PCM 格式发送
- 未知音频格式自动回退为 pcm

### 6.1.1 2026-03-11 性能修复方案（已实施）

**问题现象**：用户只说一句很短的话（如「你好」），识别仍需等待较久，整体体感偏慢。

**已确认的主要原因**：
- 百炼 ASR 默认会等待尾静音后再判定句尾；短句结束后会额外停顿一段时间
- 旧实现中，后端在收到 `sentence_end=true` 后仅缓存文本，仍继续等待 `task-finished` 才返回结果
- 问候类短句（如「你好」「您好」）若未命中规则引擎，会额外走一次 Qwen 兜底

**本轮修复决策**：

| 优化项 | 方案 | 状态 | 目的 |
|------|------|------|------|
| ASR 尾静音阈值 | 按音频时长动态设置 `max_end_silence=200-400ms` | ✅ 已完成 | 缩短短句结束后的等待时间 |
| ASR 返回时机 | 收到最终句子（`sentence_end=true`）后直接返回，不再被动等待 `task-finished` | ✅ 已完成 | 去掉服务端收尾等待 |
| ASR 分段耗时 | 细化记录 `asr_connect_ms / asr_wait_final_ms / asr_ms` | ✅ 已完成 | 区分建连、尾部等待和整体识别耗时 |
| ASR 预建连 | 长按开始时调用 `/ai/voice-intent/prepare` 预热百炼 WebSocket | ✅ 已完成 | 减少松手后再建连的串行等待 |
| 短句意图识别 | 为 `你好/您好/哈喽/在吗/早上好/晚上好` 等问候语添加规则命中，直接返回 `chat` | ✅ 已完成 | 避免短句再走 Qwen |
| 分段耗时观测 | 增加录音收尾、上传、ASR、意图识别四段耗时日志 | ✅ 已完成 | 便于定位真实瓶颈并验证优化效果 |

**预期收益（估算值，待真机复测确认）**：
- 超短语音可减少约 **400-1000ms** 等待时间
- 问候类短句可再减少一次 **Qwen 300-600ms** 的额外耗时
- 规则命中的常见短指令，目标体感压缩到 **~1 秒级**

> 参考：阿里云百炼实时语音识别 WebSocket API 文档中，`max_end_silence` 默认值为 **700ms**，参数范围 **200ms-6000ms**。当前实现会根据短语音时长动态取 **200-400ms**，优先压缩尾部等待。

### 6.2 语音意图端点（已完成）

**文件**：`backend/src/modules/ai/ai.controller.ts`

```typescript
@Public()  // 无需登录即可使用
@Post('voice-intent')
@UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 10 * 1024 * 1024 } }))
async parseVoiceIntent(
  @UploadedFile() audioFile: Express.Multer.File,
) {
  const format = this.getAudioFormat(audioFile.mimetype); // wav/mp3/aac/...
  return this.aiService.parseVoiceIntent(audioFile.buffer, format);
}
```

> **注意**：语音意图解析、快捷入口、问候语三个端点均标记 `@Public()`，无需登录即可使用。

### 6.2.1 `classify_ms` / `entity_resolve_ms` 优化方法

在当前埋点里：

- `classify_ms` = 一级意图分类耗时
- `entity_resolve_ms` = 商品 / 企业 / 推荐条件的实体解析与参数补全过程耗时

这两段通常决定：

- 为什么 `search` 很快，但 `recommend` 明显更慢
- 为什么同样一句短语音，ASR 已经只有 `1-3s`，总耗时仍可能到 `6-10s`

#### A. `classify_ms` 的优化方向

**核心目标**：少调模型，扩大高确定性快路径。

**建议步骤**：

1. **扩大 fast-path 覆盖率**
   - 对明确 `search / navigate / FAQ / greeting` 直接短路，不进入 Qwen 分类
   - 典型例子：`打开购物车`、`今天几号`、`帮我找鸡蛋`

2. **规则引擎只保留高确定性白名单**
   - 只处理 100% 确定的硬指令
   - 不再让规则引擎和 Qwen 在模糊句子上重复“打架”

3. **缩短分类 prompt**
   - 分类 prompt 只回答：`intent + 核心 slots`
   - 不把大量业务说明、示例、运营话术混进分类 prompt

4. **避免同一轮重复分类**
   - 分类结果一旦已拿到，后续 `search / recommend / company` 解析尽量复用
   - 不再在后处理阶段重新做等价的模型判断

**适用场景**：
- `search`
- `navigate`
- `chat FAQ`
- 问候语

#### B. `entity_resolve_ms` 的优化方向

**核心目标**：少做开放式重写，多做结构化精确匹配。

**建议步骤**：

1. **明确 query 直接命中**
   - 若已抽出稳定核心词（如 `鸡蛋 / 水果 / 牛肉 / 武汉`），直接跳过重写
   - 不再让模型把同一个词“重写一遍还是自己”

2. **优先用结构化字段精确匹配**
   - 商品：优先 `category / tags / aiKeywords`
   - 企业：优先 `companyType / industryTags / address.province/city/district/postalCode`
   - 推荐：优先 `recommendThemes / budget / constraints`

3. **把泛称映射前移**
   - `卖水果的公司` → `industryHint=水果`
   - `武汉有哪些企业` → `location=武汉`
   - `今天有什么爆款` → `recommendThemes=["hot"]`

4. **推荐链路拆轻重两档**
   - 轻推荐：`今天有什么水果 / 最近有什么好茶`
   - 重推荐：`100 元预算给我搭配一套`
   - 轻推荐优先走 `query/category + theme`，避免完整大模型解析

5. **候选集约束匹配**
   - 企业纠偏只在真实企业候选里做
   - 商品映射只在当前分类 / 标签 / 关键词候选里做
   - 避免开放式改写带来的额外耗时和幻觉

#### C. 当前执行优先级

按最近真实日志，当前最值得优先优化的是：

1. **扩搜索 fast-path**，继续压 `classify_ms`
2. **给 `recommend` 增加 `recommend-lite`**，优先压 `entity_resolve_ms`
3. **企业与商品侧继续补结构化数据**，减少文本拼接匹配

一句话总结：

- `classify_ms`：靠“少调模型”
- `entity_resolve_ms`：靠“少重写、多精确匹配”

---

## 7. 统一语音路由器（分类器 + 槽位 + 实体 + 执行）

### 7.1 核心结论

从这一版开始，语音策略不再继续沿用旧的“规则引擎 + 局部模型补丁”思路，后续统一切换到这条主链路：

```text
ASR
  -> 统一分类器
  -> 槽位抽取
  -> 动态实体解析
  -> 受控执行
```

这意味着：
- 不再把语音理解当成单个 `parseIntent()` 函数
- 不再把执行动作建立在自然语言残句上
- 不再继续把“补正则”当成长期主策略

**判断标准**：
- 模型负责理解
- 数据负责约束
- 执行层只认结构化结果

### 7.2 统一语音路由器的 4 层职责

#### 7.2.1 统一分类器（Intent Classifier）

第一层只判断一句话属于哪类任务，不负责抽关键词，也不直接跳转。

固定一级意图：
- `navigate`
- `search`
- `company`
- `transaction`
- `recommend`
- `chat`

推荐输出：

```json
{"intent":"company","confidence":0.93,"slots":{}}
```

#### 7.2.2 槽位抽取（Slot Extraction）

分类完成后，再按意图抽对应参数：

- `navigate`
  - `targetPage`
- `search`
  - `query`
  - `categoryHint`
  - `preferRecommended`
  - `constraints`
  - `budget`
  - `recommendThemes`
- `company`
  - `mode`: `list | detail | search`
  - `name`
- `transaction`
  - `action`
  - `status`
- `recommend`
  - `query`
  - `budget`
  - `constraints`
  - `recommendThemes`

例如：

```json
{
  "intent": "company",
  "confidence": 0.93,
  "slots": {
    "mode": "detail",
    "name": "清河农场"
  }
}
```

#### 7.2.3 动态实体解析（Dynamic Entity Resolution）

槽位不能直接执行，必须先和当前真实业务数据对齐。

典型映射：
- `清河农场` -> `青禾智慧农场`
- `鲜果` -> `水果`
- `去付款` -> `pay`

**约束原则**：
- 模型可以帮助纠偏
- 但最终只能在当前真实候选集合内选择
- 不能凭空生成不存在的分类、企业、商品或页面

#### 7.2.4 受控执行（Controlled Execution）

执行层只认结构化结果，例如：

```json
{
  "intent": "company",
  "slots": {
    "mode": "detail",
    "name": "青禾智慧农场"
  },
  "resolved": {
    "companyId": "c-002",
    "companyName": "青禾智慧农场"
  }
}
```

执行规则：
- `company + resolvedCompanyId` -> 打开企业详情
- `company + mode=list` -> 打开企业搜索/企业列表页
- `company + mode=search` -> 打开企业搜索结果页
- `search + 无明确商品` -> 打开搜索结果页，不直接执行危险动作
- `transaction + 未登录` -> 先弹登录
- `transaction + 缺上下文` -> 追问或降级，不直接执行

### 7.3 建议的统一返回 Schema

后端最终应逐步从旧的 `type + param + feedback` 过渡到：

```json
{
  "intent": "search",
  "confidence": 0.94,
  "slots": {
    "query": "海鲜",
    "preferRecommended": true
  },
  "resolved": {
    "matchedCategoryId": "cat-seafood",
    "matchedCategoryName": "海鲜"
  },
  "feedback": "正在为你搜索海鲜..."
}
```

建议统一字段：
- `intent`
- `confidence`
- `slots`
- `resolved`
- `feedback`
- `fallbackReason`

### 7.4 模型分工建议

| 层 | 任务 | 建议模型 | 说明 |
|------|------|----------|------|
| 统一分类器 | 先分 `navigate/search/company/transaction/recommend/chat` | `qwen-flash` | 快、便宜、稳定 |
| 槽位抽取 | 抽 `query/action/mode/budget/...` | `qwen-flash` | 结构化 JSON 即可 |
| 动态实体解析 | 企业纠偏、分类映射、同音错字回写 | `qwen-flash` + 当前候选集合 | 受真实数据强约束 |
| 受控执行 | 跳转、登录拦截、交易校验、白名单执行 | 不依赖生成式模型 | 前后端逻辑完成 |
| 推荐 / 预算导购 | 组合推荐、预算规划、推荐理由 | `qwen-plus` | 复杂理解单独处理 |
| 多轮聊天 | 上下文追问、开放问答 | `qwen-plus` | 不混进执行型语音链路 |

**明确不再采用的旧策略**：
- 不再以“补正则 + 搜索词清洗”作为长期主方案
- 不再把所有语音统一塞到一个兜底 prompt
- 不再让前端根据自然语言残句二次猜测执行对象

### 7.5 搜索主方案：动态分类数据 + 语义模型

搜索类语音最终不能依赖静态词表，也不能只靠模型“自由猜测”。更稳的做法是：

```text
当前后台有效分类树（Category）
  + 当前商品标签/关键词
  + 用户语音 query
  -> Qwen-Flash 在当前候选集合内做语义映射
  -> 输出 matchedCategory / query / constraints
  -> 检索商品
```

**关键原则**：
- 后台分类管理是商品类目的唯一主数据源
- 模型负责“理解用户话里的语义”，但只能在“当前有效分类集合”里做匹配
- 不能让模型凭空生成一个后台不存在的分类
- `aliases/synonyms` 可以有，但应视为加速缓存，不应成为唯一真相来源

**为什么不能只靠静态 aliases/synonyms**：
- 后台分类会持续增删改，手工维护别名容易滞后
- 新增分类后，静态词表不会自动知道它的近义表达
- 只靠静态别名表无法覆盖长尾口语，比如“海产”“鲜果”“牛排类的”

**为什么也不能只靠更强模型**：
- 模型能理解语义，但不知道当前后台到底有哪些真实分类
- 如果不给它当前分类集合，它可能会输出不存在的分类，产生幻觉
- 所以正确方式不是“让模型猜”，而是“让模型在真实分类候选里做选择”

**推荐实现**：
1. 每次 search handler 执行时，先读取当前有效分类树（如 `水果 / 海鲜 / 牛肉 / 榴莲`）
2. 同时读取分类路径、商品标签、`aiKeywords` 作为候选上下文
3. 让 `qwen-flash` 输出：
   - `query`
   - `matchedCategoryId`
   - `matchedCategoryName`
   - `preferRecommended`
   - `constraints`
4. 后端只接受候选集合内存在的 `matchedCategoryId`
5. 若模型未命中任何有效分类，则降级为普通关键词搜索

**当前已落地的第一阶段**：
- 商品搜索接口 `GET /products?keyword=` 已接入后台实时分类树
- 若 query 直接命中父分类（如 `水果`），后端会自动召回其子分类商品（如 `浆果 -> 蓝莓`）
- 若 query 不能直接命中分类（如 `鲜果`），后端会调用 `qwen-flash`，但只能在当前有效分类候选集合里做映射
- 搜索页提交后改为优先请求后端关键词检索，因此后台分类树和语义映射已真正生效
- 发现页分类横滑改为读取 `/products/categories` 的一级分类，不再依赖前端静态分类常量
- 分类详情页改为通过真实 `categoryId` 请求后端商品列表，并继承父分类召回子分类商品能力
- 首页语音跳转搜索时，会把结构化参数带到搜索页，不再只传单个关键词字符串
- AI 推荐页已开始消费语音里的 `query / budget / constraints / recommendThemes`，推荐语音不再只能退回普通搜索页
- 商品搜索排序已开始消费 `preferRecommended / constraints`：
  - `preferRecommended=true` 时，会提升 `有机认证 / 可信溯源 / 地理标志 / 检测报告 / 当季鲜采` 等质量信号
  - `constraints` 当前先支持：`organic / low-sugar / seasonal / traceable / cold-chain / geo-certified / healthy / fresh`
- `recommend` 当前新增 `recommendThemes`：
  - `hot`：爆款 / 热销 / 人气
  - `discount`：折扣 / 优惠 / 特价
  - `tasty`：好吃 / 美味 / 口感
  - `seasonal`：当季 / 应季
  - `recent`：最近 / 近期 / 新品
- 商品搜索排序已开始消费 `recommendThemes`：
  - `hot`：优先提升热销词、质量信号和较新的商品
  - `discount`：优先提升优惠词信号，并对低价商品做轻量加权
  - `tasty`：优先提升美味/口感词、新鲜信号和质量信号
  - `seasonal`：优先提升当季/应季信号
  - `recent`：优先提升最近创建和新品信号
- 当前示例验证：
  - `水果` -> 命中 `水果` 父分类，召回 `蓝莓`
  - `鲜果` -> `qwen-flash` 映射到 `水果`，再召回 `蓝莓`
  - `鸡蛋` -> `qwen-flash` 映射到 `禽蛋`，命中 `土鸡蛋`
  - `categoryId=cat-fruit` -> 分类详情页可直接召回 `浆果 -> 蓝莓`
  - `有没有鲜果` -> `search.query=水果`，并附带 `matchedCategoryId=cat-fruit`
  - `有没有推荐的海鲜` -> `search.query=海鲜`，并附带 `preferRecommended=true`
  - `帮我找有机蔬菜` -> `search.constraints=["organic"]`
  - `推荐今天的爆款` -> `recommend.recommendThemes=["hot"]`
  - `推荐今天的折扣商品` -> `recommend.recommendThemes=["discount"]`
  - `推荐最近好吃的食物` -> `recommend.recommendThemes=["recent","tasty"]`
  - `蔬菜 + constraints=traceable` 时，带 `可信溯源` 的生菜会被提升

**可选优化**：
- 当后台新增/修改分类时，异步用 `qwen-flash` 为该分类生成一组候选别名，缓存到 `aliases`
- 搜索时先走 `aliases` 快速匹配，再决定是否调用模型
- 但即使有 `aliases`，最终也仍以实时分类树为准

### 7.6 推荐信号设计（建议方案）

当前这版 `recommendThemes` 已能识别 `hot / discount / tasty / seasonal / recent`，但排序仍属于第一阶段启发式：
- 目前主要依赖 `title / subtitle / tags / aiKeywords / createdAt / price`
- 还没有独立的 `爆款 / 折扣 / 当季 / 好吃` 结构化字段
- 因此当前结果能工作，但不应视为最终推荐引擎

**核心原则**：
- 不应该要求运营或商家为每个商品手动设置所有推荐主题
- 也不应该完全依赖模型自由理解，因为模型不知道真实业务状态
- 更合理的是：**商品基础事实人工维护，推荐信号系统自动计算，运营只做少量覆盖**

**推荐信号拆分**：

| 信号 | 是否应手动维护 | 推荐来源 | 说明 |
|------|----------------|----------|------|
| `category` 分类 | 是 | 后台分类管理 | 商品的基础真值，必须人工选定 |
| `flavorTags` 口味标签 | 适度人工维护 | 商品标签 / 属性 | 如 `鲜甜 / 脆甜 / 回甘 / 软糯`，用于“好吃”类推荐 |
| `seasonalMonths` 当季月份 | 半自动 | 分类规则 + 人工覆盖 | 如草莓 12-4 月；后台可修正 |
| `hotScore` 爆款分 | 否 | 销量 / 下单 / 点击 / 收藏自动计算 | 不建议人工逐个打“爆款” |
| `discountRate` 折扣率 | 否 | 原价 / 活动价自动计算 | 不建议人工逐个打“折扣” |
| `recentScore` 上新分 | 否 | `createdAt / launchAt` 自动计算 | “最近”“新品”应由时间决定 |
| `tastyScore` 好吃分 | 否为主 | 评分 / 评论 / 复购 + `flavorTags` | “好吃”更适合混合信号，不适合纯人工 |
| `manualBoost` 运营加权 | 少量人工维护 | 运营后台 | 用于主推活动、临时强干预 |

**建议的数据层设计**：

第一层：商品基础事实（人工维护）
- `categoryId`
- `title / subtitle / description`
- `tags`
- `aiKeywords`
- `attributes`
- 建议新增：
  - `flavorTags: string[]`
  - `seasonalMonths: number[]`
  - `manualRecommendTags: string[]`
  - `manualBoost: number`

第二层：系统计算信号（自动维护）
- `sales7d`
- `sales30d`
- `orderCount7d`
- `viewCount7d`
- `favoriteCount7d`
- `hotScore`
- `discountRate`
- `recentScore`
- `seasonalScore`
- `tastyScore`

第三层：推荐结果层（查询时动态生成）
- 当用户说“推荐今天的爆款”
  - 主要依赖：`hotScore + manualBoost`
- 当用户说“推荐今天的折扣商品”
  - 主要依赖：`discountRate + 活动状态`
- 当用户说“推荐最近好吃的食物”
  - 主要依赖：`recentScore + tastyScore + flavorTags`
- 当用户说“推荐今天的当季水果”
  - 主要依赖：`seasonalScore + categoryId=水果`

**对后台的实际要求**：
- 不是让后台为每个商品逐个勾选“爆款 / 折扣 / 最近 / 好吃”
- 后台真正需要维护的是：
  - 正确分类
  - 合理标签
  - 必要的 `aiKeywords`
  - 口味类描述（如果商品确实有）
  - 少量运营人工主推位

**哪些推荐主题该怎么落**：

1. `hot` 爆款
- 不建议人工逐个维护
- 应由销量、下单量、点击量、收藏量、近 7/30 天趋势自动计算
- 可保留 `manualBoost` 让运营短期推高某些活动商品

2. `discount` 折扣
- 不建议人工写“这是折扣商品”
- 应增加“原价 / 活动价 / 活动时间”字段，再自动算 `discountRate`
- 目前若没有原价与活动价结构化字段，只能先用标签和价格做弱推断

3. `recent` 最近 / 新品
- 不需要人工维护
- 直接根据 `createdAt` 或后续新增的 `launchAt` 自动计算

4. `seasonal` 当季
- 不建议完全人工逐个打标签
- 推荐方式：
  - 类目默认季节规则
  - 商品可选 `seasonalMonths` 覆盖
  - 查询时按当前日期算 `seasonalScore`

5. `tasty` 好吃
- 不适合纯自动，也不适合全人工
- 推荐混合来源：
  - 人工维护 `flavorTags`
  - 用户评分
  - 评论关键词情感
  - 复购率

**为什么不建议只靠标签**：
- 标签适合表达“卖点”，不适合承载所有推荐排序逻辑
- `爆款 / 折扣 / 最近` 本质上是动态信号，随时间和业务数据变化
- 如果全部手工维护，运营成本会越来越高，而且很快过期

**建议的实施顺序**：
1. 先保留当前启发式排序作为过渡方案
2. 后台商品表新增推荐信号相关字段：
   - `originalPrice` 或活动价信息
   - `flavorTags`
   - `seasonalMonths`
   - `manualBoost`
3. 新增定时任务或聚合表，计算：
   - `hotScore`
   - `discountRate`
   - `recentScore`
   - `seasonalScore`
4. 商品检索排序从“标签启发式”切到“结构化信号优先”
5. 最后再让 `qwen-plus` 在推荐理由里解释这些排序依据

**当前仓库现状（便于后续实现）**：
- 商品模型已有：`categoryId / attributes / aiKeywords / tags / basePrice / createdAt`
- 卖家商品创建与编辑接口已支持：`tags / aiKeywords / attributes`
- 管理端商品更新目前支持：`aiKeywords / attributes`
- 仍缺少专门的：
  - `originalPrice / 活动价`
  - `flavorTags`
  - `seasonalMonths`
  - `manualBoost`
  - `hotScore / discountRate / tastyScore / recentScore`

### 7.7 目标 Schema 与典型例子

```json
{"intent":"navigate","confidence":0.98,"slots":{"targetPage":"cart"},"resolved":{"route":"/cart"}}
{"intent":"search","confidence":0.94,"slots":{"query":"水果","preferRecommended":false},"resolved":{"matchedCategoryId":"cat-fruit","matchedCategoryName":"水果"}}
{"intent":"company","confidence":0.91,"slots":{"mode":"detail","name":"清河农场"},"resolved":{"companyId":"c-002","companyName":"青禾智慧农场"}}
{"intent":"company","confidence":0.95,"slots":{"mode":"list"},"resolved":{}}
{"intent":"transaction","confidence":0.96,"slots":{"action":"pay"},"resolved":{"requiredLogin":true}}
{"intent":"recommend","confidence":0.94,"slots":{"budget":100,"recommendThemes":["hot"]},"resolved":{}}
```

**相近话术如何归一**：
- 「有没有海鲜」→ `search`
- 「有没有推荐的海鲜」→ 仍是 `search`，差异写进 `slots.preferRecommended`
- 「推荐点海鲜给我」→ `recommend`
- 「现在有哪些企业」→ `company + mode=list`
- 「打开农场」→ `company + mode=list`
- 「打开青禾农场」→ `company + mode=detail`

### 7.8 建议实施顺序

1. 重构 `ai.service.ts` 为四段式：
   - `classifyIntent()`
   - `extractSlots()`
   - `resolveEntities()`
   - `dispatchExecution()`
2. 先打通两个高频链路：
   - `search`
   - `company`
3. 再补 `transaction` 的受控动作
4. 最后把 `recommend` 升级成复杂组合导购

### 7.9 日志与回放要求

统一记录：
- `transcript`
- `intent`
- `slots`
- `resolved`
- `finalAction`
- `fallbackReason`

示例：

```json
{
  "transcript": "打开清河农场",
  "intent": "company",
  "slots": { "mode": "detail", "name": "清河农场" },
  "resolved": { "companyId": "c-002", "companyName": "青禾智慧农场" },
  "finalAction": "open_company_detail"
}
```

### 7.10 如何查看后台数据与日志

当前排查语音、企业搜索、推荐结果时，建议固定用下面 4 种方式。

**1. 看后端实时日志（首选）**

重点关注：
- `语音转录结果：...`
- `[VoiceRoute] classified ...`
- `[VoiceSearch] ...`
- `[VoicePerf] asr=... classify=... entity=... total=...`

启动命令：

```bash
cd backend
npm run start:dev
```

如果只是确认 3000 端口是谁在占用：

```bash
lsof -i :3000
```

**2. 直接查数据库（确认真实落库结果）**

适用于确认：
- 最近语音到底落了什么 `transcript / intent / slots / resolved`
- 企业资料当前真实 `description / address / highlights`
- 首页“最近对话”到底按 session 还是按 utterance 更新

查询最近语音：

```bash
cd backend && node - <<'NODE'
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const rows = await prisma.aiUtterance.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    include: { intentResults: true, session: true },
  });
  console.log(JSON.stringify(rows, null, 2));
  await prisma.$disconnect();
})();
NODE
```

查询指定企业：

```bash
cd backend && node - <<'NODE'
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const company = await prisma.company.findUnique({
    where: { id: 'c-002' },
    include: { profile: true },
  });
  console.log(JSON.stringify(company, null, 2));
  await prisma.$disconnect();
})();
NODE
```

**3. 直接打公开接口（确认前端真正拿到什么）**

适用于确认：
- `CompanyService.mapToFrontend()` 最终输出
- `location / address / mainBusiness / badges / industryTags` 是否已经映射正确

```bash
curl http://localhost:3000/api/v1/companies
curl http://localhost:3000/api/v1/companies/c-002
```

**4. 清前端缓存重测（排除旧 bundle）**

当出现“首页最近对话没更新”“企业搜索还是旧逻辑”“新接口已改但手机上没生效”时，先清 Expo/Metro 缓存：

```bash
npx expo start -c
```

这是排查“后端已修、前端仍像旧版本”的第一步。

---

## 8. 前端跳转执行

在 `app/(tabs)/home.tsx` → `navigateByIntent()`：

```typescript
const navigateByIntent = useCallback((intent: AiVoiceIntent) => {
  switch (intent.type) {
    case 'search':
      setFeedbackText(intent.feedback);
      setTimeout(() => router.push({ pathname: '/search', params: { q: intent.param } }), 800);
      break;
    case 'company':
      setFeedbackText(intent.feedback);
      setTimeout(() => router.push({ pathname: '/company/[id]', params: { id: intent.param } }), 800);
      break;
    case 'chat':
    default:
      // 在首页展示 AI 回复（6秒），不强制跳转；用户可继续长按对话或点击进入聊天页
      setFeedbackText(intent.feedback || '我在呢，有什么可以帮你？');
      break;
  }
}, [router]);
```

**当前交互模式**：
- `search`/`company`：显示反馈文字 0.8s 后自动跳转对应页面
- `navigate`：立即执行页面跳转；若目标页需要登录（当前为 `settings` / `orders`），先弹登录框，登录成功后再继续跳转
- `chat`：在首页反馈条展示 AI 回复（保持 6 秒），不跳转，用户可继续长按语音对话
- **当前限制**：仅单轮问答，每次语音请求独立，无上下文记忆

---

## 9. 延迟与性能分析

### 9.1 全链路延迟分解

| 步骤 | 耗时 | 说明 |
|---|---|---|
| 松手 → 音频编码完成 | ~100ms | expo-av 本地处理 |
| 上传音频到后端 | ~200-400ms | 5秒录音 ≈ 160KB WAV，国内 4G/WiFi |
| 后端接收 → 调 ASR | ~100ms | WebSocket 建连 |
| **百炼 ASR 一句话识别** | **~500-800ms** | **最大瓶颈** |
| 意图分类（规则命中） | <1ms | 本地正则匹配 |
| 意图分类（Qwen 兜底） | ~300-600ms | 仅 20% 请求走这步 |
| 返回前端 + 执行跳转 | ~100ms | 网络 + router.push |

### 9.2 总延迟

| 场景 | 总耗时 | 占比 |
|---|---|---|
| 规则命中（"帮我找有机蔬菜"） | **~1-1.5秒** | ~80% |
| Qwen 兜底（"最近有什么划算的推荐"） | **~1.5-2.5秒** | ~20% |

### 9.3 用户体感优化

通过 UI 反馈让用户感觉更快：

```
松手 → AiOrb 切 thinking 状态 + "正在识别语音..."
  → 1s → 显示 feedback（"正在搜索..."）→ 跳转
```

### 9.4 2026-03-11 本轮性能修复目标（待实施）

本轮不改交互形态，只优化当前单轮语音链路的返回时机：

1. ASR 侧将 `max_end_silence` 从默认 **700ms** 调整为 **400ms**
2. 服务端拿到最终句子后立即返回，不再等待 `task-finished`
3. 问候类短句直接走规则引擎，绕过 Qwen
4. 对整条链路补充分段耗时日志，复测「你好」「帮我找苹果」「最近有什么优惠」三类样本

**预期效果（估算）**：
- 「你好」这类短句：总耗时预计下降最明显
- 规则命中类搜索指令：预计可从 **~1-1.5 秒** 进一步压缩
- Qwen 兜底类问题：ASR 部分会变快，但整体仍受大模型返回速度影响

---

## 10. 费用估算（分阶段详细计算）

### 10.0 百炼平台定价参考（2026-03-11 校对）

以下为当前与你这条语音链路最相关的模型价格，均按 **非思考模式** 记录：

| 服务 / 模型 | 适用任务 | 计费口径 | 官方单价 |
|---|---|---|---|
| **百炼 ASR（gummy-chat-v1）** | 语音转文字 | 按音频秒数 | 仍按百炼控制台实时页为准 |
| **Qwen-Flash** | 搜索词改写、动作导航、简单问答 | 按 token | 输入 **0.15 元/百万 token**，输出 **1.5 元/百万 token** |
| **Qwen-Turbo** | 历史兜底意图分类 | 按 token | 输入 **0.3 元/百万 token**，输出 **0.6 元/百万 token** |
| **Qwen-Plus** | 推荐、预算导购、复杂理解、多轮对话 | 按 token | 输入 **0.8 元/百万 token**，输出 **2 元/百万 token** |
| **ECS 服务器**（后端已有） | 应用托管 | 月付 | 已有，不额外增加 |

> `qwen-turbo` 当前仍可用，但阿里云官方已明确标注为历史模型；新接入建议优先选 `qwen-flash`。

---

### 10.1 初期：验证阶段（0-3个月）

**目标**：先把语音搜索、动作导航、预算推荐三类需求跑通
**预计日活**：50-200 用户
**预计语音次数**：100-400 次/天
**推荐模型组合**：
- 搜索词改写 / 动作导航 / 简单问答：`qwen-flash`
- 推荐 / 预算导购 / 多轮对话：`qwen-plus`

#### 省钱策略

| 策略 | 省了什么 | 影响 |
|---|---|---|
| **规则引擎为主，Qwen 只补复杂语义** | 节省大部分 LLM 费用 | 明确指令维持极快响应 |
| **动作模型改用 Qwen-Flash** | 比一直用 `qwen-plus` 更便宜 | 动作类请求几乎无质量损失 |
| **音频直传后端，不走 OSS** | 省掉 OSS 存储+流量费 | 音频不留存（初期不需要） |
| **优先吃百炼赠送额度** | 省掉大部分早期费用 | 免费额度以控制台实时展示为准 |

#### 目标架构（建议）

```
前端录音(expo-av WAV)
  → 直传后端(multipart)
  → 百炼ASR(gummy-chat-v1)
  → 规则引擎
      ├─ 明确搜索 / 店铺 / 订单 → 直接执行
      ├─ 搜索词噪声 / 动作导航 → Qwen-Flash
      └─ 推荐 / 预算导购 / 复杂问答 → Qwen-Plus
```

#### 初期月成本：**接近 0 元**（百炼免费额度覆盖）

---

### 10.2 单次调用粗估（与你当前场景最相关）

| 场景 | 建议模型 | 典型请求规模 | 单次粗估成本 |
|---|---|---|---|
| 语音搜索词改写 | `qwen-flash` | 输入 400-800 token，输出 20-80 token | **约 0.0001-0.0003 元/次** |
| 动作类语音导航 | `qwen-flash` | 输入 400-900 token，输出 20-100 token | **约 0.0001-0.0003 元/次** |
| 推荐 / 预算导购 | `qwen-plus` | 输入 800-2000 token，输出 200-600 token | **约 0.0010-0.0030 元/次** |

> 结论：对你这种「短语音 + 短输出」场景，模型调用费远低于 ASR；真正需要控制的是**不要把所有请求都走 `qwen-plus`**。

---

### 10.3 中期：增长阶段（3-12个月）

**预计日活**：500-3,000 用户

#### 中期成本明细（按日活 1,000 计算，按建议路由估算）

| 项目 | 计算方式 | 月成本 |
|---|---|---|
| **百炼 ASR** | 60,000次 × 3秒 × 0.0003元/秒 | **~54元** |
| **Qwen-Flash（动作/搜索重写）** | 15,000次 ×（700 in + 80 out）token | **~3-4元** |
| **Qwen-Plus（推荐/复杂对话）** | 3,000次 ×（1800 in + 350 out）token | **~6-7元** |
| **月总计** | | **~64-65元** |

#### 模型路由收益

| 方案 | 月成本（仅模型部分） | 说明 |
|---|---|---|
| 搜索重写一直用 `qwen-plus` | **~10-11元** | 能用，但没有必要 |
| 搜索重写 / 动作用 `qwen-flash` | **~3-4元** | 成本约降到原来的三分之一 |

> 从你当前需求看，最省钱同时又不太牺牲效果的路线就是：**动作/改写用 `flash`，推荐/复杂理解用 `plus`**。

---

### 10.4 后期：规模化阶段（12个月+）

**预计日活**：5,000-50,000 用户

| 日活 | ASR | Qwen-Flash | Qwen-Plus | TTS | **月总计** |
|---|---|---|---|---|---|
| 5,000 | ~270元 | ~15-20元 | ~30-35元 | 125元 | **~440-450元** |
| 10,000 | ~540元 | ~30-40元 | ~60-70元 | 250元 | **~880-900元** |
| 50,000 | ~2,700元 | ~150-200元 | ~300-350元 | 1,250元 | **~4,400-4,500元** |

### 10.5 成本总览对比

| 阶段 | 时间 | 日活 | 月成本 | 人均成本/月 |
|---|---|---|---|---|
| **初期（验证）** | 0-3月 | 50-200 | **~0元** | 0元 |
| **中期（增长）** | 3-12月 | 500-3,000 | **~64-195元** | ~0.06元 |
| **后期（规模）** | 12月+ | 5,000-50,000 | **~440-4,500元** | ~0.09元 |

**核心结论**：
1. **初期利用百炼免费额度，接近零成本**
2. **你这类短语音任务真正该优化的是模型路由，而不是单次调用费**
3. **最大省钱杠杆是把动作 / 搜索改写切到 `qwen-flash`**，把 `qwen-plus` 留给推荐和复杂理解
4. **规则引擎覆盖率越高，LLM 成本越低**；明确指令尽量不要交给大模型

**官方价格参考**：
- 阿里云百炼模型大全：https://help.aliyun.com/zh/model-studio/models
- 千问模型计费说明：https://help.aliyun.com/zh/model-studio/qwen-model-billing-notice

---

## 11. 常见问题

### Q: expo-av 在中国能用吗？
**能用。** 录音功能完全在本地执行（iOS AVAudioRecorder / Android MediaRecorder），不依赖任何海外服务或 Google Play Services。

### Q: 为什么用百炼平台而不是传统 NLS？
百炼平台是阿里云新一代 AI 服务入口，ASR + LLM 统一 API Key 管理，接入更简单，价格更低。传统 NLS 控制台（nls.console.aliyun.com）已逐步迁移到百炼。

### Q: 可以用 Claude/GPT 代替 Qwen 吗？
技术上可以，但不推荐作为主力：(1) 海外 API 从国内访问延迟高 (2) 价格贵几倍 (3) 可能需要翻墙。Qwen 中文能力不输 GPT-4，且在阿里云内网调用最快。

### Q: 意图识别为什么不全用大模型？
成本和延迟。规则引擎处理"帮我找XXX"这类简单请求 <1ms、0 成本。大模型处理同样请求需要 300-600ms。80% 的语音指令是简单搜索，没必要为此调用大模型。

### Q: 「打开购物车」「去结算」「推荐100元内买什么」这类语音用哪个模型最合适？
建议按任务拆层：
- **动作导航 / 搜索词改写 / 简单问答**：优先用 `qwen-flash`
- **预算推荐 / 复杂导购 / 多轮对话**：优先用 `qwen-plus`

原因是前者本质上是结构化分类和参数抽取，`flash` 更便宜更快；后者需要更强的组合、排序、预算理解能力，`plus` 更稳。

### Q: 录音时长限制？
gummy-chat-v1 支持 1 分钟以内的短语音。实际用户说一句指令通常 2-5 秒。后端设置 15 秒超时。

---

## 12. 后续升级路线

### Phase 1：基础语音跳转 ✅ 已完成
- expo-av 录音 → 百炼 ASR (gummy-chat-v1) → 规则引擎 + Qwen 意图分类 → 页面跳转
- 无需登录即可使用（`@Public()` 装饰器）
- 录音动画反馈（脉动光环 + 扩散波纹 + ActivityIndicator 旋转）
- chat 意图在首页展示回复，不强制跳转
- ASR 预录音频无延迟批量发送（当前 128KB/块），并按短语音时长动态收紧 `max_end_silence`

### Phase 1.2：统一语音路由器重构 🟡 进行中
**目标**：把首页语音从“补丁式理解”升级为“结构化语义流水线”

**目标主链路**：
`ASR -> 统一分类器 -> 槽位抽取 -> 动态实体解析 -> 受控执行`

**方案**：
- 固定一级意图：`navigate / search / company / transaction / recommend / chat`
- 固定二级结构：`slots`
- 固定三级结构：`resolved`
- 前端执行层不再根据自然语言残句二次猜测
- 企业、商品、分类、交易动作都先经过实体解析
- 推荐与复杂导购继续单列给 `qwen-plus`

**当前落地状态**：
- 已完成：六类意图的过渡态落地
- 已完成：`search` 与 `company` 已开始返回结构化参数
- 已完成：商品分类和企业名称已接入动态候选集合约束
- 已完成：企业链路已接入受约束的同音纠偏
- 🟡 进行中：统一 `resolved intent` 返回协议已在后端产出，首页主执行层、聊天页、历史页、最近对话已开始消费；仍有少量 legacy `param` 兼容残留
- 🟡 进行中：`transaction` 仍以单步受控动作优先，深层业务流待继续补齐
- 🟡 进行中：`recommend` 已可直达专用推荐页、消费结构化参数，并由后端输出第一阶段组合导购方案，复杂组合重排待继续补齐
- ⬜ 未开始：统一回放日志与错误归因体系

### Phase 2：多轮对话（核心升级） 🟡 基础会话链路已接通
**目标**：从单轮问答升级为连续多轮对话，AI 具备上下文记忆

#### 2.1 核心架构决策

**双脑分治**：首页和聊天页使用完全不同的处理链路，互不干扰。

| 入口 | 主脑 | 链路 | 执行方式 |
|------|------|------|----------|
| **首页语音** | 规则引擎 + Qwen-Flash | `ASR → 路由器 → 执行` | 自动执行（快、稳、适合指令） |
| **聊天页** | Qwen-Plus | `messages history → Qwen-Plus → reply + optional suggestedActions` | 先建议，用户确认后执行 |

**为什么不在聊天页里也走 parseIntent()？**
- 聊天页天然更开放，用户会说"我想看看有没有适合减脂的""帮我找点便宜的""那就去付款吧""顺便打开订单"
- 如果聊天模型一句理解错了就直接执行，风险比首页指令入口高很多
- 先让规则引擎/Qwen-Flash 做一级路由再让 Qwen-Plus 聊天 = 两套脑子打架
- 所以聊天页内 **Qwen-Plus 是唯一主脑**，绕过 `parseIntent()`

#### 2.2 聊天页输出协议

聊天页每次 Qwen-Plus 响应支持 3 种输出：

```json
{
  "reply": "我帮你先筛了一下，有机蔬菜更适合从蔬菜分类里找。",
  "suggestedActions": [
    {
      "type": "search",
      "label": "搜索有机蔬菜",
      "resolved": {
        "query": "蔬菜",
        "constraints": ["organic"]
      }
    }
  ],
  "followUpQuestions": [
    "你对价格有要求吗？",
    "需要看看当季的推荐吗？"
  ]
}
```

| 字段 | 含义 | 是否必须 |
|------|------|----------|
| `reply` | 自然语言回答 | 必须 |
| `suggestedActions[]` | 建议动作（用户点击才执行） | 可选 |
| `followUpQuestions[]` | 追问候选（引导对话继续） | 可选 |

**suggestedActions 的 type 白名单**：复用已有意图类型 `search / navigate / company / transaction / recommend`

**suggestedActions 的 resolved 字段补全**：
```
Qwen-Plus 输出 JSON → 后端检测到 suggestedActions
→ 对每个 action 调用已有搜索/企业/交易解析器补全 resolved 字段
→ 返回前端（action 可直接执行，无需二次解析）
```

**JSON 格式 fallback**：如果 Qwen-Plus 返回非法 JSON，后端将整个输出当作纯 `reply` 返回，`suggestedActions` 和 `followUpQuestions` 为空数组。前端永远有内容显示，不会白屏。

#### 2.3 上下文窗口策略

**双重控制**（轮次上限 + token 预算上限）：

| 控制维度 | 第一版设定 | 说明 |
|----------|-----------|------|
| 轮次上限 | 最近 **6-8 轮**（user+assistant 各算一条） | 不只按轮次，因为有的轮次很长 |
| 输入 token 预算 | **6000-8000 tokens** | 不只按 token，因为实现和调试时轮次概念更直观 |
| 截断策略 | 从最旧轮次开始丢弃 | 保留 system prompt + 最近 N 轮 + 当前用户消息 |
| token 估算 | 中文 1 字 ≈ 1.5 token（粗估） | 第一版不跑 tokenizer |

**组装顺序**：`system prompt` → 最近 6-8 轮历史（受 token 预算截断）→ 当前用户消息

**摘要功能（第二阶段再做）**：超长历史的"记忆总结器"不在第一版范围，先用滑动窗口即可。

#### 2.4 system prompt 设计

**第一版要短**（约 400-600 token），只放：
- 角色定义（农脉 AI 助手）
- 回答边界（农业电商范围内的问答、推荐、导购）
- 安全规则（不编造商品信息、不承诺价格、不代替用户做支付决策）
- 可输出结构（reply + suggestedActions + followUpQuestions 的 JSON schema）
- 允许建议动作但不自动执行

**不要在 system prompt 里塞**：
- 大量商品知识 / 企业知识
- 分类树全量
- 长篇运营话术

**商品/企业信息不注入**：第一版默认不注入大批业务数据。只有当用户的问题明显需要时（如"你们平台都有什么水果""武汉有哪些农场"），再走检索/工具化补充——但检索补充能力放第二阶段，第一版 Qwen-Plus 只靠对话上下文回答。

#### 2.5 首页 → 聊天页衔接

**进入聊天页的触发条件**：
- 首页语音路由器返回 `chat` 意图
- 首页语音结果需要进一步解释
- 用户点击"继续对话"按钮

**衔接方式**：
- 首页还是走现有语音路由器
- 跳转时把首页这一轮的 `{ transcript, feedback }` 作为一对 user/assistant 消息注入到新 session 的 message history
- Qwen-Plus 自然能看到这轮上下文，不需要额外处理

#### 2.6 聊天页语音输入

聊天页支持文字输入 + 语音输入两种模式：
- 语音输入链路：录音 → ASR 转文字 → **当作文字消息走 Qwen-Plus 主链路**（不过 parseIntent）
- 语音和文字在聊天页内是等价的，只是输入方式不同

#### 2.7 第一版不做流式

第一版等 Qwen-Plus 完整响应后再渲染（约 1-3s loading），不做流式输出。理由：
- 完整 JSON 响应更容易解析和校验
- 链路简单，先跑通再优化体验
- 流式 reply + 非流式 suggestedActions 的混合模式留作后续体验优化

#### 2.8 后端改造

- `ai.service.ts` 新增 `chatWithContext()` 方法，独立于 `parseIntent()`
- 调用 Qwen-Plus OpenAI 兼容 API（`https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`）
- 使用已有 AiSession/AiUtterance 模型存储对话历史
- `sendMessage()` 端点改为调用 `chatWithContext()` 而非 `parseIntent()`
- 响应中的 `suggestedActions` 由后端调用已有解析器补全 `resolved` 字段

**当前状态**：
- ✅ 已完成：登录用户的首页语音结果可落到真实 `AiSession`
- ✅ 已完成：聊天页、历史页、首页最近对话已接入真实 `/ai/sessions`
- ✅ 已完成：未登录用户在 AI 聊天页发送消息时，先提示登录/注册
- ✅ 已完成：`chatWithContext()` 方法（Qwen-Plus 多轮对话 + suggestedActions）
- ✅ 已完成：`sendMessage()` 切换到 `chatWithContext()` 主链路
- ✅ 已完成：前端 suggestedActions 卡片渲染与点击执行
- ✅ 已完成：前端 followUpQuestions 快捷按钮渲染
- ⬜ 未开始：聊天页语音输入（ASR → 文字 → Qwen-Plus）
- ✅ 已完成：首页 → 聊天页的初始上下文注入

### Phase 3：流式 ASR（体验升级）
- 替换为 WebSocket 流式识别（`gummy-realtime-v1`）
- 用户说话过程中实时显示文字
- 首字延迟目标从 ~1s 压到 ~300ms，松手后等待目标压到 **<800ms**
- 注意：`gummy-realtime-v1` 不能直接替换当前“录完整文件再上传”的一句话链路；要切换该模型，前端需改为边录边传，后端也要新增面向客户端的实时音频 WebSocket 通道
- 当前已先落地“预建连”作为中间态优化：仍保持整段上传，但在长按开始时预热百炼连接，先验证建连耗时是否是主要瓶颈

**流式 ASR 分流策略（建议白名单）**：
- 第一优先级：`navigate`
  - 例：`打开购物车`、`去结算`、`回首页`、`打开设置`
  - 原因：句子短、后处理接近 0，当前瓶颈几乎全在 ASR
- 第二优先级：`transaction` / `add-to-cart`
  - 例：`去付款`、`查看订单`、`把鸡蛋加入购物车`
  - 原因：说完就执行，意图稳定，流式收益直接体现在“松手即执行”
- 第三优先级：高频简单搜索 `search`
  - 例：`有没有鸡蛋`、`看看水果`、`找青菜`
  - 原因：当前后处理已压到很轻，进一步优化主要靠 ASR 本身
- 第四优先级：`company list/search`
  - 例：`打开农场`、`看看有哪些企业`
  - 原因：列表类请求收益明显，但企业名纠偏仍可能带来额外后处理时间

**不建议第一批优先走流式的类型**：
- `chat`
  - 例：`今天几号`、`天气如何`
  - 原因：即使 ASR 变快，整体仍常受 Qwen 问答耗时影响
- `recommend`
  - 例：`推荐最近好吃的`、`预算 100 买什么`
  - 原因：后续还要做槽位抽取、候选召回、重排，ASR 不是唯一瓶颈
- 复杂 `company detail`
  - 例：`打开青禾农场`
  - 原因：若涉及同音纠偏或模糊匹配，流式只能优化前半段

**建议实施顺序**：
1. 先给 `navigate / transaction / add-to-cart / simple search` 开流式
2. 再评估 `company list/search` 的收益
3. `recommend / chat` 继续沿用当前“预建连 + 整段上传”链路，等后处理链路再收紧后再考虑切流式

### Phase 4：上下文感知意图
- 结合用户当前页面、浏览历史、购物车内容做意图增强
- 例：用户在某商品页说"加购物车" → 自动识别当前商品 ID
- 例：用户在购物车页说「去结算」→ 直接进入结算页
- 利用已有的 AiSession.context 字段

### Phase 5：AI 智能推荐与 RAG
- 结合数据库做 RAG（检索增强生成）
- 商品推荐、订单查询、溯源查询、预算导购等业务场景
- 结构化数据检索 + LLM 自然语言回答

### Phase 6：端侧 ASR（离线可用）
- 集成阿里云 NUI SDK 或 Whisper 端侧模型
- 实现离线录音 + 在线识别混合模式
- 弱网环境也能使用

### Phase 7：语音合成 TTS（AI 回复变语音）
- 搜索结果/推荐用语音播报
- 百炼平台 TTS 或端侧 TTS

---

## 13. 实施进度

| 阶段 | 任务 | 状态 |
|------|------|------|
| **准备** | 百炼平台开通 | ✅ 已完成 |
| **准备** | API Key 创建（华北2北京地域） | ✅ 已完成 |
| **准备** | 环境变量配置（DASHSCOPE_API_KEY） | ✅ 已完成 |
| **Phase 1** | 安装 expo-av + 录音实现 | ✅ 已完成 |
| **Phase 1** | 音频上传（multipart 直传后端） | ✅ 已完成 |
| **Phase 1** | 后端 ASR 集成（百炼 gummy-chat-v1） | ✅ 已完成 |
| **Phase 1** | 后端意图识别（规则引擎 + Qwen-Flash 兜底） | ✅ 已完成 |
| **Phase 1** | 前端跳转逻辑（search / company / chat / navigate） | ✅ 已完成 |
| **Phase 1** | 端到端联调测试（Expo Go 真机验证） | ✅ 已完成 |
| **Phase 1** | 无需登录即可使用（@Public） | ✅ 已完成 |
| **Phase 1** | 录音动画反馈（脉动/波纹/旋转） | ✅ 已完成 |
| **Phase 1** | ASR 速度优化（无延迟批量发送） | ✅ 已完成 |
| **Phase 1** | WAV→PCM 自动转换 + 格式兜底 | ✅ 已完成 |
| **Phase 1** | chat 意图首页展示回复（不跳转） | ✅ 已完成 |
| **Phase 1.1** | ASR 尾静音阈值优化（`max_end_silence=400ms`） | ✅ 已完成 |
| **Phase 1.1** | `sentence_end` 提前返回，减少等待 `task-finished` | ✅ 已完成 |
| **Phase 1.1** | ASR 预建连（长按开始即准备 WebSocket） | ✅ 已完成 |
| **Phase 1.1** | ASR 细分耗时（`connect / wait_final / total`） | ✅ 已完成 |
| **Phase 1.1** | 问候类短句规则命中，绕过 Qwen | ✅ 已完成 |
| **Phase 1.1** | 语音链路分段耗时埋点与复测 | ✅ 已完成 |
| **Phase 1.2** | 统一语音路由器（分类器 / 槽位 / 实体 / 执行） | ✅ 已完成 |
| **Phase 1.2** | Qwen 模型分工（`flash` 分类/抽取/实体 / `plus` 推荐） | ✅ 已完成 |
| **Phase 1.2** | 动作类语音意图（购物车 / 结算 / 页面跳转） | ✅ 已完成 |
| **Phase 1.2** | 搜索页商品检索切到后端关键词搜索 | ✅ 已完成 |
| **Phase 1.2** | 搜索实体解析第一阶段（实时分类树 + 父分类召回 + `qwen-flash` 候选匹配） | ✅ 已完成 |
| **Phase 1.2** | 发现页分类入口 / 分类详情页接入后台真实分类 | ✅ 已完成 |
| **Phase 1.2** | 语音搜索返回结构化搜索参数并传递到搜索页 | ✅ 已完成 |
| **Phase 1.2** | 搜索结果开始消费 `preferRecommended / constraints` 做排序 | ✅ 已完成 |
| **Phase 1.2** | 交易类语音意图（付款 / 订单 / 售后） | ✅ 已完成 |
| **Phase 1.2** | `resolved intent` 统一返回协议（后端产出 + 首页消费） | ✅ 已完成 |
| **Phase 1.2** | 推荐类语音意图（预算导购 / 组合推荐） | ✅ 已完成 |
| **Phase 2** | AI 聊天页接入真实 `/ai/sessions` 会话链路 | ✅ 已完成 |
| **Phase 2** | 后端 AiSession / AiUtterance 基础落库 | ✅ 已完成 |
| **Phase 2** | `chatWithContext()` 方法（Qwen-Plus 多轮 + suggestedActions） | ✅ 已完成 |
| **Phase 2** | `sendMessage()` 切换到 `chatWithContext()` 主链路 | ✅ 已完成 |
| **Phase 2** | 前端 suggestedActions 卡片渲染与点击执行 | ✅ 已完成 |
| **Phase 2** | 前端 followUpQuestions 快捷按钮渲染 | ✅ 已完成 |
| **Phase 2** | 聊天页语音输入（ASR → 文字 → Qwen-Plus） | ⬜ 未开始 |
| **Phase 2** | 首页 → 聊天页初始上下文注入 | ✅ 已完成 |
| **Phase B** | 语义槽位扩展（7 个新槽位 + fallbackReason 分流） | ✅ 已完成 |
| **Phase B** | Flash→Plus 条件升级管道 + 质量检查 | ✅ 已完成 |
| **Phase B** | Product 语义字段（5 字段 + AI 填充 + semanticMeta 追踪） | ✅ 已完成 |
| **Phase B** | 多维语义评分引擎 + 中英文约束映射 + 三级降级 | ✅ 已完成 |
| **Phase B** | 搜索/推荐全链路语义参数透传（前端→Repo→Controller→Service） | ✅ 已完成 |
| **Phase B** | 卖家/管理后台语义标签编辑 + AI 重新生成 | ✅ 已完成 |
| **Phase B** | out-of-domain 引导式回复 + chat 页接收 | ✅ 已完成 |
| **Phase B** | 浮动伴侣菜单升级为语义槽位格式 | ✅ 已完成 |
| **Phase B** | 隐私脱敏日志 + 3 个功能开关 + Prisma migration | ✅ 已完成 |
| **Phase B** | 42 个单元测试（评分 + 质量检查） | ✅ 已完成 |
| **Phase B** | 真机测试通过（Expo Go） | ✅ 已完成 |
| **Phase C** | 满减凑单逻辑（promotionIntent 真实计算） | ⬜ 未开始 |
| **Phase C** | 搭配推荐引擎（bundleIntent 真实推荐） | ⬜ 未开始 |
| **Phase C** | 场景化推荐卡片 UI | ⬜ 未开始 |
| **Phase C** | 用户历史上下文注入（购买记录/搜索记录影响推荐） | ⬜ 未开始 |
| **Phase C** | Redis 热度缓存 + 定时刷新 | ⬜ 未开始 |
| **Phase C** | 管理后台 AI 意图分析仪表盘 | ⬜ 未开始 |
| **Phase 3** | 流式 ASR 升级 | ⬜ 未开始 |
| **Phase 4** | 上下文感知意图 | ⬜ 未开始 |
| **Phase 5** | AI 智能推荐与 RAG | ⬜ 未开始 |
| **Phase 6** | 端侧 ASR | ⬜ 未开始 |
| **Phase 7** | TTS 语音合成 | ⬜ 未开始 |

---

## 14. 语义意图升级（Phase B）

### 14.1 语义槽位扩展

新增 7 个语义槽位：usageScenario（使用场景）、promotionIntent（促销意图）、bundleIntent（组合购买）、dietaryPreference（饮食偏好）、freshness（新鲜度）、originPreference（产地偏好）、flavorPreference（口味偏好）。扩展用户查询的语义理解维度，提高商品匹配精准度。

### 14.2LLM 管道变化

意图识别流程升级为：Flash（初始分类）→ 质量检查（置信度 + 完整性验证）→ 条件升级 Plus（高风险或复杂查询才调用），平衡性能与精准度。

### 14.3fallbackReason 分流

识别失败的原因分为三类：out-of-domain（超出业务范围）、too-vague（查询过于模糊）、unsafe（安全风险），指导前端降级策略。

### 14.4Product 语义字段

商品新增语义字段：flavorTags（口味标签）、seasonalMonths（上市月份）、usageScenarios（应用场景）、dietaryTags（饮食类标签）、originRegion（产地区域）及 semanticMeta（源数据追踪，用于审计和更新）。

### 14.5搜索评分变化

融合语义匹配权重到排序模型，支持三级降级策略（A 级：语义精确匹配、B 级：关键词部分匹配、C 级：后备数据驱动），提升搜索相关性。

### 14.6功能开关

引入三个环境变量控制增量灰度：AI_SEMANTIC_SLOTS_ENABLED（槽位抽取）、AI_PRODUCT_SEMANTIC_FIELDS_ENABLED（商品语义化）、AI_SEMANTIC_SCORING_ENABLED（语义评分）。

---

## 15. 语义意图升级路线 — Phase C（待启动）

> **前置条件**：Phase B 已完成并通过真机测试。Phase C 在 Phase B 数据积累（存量商品 AI 填充）稳定后启动。

### 15.1 满减凑单逻辑

**现状**：Phase B 中 `promotionIntent: 'threshold-optimization'` 降级为 `recommendThemes: ['discount']`（推荐优惠商品），不做真正的凑单计算。

**Phase C 目标**：
- 读取当前生效的满减活动规则（门槛金额、优惠额度）
- 读取用户购物车当前总金额
- 计算差额，推荐能凑满门槛的商品组合（按性价比排序）
- 前端展示"再买 ¥X 可减 ¥Y"引导卡片 + 凑单商品列表

**涉及模块**：
- 后端：`coupon` 模块（读取活动规则）+ `cart` 模块（读取购物车）+ 新建 `promotion-optimizer` 服务
- 前端：推荐页新增凑单模式 UI，购物车页新增凑单入口

### 15.2 搭配推荐引擎

**现状**：Phase B 中 `bundleIntent: 'complement'` 降级为通用推荐，无真正搭配逻辑。

**Phase C 目标**：
- 基于当前商品/购物车内容，推荐互补商品（如买了牛肉推荐调料、配菜）
- 数据来源：商品共购关系（历史订单中同时出现的商品对）+ 品类互补规则
- 后端定时任务计算商品共购矩阵，存入 Redis

**涉及模块**：
- 后端：新建 `bundle-recommend` 服务，依赖 `order` 模块历史数据
- 前端：商品详情页 / 购物车页新增"搭配推荐"卡片区域

### 15.3 场景化推荐卡片 UI

**现状**：推荐结果以商品列表形式展示，无场景化包装。

**Phase C 目标**：
- 当 `usageScenario` 存在时（如"晚餐做饭"），推荐页顶部展示场景卡片：标题（"晚餐食材推荐"）+ 场景图 + 一键加购按钮
- 按场景分组展示商品（主食 / 配菜 / 调味料）
- 支持"一键加购整套食材"

**涉及模块**：
- 前端：推荐页 UI 重构，新增场景卡片组件
- 后端：推荐接口返回分组结构（按品类/用途分组）

### 15.4 用户历史上下文注入

**现状**：每次语音/搜索独立处理，不考虑用户历史。

**Phase C 目标**：
- 将用户最近 7 天的搜索记录、购买记录、收藏记录注入 LLM 推荐 prompt
- 实现"根据你最近买的 XX，推荐搭配的 YY"
- 避免重复推荐已购商品（除非是高频消耗品）

**涉及模块**：
- 后端：`ai.service.ts` 推荐 prompt 注入用户上下文（从 `order`/`cart`/搜索历史读取）
- 需要用户登录态才能使用（匿名用户降级为无历史推荐）

### 15.5 Redis 热度缓存 + 定时刷新

**现状**：Phase B 用 `createdAt` 新鲜度替代热度分（新商品 +0~10 分），无真实热度数据。

**Phase C 目标**：
- 定时任务（每小时）计算每个商品的热度分：`hotScore = (7日订单量 + 浏览量×0.1 + 收藏量×0.3) / 归一化因子`
- 存入 Redis，搜索评分时读取叠加
- 管理后台可手动 boost 指定商品

**涉及模块**：
- 后端：新建 `hot-score` 定时任务，写入 Redis
- `product.service.ts` 搜索时从 Redis 读取 hotScore 叠加到总分

### 15.6 管理后台 AI 意图分析仪表盘

**现状**：Phase B 有结构化日志（pipeline/intent/slotKeys/degradeLevel），但只能通过日志查询查看。

**Phase C 目标**：
- 管理后台新增"AI 意图分析"页面
- 展示指标趋势图：搜索点击率、推荐转化率、澄清率、out-of-domain 占比、Plus 升级率、Level C 降级率、平均延迟
- 支持按时间范围、intent 类型、pipeline 层级筛选
- 展示高频 transcript 词云（脱敏后）

**涉及模块**：
- 后端：新建 `ai-analytics` 模块，从日志/数据库聚合指标
- 前端：管理后台新增仪表盘页面（@ant-design/charts）

---

## 16. 已知问题与调试记录

### 14.1 已解决问题

| 问题 | 原因 | 修复 |
|------|------|------|
| `ws_1.default is not a constructor` | WebSocket 导入方式不兼容 CommonJS | `import * as WebSocket from 'ws'` |
| `Cannot access 'ws' before initialization` | setTimeout 引用了尚未初始化的 ws 变量 | 将 timer 创建移到 ws 初始化之后 |
| UNSUPPORTED_FORMAT | iOS WAV 文件含 RIFF header，百炼 ASR 不接受 | 自动检测 RIFF header 并剥离 44 字节，以 raw PCM 发送 |
| UNSUPPORTED_FORMAT（二次） | MIME 类型 `audio/vnd.wave` 被 regex 提取为 `vnd` | 添加 validFormats 白名单 + 未知格式回退 pcm |
| 0 个识别结果 | 百炼平台使用 `header.event`（非 `action`）和 `output.transcription`（非 `sentence`） | 同时检查 action/event，同时读取 transcription/sentence |
| 语音理解仍显“工程化” | 当前仍是过渡态：规则、局部模型、页面兜底并存 | 统一升级为“分类器 -> 槽位抽取 -> 动态实体解析 -> 受控执行” |
| 请先登录 (FORBIDDEN) | voice-intent 端点需要 JWT 认证 | 添加 `@Public()` 装饰器 |
| 识别后立即跳转 AI 农管家 | chat 意图直接 router.push | 改为首页展示回复，不跳转 |
| Loading 圆圈不旋转 | MaterialCommunityIcons 'loading' 是静态图标 | 改用 React Native ActivityIndicator |
| Only one Recording object | 上一次录音未释放 | handleLongPress 开头清理 recordingRef |

### 14.2 当前限制

- **聊天页语音输入未实现**：聊天页已支持文字多轮对话（Qwen-Plus），但语音输入（ASR → 文字 → Qwen-Plus）尚未接入
- **动作语音当前仅接在首页入口**：购物车页、订单页等上下文页内还没有独立语音入口
- **统一 `resolved intent` 协议仍在过渡态**：后端已回填 `intent / confidence / slots / resolved / fallbackReason`，但前端执行层仍保留旧 `type + param + feedback` 降级链，会话/落库链路也还没切到统一结构
- **录音偶尔启动失败**：连续多次录音时，iOS 音频会话可能未完全释放，需要等待几秒再试
- **识别延迟**：全链路约 2-4 秒（含上传 + ASR + 意图识别），体感偏慢
  - 已于 **2026-03-11** 确认本轮修复方案：`max_end_silence=400ms`、`sentence_end` 提前返回、问候类短句绕过 Qwen、补充分段耗时日志
