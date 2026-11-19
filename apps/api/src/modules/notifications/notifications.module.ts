import { Global, Injectable, Module, Controller, Get, Patch, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationPriority, NotificationType } from '@shopcontrol/shared';
import { ControlPrismaService } from '../../common/database/control-prisma.service';
import { AllowSuspendedWrite, CurrentUser } from '../../common/auth/auth.decorators';
import { AuthenticatedUser } from '../../common/auth/request-context.types';

export interface CreateNotificationInput {
  merchantId?: string | null;
  shopId?: string | null;
  recipientUserId: string;
  type: NotificationType;
  priority?: NotificationPriority;
  title: string;
  message: string;
  targetPath?: string | null;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly controlPrisma: ControlPrismaService) {}

  async create(input: CreateNotificationInput): Promise<void> {
    await this.controlPrisma.notification.create({
      data: {
        merchantId: input.merchantId ?? null,
        shopId: input.shopId ?? null,
        recipientUserId: input.recipientUserId,
        type: input.type,
        priority: input.priority ?? 'INFO',
        title: input.title.slice(0, 180),
        message: input.message.slice(0, 1000),
        targetPath: input.targetPath ?? null,
      },
    });
  }

  async notifyMerchantOwners(
    merchantId: string,
    payload: Omit<CreateNotificationInput, 'recipientUserId' | 'merchantId'>,
  ): Promise<void> {
    const owners = await this.controlPrisma.user.findMany({
      where: { merchantId, role: 'OWNER', isActive: true },
      select: { id: true },
    });

    await Promise.all(
      owners.map((owner) =>
        this.create({
          ...payload,
          merchantId,
          recipientUserId: owner.id,
        }),
      ),
    );
  }

  async listForUser(userId: string, page = 1, limit = 20) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(50, Math.max(1, limit));

    const [items, total, unreadCount] = await Promise.all([
      this.controlPrisma.notification.findMany({
        where: { recipientUserId: userId },
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        include: { shop: { select: { name: true } } },
      }),
      this.controlPrisma.notification.count({ where: { recipientUserId: userId } }),
      this.controlPrisma.notification.count({
        where: { recipientUserId: userId, isRead: false },
      }),
    ]);

    return {
      items: items.map((n) => ({
        id: n.id,
        type: n.type,
        priority: n.priority,
        title: n.title,
        message: n.message,
        shopId: n.shopId,
        shopName: n.shop?.name ?? null,
        targetPath: n.targetPath,
        isRead: n.isRead,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
      total,
      unreadCount,
      page: safePage,
      limit: safeLimit,
    };
  }

  async markRead(userId: string, id: string) {
    await this.controlPrisma.notification.updateMany({
      where: { id, recipientUserId: userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { ok: true };
  }

  async markAllRead(userId: string) {
    await this.controlPrisma.notification.updateMany({
      where: { recipientUserId: userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { ok: true };
  }
}

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Lister les notifications de l’utilisateur connecté' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notificationsService.listForUser(
      user.userId,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }

  @Patch(':id/read')
  @AllowSuspendedWrite()
  @ApiOperation({ summary: 'Marquer une notification comme lue' })
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.notificationsService.markRead(user.userId, id);
  }

  @Patch('read-all')
  @AllowSuspendedWrite()
  @ApiOperation({ summary: 'Marquer toutes les notifications comme lues' })
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.markAllRead(user.userId);
  }
}

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
