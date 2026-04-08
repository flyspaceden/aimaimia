import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CsContentType } from '@prisma/client';

export class SendCsMessageDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsOptional()
  @IsEnum(CsContentType)
  contentType?: CsContentType;
}
