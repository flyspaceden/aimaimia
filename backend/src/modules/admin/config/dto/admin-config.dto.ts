import { IsString, IsOptional, IsDefined } from 'class-validator';

export class UpdateConfigDto {
  /** 配置值（具体类型由配置键决定，在 Service 层做业务验证） */
  @IsDefined({ message: '配置值 value 不能为空' })
  value: any;

  @IsOptional()
  @IsString()
  changeNote?: string;
}
