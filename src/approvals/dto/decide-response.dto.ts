import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RequestStatus, SegmentStatus } from '@prisma/client';

export class DecidedSegmentItemDto {
  @ApiProperty({ description: 'Segment ID', example: 'uuid-segment-id' })
  id!: string;

  @ApiProperty({
    description: 'Updated segment status',
    enum: SegmentStatus,
    example: SegmentStatus.approved,
  })
  status!: SegmentStatus;

  @ApiPropertyOptional({
    description: 'Comment provided for this segment decision',
    example: 'Approved based on team coverage',
  })
  comment?: string | null;
}

export class DecideResponseDto {
  @ApiProperty({
    description: 'Status message of the decision outcome',
    example: 'Leave request decided successfully',
  })
  message!: string;

  @ApiProperty({ description: 'Leave request ID', example: 'uuid-request-id' })
  id!: string;

  @ApiProperty({
    description: 'Derived leave request status',
    enum: RequestStatus,
    example: RequestStatus.partially_approved,
  })
  status!: RequestStatus;

  @ApiProperty({
    description: 'List of individual segment decisions',
    type: [DecidedSegmentItemDto],
  })
  segments!: DecidedSegmentItemDto[];
}
