import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ShipmentCallbackEventDto {
  @IsISO8601({}, { message: 'events.time 必须为 ISO8601 时间格式' })
  time: string;

  @IsString({ message: 'events.message 必须为字符串' })
  @MaxLength(200, { message: 'events.message 不能超过 200 个字符' })
  message: string;

  @IsOptional()
  @IsString({ message: 'events.location 必须为字符串' })
  @MaxLength(120, { message: 'events.location 不能超过 120 个字符' })
  location?: string;
}

export class ShipmentCallbackDto {
  @IsString({ message: 'trackingNo 必须为字符串' })
  @MaxLength(64, { message: 'trackingNo 不能超过 64 个字符' })
  trackingNo: string;

  @IsString({ message: 'status 必须为字符串' })
  @MaxLength(32, { message: 'status 不能超过 32 个字符' })
  status: string;

  @IsOptional()
  @IsArray({ message: 'events 必须为数组' })
  @ArrayMaxSize(100, { message: 'events 最多 100 条' })
  @ValidateNested({ each: true })
  @Type(() => ShipmentCallbackEventDto)
  events?: ShipmentCallbackEventDto[];

  @IsOptional()
  rawPayload?: any;

  @IsOptional()
  @IsString({ message: 'signature 必须为字符串' })
  @MaxLength(512, { message: 'signature 不能超过 512 个字符' })
  signature?: string;
}
