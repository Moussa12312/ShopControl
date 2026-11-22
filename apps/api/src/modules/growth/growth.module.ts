import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Global,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import * as QRCode from 'qrcode';
import { z } from 'zod';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { AuthenticatedUser } from '../../common/auth/request-context.types';
import { getEnv } from '../../common/config/env.config';
import { ControlPrismaService } from '../../common/database/control-prisma.service';
import { ShopDatabaseManagerService } from '../../common/database/shop-database-manager.service';
import { ShopScopeGuard } from '../../common/guards/shop-scope.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';

/* ------------------------------------------------------------------ Schémas */

const growthConfigSchema = z.object({
  smsEnabled: z.boolean().optional(),
  waveLink: z.string().url().max(300).or(z.literal('')).optional(),
  wavePhone: z.string().regex(/^[0-9+ ]{6,20}$/).or(z.literal('')).optional(),
  orangeMoneyCode: z.string().regex(/^[0-9A-Za-z #*+]{3,30}$/).or(z.literal('')).optional(),
});
type GrowthConfig = z.infer<typeof growthConfigSchema>;

const loyaltyRuleSchema = z.object({
  isEnabled: z.boolean(),
  pointsPer100Xof: z.number().int().min(1).max(100),
  minSaleXof: z.number().int().min(0).max(10_000_000),
});

const rewardSchema = z.object({
  name: z.string().trim().min(2).max(120),
  pointsCost: z.number().int().min(1).max(1_000_000),
  discountType: z.enum(['PERCENT', 'FIXED']),
  discountValue: z.number().positive().max(1_000_000),
  maxDiscountXof: z.number().int().min(0).nullable().optional(),
});

const commissionRuleSchema = z.object({
  agentUserId: z.string().uuid().nullable().optional(),
  percentBps: z.number().int().min(0).max(5000),
  minSaleXof: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

const redeemSchema = z.object({ rewardId: z.string().uuid() });
const markPaidSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  agentUserId: z.string().uuid(),
});

const monthRange = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
};

export interface SaleHookInput {
  id: string;
  saleNumber: string;
  totalXof: number;
  clientId: string | null;
  actorUserId: string | null;
  actorRole: string;
}

/* ------------------------------------------------------------------ Service */

@Injectable()
export class GrowthService {
  private readonly logger = new Logger(GrowthService.name);

  constructor(
    private readonly controlPrisma: ControlPrismaService,
    private readonly shopDbManager: ShopDatabaseManagerService,
  ) {}

  // ----- Configuration (stockée dans ShopLocalConfig.businessProfile.growth)

  async getConfig(shopId: string): Promise<GrowthConfig> {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const cfg = await client.shopLocalConfig.findFirst({ select: { businessProfile: true } });
    const profile = (cfg?.businessProfile ?? {}) as Record<string, unknown>;
    return (profile.growth ?? {}) as GrowthConfig;
  }

  async setConfig(shopId: string, input: GrowthConfig): Promise<GrowthConfig> {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const cfg = await client.shopLocalConfig.findFirst();
    if (!cfg) throw new NotFoundException('Configuration boutique introuvable.');
    const profile = (cfg.businessProfile ?? {}) as Record<string, unknown>;
    const next = { ...((profile.growth ?? {}) as GrowthConfig), ...input };
    await client.shopLocalConfig.update({
      where: { id: cfg.id },
      data: { businessProfile: { ...profile, growth: next } as object },
    });
    return next;
  }

  // ----- Hook post-vente (jamais bloquant pour la vente)

  async onSaleCreated(shopId: string, sale: SaleHookInput): Promise<void> {
    await this.safely('commission', () => this.recordCommission(shopId, sale));
    await this.safely('fidélité', () => this.awardLoyalty(shopId, sale));
    await this.safely('sms', () => this.sendSaleSms(shopId, sale));
  }

  private async safely(label: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.warn(`Hook post-vente (${label}) en échec : ${(err as Error).message}`);
    }
  }

  // ----- SMS / WhatsApp

  async sendMessage(to: string, message: string, kind: string): Promise<boolean> {
    const env = getEnv();
    if (!env.REMINDER_WEBHOOK_URL) return false;
    const res = await fetch(env.REMINDER_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.REMINDER_WEBHOOK_TOKEN ? { Authorization: `Bearer ${env.REMINDER_WEBHOOK_TOKEN}` } : {}),
      },
      body: JSON.stringify({ to, message, kind }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  }

  private async sendSaleSms(shopId: string, sale: SaleHookInput): Promise<void> {
    if (!sale.clientId) return;
    const cfg = await this.getConfig(shopId);
    if (!cfg.smsEnabled) return;
    const client = await this.shopDbManager.getClientForShop(shopId);
    const [buyer, local] = await Promise.all([
      client.client.findUnique({ where: { id: sale.clientId }, select: { fullName: true, phone: true } }),
      client.shopLocalConfig.findFirst({ select: { shopName: true } }),
    ]);
    if (!buyer?.phone) return;
    const total = `${sale.totalXof.toLocaleString('fr-FR')} FCFA`;
    await this.sendMessage(
      buyer.phone,
      `Merci ${buyer.fullName}. Achat de ${total} chez ${local?.shopName ?? 'notre boutique'} (réf. ${sale.saleNumber}).`,
      'SALE_CONFIRMATION',
    );
  }

  // ----- Fidélité

  async getLoyaltyOverview(shopId: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const [rule, tiers, rewards] = await Promise.all([
      client.loyaltyRule.findFirst(),
      client.loyaltyTier.findMany({ orderBy: { minLifetimePoints: 'asc' } }),
      client.loyaltyReward.findMany({ where: { isActive: true }, orderBy: { pointsCost: 'asc' } }),
    ]);
    return {
      rule: rule ?? { isEnabled: false, pointsPer100Xof: 1, minSaleXof: 500 },
      tiers: tiers.map((t) => ({ ...t, discountPercent: Number(t.discountPercent) })),
      rewards: rewards.map((r) => ({ ...r, discountValue: Number(r.discountValue) })),
    };
  }

  async saveLoyaltyRule(shopId: string, input: z.infer<typeof loyaltyRuleSchema>) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const existing = await client.loyaltyRule.findFirst();
    if (existing) await client.loyaltyRule.update({ where: { id: existing.id }, data: input });
    else await client.loyaltyRule.create({ data: input });
    return this.getLoyaltyOverview(shopId);
  }

  async addReward(shopId: string, input: z.infer<typeof rewardSchema>) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    await client.loyaltyReward.create({
      data: { ...input, maxDiscountXof: input.maxDiscountXof ?? null },
    });
    return this.getLoyaltyOverview(shopId);
  }

  async getClientLoyalty(shopId: string, clientId: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const account = await client.loyaltyAccount.findUnique({
      where: { clientId },
      include: { tier: true, transactions: { orderBy: { createdAt: 'desc' }, take: 30 } },
    });
    return {
      currentPoints: account?.currentPoints ?? 0,
      lifetimePoints: account?.lifetimePoints ?? 0,
      tier: account?.tier
        ? { name: account.tier.name, discountPercent: Number(account.tier.discountPercent), badgeColor: account.tier.badgeColor }
        : null,
      transactions: account?.transactions ?? [],
    };
  }

  async redeemReward(shopId: string, clientId: string, rewardId: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    return client.$transaction(async (tx) => {
      const [account, reward] = await Promise.all([
        tx.loyaltyAccount.findUnique({ where: { clientId } }),
        tx.loyaltyReward.findFirst({ where: { id: rewardId, isActive: true } }),
      ]);
      if (!reward) throw new NotFoundException('Récompense introuvable.');
      if (!account || account.currentPoints < reward.pointsCost) {
        throw new BadRequestException('Points insuffisants pour cette récompense.');
      }
      await tx.loyaltyAccount.update({
        where: { id: account.id },
        data: { currentPoints: { decrement: reward.pointsCost } },
      });
      await tx.loyaltyTransaction.create({
        data: { accountId: account.id, type: 'REDEEM', points: -reward.pointsCost, note: reward.name.slice(0, 200) },
      });
      return {
        rewardName: reward.name,
        discountType: reward.discountType,
        discountValue: Number(reward.discountValue),
        maxDiscountXof: reward.maxDiscountXof,
        remainingPoints: account.currentPoints - reward.pointsCost,
      };
    });
  }

  private async awardLoyalty(shopId: string, sale: SaleHookInput): Promise<void> {
    if (!sale.clientId) return;
    const client = await this.shopDbManager.getClientForShop(shopId);
    const rule = await client.loyaltyRule.findFirst();
    if (!rule?.isEnabled || sale.totalXof < rule.minSaleXof) return;
    const points = Math.floor(sale.totalXof / 100) * rule.pointsPer100Xof;
    if (points <= 0) return;

    await client.$transaction(async (tx) => {
      const account = await tx.loyaltyAccount.upsert({
        where: { clientId: sale.clientId! },
        create: { clientId: sale.clientId!, currentPoints: points, lifetimePoints: points },
        update: { currentPoints: { increment: points }, lifetimePoints: { increment: points } },
      });
      await tx.loyaltyTransaction.create({
        data: { accountId: account.id, saleId: sale.id, type: 'EARN', points, note: `Vente ${sale.saleNumber}` },
      });
      const tier = await tx.loyaltyTier.findFirst({
        where: { minLifetimePoints: { lte: account.lifetimePoints } },
        orderBy: { minLifetimePoints: 'desc' },
      });
      if (tier && tier.id !== account.tierId) {
        await tx.loyaltyAccount.update({ where: { id: account.id }, data: { tierId: tier.id } });
      }
    });
  }

  // ----- Commissions

  async listCommissionRules(shopId: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    return client.commissionRule.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async saveCommissionRule(shopId: string, input: z.infer<typeof commissionRuleSchema>) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const agentUserId = input.agentUserId ?? null;
    const existing = await client.commissionRule.findFirst({ where: { agentUserId } });
    const data = { agentUserId, percentBps: input.percentBps, minSaleXof: input.minSaleXof, isActive: input.isActive };
    if (existing) await client.commissionRule.update({ where: { id: existing.id }, data });
    else await client.commissionRule.create({ data });
    return this.listCommissionRules(shopId);
  }

  private async recordCommission(shopId: string, sale: SaleHookInput): Promise<void> {
    if (sale.actorRole !== 'AGENT' || !sale.actorUserId) return;
    const client = await this.shopDbManager.getClientForShop(shopId);
    const rules = await client.commissionRule.findMany({
      where: { isActive: true, OR: [{ agentUserId: sale.actorUserId }, { agentUserId: null }] },
    });
    // La règle propre à l'agent prime sur la règle globale.
    const rule = rules.find((r) => r.agentUserId === sale.actorUserId) ?? rules.find((r) => r.agentUserId === null);
    if (!rule || sale.totalXof < rule.minSaleXof) return;
    const earned = Math.floor((sale.totalXof * rule.percentBps) / 10_000);
    if (earned <= 0) return;
    const now = new Date();
    await client.commissionLedger.create({
      data: {
        saleId: sale.id,
        agentUserId: sale.actorUserId,
        saleTotalXof: sale.totalXof,
        percentBps: rule.percentBps,
        earnedXof: earned,
        payPeriod: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`,
      },
    });
  }

  async commissionReport(shopId: string, month: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const rows = await client.commissionLedger.groupBy({
      by: ['agentUserId'],
      where: { payPeriod: month },
      _sum: { earnedXof: true, saleTotalXof: true },
      _count: { _all: true },
    });
    const unpaid = await client.commissionLedger.groupBy({
      by: ['agentUserId'],
      where: { payPeriod: month, paidAt: null },
      _sum: { earnedXof: true },
    });
    const unpaidMap = new Map(unpaid.map((u) => [u.agentUserId, u._sum.earnedXof ?? 0]));
    const users = await this.controlPrisma.user.findMany({
      where: { id: { in: rows.map((r) => r.agentUserId) } },
      select: { id: true, fullName: true },
    });
    const names = new Map(users.map((u) => [u.id, u.fullName]));
    const agents = rows.map((r) => ({
      agentUserId: r.agentUserId,
      agentName: names.get(r.agentUserId) ?? 'Agent',
      salesCount: r._count._all,
      salesTotalXof: r._sum.saleTotalXof ?? 0,
      earnedXof: r._sum.earnedXof ?? 0,
      unpaidXof: unpaidMap.get(r.agentUserId) ?? 0,
    }));
    return {
      month,
      agents,
      totalEarnedXof: agents.reduce((s, a) => s + a.earnedXof, 0),
      totalUnpaidXof: agents.reduce((s, a) => s + a.unpaidXof, 0),
    };
  }

  async markPaid(shopId: string, month: string, agentUserId: string, actorId: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const res = await client.commissionLedger.updateMany({
      where: { payPeriod: month, agentUserId, paidAt: null },
      data: { paidAt: new Date(), paidByUserId: actorId },
    });
    return { updated: res.count };
  }

  // ----- Mobile Money (QR)

  async mobileMoneyQr(shopId: string, method: string, amountXof: number) {
    const cfg = await this.getConfig(shopId);
    let payload: string;
    let label: string;
    if (method === 'WAVE') {
      if (cfg.waveLink) {
        const url = new URL(cfg.waveLink);
        url.searchParams.set('amount', String(amountXof));
        payload = url.toString();
      } else if (cfg.wavePhone) {
        payload = `Wave ${cfg.wavePhone} - ${amountXof} FCFA`;
      } else {
        throw new BadRequestException('Wave non configuré (lien ou numéro marchand manquant).');
      }
      label = cfg.wavePhone || 'Wave';
    } else if (method === 'ORANGE_MONEY') {
      if (!cfg.orangeMoneyCode) throw new BadRequestException('Orange Money non configuré (code marchand manquant).');
      payload = `Orange Money marchand ${cfg.orangeMoneyCode} - ${amountXof} FCFA`;
      label = cfg.orangeMoneyCode;
    } else {
      throw new BadRequestException('Moyen de paiement non supporté.');
    }
    const qrDataUrl = await QRCode.toDataURL(payload, { margin: 1, width: 320 });
    return { method, amountXof, label, payload, qrDataUrl };
  }

  // ----- Export comptable OHADA

  async ohadaJournal(shopId: string, from: string, to: string): Promise<string> {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const sales = await client.sale.findMany({
      where: {
        status: 'COMPLETED',
        createdAt: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T23:59:59.999Z`) },
      },
      orderBy: { createdAt: 'asc' },
      select: { saleNumber: true, createdAt: true, totalXof: true, taxTotalXof: true, client: { select: { fullName: true } } },
    });
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const header = 'Date;N° pièce;Libellé;Compte débit;Débit (411/571);Compte crédit;Crédit (707);Compte TVA;TVA collectée (4431);Montant HT;Montant TTC';
    const lines = sales.map((s) => {
      const ttc = s.totalXof;
      const tva = s.taxTotalXof;
      const ht = ttc - tva;
      return [
        s.createdAt.toISOString().slice(0, 10),
        s.saleNumber,
        esc(`Vente ${s.client?.fullName ?? 'comptoir'}`),
        '411',
        ttc,
        '707',
        ht,
        '4431',
        tva,
        ht,
        ttc,
      ].join(';');
    });
    return `\uFEFF${[header, ...lines].join('\n')}\n`;
  }

  async tvaSummary(shopId: string, month: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const { start, end } = monthRange(month);
    const agg = await client.sale.aggregate({
      where: { status: 'COMPLETED', createdAt: { gte: start, lt: end } },
      _sum: { totalXof: true, taxTotalXof: true },
      _count: { _all: true },
    });
    const collected = agg._sum.taxTotalXof ?? 0;
    const ttc = agg._sum.totalXof ?? 0;
    return {
      month,
      salesCount: agg._count._all,
      turnoverHtXof: ttc - collected,
      turnoverTtcXof: ttc,
      tvaCollecteeXof: collected,
      tvaDeductibleXof: 0,
      soldeADeclarerXof: collected,
    };
  }
}

