import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDeliveryConversationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  orderId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  subOrderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  subject?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  message: string;
}
