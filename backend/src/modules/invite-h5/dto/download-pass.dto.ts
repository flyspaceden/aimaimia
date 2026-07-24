import { IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

/** 已登录 H5 会话申请一次性下载交接凭证。 */
export class CreateInviteH5DownloadPassDto {
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  landingSessionId: string;

  /** 由 Web Crypto 生成的 256 位随机 capability；服务端只保存 SHA-256 哈希。 */
  @IsString()
  @Length(43, 43)
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  ticket: string;
}

/** 系统浏览器消费一次性下载交接凭证。 */
export class ConsumeInviteH5DownloadPassDto {
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  ticket: string;
}
