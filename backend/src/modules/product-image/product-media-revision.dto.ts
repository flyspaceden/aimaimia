import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsString, MaxLength, MinLength } from 'class-validator';

export class RequestProductMediaRevisionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(9)
  @ArrayUnique()
  @IsString({ each: true })
  mediaAssetIds: string[];

  @IsString()
  @MinLength(8)
  @MaxLength(160)
  idempotencyKey: string;

  @IsBoolean()
  quantityConfirmed: boolean;

  @IsBoolean()
  labelsConfirmed: boolean;

  @IsBoolean()
  factsConfirmed: boolean;
}
