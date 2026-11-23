import {
  BadRequestException,
  Body,
  ConflictException,
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
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createAnnouncementSchema,
  createSupportTicketSchema,
  PLATFORM_MODULES,
  recordPlatformPaymentSchema,
  replySupportTicketSchema,
  requestSubscriptionRenewalSchema,
  reviewSubscriptionRenewalSchema,
  SubscriptionBillingCycle,
  updatePlatformPlanConfigSchema,
  updateSupportTicketStatusSchema,
  upsertSubscriptionSchema,
} from '@shopcontrol/shared';
import { AllowSuspendedWrite, CurrentUser, Public, Roles } from '../../common/auth/auth.decorators';
import { AuthenticatedUser, RequestWithAuth } from '../../common/auth/request-context.types';
import { ControlPrismaService } from '../../common/database/control-prisma.service';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.module';
import { RequestMeta } from '../auth/auth.service';

const DEFAULT_PLATFORM_PLANS: Array<{
  code: string;
  name: string;
  tagline: string;
  badge: string | null;
  monthlyPriceXof: number;
  yearlyPriceXof: number;
  directSalePriceXof: number;
  allowMonthly: boolean;
  allowYearly: boolean;
  allowDirectSale: boolean;
  trialDays: number;
  maxShops: number;
  maxAgentsPerShop: number;
  features: string[];
  isActive: boolean;
  sortOrder: number;
}> = [
  {
    code: 'STARTER',
    name: 'Starter',
    tagline: 'Idéal pour démarrer avec une boutique organisée.',
    badge: null,
    monthlyPriceXof: 15000,
    yearlyPriceXof: 150000,
    directSalePriceXof: 350000,
    allowMonthly: true,
    allowYearly: true,
    allowDirectSale: true,
    trialDays: 14,
    maxShops: 1,
    maxAgentsPerShop: 3,
    features: [
      '1 boutique avec base de données dédiée',
      'Jusqu’à 3 comptes agents',
      'Caisse POS rapide, Stocks & Dépenses',
      'Vitrine QR publique & suivi commandes',
    ],
    isActive: true,
    sortOrder: 0,
  },
  {
    code: 'PRO',
    name: 'Pro Multi-Boutiques',
    tagline: 'Le choix recommandé pour les commerçants en croissance.',
    badge: 'Recommandé',
    monthlyPriceXof: 25000,
    yearlyPriceXof: 250000,
    directSalePriceXof: 600000,
    allowMonthly: true,
    allowYearly: true,
    allowDirectSale: true,
    trialDays: 14,
    maxShops: 5,
    maxAgentsPerShop: 10,
    features: [
      'Jusqu’à 5 boutiques isolées',
      'Jusqu’à 10 agents / boutique',
      'Transferts inter-boutiques & Bilans consolidés',
      'Achats fournisseurs, créances clients & Messagerie',
    ],
    isActive: true,
    sortOrder: 1,
  },
  {
    code: 'ENTERPRISE',
    name: 'Entreprise',
    tagline: 'Puissance maximale pour réseaux de boutiques et grossistes.',
    badge: null,
    monthlyPriceXof: 50000,
    yearlyPriceXof: 500000,
    directSalePriceXof: 1200000,
    allowMonthly: true,
    allowYearly: true,
    allowDirectSale: true,
    trialDays: 14,
    maxShops: 20,
    maxAgentsPerShop: 50,
    features: [
      'Jusqu’à 20 boutiques',
      'Jusqu’à 50 agents / boutique',
      'Tous les modules inclus sans limite',
      'Support prioritaire & accompagnement dédié',
    ],
    isActive: true,
    sortOrder: 2,
  },
];

