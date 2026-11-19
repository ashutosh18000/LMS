import { IsArray, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { SaturdayMode } from '@prisma/client';

export class CreateScheduleTemplateDto {
  @IsString({ message: 'Template name must be a string' })
  @IsNotEmpty({ message: 'Template name is required' })
  name!: string;

  @IsEnum(SaturdayMode, {
    message: 'saturdayMode must be one of: off, half, full, alternate',
  })
  @IsNotEmpty({ message: 'saturdayMode is required' })
  saturdayMode!: SaturdayMode;

  @IsOptional()
  @IsArray({ message: 'alternateOffWeeks must be an array of numbers' })
  @IsInt({ each: true, message: 'Each week number must be an integer' })
  alternateOffWeeks?: number[];
}
