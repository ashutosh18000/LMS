import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectRequestDto {
  @IsString({ message: 'comment must be a string' })
  @IsNotEmpty({ message: 'comment is required' })
  @MaxLength(500, { message: 'comment cannot exceed 500 characters' })
  comment!: string;
}
