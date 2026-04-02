import { IsIn } from 'class-validator';

export class UpdateGroupStatusDto {
  @IsIn(['forming', 'inviting', 'confirmed', 'paid', 'completed'])
  status: string;
}
