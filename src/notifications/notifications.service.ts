import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType, Portion, Prisma, RequestStatus, SegmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import {
  MarkAllReadResponseDto,
  MarkReadResponseDto,
  PaginatedNotificationsResponseDto,
  UnreadCountResponseDto,
} from './dto/notification-response.dto';
import { DateUtil } from '../common/utils/date.util';

export interface DecidedSegmentNotificationItem {
  id: string;
  isWfh: boolean;
  startDate: string | Date;
  endDate: string | Date;
  portion: Portion;
  status: SegmentStatus;
  comment?: string | null;
}

export interface DecisionNotificationInput {
  orgId: string;
  requestId: string;
  requestStatus: RequestStatus;
  requester: {
    id: string;
    name: string;
    managerId?: string | null;
  };
  segments: DecidedSegmentNotificationItem[];
}

export interface CancellationNotificationInput {
  orgId: string;
  requestId: string;
  cancelledBy: 'staff' | 'hr';
  requester: {
    id: string;
    name: string;
    managerId?: string | null;
  };
  segments: Array<{
    isWfh: boolean;
    startDate: string | Date;
    endDate: string | Date;
    portion: Portion;
  }>;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves paginated notifications strictly scoped to the caller's userId and orgId.
   */
  async getNotifications(
    userId: string,
    orgId: string,
    query: QueryNotificationsDto,
  ): Promise<PaginatedNotificationsResponseDto> {
    const where: Prisma.NotificationWhereInput = {
      userId,
      orgId,
      ...(query.unread ? { readAt: null } : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    return {
      items: items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        requestId: n.requestId,
        readAt: n.readAt,
        createdAt: n.createdAt,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Returns count of unread notifications for caller.
   */
  async getUnreadCount(userId: string, orgId: string): Promise<UnreadCountResponseDto> {
    const unreadCount = await this.prisma.notification.count({
      where: {
        userId,
        orgId,
        readAt: null,
      },
    });

    return {
      unreadCount,
      count: unreadCount,
    };
  }

  /**
   * Marks a single notification as read if owned by the caller.
   */
  async markAsRead(
    userId: string,
    orgId: string,
    id: string,
  ): Promise<MarkReadResponseDto> {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId, orgId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    const now = new Date();
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: now },
    });

    return {
      message: 'Notification marked as read',
      id: updated.id,
      readAt: updated.readAt!,
    };
  }

  /**
   * Marks all unread notifications of caller as read.
   */
  async markAllAsRead(userId: string, orgId: string): Promise<MarkAllReadResponseDto> {
    const result = await this.prisma.notification.updateMany({
      where: {
        userId,
        orgId,
        readAt: null,
      },
      data: {
        readAt: new Date(),
      },
    });

    return {
      message: 'All notifications marked as read',
      count: result.count,
    };
  }

  /**
   * Creates notifications for a leave decision within a database transaction.
   * Generates:
   * 1. Staff notification (detailed with HR comments on rejection).
   * 2. Manager notification (sanitized: NO decision comment, NO leave type name, NO staff reason, NO balance).
   */
  async createDecisionNotifications(
    tx: Prisma.TransactionClient,
    input: DecisionNotificationInput,
  ): Promise<void> {
    const { orgId, requestId, requestStatus, requester, segments } = input;

    // 1. Staff Notification (Staff gets summary with segment-level decision comments)
    let staffStatusLabel = 'Decided';
    if (requestStatus === RequestStatus.approved) staffStatusLabel = 'Approved';
    else if (requestStatus === RequestStatus.rejected) staffStatusLabel = 'Rejected';
    else if (requestStatus === RequestStatus.partially_approved) staffStatusLabel = 'Partially Approved';

    const staffTitle = `Leave Request Decision: ${staffStatusLabel}`;

    const staffLines: string[] = [
      `Your leave request has been ${staffStatusLabel.toLowerCase()}. Details by segment:`,
    ];

    for (const seg of segments) {
      const kind = seg.isWfh ? 'WFH' : 'Leave';
      const startStr = typeof seg.startDate === 'string' ? seg.startDate : DateUtil.format(seg.startDate);
      const endStr = typeof seg.endDate === 'string' ? seg.endDate : DateUtil.format(seg.endDate);
      const portionStr = seg.portion === Portion.full ? 'Full Day' : seg.portion === Portion.first_half ? 'First Half' : 'Second Half';
      const decisionStr = seg.status === SegmentStatus.approved ? 'Approved' : 'Rejected';

      let line = `- ${kind} (${startStr} to ${endStr}, ${portionStr}): ${decisionStr}`;
      if (seg.status === SegmentStatus.rejected && seg.comment) {
        line += `. Reason: ${seg.comment}`;
      }
      staffLines.push(line);
    }

    await tx.notification.create({
      data: {
        orgId,
        userId: requester.id,
        type: NotificationType.leave_decided,
        title: staffTitle,
        body: staffLines.join('\n'),
        requestId,
      },
    });

    // 2. Manager Notification (if managerId is present)
    // CRITICAL PRIVACY: Manager NEVER receives decisionComment, reason, leave type name, or balance.
    if (requester.managerId && requester.managerId !== requester.id) {
      const managerTitle = `Team Member Leave Decision: ${requester.name}`;
      const managerLines: string[] = [
        `Leave decision for ${requester.name}:`,
      ];

      for (const seg of segments) {
        const kind = seg.isWfh ? 'WFH' : 'Leave';
        const startStr = typeof seg.startDate === 'string' ? seg.startDate : DateUtil.format(seg.startDate);
        const endStr = typeof seg.endDate === 'string' ? seg.endDate : DateUtil.format(seg.endDate);
        const portionStr = seg.portion === Portion.full ? 'Full Day' : seg.portion === Portion.first_half ? 'First Half' : 'Second Half';
        const decisionStr = seg.status === SegmentStatus.approved ? 'Approved' : 'Rejected';

        // Sanitized segment line: ONLY who, dates, kind, portion, and decision status. NO comments.
        managerLines.push(`- ${kind} (${startStr} to ${endStr}, ${portionStr}): ${decisionStr}`);
      }

      await tx.notification.create({
        data: {
          orgId,
          userId: requester.managerId,
          type: NotificationType.leave_decided,
          title: managerTitle,
          body: managerLines.join('\n'),
          requestId,
        },
      });
    }
  }

  /**
   * Creates notifications when a leave request is cancelled (by staff or by HR cancel-approved).
   */
  async createCancellationNotifications(
    tx: Prisma.TransactionClient,
    input: CancellationNotificationInput,
  ): Promise<void> {
    const { orgId, requestId, cancelledBy, requester, segments } = input;

    // 1. Staff Notification
    const staffTitle = cancelledBy === 'hr'
      ? 'Approved Leave Request Cancelled by HR'
      : 'Leave Request Cancelled';

    const staffLines: string[] = [
      cancelledBy === 'hr'
        ? 'Your approved leave request has been cancelled by HR. Any deducted leave balance has been refunded.'
        : 'Your leave request has been cancelled.',
    ];

    for (const seg of segments) {
      const kind = seg.isWfh ? 'WFH' : 'Leave';
      const startStr = typeof seg.startDate === 'string' ? seg.startDate : DateUtil.format(seg.startDate);
      const endStr = typeof seg.endDate === 'string' ? seg.endDate : DateUtil.format(seg.endDate);
      const portionStr = seg.portion === Portion.full ? 'Full Day' : seg.portion === Portion.first_half ? 'First Half' : 'Second Half';
      staffLines.push(`- ${kind} (${startStr} to ${endStr}, ${portionStr})`);
    }

    await tx.notification.create({
      data: {
        orgId,
        userId: requester.id,
        type: NotificationType.leave_cancelled,
        title: staffTitle,
        body: staffLines.join('\n'),
        requestId,
      },
    });

    // 2. Manager Notification (if managerId is present)
    if (requester.managerId && requester.managerId !== requester.id) {
      const managerTitle = `Team Member Leave Cancelled: ${requester.name}`;
      const managerLines: string[] = [
        `Leave for ${requester.name} has been cancelled:`,
      ];

      for (const seg of segments) {
        const kind = seg.isWfh ? 'WFH' : 'Leave';
        const startStr = typeof seg.startDate === 'string' ? seg.startDate : DateUtil.format(seg.startDate);
        const endStr = typeof seg.endDate === 'string' ? seg.endDate : DateUtil.format(seg.endDate);
        const portionStr = seg.portion === Portion.full ? 'Full Day' : seg.portion === Portion.first_half ? 'First Half' : 'Second Half';
        managerLines.push(`- ${kind} (${startStr} to ${endStr}, ${portionStr})`);
      }

      await tx.notification.create({
        data: {
          orgId,
          userId: requester.managerId,
          type: NotificationType.leave_cancelled,
          title: managerTitle,
          body: managerLines.join('\n'),
          requestId,
        },
      });
    }
  }
}
