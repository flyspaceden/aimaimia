import { IsString, Length } from 'class-validator';
export class WechatDeletionProofDto { @IsString() @Length(1, 256) code!: string; }
