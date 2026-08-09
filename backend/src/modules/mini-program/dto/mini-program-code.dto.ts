import { IsIn } from 'class-validator';

export const MINI_PROGRAM_CODE_KINDS = ['REFERRAL', 'GROUP_BUY', 'CAPTAIN'] as const;

export class CreateMiniProgramCodeDto {
  @IsIn(MINI_PROGRAM_CODE_KINDS)
  kind: typeof MINI_PROGRAM_CODE_KINDS[number];
}
