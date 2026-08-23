import { IsString, IsInt, Min, IsDateString } from 'class-validator';

export class CreateGroupDto {
  @IsString()
  companyId: string;

  @IsString()
  title: string;

  @IsString()
  destination: string;

  @IsInt()
  @Min(1)
  targetSize: number;

  @IsDateString({ strict: true })
  deadline: string;
}
