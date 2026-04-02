import { IsString, IsOptional, IsIn } from 'class-validator';

export class ReviewBookingDto {
  @IsIn(['approved', 'rejected'])
  status: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  note?: string;
}
