import {
  Equals,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export enum AccountDeletionConfirmMethod {
  SMS = 'SMS',
  WECHAT_MODAL = 'WECHAT_MODAL',
}

export class SendDeletionCodeDto {}

export class ExecuteDeletionDto {
  @IsEnum(AccountDeletionConfirmMethod)
  confirmationMethod!: AccountDeletionConfirmMethod;

  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(8)
  smsCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  modalConfirmText?: string;

  @IsBoolean()
  @Equals(true)
  acknowledgedNotice!: true;
}
