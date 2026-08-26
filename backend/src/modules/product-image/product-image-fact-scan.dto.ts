import { IsString, MaxLength } from 'class-validator';

export class RequestProductImageFactScanDto {
  @IsString()
  productId: string;

  @IsString()
  @MaxLength(128)
  idempotencyKey: string;
}
