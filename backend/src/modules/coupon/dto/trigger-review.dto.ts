import { IsOptional, IsString, MaxLength } from 'class-validator';

/** 上报评价事件 DTO（用于触发 REVIEW 红包） */
export class TriggerReviewDto {
  @IsString()
  @MaxLength(64)
  orderId: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  reviewId?: string;
}
