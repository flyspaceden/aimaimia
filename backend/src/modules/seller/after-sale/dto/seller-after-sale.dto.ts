import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsArray,
  ArrayMinSize,
  MaxLength,
} from 'class-validator';

export class ApproveAfterSaleDto {
  @IsOptional()
  @IsString({ message: 'note 必须为字符串' })
  @MaxLength(500, { message: 'note 不能超过 500 个字符' })
  note?: string;
}

export class RejectAfterSaleDto {
  @IsString({ message: 'reason 必须为字符串' })
  @IsNotEmpty({ message: 'reason 不能为空' })
  @MaxLength(500, { message: 'reason 不能超过 500 个字符' })
  reason: string;
}

export class RejectReturnDto {
  @IsString({ message: 'reason 必须为字符串' })
  @IsNotEmpty({ message: 'reason 不能为空' })
  @MaxLength(500, { message: 'reason 不能超过 500 个字符' })
  reason: string;

  @IsArray({ message: 'photos 必须为数组' })
  @ArrayMinSize(1, { message: 'photos 至少包含 1 张照片' })
  @IsString({ each: true, message: 'photos 每项必须为字符串' })
  photos: string[];

  @IsString({ message: 'returnWaybillNo 必须为字符串' })
  @IsNotEmpty({ message: 'returnWaybillNo 不能为空' })
  @MaxLength(50, { message: 'returnWaybillNo 不能超过 50 个字符' })
  returnWaybillNo: string;
}

export class GenerateWaybillDto {
  @IsString({ message: 'carrierCode 必须为字符串' })
  @IsNotEmpty({ message: 'carrierCode 不能为空' })
  @MaxLength(16, { message: 'carrierCode 不能超过 16 个字符' })
  carrierCode: string;
}
