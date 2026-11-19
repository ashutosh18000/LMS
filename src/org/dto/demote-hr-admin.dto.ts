import { IsIn, IsNotEmpty } from 'class-validator';
import { Role } from '@prisma/client';

export class DemoteHrAdminDto {
  @IsIn([Role.staff, Role.manager], {
    message: 'New role must be either staff or manager',
  })
  @IsNotEmpty({ message: 'New role is required' })
  newRole!: 'staff' | 'manager';
}
