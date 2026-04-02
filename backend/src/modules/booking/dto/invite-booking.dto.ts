import { IsString } from 'class-validator';

export class InviteBookingDto {
  @IsString()
  groupId: string;
}
