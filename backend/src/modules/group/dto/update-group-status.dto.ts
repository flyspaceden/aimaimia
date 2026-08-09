import { IsEnum } from 'class-validator';
import { GroupStatus } from '@prisma/client';

export class UpdateGroupStatusDto {
  @IsEnum(GroupStatus)
  status: GroupStatus;
}
