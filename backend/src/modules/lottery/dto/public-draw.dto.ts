import { IsString, Length } from 'class-validator';

export class PublicDrawDto {
  @IsString()
  @Length(32, 128)
  deviceFingerprint: string;
}
