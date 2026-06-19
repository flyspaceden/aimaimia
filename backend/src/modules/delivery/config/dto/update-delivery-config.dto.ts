import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

class UpdateDeliveryConfigItemDto {
  @IsString()
  @IsNotEmpty()
  key: string;

  value: unknown;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @IsIn(['SYSTEM', 'CUSTOMER_SERVICE', 'MANIFEST', 'UNIT'])
  scope?: 'SYSTEM' | 'CUSTOMER_SERVICE' | 'MANIFEST' | 'UNIT';
}

export class UpdateDeliveryConfigDto {
  @IsArray()
  items: UpdateDeliveryConfigItemDto[];
}

export { UpdateDeliveryConfigItemDto };
