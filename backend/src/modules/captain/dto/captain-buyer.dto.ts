import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class BindCaptainCodeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  code: string;
}
