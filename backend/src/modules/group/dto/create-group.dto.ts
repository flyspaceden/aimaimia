import { IsString, IsInt, Min } from 'class-validator';

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

  @IsString()
  deadline: string;
}
