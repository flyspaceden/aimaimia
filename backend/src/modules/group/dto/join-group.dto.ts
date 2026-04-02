import { IsOptional, IsInt, Min } from 'class-validator';

export class JoinGroupCountDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  count?: number;
}