@Injectable()
export class PlatformService {
  constructor(
    private readonly controlPrisma: ControlPrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private formatPlan(p: any) {
    return {
      code: p.code,
      name: p.name,
      tagline: p.tagline,
      badge: p.badge ?? null,
      monthlyPriceXof: p.monthlyPriceXof,
      yearlyPriceXof: p.yearlyPriceXof,
      directSalePriceXof: p.directSalePriceXof,
      allowMonthly: Boolean(p.allowMonthly),
      allowYearly: Boolean(p.allowYearly),
      allowDirectSale: Boolean(p.allowDirectSale),
      trialDays: p.trialDays,
      maxShops: p.maxShops,
      maxAgentsPerShop: p.maxAgentsPerShop,
      features: Array.isArray(p.features) ? (p.features as string[]) : [],
      isActive: Boolean(p.isActive),
      sortOrder: p.sortOrder,
      updatedAt: p.updatedAt ? p.updatedAt.toISOString() : new Date().toISOString(),
    };
  }

  async ensureDefaultPlans(): Promise<void> {
    const count = await this.controlPrisma.platformPlanConfig.count();
    if (count > 0) return;
    for (const plan of DEFAULT_PLATFORM_PLANS) {
      await this.controlPrisma.platformPlanConfig.upsert({
        where: { code: plan.code },
        create: {
          code: plan.code,
          name: plan.name,
          tagline: plan.tagline,
          badge: plan.badge,
          monthlyPriceXof: plan.monthlyPriceXof,
          yearlyPriceXof: plan.yearlyPriceXof,
          directSalePriceXof: plan.directSalePriceXof,
          allowMonthly: plan.allowMonthly,
          allowYearly: plan.allowYearly,
          allowDirectSale: plan.allowDirectSale,
          trialDays: plan.trialDays,
          maxShops: plan.maxShops,
          maxAgentsPerShop: plan.maxAgentsPerShop,
          features: plan.features as object,
          isActive: plan.isActive,
          sortOrder: plan.sortOrder,
        },
        update: {},
      });
    }
  }

  async listPublicPlans() {
    await this.ensureDefaultPlans();
    const plans = await this.controlPrisma.platformPlanConfig.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return plans.map((p) => this.formatPlan(p));
  }

  async listAdminPlans() {
    await this.ensureDefaultPlans();
    const plans = await this.controlPrisma.platformPlanConfig.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    return plans.map((p) => this.formatPlan(p));
  }

  async updatePlanConfig(
    code: string,
    input: any,
    actor: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    await this.ensureDefaultPlans();
    const existing = await this.controlPrisma.platformPlanConfig.findUnique({ where: { code } });
    if (!existing) {
      throw new NotFoundException(`Formule « ${code} » introuvable.`);
    }

    const updated = await this.controlPrisma.platformPlanConfig.update({
      where: { code },
      data: {
        name: input.name,
        tagline: input.tagline ?? '',
        badge: input.badge?.trim() || null,
        monthlyPriceXof: input.monthlyPriceXof,
        yearlyPriceXof: input.yearlyPriceXof,
        directSalePriceXof: input.directSalePriceXof,
        allowMonthly: Boolean(input.allowMonthly),
        allowYearly: Boolean(input.allowYearly),
        allowDirectSale: Boolean(input.allowDirectSale),
        trialDays: input.trialDays ?? 14,
        maxShops: input.maxShops,
        maxAgentsPerShop: input.maxAgentsPerShop,
        features: (input.features || []) as object,
        isActive: input.isActive !== undefined ? Boolean(input.isActive) : true,
      },
    });

    await this.auditService.recordControl({
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'PLATFORM_PLAN_UPDATED',
      entityType: 'PlatformPlanConfig',
      entityId: code,
      afterData: {
        monthlyPriceXof: updated.monthlyPriceXof,
        yearlyPriceXof: updated.yearlyPriceXof,
        directSalePriceXof: updated.directSalePriceXof,
        trialDays: updated.trialDays,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return this.formatPlan(updated);
  }

  async getOrInitSubscription(merchantId: string) {
    let sub = await this.controlPrisma.merchantSubscription.findUnique({ where: { merchantId } });
    if (!sub) {
      const nextMonth = new Date(Date.now() + 30 * 86_400_000);
      sub = await this.controlPrisma.merchantSubscription.create({
        data: {
          merchantId,
          planCode: 'PRO',
          billingCycle: 'MONTHLY',
          priceXof: 25000,
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
      trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
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
              trialEndsAt: m.subscription.trialEndsAt?.toISOString() ?? null,
              updatedAt: m.subscription.updatedAt.toISOString(),
            }
          : await this.getOrInitSubscription(m.id),
      })),
    );
  }

  async upsertSubscription(merchantId: string, input: any, actor: AuthenticatedUser, meta: RequestMeta) {
    const billingCycle: SubscriptionBillingCycle = input.billingCycle || 'MONTHLY';
    const priceXof = input.priceXof ?? input.monthlyPriceXof;
    const periodEnd = input.currentPeriodEnd
      ? new Date(input.currentPeriodEnd)
      : billingCycle === 'DIRECT_SALE'
        ? new Date('2099-12-31T23:59:59.000Z')
        : billingCycle === 'YEARLY'
          ? new Date(Date.now() + 365 * 86_400_000)
          : new Date(Date.now() + 30 * 86_400_000);

    const sub = await this.controlPrisma.merchantSubscription.upsert({
      where: { merchantId },
      create: {
        merchantId,
        planCode: input.planCode,
        billingCycle,
        priceXof,
        monthlyPriceXof: input.monthlyPriceXof,
        maxShops: input.maxShops,
        maxAgentsPerShop: input.maxAgentsPerShop,
        enabledModules: input.enabledModules as object,
        currentPeriodEnd: periodEnd,
        autoSuspendGraceDays: input.autoSuspendGraceDays ?? 7,
      },
      update: {
        planCode: input.planCode,
        billingCycle,
        priceXof,
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
      afterData: {
        planCode: sub.planCode,
        billingCycle: sub.billingCycle,
        priceXof: sub.priceXof,
        monthlyPriceXof: sub.monthlyPriceXof,
        maxShops: sub.maxShops,
      },
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

  // --- Renouvellement / activation d'abonnement (essai terminé, impayé, suspendu) ---

  private cyclePrice(plan: { monthlyPriceXof: number; yearlyPriceXof: number; directSalePriceXof: number }, cycle: string) {
    return cycle === 'YEARLY'
      ? plan.yearlyPriceXof
      : cycle === 'DIRECT_SALE'
        ? plan.directSalePriceXof
        : plan.monthlyPriceXof;
  }

  async getRenewalOverview(merchantId: string) {
    const [merchant, requests] = await Promise.all([
      this.controlPrisma.merchant.findUnique({
        where: { id: merchantId },
        select: { status: true, statusReason: true, gracePeriodEndsAt: true },
      }),
      this.controlPrisma.subscriptionRenewalRequest.findMany({
        where: { merchantId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    return {
      merchantStatus: merchant?.status ?? 'ACTIVE',
      statusReason: merchant?.statusReason ?? null,
      gracePeriodEndsAt: merchant?.gracePeriodEndsAt?.toISOString() ?? null,
      renewalRequests: requests.map((r) => ({
        ...r,
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async requestRenewal(input: any, actor: AuthenticatedUser, meta: RequestMeta) {
    if (!actor.merchantId) throw new ForbiddenException('Marchand manquant.');
    const sub = await this.getOrInitSubscription(actor.merchantId);
    await this.ensureDefaultPlans();

    const planCode: string = input.planCode || sub.planCode;
    const plan = await this.controlPrisma.platformPlanConfig.findUnique({ where: { code: planCode } });
    if (!plan || !plan.isActive) throw new BadRequestException('Formule indisponible.');

    const cycle: string = input.billingCycle;
    const allowed =
      cycle === 'YEARLY' ? plan.allowYearly : cycle === 'DIRECT_SALE' ? plan.allowDirectSale : plan.allowMonthly;
    if (!allowed) throw new BadRequestException('Ce mode de facturation n’est pas proposé pour cette formule.');

    const pending = await this.controlPrisma.subscriptionRenewalRequest.findFirst({
      where: { merchantId: actor.merchantId, status: 'PENDING' },
    });
    if (pending) {
      throw new ConflictException({
        code: 'RENEWAL_ALREADY_PENDING',
        message: 'Une demande est déjà en cours de vérification par l’équipe ShopControl.',
      });
    }

    // Le montant est TOUJOURS recalculé côté serveur à partir de la grille tarifaire.
    const amountXof = this.cyclePrice(plan, cycle);
    let created;
    try {
      created = await this.controlPrisma.subscriptionRenewalRequest.create({
        data: {
          merchantId: actor.merchantId,
          planCode,
          billingCycle: cycle,
          amountXof,
          paymentMethodCode: input.paymentMethodCode,
          reference: input.reference,
          requestedByUserId: actor.userId,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException({
          code: 'DUPLICATE_PAYMENT_REFERENCE',
          message: 'Cette référence de transfert a déjà été utilisée.',
        });
      }
      throw e;
    }

    await this.auditService.recordControl({
      merchantId: actor.merchantId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'SUBSCRIPTION_RENEWAL_REQUESTED',
      entityType: 'SubscriptionRenewalRequest',
      entityId: created.id,
      afterData: { planCode, billingCycle: cycle, amountXof, paymentMethodCode: input.paymentMethodCode },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
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
        priority: 'WARNING',
        title: 'Demande d’activation d’abonnement',
        message: `${actor.fullName} — ${amountXof} FCFA (${input.paymentMethodCode}), réf. ${input.reference}. À vérifier.`,
        targetPath: '/admin/platform',
      });
    }
    return { ...created, createdAt: created.createdAt.toISOString() };
  }

  async listRenewalRequests(status?: string) {
    const items = await this.controlPrisma.subscriptionRenewalRequest.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { merchant: { select: { id: true, name: true, email: true, phone: true } } },
    });
    return items.map((r) => ({
      ...r,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async approveRenewal(id: string, note: string | undefined, actor: AuthenticatedUser, meta: RequestMeta) {
    const req = await this.controlPrisma.subscriptionRenewalRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Demande introuvable.');
    if (req.status !== 'PENDING') throw new ConflictException('Cette demande a déjà été traitée.');

    const sub = await this.getOrInitSubscription(req.merchantId);
    const plan = await this.controlPrisma.platformPlanConfig.findUnique({ where: { code: req.planCode } });
    const now = new Date();
    // Si l'essai ou l'abonnement en cours n'est pas encore expiré (currentEnd > now),
    // la nouvelle période s'ajoute à la suite de la date limite (currentEnd) pour ne perdre aucun jour d'essai gratuit.
    // Si la période est déjà échue (currentEnd <= now), le calcul repart d'aujourd'hui (now).
    const currentEnd = new Date(sub.currentPeriodEnd);
    const base = currentEnd > now ? currentEnd : now;
    const newEnd =
      req.billingCycle === 'DIRECT_SALE'
        ? new Date('2099-12-31T23:59:59.000Z')
        : new Date(base.getTime() + (req.billingCycle === 'YEARLY' ? 365 : 30) * 86_400_000);

    await this.controlPrisma.$transaction([
      this.controlPrisma.subscriptionRenewalRequest.update({
        where: { id },
        data: { status: 'APPROVED', reviewedByUserId: actor.userId, reviewedAt: now, reviewNote: note ?? null },
      }),
      this.controlPrisma.platformPayment.create({
        data: {
          merchantId: req.merchantId,
          amountXof: req.amountXof,
          paymentMethodCode: req.paymentMethodCode,
          reference: req.reference,
          periodLabel: `Abonnement ${req.planCode} (${req.billingCycle}) jusqu’au ${newEnd.toLocaleDateString('fr-FR')}`,
          notes: 'Demande de renouvellement approuvée',
          recordedByUserId: actor.userId,
        },
      }),
      this.controlPrisma.merchantSubscription.update({
        where: { merchantId: req.merchantId },
        data: {
          planCode: req.planCode,
          billingCycle: req.billingCycle,
          priceXof: req.amountXof,
          ...(plan
            ? { monthlyPriceXof: plan.monthlyPriceXof, maxShops: plan.maxShops, maxAgentsPerShop: plan.maxAgentsPerShop }
            : {}),
          currentPeriodStart: now,
          currentPeriodEnd: newEnd,
          trialEndsAt: null,
        },
      }),
      this.controlPrisma.merchant.update({
        where: { id: req.merchantId },
        data: { status: 'ACTIVE', statusReason: null, gracePeriodEndsAt: null },
      }),
    ]);

    await this.auditService.recordControl({
      merchantId: req.merchantId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'SUBSCRIPTION_RENEWAL_APPROVED',
      entityType: 'SubscriptionRenewalRequest',
      entityId: id,
      afterData: { amountXof: req.amountXof, newPeriodEnd: newEnd.toISOString() },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });
    await this.notificationsService.notifyMerchantOwners(req.merchantId, {
      type: 'PLATFORM',
      priority: 'INFO',
      title: 'Abonnement activé',
      message: `Votre paiement est confirmé. Abonnement actif jusqu’au ${newEnd.toLocaleDateString('fr-FR')}.`,
      targetPath: '/owner/subscription',
    });
    return { ok: true, currentPeriodEnd: newEnd.toISOString() };
  }

  async rejectRenewal(id: string, note: string | undefined, actor: AuthenticatedUser, meta: RequestMeta) {
    const req = await this.controlPrisma.subscriptionRenewalRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Demande introuvable.');
    if (req.status !== 'PENDING') throw new ConflictException('Cette demande a déjà été traitée.');

    await this.controlPrisma.subscriptionRenewalRequest.update({
      where: { id },
      data: { status: 'REJECTED', reviewedByUserId: actor.userId, reviewedAt: new Date(), reviewNote: note ?? null },
    });
    await this.auditService.recordControl({
      merchantId: req.merchantId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'SUBSCRIPTION_RENEWAL_REJECTED',
      entityType: 'SubscriptionRenewalRequest',
      entityId: id,
      afterData: { note: note ?? null },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });
    await this.notificationsService.notifyMerchantOwners(req.merchantId, {
      type: 'PLATFORM',
      priority: 'WARNING',
      title: 'Paiement d’abonnement non validé',
      message: `La référence ${req.reference} n’a pas pu être vérifiée${note ? ` : ${note}` : '.'} Soumettez une nouvelle demande.`,
      targetPath: '/owner/subscription',
    });
    return { ok: true };
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

  @Public()
  @Get('public/plans')
  @ApiOperation({ summary: 'Grille tarifaire publique configurable (Mois, Année, Vente directe)' })
  listPublicPlans() {
    return this.platformService.listPublicPlans();
  }

  @Get('admin/plans')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Lister les formules et tarifs configurés par le Super Admin' })
  listAdminPlans() {
    return this.platformService.listAdminPlans();
  }

  @Put('admin/plans/:code')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Configurer le tarif (Par mois, Par année, Vente directe) d’une offre' })
  updatePlanConfig(
    @Param('code') code: string,
    @Body(new ZodValidationPipe(updatePlatformPlanConfigSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.platformService.updatePlanConfig(code, body, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

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
    const [subscription, payments, overview] = await Promise.all([
      this.platformService.getOrInitSubscription(user.merchantId),
      this.platformService.listPlatformPayments(user.merchantId),
      this.platformService.getRenewalOverview(user.merchantId),
    ]);
    return { subscription, payments, ...overview };
  }

  // Autorisé même compte suspendu : c'est le seul moyen pour le propriétaire de se réactiver.
  @Post('merchant/subscription/renew')
  @Roles('OWNER')
  @AllowSuspendedWrite()
  @ApiOperation({ summary: 'Demander l’activation / le renouvellement (référence de transfert obligatoire)' })
  requestRenewal(
    @Body(new ZodValidationPipe(requestSubscriptionRenewalSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.platformService.requestRenewal(body, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Get('admin/renewal-requests')
  @Roles('SUPER_ADMIN')
  listRenewalRequests(@Query('status') status?: string) {
    return this.platformService.listRenewalRequests(status);
  }

  @Post('admin/renewal-requests/:id/approve')
  @Roles('SUPER_ADMIN')
  approveRenewal(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviewSubscriptionRenewalSchema)) body: { note?: string },
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.platformService.approveRenewal(id, body.note, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Post('admin/renewal-requests/:id/reject')
  @Roles('SUPER_ADMIN')
  rejectRenewal(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviewSubscriptionRenewalSchema)) body: { note?: string },
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.platformService.rejectRenewal(id, body.note, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
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
