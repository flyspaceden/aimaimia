import { IsDefined, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCsOutreachDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  buyerNo!: string;

  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  initialMessage!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  inviteTitle?: string;
}