/* --------------------------------------------------------------- Controller */

@ApiTags('Croissance (fidélité, commissions, Mobile Money, OHADA)')
@ApiBearerAuth()
@Controller('shops/:shopId')
@UseGuards(ShopScopeGuard)
export class GrowthController {
  constructor(private readonly growth: GrowthService) {}

  @Get('growth/config')
  @Roles('OWNER', 'AGENT')
  @ApiOperation({ summary: 'Configuration SMS / Wave / Orange Money de la boutique' })
  getConfig(@Param('shopId') shopId: string) {
    return this.growth.getConfig(shopId);
  }

  @Put('growth/config')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Mettre à jour la configuration SMS / Mobile Money' })
  setConfig(@Param('shopId') shopId: string, @Body(new ZodValidationPipe(growthConfigSchema)) body: GrowthConfig) {
    return this.growth.setConfig(shopId, body);
  }

  @Get('loyalty')
  @Roles('OWNER', 'AGENT')
  @ApiOperation({ summary: 'Règles, paliers et récompenses fidélité' })
  loyalty(@Param('shopId') shopId: string) {
    return this.growth.getLoyaltyOverview(shopId);
  }

  @Put('loyalty/rule')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Configurer le programme de fidélité' })
  saveRule(@Param('shopId') shopId: string, @Body(new ZodValidationPipe(loyaltyRuleSchema)) body: z.infer<typeof loyaltyRuleSchema>) {
    return this.growth.saveLoyaltyRule(shopId, body);
  }

