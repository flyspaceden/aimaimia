import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsString } from 'class-validator';

export class RequestProductMediaRevisionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(9)
  @IsString({ each: true })
  mediaAssetIds: string[];

  @IsString()
  idempotencyKey: string;

  @IsBoolean()
  quantityConfirmed: boolean;

  @IsBoolean()
  labelsConfirmed: boolean;

  @IsBoolean()
  factsConfirmed: boolean;
}
