import { IsString, IsOptional, IsInt, IsIn, Min } from 'class-validator';

export class CreateBookingDto {
  @IsString()
  companyId: string;

  @IsOptional()
  @IsString()
  eventId?: string;

  @IsString()
  date: string;

  @IsInt()
  @Min(1)
  headcount: number;

  @IsIn(['consumer', 'buyer', 'student', 'media', 'investor', 'other'])
  identity: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;
}