  @Post('loyalty/rewards')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Ajouter une récompense fidélité' })
  addReward(@Param('shopId') shopId: string, @Body(new ZodValidationPipe(rewardSchema)) body: z.infer<typeof rewardSchema>) {
    return this.growth.addReward(shopId, body);
  }

  @Get('loyalty/clients/:clientId')
  @Roles('OWNER', 'AGENT')
  @ApiOperation({ summary: 'Solde et historique fidélité d’un client' })
  clientLoyalty(@Param('shopId') shopId: string, @Param('clientId') clientId: string) {
    return this.growth.getClientLoyalty(shopId, clientId);
  }

  @Post('loyalty/clients/:clientId/redeem')
  @Roles('OWNER', 'AGENT')
  @ApiOperation({ summary: 'Échanger des points contre une récompense' })
  redeem(
    @Param('shopId') shopId: string,
    @Param('clientId') clientId: string,
    @Body(new ZodValidationPipe(redeemSchema)) body: z.infer<typeof redeemSchema>,
  ) {
    return this.growth.redeemReward(shopId, clientId, body.rewardId);
  }

  @Get('commissions/rules')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Règles de commission des agents' })
  commissionRules(@Param('shopId') shopId: string) {
    return this.growth.listCommissionRules(shopId);
  }

