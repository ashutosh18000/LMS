import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty } from 'class-validator';

export class CarryForwardDto {
  @Type(() => Number)
  @IsInt({ message: 'fromYear must be an integer' })
  @IsNotEmpty({ message: 'fromYear is required' })
  fromYear!: number;
}
