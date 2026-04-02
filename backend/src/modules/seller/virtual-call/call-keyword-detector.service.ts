import { Injectable, Logger } from '@nestjs/common';

/**
 * 违规关键词类别
 *
 * CONTACT_LEAK: 泄露联系方式（手机号、微信号、QQ号、邮箱等）
 * TRANSACTION_BYPASS: 引导线下交易/绕过平台支付
 */
export type ViolationCategory = 'CONTACT_LEAK' | 'TRANSACTION_BYPASS';

/** 单条违规匹配结果 */
export interface KeywordViolation {
  /** 匹配到的关键词或片段 */
  keyword: string;
  /** 违规类别 */
  category: ViolationCategory;
}

/** 通话转写文本分析结果 */
export interface TranscriptAnalysisResult {
  /** 违规列表，空数组表示未发现违规 */
  violations: KeywordViolation[];
}

// ---- 联系方式泄露检测正则 ----

/** 手机号正则：11 位数字，1 开头 */
const PHONE_NUMBER_REGEX = /(?<!\d)1[3-9]\d{9}(?!\d)/g;

/** 邮箱地址正则 */
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/** QQ 号正则：5~12 位纯数字，前后用中文或空白分隔 */
const QQ_NUMBER_REGEX = /(?:QQ|qq|Qq)[号:：]?\s*(\d{5,12})/g;

// ---- 联系方式泄露关键词 ----
const CONTACT_LEAK_KEYWORDS = [
  '加我微信',
  '微信号',
  'wx:',
  'WX:',
  'wx：',
  'WX：',
  '加个微信',
  '我的微信',
  '微信联系',
  '加微信',
];

// ---- 引导线下交易关键词 ----
const TRANSACTION_BYPASS_KEYWORDS = [
  '线下交易',
  '私下转账',
  '支付宝转',
  '微信转',
  '线下付款',
  '直接转账',
  '私下付',
  '绕过平台',
  '不走平台',
  '平台外交易',
];

/**
 * 通话录音关键词检测服务
 *
 * 对通话转写文本进行敏感关键词扫描，检测以下违规行为：
 * 1. 泄露联系方式（手机号、微信号、QQ号、邮箱）
 * 2. 引导线下交易（绕过平台支付）
 *
 * TODO: 当前为文本匹配占位实现，未来应集成 ASR（语音识别）服务
 *       - 先调用 ASR（如讯飞/阿里云）将通话录音转为文本
 *       - 再调用本服务分析转写文本
 *       - 可考虑引入 NLP 模型提升语义理解精度，减少误报
 */
@Injectable()
export class CallKeywordDetectorService {
  private readonly logger = new Logger(CallKeywordDetectorService.name);

  /**
   * 分析通话转写文本，返回违规关键词列表
   *
   * TODO: 未来 ASR 集成后，入参应改为录音文件 URL，内部先转写再分析
   *
   * @param transcript 通话转写文本
   * @returns 违规分析结果
   */
  analyzeTranscript(transcript: string): TranscriptAnalysisResult {
    const violations: KeywordViolation[] = [];

    if (!transcript || transcript.trim().length === 0) {
      return { violations };
    }

    // 1. 检测手机号泄露
    const phoneMatches = transcript.match(PHONE_NUMBER_REGEX);
    if (phoneMatches) {
      for (const phone of phoneMatches) {
        violations.push({
          keyword: phone,
          category: 'CONTACT_LEAK',
        });
      }
    }

    // 2. 检测邮箱泄露
    const emailMatches = transcript.match(EMAIL_REGEX);
    if (emailMatches) {
      for (const email of emailMatches) {
        violations.push({
          keyword: email,
          category: 'CONTACT_LEAK',
        });
      }
    }

    // 3. 检测 QQ 号泄露
    let qqMatch: RegExpExecArray | null;
    // 重置正则 lastIndex（全局正则需要重置）
    QQ_NUMBER_REGEX.lastIndex = 0;
    while ((qqMatch = QQ_NUMBER_REGEX.exec(transcript)) !== null) {
      violations.push({
        keyword: qqMatch[0],
        category: 'CONTACT_LEAK',
      });
    }

    // 4. 检测微信号等联系方式关键词
    for (const kw of CONTACT_LEAK_KEYWORDS) {
      if (transcript.includes(kw)) {
        violations.push({
          keyword: kw,
          category: 'CONTACT_LEAK',
        });
      }
    }

    // 5. 检测引导线下交易关键词
    for (const kw of TRANSACTION_BYPASS_KEYWORDS) {
      if (transcript.includes(kw)) {
        violations.push({
          keyword: kw,
          category: 'TRANSACTION_BYPASS',
        });
      }
    }

    // 去重（同一关键词可能多次出现）
    const seen = new Set<string>();
    const dedupedViolations = violations.filter((v) => {
      const key = `${v.category}:${v.keyword}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (dedupedViolations.length > 0) {
      this.logger.warn(
        `转写文本检测到 ${dedupedViolations.length} 条违规: ${dedupedViolations.map((v) => `[${v.category}] ${v.keyword}`).join(', ')}`,
      );
    }

    return { violations: dedupedViolations };
  }
}
