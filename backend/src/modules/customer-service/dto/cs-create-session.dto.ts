import { IsIn, IsOptional, IsString } from 'class-validator';
import { CsSessionSource } from '@prisma/client';

export class CreateCsSessionDto {
  @IsIn([
    CsSessionSource.MY_PAGE,
    CsSessionSource.ORDER_DETAIL,
    CsSessionSource.AFTERSALE_DETAIL,
  ])
  source: CsSessionSource;

  @IsOptional()
  @IsString()
  sourceId?: string;
}
