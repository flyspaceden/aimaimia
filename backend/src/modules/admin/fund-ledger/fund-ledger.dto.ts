import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';

export class FundQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() @MaxLength(100) companyId?: string;
  @IsOptional() @IsString() @MaxLength(100) orderId?: string;
  @IsOptional() @IsString() @MaxLength(100) eventType?: string;
  @IsOptional() @IsIn(['NORMAL', 'VIP', 'LEGACY']) sourceType?: string;
  @IsOptional() @IsString() @MaxLength(100) status?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}
export class FundPaymentCreateDto {
  @IsString() @Length(1,100) companyId!: string;
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }) @Min(0.01) @Max(100000000) amount!: number;
  @IsString() @Length(1,200) payeeName!: string;
  @IsString() @Length(6,80) bankAccount!: string;
  @IsString() @Length(1,200) bankName!: string;
  @IsString() @Length(1,500) reason!: string;
  @IsString() @Length(8,100) idempotencyKey!: string;
}
export class FundPaymentConfirmDto {
  @IsOptional() @IsBoolean() confirmActualPayment?: boolean;
  @IsOptional() @IsString() @Length(1,500) reviewReason?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100000000) actualAmount!: number;
  @IsDateString() paidAt!: string;
  @IsString() @Length(1,100) sourceAccountRef!: string;
  @IsString() @Length(1,100) bankReference!: string;
  @IsUUID() proofKey!: string;
  @IsString() @Length(8,100) idempotencyKey!: string;
}
export class FundPaymentReasonDto {
  @IsString() @Length(1,500) reason!: string;
  @IsString() @Length(8,100) idempotencyKey!: string;
}
export class FundRecoveryDto extends FundPaymentReasonDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100000000) amount!: number;
  @IsDateString() recoveredAt!: string;
  @IsString() @Length(1,100) bankReference!: string;
  @IsUUID() proofKey!: string;
}
