import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import {
  MarkAllReadResponseDto,
  MarkReadResponseDto,
  PaginatedNotificationsResponseDto,
  UnreadCountResponseDto,
} from './dto/notification-response.dto';

@ApiTags('Notifications')
@ApiBearerAuth('JWT-auth')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * 1. GET /notifications
   * Paginated listing of in-app notifications for the authenticated user.
   */
  @Get()
  @ApiOperation({ summary: 'Get current user notifications (paginated, ?unread=true)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated list of user notifications',
    type: PaginatedNotificationsResponseDto,
  })
  async getNotifications(
    @CurrentUser('id') userId: string,
    @CurrentUser('orgId') orgId: string,
    @Query() query: QueryNotificationsDto,
  ): Promise<PaginatedNotificationsResponseDto> {
    return this.notificationsService.getNotifications(userId, orgId, query);
  }

  /**
   * 2. GET /notifications/unread-count
   * Count of unread notifications for the authenticated user.
   */
  @Get('unread-count')
  @ApiOperation({ summary: 'Get count of unread notifications' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Unread notifications count',
    type: UnreadCountResponseDto,
  })
  async getUnreadCount(
    @CurrentUser('id') userId: string,
    @CurrentUser('orgId') orgId: string,
  ): Promise<UnreadCountResponseDto> {
    return this.notificationsService.getUnreadCount(userId, orgId);
  }

  /**
   * 3. PATCH /notifications/:id/read
   * Marks a specific notification as read.
   */
  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark single notification as read' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Notification marked as read',
    type: MarkReadResponseDto,
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Notification not found' })
  async markAsRead(
    @CurrentUser('id') userId: string,
    @CurrentUser('orgId') orgId: string,
    @Param('id') id: string,
  ): Promise<MarkReadResponseDto> {
    return this.notificationsService.markAsRead(userId, orgId, id);
  }

  /**
   * 4. POST /notifications/read-all
   * Marks all unread notifications of the user as read.
   */
  @HttpCode(HttpStatus.OK)
  @Post('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'All notifications marked as read',
    type: MarkAllReadResponseDto,
  })
  async markAllAsRead(
    @CurrentUser('id') userId: string,
    @CurrentUser('orgId') orgId: string,
  ): Promise<MarkAllReadResponseDto> {
    return this.notificationsService.markAllAsRead(userId, orgId);
  }
}
