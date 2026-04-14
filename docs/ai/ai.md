# 爱买买 AI 语音助手集成方案

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
12. [当前主线与候选增强路线](#12-当前主线与候选增强路线)
13. [实施进度](#13-实施进度)
14. [语义意图升级（Phase B）](#14-语义意图升级phase-b)
15. [语义意图升级路线 — Phase C](#15-语义意图升级路线--phase-c待启动)
16. [用户定位与"附近"查询 — Phase D](#16-用户定位与附近查询--phase-d待启动)
17. [已知问题与调试记录](#17-已知问题与调试记录)

---

## 1. 功能概述

**核心交互**：用户在首页长按「AI买买」按钮录入语音 → AI 理解意图 → 自动跳转到目标页面。

**当前主线（2026-04-03 调整）**：
- 当前阶段把首页/全局语音入口定义为**操作型语音入口**（operation-first），不是通用对话入口
- 第一阶段只收敛 5 类核心任务：**页面跳转 / 商品搜索 / 企业搜索或列表 / 加购物车 / 订单查询**
- 核心产品规则：**默认进入列表或结果页；只有明确且高置信命中单一对象时，才允许进入详情页或直接执行动作**
- 聊天、复杂推荐、开放探索类表达不强行进入操作执行链路，应安全反馈或引导进入聊天体验
- 第一阶段在线预算固定为：**0 次规则命中模型调用**或**1 次轻模型归一化调用**；`qwen-plus` 不进入操作主链路

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
- ✅ 唯一命中商品的加购语音已改为**直接加入购物车 + 明显成功提示**，不再跳转搜索页
- ✅ **Phase B 语义意图升级已完成**：7 语义槽位 + Flash→Plus 管道 + Product 语义字段 + 多维评分 + out-of-domain 引导 + 真机测试通过
- 🟡 当前主线已切换为 **“操作型语音链路收敛 v1”**：优先解决速度、稳定性、默认列表优先、误执行控制
- 🟡 2026-04-04 最新真实语音日志表明：寒暄快路、购物车语义、轻推荐链路已明显收口；当前剩余主要尾巴是 `打开 + 搜索词` 这类歧义表达仍可能进入 `flash`
- ⬜ 候选增强项暂不进入当前主线：Phase C 凑单优化 / 搭配推荐 / 场景卡片协议 / 用户偏好摘要 / Redis 热度缓存 / AI 分析仪表盘
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

**第一阶段在线预算（操作型语音主线）**：
- `Fast Route` 命中时：**0 次模型调用**
- 规则不足时：**最多 1 次轻模型调用**（当前以 `qwen-flash` 为主）
- `qwen-plus`：**不进入操作主链路**，仅保留给推荐、预算导购、多轮对话

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

**第一阶段运行时结构（2026-04-03 重申）**：
- 主链路固定为：`router -> normalizer -> resolver -> execution policy`
- 规则命中时不进入模型
- 进入模型时最多只做一次轻量归一化，不再把 `Flash -> Plus` 作为操作链路常态
- `list vs detail`、`直接执行 vs 回退列表` 由执行策略决定，不交给模型自由发挥
- 聊天、复杂推荐等非操作型请求不强塞进这条执行链路

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
{ "ios": { "infoPlist": { "NSMicrophoneUsageDescription": "爱买买需要使用麦克风来接收你的语音指令" } } }
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
| 短句意图识别 | 为 `你好/您好/哈喽/在吗/早上好/晚上好` 等问候语添加规则命中，直接返回 `chat` | 🟡 第一版已完成 | 已覆盖基础问候，但 `你好吗/最近怎么样` 等状态寒暄仍可能漏入模型链 |
| 分段耗时观测 | 增加录音收尾、上传、ASR、意图识别四段耗时日志 | ✅ 已完成 | 便于定位真实瓶颈并验证优化效果 |

**预期收益（估算值，待真机复测确认）**：
- 超短语音可减少约 **400-1000ms** 等待时间
- 问候类短句可再减少一次 **Qwen 300-600ms** 的额外耗时
- 规则命中的常见短指令，目标体感压缩到 **~1 秒级**

**2026-04-04 最新复核**：
- `你好` 类基础问候已能命中快路，但 `你好吗？` 仍出现 `total_ms=13919 / classify_ms=12160`
- 说明当前实现更接近“**短句问候第一版规则**”，尚未升级为“**寒暄语义簇快路**”
- 下一步不应继续枚举所有句子，而应把寒暄快路按 `greeting / status-greeting / presence-check` 三类语义簇收敛

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

1. 在后端先收口为四段式主链路：
   - `router`
   - `normalizer`
   - `resolver`
   - `executionPolicy`
2. 优先补齐高频快路：
   - 页面跳转
   - 订单查询
   - 商品搜索
   - 企业列表
3. 再继续收紧直接执行类动作：
   - 加购物车
   - 单对象详情直达
4. 推荐、复杂导购、多轮聊天继续独立演进，不挤占当前操作型语音主线

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

前端当前主线应逐步收敛为**结构化动作执行器**，而不是自然语言解释器。前端的职责是消费后端返回的结构化结果并执行安全动作，而不是根据残句、模糊词、旧 `param` 字段再次猜测用户想去哪里。

**推荐执行协议**：

```json
{
  "intent": "company",
  "confidence": 0.93,
  "slots": {
    "mode": "list",
    "location": "武汉"
  },
  "resolved": {
    "actionType": "open_company_results",
    "route": "/company/search",
    "params": {
      "location": "武汉"
    }
  }
}
```

**前端执行原则**：
- 页面跳转：目标页明确且在白名单内时直接执行
- 商品搜索：默认进入搜索结果页，不默认进商品详情页
- 企业搜索：默认进入企业列表页，不默认进企业详情页
- 商品详情 / 企业详情：只有唯一对象且高置信时才允许
- 加购物车：只有动作明确、单商品高置信、数量安全时才允许直接执行
- 订单查询：默认进入订单列表页，只有单订单高置信时才允许直达详情

**实现要求**：
- 前端优先消费 `slots / resolved / fallbackReason`
- legacy `param` 兼容仅作过渡，不再扩张
- `navigateByIntent()` 的长期目标是动作执行器，而不是半个意图解释器
- 列表类请求优先保留结构化筛选项（如 `location / constraints / category`），避免脏 `q` 压过正确过滤

---

## 9. 延迟与性能分析

### 9.1 第一阶段性能目标

第一阶段不追求“所有自然语言都快”，而是只对**高频明确操作请求**设硬预算。

**统计口径（重要）**：
- 这里的 `P50 / P95` 指的是：**ASR 最终文本已产出之后**，到**前端收到结构化 action 并可执行**之间的链路延迟
- **不包含**：用户说话时长、音频上传时长、ASR 识别时长
- 这样才能让性能目标严格对应当前要优化的部分：`router / normalizer / resolver / execution policy`

| 目标 | 适用场景 |
|---|---|
| `P50 <= 2s` | 页面跳转、订单列表、明显商品搜索、明显企业列表 |
| `P95 <= 3.5s` | 同类高频操作请求，在网络波动下仍保持可接受 |
| `<= 5s` | 需要一次轻模型归一化的复杂搜索或复杂操作表达 |

### 9.2 当前性能判断

当前真实问题不是单纯 ASR 慢，而是**简单请求偶尔会落入过重的语义链路**。一旦操作请求被带入重模型或多段语义升级，总耗时就会显著偏离“像操作一样快”的目标。

因此第一阶段的性能策略不是继续加大模型能力，而是：
- 让高频明确请求尽量命中规则快路
- 让操作链路最多只调用一次轻模型
- 不让 `qwen-plus` 进入操作主链路
- 让“默认列表优先”同时兼顾正确率和速度

**2026-04-04 真实样本（America/New_York）**：

| 话术 | 结果 | 关键耗时 | 当前判断 |
|---|---|---|---|
| `你好吗？` | `chat` | `total_ms=13919`，`classify_ms=12160` | 寒暄快路未覆盖到“状态寒暄”，落入模型链 |
| `把土鸡蛋放入购物车。` | `transaction` | `total_ms=17556`，`classify_ms=14441` | 购物车相关表达仍未从通用交易语义中拆出，且存在误判 |
| `现在有推荐的水果吗？` | `recommend` | `total_ms=10654`，`classify_ms=3486`，`entity_resolve_ms=4517` | 推荐链路仍偏重，轻推荐与重推荐尚未彻底分档 |
| `去结算。` | `navigate` | `total_ms=1335`，`classify_ms=0` | 快路正常 |
| `帮我看看现在有哪些订单。` | `transaction` | `total_ms=2321`，`classify_ms=0` | 快路正常 |
| `帮我找一找信阳毛尖。` | `search` | `total_ms=2581~3622`，`classify_ms=1~27` | 搜索快路基本正常 |

这些样本说明：当前问题不是“整体都慢”，而是**寒暄 / 购物车 / 推荐** 三类仍会不稳定地落入偏重链路。

### 9.3 在线预算

| 链路 | 模型预算 | 说明 |
|---|---|---|
| `Fast Route` | 0 次 | 页面跳转、订单查询、明显搜索、明显企业列表优先在这里解决 |
| `Structured Normalize` | 最多 1 次轻模型 | 只做 `intent / slots / confidence / fallbackReason` 归一化 |
| `Execution Policy` | 0 次 | 列表/详情/加购/订单直达由规则决定，不再追加模型调用 |
| `Chat / Complex Recommend` | 不属于操作主链路 | 允许使用 `qwen-plus`，但不应阻塞操作入口 |

### 9.4 建议监控指标

第一阶段至少补齐这些指标，否则只能靠体感判断：
- `fast_route_hit_rate`
- `model_route_rate`
- `list_fallback_rate`
- `detail_direct_rate`
- `auto_add_to_cart_rate`
- `misfire_rate`
- `p50_total_ms`
- `p95_total_ms`
- `flash_ms / plus_ms / upgraded / fallbackReason`

### 9.5 当前 UI 反馈策略

交互层继续保留：

```
松手 → AiOrb 切 thinking 状态 + "正在识别语音..."
  → 返回结构化结果 → 显示 feedback / 执行动作
```

但后续优化重点应放在**真实链路耗时收敛**，而不是单纯靠 loading 文案掩盖慢路由。

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

## 12. 当前主线与候选增强路线

### 12.1 当前主线：操作型语音链路收敛 v1

第一阶段先不继续扩功能面，而是把当前语音入口收敛成一条**快、稳、可评测**的操作链路。

**第一阶段只覆盖 5 类核心任务**：
- 页面跳转
- 商品搜索
- 企业搜索 / 企业列表
- 加购物车
- 订单查询

**全局产品规则**：
- 默认进入列表或结果页
- 只有明确且高置信命中单一对象时，才允许进入详情页
- 只有动作明确且单对象高置信时，才允许直接执行动作（如加购物车）
- 低置信时不硬猜，不误执行

**运行时结构**：
`ASR -> router -> normalizer -> resolver -> execution policy`

**设计要求**：
- `router` 优先命中规则快路
- `normalizer` 最多调用 1 次轻模型，只做结构化归一
- `resolver` 负责把结构化槽位对齐真实商品、企业、订单、页面
- `execution policy` 负责决定列表、详情、加购、订单直达，不让模型自由决定执行动作

### 12.2 当前主线实施顺序

#### A. 链路收口
- 明确首页/全局语音入口是操作型入口，不是开放聊天入口
- 把聊天、复杂推荐、开放探索从操作主链路中分流出去
- 固定“默认列表优先”的执行原则

#### B. 高频快路
- 优先覆盖页面跳转、订单查询、明显商品搜索、明显企业列表
- 补齐寒暄类快路（尤其 `status-greeting / presence-check`）
- 把购物车语义从通用 `transaction` 中拆开，至少区分 `cart-add / cart-open / cart-query`
- 让轻推荐优先按 `query/category + theme` 进入结果页或推荐页，不在语音主链路里做重解析
- 让高频明确请求尽量不进入模型

#### C. 可测性与埋点
- 统一记录 `transcript / intent / slots / resolved / finalAction / fallbackReason`
- 补齐 `fast_route_hit_rate / model_route_rate / misfire_rate / p50/p95 total_ms`
- 建立真实语音回放样本与人工标注集

#### D. 受控增强
- 在不破坏主链路的前提下，继续增强商品归一、企业归一、单对象高置信命中
- 保持“默认列表优先”，不为追求“更聪明”而提高误执行率

### 12.3 候选增强项（不进入当前主线）

这些能力可以保留在路线图中，但当前不作为主线目标：

- 聊天页语音输入（ASR → 文字 → Qwen-Plus）
- Phase C：凑单优化 / 搭配推荐 / 场景卡片协议 / 用户偏好摘要 / Redis 热度缓存 / AI 分析仪表盘
- Phase D：完整定位与距离排序方案
- 流式 ASR（`gummy-realtime-v1`）
- 上下文感知意图
- RAG
- 端侧 ASR
- TTS

**Phase D 的短期临时方案保留**：当 `location` 为“附近 / 周边 / 本地 / 这里 / 这边”时，不做 location 文本过滤，避免空结果。

### 12.4 聊天与操作的边界

首页/全局语音入口继续按**操作优先**设计：
- 适合自动执行的请求走操作链路
- 聊天、开放问答、复杂推荐不强行执行
- 必要时给出安全反馈，或引导进入聊天页继续对话

聊天页继续保持**建议优先**：
- `Qwen-Plus` 负责多轮理解
- 输出 `reply + suggestedActions + followUpQuestions`
- 用户点击 `suggestedActions` 后才执行

### 12.5 商品搜索画像与信息利用

如果下一步要继续提升 AI 搜索和推荐的准确率，重点不应该是继续增加卖家表单字段，而应该是提升**商品信息的 AI 利用率**。

核心原则是：

- 不是不要 `description` 和 `attributes`
- 而是不要让在线搜索在每次请求时，临时去读整段描述并重新理解
- 更合理的方式是：在商品保存或更新时，把标题、分类、别名、标签、`description`、`attributes` 统一抽取成结构化的 `Product Search Profile`

这层搜索画像统一服务三件事：

- 搜索召回：让商品更容易被自然语言搜到
- 搜索排序：让更符合场景、口味、适用人群、产地、配送方式的商品排前面
- 推荐解释：让 AI 不只返回商品，还能解释为什么适合

因此：

- `title / category / aiKeywords` 主要负责“能不能被搜到”
- `usageScenarios / dietaryTags / flavorTags / originRegion / seasonalMonths` 主要负责“排得准不准”
- `description / attributes` 主要负责提供原始语义，供系统在保存时抽取成搜索画像，而不是直接承担在线主搜索职责

这部分专题设计已单独整理到：

- [ai搜索.md](/Users/jamesheden/Desktop/农脉%20-%20AI赋能农业电商平台/ai搜索.md)

后续如果推进“AI 电商代理”而不是“普通电商 + 语音入口”，商品搜索画像会是搜索、推荐、导购三条链路的共同底座。

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
| **Phase 1.1** | 问候类短句规则命中，绕过 Qwen | ✅ 已完成（含 `你好吗 / 你在干嘛 / 最近怎么样` 等第一批寒暄簇） |
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
| **Operation Lane v1** | 操作型语音主线收口（5 类任务范围、默认列表优先） | 🟡 进行中 |
| **Operation Lane v1** | `router -> normalizer -> resolver -> execution policy` 边界收敛 | 🟡 进行中 |
| **Operation Lane v1** | 前端从“意图解释器”收敛为“结构化动作执行器” | 🟡 进行中 |
| **Operation Lane v1** | 企业/商品列表默认优先，详情需单对象高置信 | 🟡 进行中 |
| **Operation Lane v1** | 高频快路扩容（页面 / 订单 / 商品搜索 / 企业列表） | ✅ 第一版已完成 |
| **Operation Lane v1** | 购物车语义拆分（`cart-add / cart-open / cart-query`） | ✅ 第一版已完成 |
| **Operation Lane v1** | 寒暄快路簇化（`greeting / status-greeting / presence-check`） | ✅ 第一版已完成 |
| **Operation Lane v1** | 推荐链路轻重分档（`recommend-lite` / `complex-recommend`） | ✅ 第一版已完成（轻推荐已落地，复杂推荐仍保留后续空间） |
| **Operation Lane v1** | 更细 timing 埋点（`flash_ms / plus_ms / upgraded / fallbackReason`） | ✅ 第一版已完成 |
| **Operation Lane v1** | 真实语音回放样本与人工标注集 | ⬜ 未开始 |
| **候选增强** | 聊天页语音输入（ASR → 文字 → Qwen-Plus） | ⬜ 未开始 |
| **候选增强** | Phase C：满减凑单逻辑（promotionIntent 真实计算） | ⬜ 未开始 |
| **候选增强** | Phase C：搭配推荐引擎（bundleIntent 真实推荐） | ⬜ 未开始 |
| **候选增强** | Phase C：场景化推荐卡片 UI | ⬜ 未开始 |
| **候选增强** | Phase C：用户历史上下文注入（购买记录/搜索记录影响推荐） | ⬜ 未开始 |
| **候选增强** | Phase C：Redis 热度缓存 + 定时刷新 | ⬜ 未开始 |
| **候选增强** | Phase C：管理后台 AI 意图分析仪表盘 | ⬜ 未开始 |
| **候选增强** | Phase D：用户定位 + "附近"企业/商品查询（expo-location + 距离排序） | ⬜ 未开始 |
| **候选增强** | 流式 ASR 升级 | ⬜ 未开始 |
| **候选增强** | 上下文感知意图 | ⬜ 未开始 |
| **候选增强** | AI 智能推荐与 RAG | ⬜ 未开始 |
| **候选增强** | 端侧 ASR | ⬜ 未开始 |
| **候选增强** | TTS 语音合成 | ⬜ 未开始 |

---

## 14. 语义意图升级（Phase B）

> **说明（2026-04-03）**：本章记录的是已落地的语义能力与历史演进，不等于这些能力都应继续作为当前“操作型语音主线”的默认运行方式。自本轮设计调整后，Phase B 中的 `Flash -> Plus` 条件升级能力保留，但**不再作为操作主链路常态**；操作入口优先遵守“规则快路 + 最多 1 次轻模型归一化”的预算。

### 14.1 语义槽位扩展

新增 7 个语义槽位：usageScenario（使用场景）、promotionIntent（促销意图）、bundleIntent（组合购买）、dietaryPreference（饮食偏好）、freshness（新鲜度）、originPreference（产地偏好）、flavorPreference（口味偏好）。扩展用户查询的语义理解维度，提高商品匹配精准度。

### 14.2 LLM 管道变化

意图识别流程升级为：Flash（初始分类）→ 质量检查（置信度 + 完整性验证）→ 条件升级 Plus（高风险或复杂查询才调用），平衡性能与精准度。

**当前主线约束**：
- 上述升级能力继续保留给推荐、复杂理解、聊天或离线评估场景
- 操作型语音入口不再把 `Flash -> Plus` 作为默认主路径
- 当前主线优先目标仍是：高频明确请求 `0 或 1` 次轻模型调用

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

### 15.1 Phase C 启动原则

Phase C 不再继续堆叠在通用 `recommend/plan` 之上，而是把新的复杂推荐能力拆成独立能力：
- 通用推荐仍使用 `GET /ai/recommend/plan`
- 满减凑单独立为 `POST /ai/recommend/promotion-optimize`
- 搭配推荐独立为 `POST /ai/recommend/bundle`

**核心原则**：
- 规则与结构化数据优先，LLM 只负责语义归一化、解释文案和兜底
- 购物车、优惠活动、历史行为等“用户态能力”只在登录态下启用，匿名用户必须有降级路径
- 场景化 UI 依赖后端协议先稳定，再做页面重构，避免前后端各自造临时结构
- 观测和埋点先于分析后台，否则仪表盘会缺少可靠数据源

**建议启动顺序**：
- `C1` 满减凑单服务
- `C2` 搭配推荐服务
- `C3` 场景化推荐卡片协议 + UI
- `C4` 用户历史偏好摘要注入
- `C5` Redis 热度缓存
- `C6` 管理后台 AI 意图分析仪表盘

### 15.2 C1：满减凑单服务

**现状**：Phase B 中 `promotionIntent: 'threshold-optimization'` 仅降级为 `recommendThemes: ['discount']`，不做真正凑单。

**Phase C 目标**：
- 读取当前生效的满减活动规则（门槛金额、优惠额度、适用品类）
- 读取用户购物车当前总金额、已选商品、可参与活动商品
- 计算“距下一档门槛差额”，推荐 1~3 组凑单组合（优先低干扰、低超额、高折扣）
- 购物车页展示“再买 ¥X 可减 ¥Y”卡片，支持一键加入推荐凑单商品

**建议接口**：
- `POST /ai/recommend/promotion-optimize`
- 入参：`cartSnapshot / activePromotions / budgetGap / transcript / slots`
- 出参：`targetPromotion / gapAmount / candidateBundles[] / explanation / fallbackMode`

**涉及模块**：
- 后端：`coupon` 模块 + `cart` 模块 + 新建 `promotion-optimizer` 服务
- 前端：购物车页新增凑单入口，推荐页支持凑单结果模式

**降级策略**：
- 未登录：降级为折扣商品推荐
- 无有效活动：返回普通优惠推荐
- 购物车金额已达标：提示“当前已满足优惠条件”

### 15.3 C2：搭配推荐服务

**现状**：Phase B 中 `bundleIntent: 'complement'` 仍降级为通用推荐，无真正搭配逻辑。

**Phase C 目标**：
- 基于当前商品或购物车上下文，推荐互补商品（如买牛肉推荐调料、配菜、火锅底料）
- 数据来源分两层：
  - 第一层：品类互补规则（可控、可解释）
  - 第二层：历史共购关系（订单中高频共现商品对）
- 支持“单商品搭配”和“购物车整体补全”两种模式

**建议接口**：
- `POST /ai/recommend/bundle`
- 入参：`productId? / cartProductIds? / transcript / slots`
- 出参：`bundleMode / anchorItems[] / recommendations[] / reasons[] / fallbackMode`

**涉及模块**：
- 后端：新建 `bundle-recommend` 服务，依赖 `order` 模块与规则配置
- 前端：商品详情页 / 购物车页新增“搭配推荐”卡片区域

**降级策略**：
- 无共购数据：回退到品类互补规则
- 无规则命中：回退到当前分类热门商品

### 15.4 C3：场景化推荐卡片协议 + UI

**现状**：推荐结果主要是商品列表，缺少场景包装与“一键成套”能力。

**Phase C 目标**：
- 当 `usageScenario` 存在时，推荐页顶部展示场景卡片，如“晚餐食材推荐”“露营备菜推荐”
- 后端返回结构化分组结果，而不只是平铺商品列表
- 支持“整套加购”“按分组查看”“替换某一件商品”

**建议协议扩展**：
- 仍基于 `GET /ai/recommend/plan`
- 返回新增字段：`mode / scenarioCard / groupedSections[] / bundleCta`
- `groupedSections[]` 示例：`主菜 / 配菜 / 调味 / 加购补充`

**涉及模块**：
- 后端：推荐接口增加场景分组结构
- 前端：推荐页 UI 重构，新增场景卡片、一键整套加购、分组列表

**降级策略**：
- 无 `usageScenario`：保持当前列表模式
- 分组失败：展示普通推荐列表，不阻断结果页

### 15.5 C4：用户历史偏好摘要注入

**现状**：推荐链路按单次请求处理，不利用用户近期行为。

**Phase C 目标**：
- 汇总用户最近 7~30 天行为，形成结构化偏好摘要，而不是把原始流水直接塞给 LLM
- 摘要包含：高频品类、价格带、复购品、已购排除项、偏好标签
- 实现“根据你最近买的 XX，推荐搭配 YY”“减少重复推荐”

**建议实现方式**：
- 新建 `user-preference-summary` 生成逻辑
- 先用规则/统计生成摘要，再注入推荐 prompt 或排序逻辑
- LLM 只消费摘要文本或结构化摘要，不直接读取原始历史明细

**涉及模块**：
- 后端：`order` / `cart` / 搜索历史 / 收藏记录
- 需要登录态；匿名用户继续走无历史推荐

**降级策略**：
- 无登录态：不使用历史上下文
- 历史数据稀疏：只使用近期搜索或当前会话上下文

### 15.6 C5：Redis 热度缓存 + 定时刷新

**现状**：Phase B 以 `createdAt` 新鲜度替代热度分，无真实热点信号。

**Phase C 目标**：
- 每小时计算商品热度分：`hotScore = 7日订单量 + 浏览量×0.1 + 收藏量×0.3`
- 归一化后写入 Redis，搜索/推荐排序实时读取
- 支持后台对特定商品做手动 boost

**涉及模块**：
- 后端：新建 `hot-score` 定时任务与 Redis key 规范
- `product.service.ts` / 推荐服务读取 hotScore 叠加到排序分

**降级策略**：
- Redis 不可用：回退到当前 `createdAt` 新鲜度逻辑
- 某商品无缓存：hotScore 视为 0，不阻塞搜索

### 15.7 C6：管理后台 AI 意图分析仪表盘

**现状**：Phase B 只有结构化日志，尚未形成稳定的分析数据源。

**Phase C 目标**：
- 管理后台新增“AI 意图分析”页面
- 展示趋势指标：搜索点击率、推荐转化率、澄清率、out-of-domain 占比、Plus 升级率、Level C 降级率、平均延迟
- 支持按时间范围、intent 类型、pipeline 层级筛选
- 展示高频 transcript 词云（脱敏后）

**前置依赖**：
- 先补统一埋点或聚合表，不能直接依赖原始日志做 BI
- 建议新增 `ai_analytics_events` 或离线聚合任务

**涉及模块**：
- 后端：新建 `ai-analytics` 模块，从事件表/聚合表读取指标
- 前端：管理后台新增仪表盘页面（`@ant-design/charts`）

**降级策略**：
- Phase C 初期先做表格 + 基础折线图
- 词云与复杂筛选可后续迭代，不阻塞首版上线

---

## 16. 用户定位与"附近"查询 — Phase D（待启动）

> **前置条件**：无硬性前置依赖，可独立于 Phase C 开发。
> **触发场景**：用户语音"附近有什么农场""有哪些附近的企业""本地的水果"等包含相对位置概念的查询。

### 16.1 现状与问题

当前系统不支持基于位置的查询。当用户说"附近的企业"时，`companyLocation="附近"` 被传到搜索页做文本匹配，没有企业 location 字段包含"附近"二字，导致搜索结果为空。

### 16.2 技术方案

**前端定位（React Native / Expo）**：
- 使用 `expo-location` 获取用户 GPS 经纬度
- 首次使用时请求前台定位权限（`requestForegroundPermissionsAsync`）
- 定位结果存入 Zustand store（`useLocationStore`），全局可用
- 所有搜索/推荐 API 请求自动附带 `lat`/`lng` 参数
- 定位失败或用户拒绝权限时降级为无位置搜索

**后端距离计算**：
- Company 表新增 `latitude Float?` / `longitude Float?` 字段
- 企业搜索 API 新增 `lat`/`lng`/`radius`（km）查询参数
- 使用 Haversine 公式计算用户与企业的距离
- 支持"按距离排序"和"半径过滤"两种模式
- 商品搜索也可按所属企业的位置做距离排序（可选）

**AI 语义层适配**：
- "附近/周边/本地" 不再作为 `companyLocation` 传递
- 改为后端检测到 `location` 为相对位置词时，自动切换为坐标+半径模式
- 默认半径：附近=10km，周边=30km，本地=50km

### 16.3 改动范围

| 层 | 改什么 |
|---|--------|
| Prisma Schema | Company 加 `latitude Float?` / `longitude Float?` |
| 前端 | 安装 `expo-location` + `useLocationStore` + API 请求自动带坐标 |
| 后端 Company API | 接收 `lat/lng/radius` + Haversine 距离计算 + 按距离排序 |
| 后端 AI 语义层 | "附近/周边/本地" → 不传 location 文本，改为坐标+半径 |
| 前端企业搜索页 | 显示距离标签（如"距你 3.2km"），支持按距离排序 |
| 种子数据 / 管理后台 | 给企业补经纬度（管理后台企业编辑页加地图选点或坐标输入） |

### 16.4 降级策略

- 用户拒绝定位权限 → 不显示距离，不按距离排序，"附近"查询返回全部企业
- 企业无经纬度 → 该企业不参与距离排序，排在有坐标企业之后
- GPS 信号弱 → 使用上次缓存的位置，超过 30 分钟提示重新定位

### 16.5 短期临时方案

在 Phase D 开发前，先做一行代码修复：当 `location` 为"附近/周边/本地/这里/这边"时，不传 location 过滤，返回全部企业列表，避免搜索为空。

---

## 17. 已知问题与调试记录

### 17.1 已解决问题

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

### 17.2 当前限制

- **聊天页语音输入未实现**：聊天页已支持文字多轮对话（Qwen-Plus），但语音输入（ASR → 文字 → Qwen-Plus）尚未接入
- ~~**动作语音当前仅接在首页入口**~~：✅ Phase B 已解决 — 浮动 AI 伴侣覆盖所有页面（首页除外，首页有独立语音入口）
- ~~**统一 `resolved intent` 协议仍在过渡态**~~：✅ Phase B 已解决 — 前后端统一使用 `slots / resolved / fallbackReason` 协议，7 个语义槽位 + 9 个 resolved 字段全链路打通
- **操作型语音主线仍在收口**：`router / normalizer / resolver / execution policy` 的边界已明确，但 `AiService` 仍然过于集中，前端也还有少量 legacy `param` 兼容路径
- **默认列表优先尚未彻底收敛**：商品 / 企业列表类请求已开始按结构化参数执行，但仍需继续清理“脏 query 压过正确筛选”和“过早猜详情页”的遗留逻辑
- **录音偶尔启动失败**：连续多次录音时，iOS 音频会话可能未完全释放，需要等待几秒再试
- **操作链路耗时仍不够稳定**：简单请求偶尔会落入偏重的语义链路，导致体验明显慢于“操作入口”预期
  - 第一阶段目标已改为：高频明确请求优先命中规则快路，操作链路最多 1 次轻模型调用
  - `qwen-plus` 不再作为操作主链路常态；后续需要补齐 `fast_route_hit_rate / model_route_rate / flash_ms / plus_ms / upgraded` 等指标
- **寒暄快路已进入第一版语义簇阶段**：`你好吗 / 你在干嘛 / 今天天气如何` 等高频短句已稳定命中快路，但更长、更口语化的寒暄表达仍需继续观察
- **购物车语义已从通用交易中拆出**：`加入购物车 / 打开购物车 / 购物车里有多少件` 已有独立快路；后续仍需继续拦截“加购优惠”这类非加购语义误判
- **轻推荐已从重链路中拆出**：`有没有推荐的海鲜 / 现在有推荐的水果吗` 已能走轻推荐快路；后续仍需继续完善复杂推荐与多轮推荐边界
- **推荐理由与真实依据仍未对齐**：当前部分推荐卡片的 `reason` 仍是静态文案或弱解释，并不严格对应真实排序信号、用户偏好或推荐主题；后续需要把推荐理由绑定到实际使用的结构化依据上，避免“展示理由”和“真实推荐原因”脱节
- **当前最明显的剩余尾巴是“打开 + 搜索词”歧义句**：如 `打开信阳毛尖` 仍可能进入 `flash`，后续需要补一层执行策略或规则澄清