  @Put('commissions/rules')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Définir une règle de commission (globale ou par agent)' })
  saveCommissionRule(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(commissionRuleSchema)) body: z.infer<typeof commissionRuleSchema>,
  ) {
    return this.growth.saveCommissionRule(shopId, body);
  }

  @Get('commissions/report')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Rapport mensuel des commissions par agent' })
  report(@Param('shopId') shopId: string, @Query('month') month?: string) {
    const m = month && /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
    return this.growth.commissionReport(shopId, m);
  }

  @Post('commissions/mark-paid')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Marquer les commissions d’un agent comme payées pour un mois' })
  markPaid(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(markPaidSchema)) body: z.infer<typeof markPaidSchema>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.growth.markPaid(shopId, body.month, body.agentUserId, user.userId);
  }

  @Get('payments/mobile-money/qr')
  @Roles('OWNER', 'AGENT')
  @ApiOperation({ summary: 'QR de paiement Wave / Orange Money pour un montant' })
  qr(@Param('shopId') shopId: string, @Query('method') method: string, @Query('amount') amount: string) {
    const n = Number(amount);
    if (!Number.isInteger(n) || n <= 0) throw new BadRequestException('Montant invalide.');
    return this.growth.mobileMoneyQr(shopId, method, n);
  }

  @Get('reports/ohada/journal-ventes')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Livre-journal des ventes (CSV, format OHADA)' })
  async journal(
    @Param('shopId') shopId: string,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (!from || !to || !iso.test(from) || !iso.test(to)) throw new BadRequestException('Période invalide (AAAA-MM-JJ).');
    const csv = await this.growth.ohadaJournal(shopId, from, to);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="journal-ventes-${from}_${to}.csv"`);
    res.send(csv);
  }

  @Get('reports/ohada/tva-summary')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Récapitulatif mensuel de TVA' })
  tva(@Param('shopId') shopId: string, @Query('month') month?: string) {
    const m = month && /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
    return this.growth.tvaSummary(shopId, m);
  }
}

@Global()
@Module({
  controllers: [GrowthController],
  providers: [GrowthService],
  exports: [GrowthService],
})
export class GrowthModule {}
