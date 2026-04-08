import { IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class SubmitCsRatingDto {
  @IsInt()
  @Min(1)
  @Max(5)
  score: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  comment?: string;
}
