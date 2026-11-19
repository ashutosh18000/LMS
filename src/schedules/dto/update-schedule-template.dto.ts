import { IsArray, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { SaturdayMode } from '@prisma/client';

export class UpdateScheduleTemplateDto {
  @IsOptional()
  @IsString({ message: 'Template name must be a string' })
  name?: string;

  @IsOptional()
  @IsEnum(SaturdayMode, {
    message: 'saturdayMode must be one of: off, half, full, alternate',
  })
  saturdayMode?: SaturdayMode;

  @IsOptional()
  @IsArray({ message: 'alternateOffWeeks must be an array of numbers' })
  @IsInt({ each: true, message: 'Each week number must be an integer' })
  alternateOffWeeks?: number[];
}
