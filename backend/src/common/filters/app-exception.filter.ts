import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { sanitizeForLog, sanitizeHeadersForLog, sanitizeStringForLog } from '../logging/log-sanitizer';

type AppErrorCode = 'NETWORK' | 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID' | 'UNKNOWN';

/**
 * NestJS 内置 HttpException 在未指定具体 message 时会填入默认值
 * （如 `new UnauthorizedException()` → "Unauthorized"）。这些默认值对终端用户毫无帮助，
 * 需识别后回落到我们准备的中文通用文案。
 */
const FRAMEWORK_DEFAULT_MESSAGES = new Set([
  'Bad Request',
  'Unauthorized',
  'Forbidden',
  'Forbidden resource',
  'Not Found',
  'Method Not Allowed',
  'Too Many Requests',
  'Internal Server Error',
]);
function isFrameworkDefaultMessage(msg: string): boolean {
  return FRAMEWORK_DEFAULT_MESSAGES.has(msg);
}

/**
 * 全局异常过滤器
 * 将所有异常统一映射为 { ok: false, error: AppError } 格式
 * 与前端 src/types/AppError.ts 的 AppErrorCode 完全对齐
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request & { requestId?: string }>();
    const response = ctx.getResponse<Response>();
    const requestId = request?.requestId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: AppErrorCode = 'UNKNOWN';
    let message = '服务器内部错误';
    let displayMessage = '服务器开小差了';
    let retryable = true;
    // 业务子错误码（由 service 层通过 throw new XxxException({ code: 'CUSTOM_CODE', message }) 携带）
    // 用于前端需要"根据具体场景分支"的情形，如 CAPTCHA_INVALID 触发自动刷新图形码
    // 不覆盖上方通用 code 字段，避免 5 枚举的类型约束被破坏
    let businessCode: string | undefined;

    // Multer 限制错误：统一映射为 400，避免被当成 500
    const multerErrorCode = (exception as any)?.name === 'MulterError'
      ? (exception as any)?.code
      : null;
    if (multerErrorCode) {
      status = HttpStatus.BAD_REQUEST;
      code = 'INVALID';
      retryable = false;

      if (multerErrorCode === 'LIMIT_FILE_SIZE') {
        message = '上传文件过大';
        displayMessage = '文件大小超出限制';
      } else if (multerErrorCode === 'LIMIT_FILE_COUNT') {
        message = '上传文件数量过多';
        displayMessage = '上传文件数量超出限制';
      } else if (multerErrorCode === 'LIMIT_UNEXPECTED_FILE') {
        message = '上传字段无效';
        displayMessage = '上传文件格式不正确';
      } else {
        message = `上传失败：${multerErrorCode}`;
        displayMessage = '上传请求无效';
      }
    }

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      const rawMessage =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : (exceptionResponse as any)?.message;

      // 如果 message 是数组（class-validator 验证错误），取第一条
      message = Array.isArray(rawMessage) ? rawMessage[0] : rawMessage || message;

      // 透传业务 code（若 service 层抛 { code: 'CUSTOM_CODE', message } 结构）
      const rawCode = typeof exceptionResponse === 'object'
        ? (exceptionResponse as any)?.code
        : undefined;
      if (typeof rawCode === 'string' && rawCode) {
        businessCode = rawCode;
      }

      // 通用策略：service 层主动抛出具体 message 时优先透传，避免被通用 fallback 覆盖
      // （特别是 404/403/429 过去写死 fallback，导致业务文案"该手机号未注册""暂无权限"
      //  被吞成"未找到相关内容""暂无权限"等无意义的通用文本）
      const specific = (typeof message === 'string' && message && !isFrameworkDefaultMessage(message))
        ? message
        : null;

      switch (status) {
        case 400:
          code = 'INVALID';
          displayMessage = specific ?? '请求参数有误';
          retryable = false;
          break;
        case 401:
          code = 'FORBIDDEN';
          // 登录接口抛出的具体错误（如"手机号未注册"/"密码错误"）直接透传；
          // 通用 401（token 过期等，message 为默认 "Unauthorized"）使用友好提示
          displayMessage = specific ?? '请先登录';
          retryable = false;
          break;
        case 403:
          code = 'FORBIDDEN';
          displayMessage = specific ?? '暂无权限';
          retryable = false;
          break;
        case 404:
          code = 'NOT_FOUND';
          displayMessage = specific ?? '未找到相关内容';
          retryable = false;
          break;
        case 429:
          code = 'INVALID';
          displayMessage = specific ?? '请求过于频繁，请稍后再试';
          retryable = true;
          break;
        default:
          code = 'UNKNOWN';
          displayMessage = specific ?? '服务器开小差了';
          retryable = true;
      }
    }

    this.logException({
      exception,
      request,
      requestId,
      status,
      code,
      message,
    });

    response.status(status).json({
      ok: false,
      error: {
        code,
        message: typeof message === 'string' ? message : JSON.stringify(message),
        displayMessage,
        retryable,
        ...(businessCode ? { businessCode } : {}),
        ...(requestId ? { requestId } : {}),
      },
    });
  }

  private logException(params: {
    exception: unknown;
    request?: Request & { requestId?: string };
    requestId?: string;
    status: number;
    code: AppErrorCode;
    message: string;
  }) {
    const { exception, request, requestId, status, code, message } = params;
    const shouldLog =
      status >= 500 ||
      status === 401 ||
      status === 403 ||
      status === 429 ||
      !(exception instanceof HttpException);

    if (!shouldLog || !request) return;

    const payload = {
      requestId,
      status,
      code,
      message: sanitizeStringForLog(message),
      method: request.method,
      path: request.originalUrl || request.url,
      ip: request.ip,
      userId: (request as any)?.user?.sub ?? (request as any)?.user?.userId ?? undefined,
      headers: sanitizeHeadersForLog(request.headers as any),
      params: sanitizeForLog(request.params),
      query: sanitizeForLog(request.query),
      body: sanitizeForLog(request.body),
      exception:
        exception instanceof Error
          ? {
              name: exception.name,
              message: sanitizeStringForLog(exception.message),
              stack: exception.stack ? sanitizeStringForLog(exception.stack, { maxStringLength: 4000 }) : undefined,
            }
          : sanitizeForLog(exception),
    };

    if (status >= 500) {
      this.logger.error(JSON.stringify(payload));
      return;
    }

    this.logger.warn(JSON.stringify(payload));
  }
}
