import { IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDeliveryStaffDto {
  @IsString()
  @MaxLength(60)
  username: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  realName?: string;

  @IsString()
  @IsIn(['OWNER', 'MANAGER', 'OPERATOR'])
  role: 'OWNER' | 'MANAGER' | 'OPERATOR';

  @IsOptional()
  @IsArray()
  permissionCodes?: string[];
}
