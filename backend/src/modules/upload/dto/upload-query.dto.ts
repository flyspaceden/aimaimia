import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { UPLOAD_FOLDER_PATTERN } from '../upload.constants';

export class UploadQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(UPLOAD_FOLDER_PATTERN, {
    message: 'folder 仅允许字母、数字、_、- 和 /，最多 3 层目录',
  })
  folder?: string;
}
