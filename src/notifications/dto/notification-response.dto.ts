import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationType } from '@prisma/client';

export class NotificationItemDto {
  @ApiProperty({ description: 'Notification unique ID', example: 'uuid-notification-id' })
  id!: string;

  @ApiProperty({
    description: 'Notification event type',
    enum: NotificationType,
    example: NotificationType.leave_decided,
  })
  type!: NotificationType;

  @ApiProperty({
    description: 'Notification title',
    example: 'Leave Request Decision: Partially Approved',
  })
  title!: string;

  @ApiProperty({
    description: 'Notification body text (plain text)',
    example: 'Your leave request has been decided:\n- WFH (2026-11-25 to 2026-11-25, full): Approved\n- Casual Leave (2026-11-26 to 2026-11-26, full): Rejected. Reason: Team coverage needed',
  })
  body!: string;

  @ApiPropertyOptional({
    description: 'Associated leave request ID if applicable',
    example: 'uuid-request-id',
    nullable: true,
  })
  requestId!: string | null;

  @ApiPropertyOptional({
    description: 'Timestamp when notification was read',
    example: '2026-11-23T11:00:00.000Z',
    nullable: true,
  })
  readAt!: Date | null;

  @ApiProperty({
    description: 'Timestamp when notification was created',
    example: '2026-11-23T10:45:00.000Z',
  })
  createdAt!: Date;
}

export class PaginatedNotificationsResponseDto {
  @ApiProperty({ type: [NotificationItemDto] })
  items!: NotificationItemDto[];

  @ApiProperty({ description: 'Total matching notifications count', example: 12 })
  total!: number;

  @ApiProperty({ description: 'Current page number', example: 1 })
  page!: number;

  @ApiProperty({ description: 'Items per page', example: 20 })
  limit!: number;

  @ApiProperty({ description: 'Total number of pages', example: 1 })
  totalPages!: number;
}

export class UnreadCountResponseDto {
  @ApiProperty({ description: 'Number of unread notifications', example: 3 })
  unreadCount!: number;

  @ApiProperty({ description: 'Alias for unreadCount for convenience', example: 3 })
  count!: number;
}

export class MarkReadResponseDto {
  @ApiProperty({ description: 'Success message', example: 'Notification marked as read' })
  message!: string;

  @ApiProperty({ description: 'Notification ID', example: 'uuid-notification-id' })
  id!: string;

  @ApiProperty({ description: 'Read timestamp', example: '2026-11-23T11:00:00.000Z' })
  readAt!: Date;
}

export class MarkAllReadResponseDto {
  @ApiProperty({ description: 'Success message', example: 'All notifications marked as read' })
  message!: string;

  @ApiProperty({ description: 'Number of notifications marked as read', example: 5 })
  count!: number;
}
