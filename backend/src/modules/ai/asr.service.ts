import { Injectable, Logger } from '@nestjs/common';
import * as WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';

interface PreparedAsrSession {
  id: string;
  ws: WebSocket;
  expiresAt: number;
  reaper: NodeJS.Timeout;
}

export interface AsrRecognizeResult {
  text: string;
  timing: {
    asr_connect_ms: number;
    asr_wait_final_ms: number;
  };
}

/**
 * 阿里云百炼平台 ASR 语音识别服务
 * 使用 gummy-chat-v1 模型，通过 WebSocket 协议进行实时语音转文字
 */
@Injectable()
export class AsrService {
  private readonly logger = new Logger(AsrService.name);

  /** 预录音频一次性上传时的发送块大小（字节） */
  private readonly CHUNK_SIZE = 128000;

  /** 建连超时时间（毫秒） */
  private readonly CONNECT_TIMEOUT_MS = 8000;

  /** 识别超时时间（毫秒） */
  private readonly RECOGNITION_TIMEOUT_MS = 10000;

  /** 预建连保留时间（毫秒） */
  private readonly PREPARED_SESSION_TTL_MS = 15000;

  /** WebSocket API 地址 */
  private readonly WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference/';

  private readonly preparedSessions = new Map<string, PreparedAsrSession>();

  async prepareSession(): Promise<{ prepareId: string }> {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      throw new Error('DASHSCOPE_API_KEY 环境变量未设置');
    }

    const prepareId = uuidv4().replace(/-/g, '');
    const ws = await this.openWebSocket(apiKey);
    const expiresAt = Date.now() + this.PREPARED_SESSION_TTL_MS;
    const reaper = setTimeout(() => {
      this.releasePreparedSession(prepareId, 'expired');
    }, this.PREPARED_SESSION_TTL_MS);

    this.preparedSessions.set(prepareId, {
      id: prepareId,
      ws,
      expiresAt,
      reaper,
    });

