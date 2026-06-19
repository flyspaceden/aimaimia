import { IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateDeliveryStaffDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  realName?: string;

  @IsOptional()
  @IsString()
  @IsIn(['OWNER', 'MANAGER', 'OPERATOR'])
  role?: 'OWNER' | 'MANAGER' | 'OPERATOR';

  @IsOptional()
  @IsString()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';

  @IsOptional()
  @IsArray()
  permissionCodes?: string[];
}
