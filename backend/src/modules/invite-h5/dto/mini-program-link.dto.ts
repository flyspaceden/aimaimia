import { IsString, Matches } from 'class-validator';

/**
 * 仅允许刚刚落到邀请 H5 的同一推荐码换取小程序 URL Link。
 * landingSessionId 不是登录凭证，不包含用户身份；它只防止网页被改成跳往另一个推荐码。
 */
export class InviteH5MiniProgramLinkDto {
  @IsString()
  @Matches(/^[A-Za-z0-9]{8}$/)
  inviteCode: string;

  @IsString()
  @Matches(/^ih5_[a-f0-9]{24}$/)
  landingSessionId: string;
}
