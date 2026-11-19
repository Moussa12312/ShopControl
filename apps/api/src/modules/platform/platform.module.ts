import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createAnnouncementSchema,
  createSupportTicketSchema,
  PLATFORM_MODULES,
  recordPlatformPaymentSchema,
  replySupportTicketSchema,
  updateSupportTicketStatusSchema,
  upsertSubscriptionSchema,
} from '@shopcontrol/shared';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { AuthenticatedUser, RequestWithAuth } from '../../common/auth/request-context.types';
import { ControlPrismaService } from '../../common/database/control-prisma.service';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.module';
import { RequestMeta } from '../auth/auth.service';

@Injectable()
export class PlatformService {
  constructor(
    private readonly controlPrisma: ControlPrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async getOrInitSubscription(merchantId: string) {
    let sub = await this.controlPrisma.merchantSubscription.findUnique({ where: { merchantId } });
    if (!sub) {
      const nextMonth = new Date(Date.now() + 30 * 86_400_000);
      sub = await this.controlPrisma.merchantSubscription.create({
        data: {
          merchantId,
          planCode: 'PRO',
          monthlyPriceXof: 25000,
          maxShops: 5,
          maxAgentsPerShop: 10,
          enabledModules: [...PLATFORM_MODULES] as object,
          currentPeriodEnd: nextMonth,
          autoSuspendGraceDays: 7,
        },
      });
    }
    return {
      ...sub,
      currentPeriodStart: sub.currentPeriodStart.toISOString(),
      currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
      updatedAt: sub.updatedAt.toISOString(),
    };
  }

  async listSubscriptions() {
    const merchants = await this.controlPrisma.merchant.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        subscription: true,
        _count: { select: { shops: true, platformPayments: true } },
      },
    });
    return Promise.all(
      merchants.map(async (m) => ({
        merchantId: m.id,
        merchantName: m.name,
        status: m.status,
        shopsCount: m._count.shops,
        paymentsCount: m._count.platformPayments,
        subscription: m.subscription
          ? {
              ...m.subscription,
              currentPeriodStart: m.subscription.currentPeriodStart.toISOString(),
              currentPeriodEnd: m.subscription.currentPeriodEnd.toISOString(),
              updatedAt: m.subscription.updatedAt.toISOString(),
            }
          : await this.getOrInitSubscription(m.id),
      })),
    );
  }

  async upsertSubscription(merchantId: string, input: any, actor: AuthenticatedUser, meta: RequestMeta) {
    const periodEnd = input.currentPeriodEnd
      ? new Date(input.currentPeriodEnd)
      : new Date(Date.now() + 30 * 86_400_000);

    const sub = await this.controlPrisma.merchantSubscription.upsert({
      where: { merchantId },
      create: {
        merchantId,
        planCode: input.planCode,
        monthlyPriceXof: input.monthlyPriceXof,
        maxShops: input.maxShops,
        maxAgentsPerShop: input.maxAgentsPerShop,
        enabledModules: input.enabledModules as object,
        currentPeriodEnd: periodEnd,
        autoSuspendGraceDays: input.autoSuspendGraceDays ?? 7,
      },
      update: {
        planCode: input.planCode,
        monthlyPriceXof: input.monthlyPriceXof,
        maxShops: input.maxShops,
        maxAgentsPerShop: input.maxAgentsPerShop,
        enabledModules: input.enabledModules as object,
        currentPeriodEnd: periodEnd,
        autoSuspendGraceDays: input.autoSuspendGraceDays ?? 7,
      },
    });

    await this.auditService.recordControl({
      merchantId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'SUBSCRIPTION_UPDATED',
      entityType: 'MerchantSubscription',
      entityId: sub.id,
      afterData: { planCode: sub.planCode, monthlyPriceXof: sub.monthlyPriceXof, maxShops: sub.maxShops },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return sub;
  }

  async listPlatformPayments(merchantId?: string) {
    const items = await this.controlPrisma.platformPayment.findMany({
      where: merchantId ? { merchantId } : undefined,
      orderBy: { paidAt: 'desc' },
      take: 100,
      include: { merchant: { select: { id: true, name: true } } },
    });
    return items.map((p) => ({
      ...p,
      paidAt: p.paidAt.toISOString(),
      createdAt: p.createdAt.toISOString(),
    }));
  }

  async recordPlatformPayment(input: any, actor: AuthenticatedUser, meta: RequestMeta) {
    const merchant = await this.controlPrisma.merchant.findUnique({ where: { id: input.merchantId } });
    if (!merchant) throw new NotFoundException('Marchand introuvable.');

    const payment = await this.controlPrisma.platformPayment.create({
      data: {
        merchantId: input.merchantId,
        amountXof: input.amountXof,
        paymentMethodCode: input.paymentMethodCode,
        reference: input.reference || null,
        periodLabel: input.periodLabel,
        notes: input.notes || null,
        recordedByUserId: actor.userId,
      },
    });

    if (input.reactivateIfPastDue && merchant.status === 'PAST_DUE') {
      await this.controlPrisma.merchant.update({
        where: { id: merchant.id },
        data: { status: 'ACTIVE', statusReason: 'Paiement d’abonnement enregistré', gracePeriodEndsAt: null },
      });
    }

    await this.auditService.recordControl({
      merchantId: merchant.id,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'PLATFORM_PAYMENT_RECORDED',
      entityType: 'PlatformPayment',
      entityId: payment.id,
      afterData: { amountXof: payment.amountXof, periodLabel: payment.periodLabel },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    await this.notificationsService.notifyMerchantOwners(merchant.id, {
      type: 'PLATFORM',
      priority: 'INFO',
      title: 'Paiement d’abonnement confirmé',
      message: `Paiement de ${payment.amountXof} FCFA enregistré pour la période « ${payment.periodLabel} ».`,
      targetPath: '/owner/settings',
    });

    return payment;
  }

  // --- Support Tickets ---
  async listTickets(user: AuthenticatedUser) {
    const where = user.role === 'SUPER_ADMIN' ? {} : { merchantId: user.merchantId ?? '' };
    const tickets = await this.controlPrisma.supportTicket.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 60,
      include: {
        merchant: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    return tickets.map((t) => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      messages: t.messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
    }));
  }

  async createTicket(input: any, actor: AuthenticatedUser) {
    if (!actor.merchantId) throw new ForbiddenException('Marchand requis.');
    const seqRows = await this.controlPrisma.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('support_ticket_number_seq')`;
    const ticketNumber = `TCK-${String(Number(seqRows[0].nextval)).padStart(5, '0')}`;

    const ticket = await this.controlPrisma.supportTicket.create({
      data: {
        ticketNumber,
        merchantId: actor.merchantId,
        createdByUserId: actor.userId,
        subject: input.subject,
        priority: input.priority || 'INFO',
        status: 'OPEN',
        messages: {
          create: {
            senderUserId: actor.userId,
            senderRole: actor.role,
            senderName: actor.fullName,
            body: input.message,
          },
        },
      },
      include: { messages: true },
    });

    const admins = await this.controlPrisma.user.findMany({
      where: { role: 'SUPER_ADMIN', isActive: true },
      select: { id: true },
    });
    for (const a of admins) {
      await this.notificationsService.create({
        merchantId: actor.merchantId,
        recipientUserId: a.id,
        type: 'PLATFORM',
        priority: input.priority === 'URGENT' ? 'URGENT' : 'WARNING',
        title: `Nouveau ticket ${ticketNumber}`,
        message: `${actor.fullName} : ${input.subject}`,
        targetPath: '/admin/platform',
      });
    }

    return ticket;
  }

  async replyTicket(ticketId: string, body: string, actor: AuthenticatedUser) {
    const ticket = await this.controlPrisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket introuvable.');
    if (actor.role !== 'SUPER_ADMIN' && ticket.merchantId !== actor.merchantId) {
      throw new ForbiddenException('Accès refusé.');
    }

    const msg = await this.controlPrisma.supportTicketMessage.create({
      data: {
        ticketId: ticket.id,
        senderUserId: actor.userId,
        senderRole: actor.role,
        senderName: actor.fullName,
        body,
      },
    });

    await this.controlPrisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        status: actor.role === 'SUPER_ADMIN' && ticket.status === 'OPEN' ? 'IN_PROGRESS' : ticket.status,
      },
    });

    if (actor.role === 'SUPER_ADMIN') {
      await this.notificationsService.notifyMerchantOwners(ticket.merchantId, {
        type: 'PLATFORM',
        priority: 'INFO',
        title: `Réponse support sur ${ticket.ticketNumber}`,
        message: body.slice(0, 140),
        targetPath: '/owner/settings',
      });
    }

    return msg;
  }

  async updateTicketStatus(ticketId: string, status: string) {
    return this.controlPrisma.supportTicket.update({ where: { id: ticketId }, data: { status } });
  }

  // --- Annonces Plateforme ---
  async listAnnouncements(onlyActiveForRole?: string) {
    const now = new Date();
    const where: Record<string, unknown> = {};
    if (onlyActiveForRole) {
      where.isActive = true;
      where.OR = [{ expiresAt: null }, { expiresAt: { gt: now } }];
      where.targetRole = { in: ['ALL', onlyActiveForRole] };
    }
    const items = await this.controlPrisma.platformAnnouncement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return items.map((a) => ({
      ...a,
      expiresAt: a.expiresAt?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  async createAnnouncement(input: any, actor: AuthenticatedUser) {
    return this.controlPrisma.platformAnnouncement.create({
      data: {
        title: input.title,
        body: input.body,
        priority: input.priority || 'INFO',
        targetRole: input.targetRole || 'ALL',
        isActive: true,
        publishedByUserId: actor.userId,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
    });
  }

  async toggleAnnouncement(id: string, isActive: boolean) {
    return this.controlPrisma.platformAnnouncement.update({ where: { id }, data: { isActive } });
  }
}

@ApiTags('Administration Plateforme (Lot 7)')
@ApiBearerAuth()
@Controller()
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Get('admin/subscriptions')
  @Roles('SUPER_ADMIN')
  listSubscriptions() {
    return this.platformService.listSubscriptions();
  }

  @Put('admin/merchants/:merchantId/subscription')
  @Roles('SUPER_ADMIN')
  upsertSubscription(
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(upsertSubscriptionSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.platformService.upsertSubscription(merchantId, body, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Get('merchant/subscription')
  @Roles('OWNER')
  async mySubscription(@CurrentUser() user: AuthenticatedUser) {
    if (!user.merchantId) throw new ForbiddenException('Marchand manquant.');
    const [subscription, payments] = await Promise.all([
      this.platformService.getOrInitSubscription(user.merchantId),
      this.platformService.listPlatformPayments(user.merchantId),
    ]);
    return { subscription, payments };
  }

  @Get('admin/platform-payments')
  @Roles('SUPER_ADMIN')
  listPlatformPayments() {
    return this.platformService.listPlatformPayments();
  }

  @Post('admin/platform-payments')
  @Roles('SUPER_ADMIN')
  recordPlatformPayment(
    @Body(new ZodValidationPipe(recordPlatformPaymentSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.platformService.recordPlatformPayment(body, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Get('support/tickets')
  @Roles('SUPER_ADMIN', 'OWNER')
  listTickets(@CurrentUser() user: AuthenticatedUser) {
    return this.platformService.listTickets(user);
  }

  @Post('support/tickets')
  @Roles('OWNER')
  createTicket(
    @Body(new ZodValidationPipe(createSupportTicketSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.platformService.createTicket(body, user);
  }

  @Post('support/tickets/:ticketId/reply')
  @Roles('SUPER_ADMIN', 'OWNER')
  replyTicket(
    @Param('ticketId') ticketId: string,
    @Body(new ZodValidationPipe(replySupportTicketSchema)) body: { body: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.platformService.replyTicket(ticketId, body.body, user);
  }

  @Patch('support/tickets/:ticketId/status')
  @Roles('SUPER_ADMIN')
  updateTicketStatus(
    @Param('ticketId') ticketId: string,
    @Body(new ZodValidationPipe(updateSupportTicketStatusSchema)) body: { status: string },
  ) {
    return this.platformService.updateTicketStatus(ticketId, body.status);
  }

  @Get('admin/announcements')
  @Roles('SUPER_ADMIN')
  listAllAnnouncements() {
    return this.platformService.listAnnouncements();
  }

  @Post('admin/announcements')
  @Roles('SUPER_ADMIN')
  createAnnouncement(
    @Body(new ZodValidationPipe(createAnnouncementSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.platformService.createAnnouncement(body, user);
  }

  @Patch('admin/announcements/:id')
  @Roles('SUPER_ADMIN')
  toggleAnnouncement(@Param('id') id: string, @Body() body: { isActive: boolean }) {
    return this.platformService.toggleAnnouncement(id, Boolean(body.isActive));
  }

  @Get('announcements/active')
  @Roles('SUPER_ADMIN', 'OWNER', 'AGENT')
  @ApiOperation({ summary: 'Annonces de service actives pour le rôle connecté' })
  activeAnnouncements(@CurrentUser() user: AuthenticatedUser) {
    return this.platformService.listAnnouncements(user.role);
  }
}

@Module({
  controllers: [PlatformController],
  providers: [PlatformService],
  exports: [PlatformService],
})
export class PlatformModule {}