    this.logger.log(`ASR 预建连成功，prepareId=${prepareId}`);
    return { prepareId };
  }

  /**
   * 识别音频内容，返回文字转录结果
   * @param audioBuffer 音频二进制数据
   * @param format 音频格式（pcm, wav, mp3, opus, speex, aac, amr），默认 wav
   * @param prepareId 预建连 ID，可选
   * @returns 识别出的文字和 ASR 分段耗时
   */
  async recognize(audioBuffer: Buffer, format = 'wav', prepareId?: string): Promise<AsrRecognizeResult> {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      throw new Error('DASHSCOPE_API_KEY 环境变量未设置');
    }

    const { pcmBuffer, asrFormat } = this.normalizeAudioBuffer(audioBuffer, format);
    const estimatedDurationMs = this.estimateAudioDurationMs(pcmBuffer, asrFormat);
    const maxEndSilence = this.pickMaxEndSilenceMs(estimatedDurationMs);
    this.logger.log(
      `ASR 输入: format=${asrFormat}, 数据大小=${pcmBuffer.length} 字节, 估算时长=${estimatedDurationMs}ms, max_end_silence=${maxEndSilence}ms`,
    );

    const taskId = uuidv4().replace(/-/g, '');
    const preparedSocket = this.consumePreparedSocket(prepareId);

    return new Promise<AsrRecognizeResult>((resolve, reject) => {
      const sentences: string[] = [];
      let isResolved = false;
      let hasStartedStreaming = false;
      let connectTimer: NodeJS.Timeout | null = null;
      let recognitionTimer: NodeJS.Timeout | null = null;
      let ws: WebSocket;
      let connectStartedAt = Date.now();
      let connectResolvedAt = 0;
      let finishTaskSentAt = 0;

      const cleanup = () => {
        if (connectTimer) {
          clearTimeout(connectTimer);
          connectTimer = null;
        }
        if (recognitionTimer) {
          clearTimeout(recognitionTimer);
          recognitionTimer = null;
        }
      };

      const buildResult = (text: string): AsrRecognizeResult => ({
        text,
        timing: {
          asr_connect_ms: connectResolvedAt > 0 ? connectResolvedAt - connectStartedAt : 0,
          asr_wait_final_ms: finishTaskSentAt > 0 ? Math.max(0, Date.now() - finishTaskSentAt) : 0,
        },
      });

      const resolveWithText = (text: string, reason: string) => {
        if (isResolved) {
          return;
        }
        isResolved = true;
        cleanup();
        this.logger.log(`ASR 提前返回（${reason}）：${text}`);
        try { ws.close(); } catch (_) { /* 忽略 */ }
        resolve(buildResult(text));
      };

      const startRecognitionTimer = () => {
        if (recognitionTimer) {
          clearTimeout(recognitionTimer);
        }
        recognitionTimer = setTimeout(() => {
          if (!isResolved) {
            isResolved = true;
            try { ws.close(); } catch (_) { /* 忽略 */ }
            if (sentences.length > 0) {
              this.logger.warn(`ASR 识别超时，返回已有部分结果：${sentences.join('')}`);
              resolve(buildResult(sentences.join('')));
            } else {
              reject(new Error('ASR 识别超时'));
            }
          }
        }, this.RECOGNITION_TIMEOUT_MS);
      };

      const bindSocketHandlers = () => {
        ws.on('message', (data: WebSocket.Data) => {
          try {
            const raw = data.toString();
            this.logger.debug(`ASR 收到原始消息: ${raw.substring(0, 500)}`);
            const msg = JSON.parse(raw);
            const action = msg?.header?.action;
            const event = msg?.header?.event;
            const key = action || event;

            switch (key) {
              case 'run-task':
              case 'task-started':
                if (!hasStartedStreaming) {
                  hasStartedStreaming = true;
                  this.logger.log('ASR 任务已启动，开始发送音频数据');
                  finishTaskSentAt = this.sendAudioChunks(ws, pcmBuffer, taskId);
                }
                break;

              case 'result-generated': {
                const output = msg?.payload?.output;
                const transcription = output?.transcription || output?.sentence;
                this.logger.debug(`ASR result-generated: ${JSON.stringify(output)?.substring(0, 300)}`);
                if (transcription?.text && transcription?.sentence_end) {
                  sentences.push(transcription.text);
                  this.logger.log(`ASR 识别结果：${transcription.text}`);
                  resolveWithText(sentences.join(''), 'sentence_end');
                }
                break;
              }

              case 'task-finished':
                this.logger.log(`ASR 任务完成，共识别 ${sentences.length} 个句子`);
                if (!isResolved) {
                  isResolved = true;
                  cleanup();
                  ws.close();
                  resolve(buildResult(sentences.join('')));
                }
                break;

              case 'task-failed': {
                const errMsg = msg?.header?.error_message || msg?.header?.message || JSON.stringify(msg?.header);
                this.logger.error(`ASR 任务失败：${errMsg}`);
                if (!isResolved) {
                  isResolved = true;
                  cleanup();
                  ws.close();
                  reject(new Error(`ASR 识别失败：${errMsg}`));
                }
                break;
              }

              default:
                this.logger.warn(`ASR 未处理消息 (action=${action}, event=${event}): ${raw.substring(0, 300)}`);
            }
          } catch (_) {
            this.logger.debug(`ASR 收到非JSON消息，长度: ${data.toString().length}`);
          }
        });

        ws.on('error', (err) => {
          this.logger.error(`ASR WebSocket 错误：${err.message}`);
          if (!isResolved) {
            isResolved = true;
            cleanup();
            reject(new Error(`ASR WebSocket 连接错误：${err.message}`));
          }
        });

        ws.on('close', (code, reason) => {
          this.logger.debug(`ASR WebSocket 已关闭，code: ${code}, reason: ${reason?.toString()}`);
          if (!isResolved) {
            isResolved = true;
            cleanup();
            if (sentences.length > 0) {
              resolve(buildResult(sentences.join('')));
            } else {
              reject(new Error('ASR WebSocket 连接意外关闭'));
            }
          }
        });
      };

      const startTask = () => {
        cleanup();
        connectResolvedAt = Date.now();
        startRecognitionTimer();
        this.logger.log(`ASR WebSocket 已连接，task_id: ${taskId}`);

        const runTaskMsg = {
          header: {
            action: 'run-task',
            task_id: taskId,
            streaming: 'duplex',
          },
          payload: {
            task_group: 'audio',
            task: 'asr',
            function: 'recognition',
            model: 'gummy-chat-v1',
            parameters: {
              sample_rate: 16000,
              format: asrFormat,
              max_end_silence: maxEndSilence,
            },
            input: {},
          },
        };

        ws.send(JSON.stringify(runTaskMsg));
      };

      if (preparedSocket) {
        ws = preparedSocket;
        connectResolvedAt = Date.now();
        connectStartedAt = connectResolvedAt;
        this.logger.log(`复用 ASR 预建连，prepareId=${prepareId}`);
        bindSocketHandlers();
        startTask();
        return;
      }

      connectStartedAt = Date.now();
      ws = new WebSocket(this.WS_URL, {
        headers: {
          Authorization: `bearer ${apiKey}`,
        },
      });

      bindSocketHandlers();

      connectTimer = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          try { ws.close(); } catch (_) { /* 忽略 */ }
          reject(new Error('ASR WebSocket 连接超时'));
        }
      }, this.CONNECT_TIMEOUT_MS);

      ws.on('open', startTask);
    });
  }

  private normalizeAudioBuffer(audioBuffer: Buffer, format: string): { pcmBuffer: Buffer; asrFormat: string } {
    let pcmBuffer = audioBuffer;
    let asrFormat = format;
    if (audioBuffer.length > 44) {
      const header = audioBuffer.subarray(0, 4).toString('ascii');
      if (header === 'RIFF') {
        pcmBuffer = audioBuffer.subarray(44);
        asrFormat = 'pcm';
        this.logger.log(`WAV → PCM: 剥离 44 字节 header，PCM 数据 ${pcmBuffer.length} 字节`);
      }
    }

    const validFormats = ['pcm', 'wav', 'mp3', 'opus', 'speex', 'aac', 'amr'];
    if (!validFormats.includes(asrFormat)) {
      this.logger.warn(`未知音频格式 "${asrFormat}"，回退为 pcm`);
      asrFormat = 'pcm';
    }

    return { pcmBuffer, asrFormat };
  }

  private estimateAudioDurationMs(audioBuffer: Buffer, format: string): number {
    if (format === 'pcm') {
      const bytesPerSecond = 16000 * 2; // 16kHz * 16bit mono
      return Math.max(0, Math.round((audioBuffer.length / bytesPerSecond) * 1000));
    }

    return 0;
  }

  private pickMaxEndSilenceMs(estimatedDurationMs: number): number {
    if (estimatedDurationMs > 0 && estimatedDurationMs <= 2500) {
      return 200;
    }
    if (estimatedDurationMs > 0 && estimatedDurationMs <= 5000) {
      return 250;
    }
    if (estimatedDurationMs > 0 && estimatedDurationMs <= 8000) {
      return 300;
    }
    return 400;
  }

  private async openWebSocket(apiKey: string): Promise<WebSocket> {
    return new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(this.WS_URL, {
        headers: {
          Authorization: `bearer ${apiKey}`,
        },
      });

      const timer = setTimeout(() => {
        try { ws.close(); } catch (_) { /* 忽略 */ }
        reject(new Error('ASR WebSocket 连接超时'));
      }, this.CONNECT_TIMEOUT_MS);

      ws.once('open', () => {
        clearTimeout(timer);
        resolve(ws);
      });

      ws.once('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`ASR WebSocket 连接错误：${err.message}`));
      });

      ws.once('close', (code, reason) => {
        clearTimeout(timer);
        if (ws.readyState !== WebSocket.OPEN) {
          reject(new Error(`ASR WebSocket 连接关闭：${code} ${reason?.toString() || ''}`.trim()));
        }
      });
    });
  }

  private consumePreparedSocket(prepareId?: string): WebSocket | null {
    if (!prepareId) return null;
    const session = this.preparedSessions.get(prepareId);
    if (!session) {
      return null;
    }

    this.preparedSessions.delete(prepareId);
    clearTimeout(session.reaper);

    if (session.ws.readyState !== WebSocket.OPEN || session.expiresAt <= Date.now()) {
      try { session.ws.close(); } catch (_) { /* 忽略 */ }
      return null;
    }

    return session.ws;
  }

  private releasePreparedSession(prepareId: string, reason: string) {
    const session = this.preparedSessions.get(prepareId);
    if (!session) return;
    this.preparedSessions.delete(prepareId);
    clearTimeout(session.reaper);
    try { session.ws.close(); } catch (_) { /* 忽略 */ }
    this.logger.debug(`ASR 预建连已释放，prepareId=${prepareId}, reason=${reason}`);
  }

  /**
   * 分块发送音频数据（无延迟，预录音频一次性发完）
   * 全部发送完后发送 finish-task 消息
   */
  private sendAudioChunks(ws: WebSocket, audioBuffer: Buffer, taskId: string): number {
    const totalChunks = Math.ceil(audioBuffer.length / this.CHUNK_SIZE);
    this.logger.debug(`音频数据总大小: ${audioBuffer.length} 字节，分 ${totalChunks} 块发送`);

    for (let i = 0; i < totalChunks; i++) {
      if (ws.readyState !== WebSocket.OPEN) {
        this.logger.warn('WebSocket 已关闭，停止发送音频');
        return 0;
      }
      const start = i * this.CHUNK_SIZE;
      const end = Math.min(start + this.CHUNK_SIZE, audioBuffer.length);
      ws.send(audioBuffer.subarray(start, end));
    }

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        header: {
          action: 'finish-task',
          task_id: taskId,
          streaming: 'duplex',
        },
        payload: { input: {} },
      }));
      this.logger.log('音频数据发送完毕，已发送 finish-task');
      return Date.now();
    }

    return 0;
  }
}
