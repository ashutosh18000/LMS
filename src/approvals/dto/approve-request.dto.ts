import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveRequestDto {
  @IsOptional()
  @IsString({ message: 'comment must be a string' })
  @MaxLength(500, { message: 'comment cannot exceed 500 characters' })
  comment?: string;
}
