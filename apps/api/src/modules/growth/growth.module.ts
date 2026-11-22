import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { computeCommissionXof, computeLoyaltyPoints, pickCommissionRule } from './growth.calc';

/* ------------------------------------------------------------------ Schémas */

const ownerGrowthConfigSchema = z.object({
  smsEnabled: z.boolean().optional(),
  waveLink: z.string().url().max(300).or(z.literal('')).optional(),
  wavePhone: z.string().regex(/^[0-9+ ]{6,20}$/).or(z.literal('')).optional(),
  orangeMoneyCode: z.string().regex(/^[0-9A-Za-z #*+]{3,30}$/).or(z.literal('')).optional(),
});

const adminSmsGatewaySchema = z.object({
  smsEnabled: z.boolean().optional(),
  smsProvider: z.enum(['WEBHOOK', 'ORANGE_MALI', 'TWILIO', 'TEXTBEE']).optional(),
  smsSenderId: z.string().trim().max(30).optional(),
  smsApiKey: z.string().trim().max(300).optional(),
  smsApiSecret: z.string().trim().max(300).optional(),
  smsWebhookUrl: z.string().url().max(400).or(z.literal('')).optional(),
});

type GrowthConfig = z.infer<typeof ownerGrowthConfigSchema> & z.infer<typeof adminSmsGatewaySchema>;

const testSmsSchema = z.object({
  phone: z.string().trim().min(6).max(25),
  message: z.string().trim().max(320).optional(),
});

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
const promotionSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    discountPercent: z.number().gt(0).max(100),
    appliesToAll: z.boolean(),
    productIds: z.array(z.string().uuid()).max(500).default([]),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), { message: 'La fin doit être après le début.', path: ['endsAt'] })
  .refine((v) => v.appliesToAll || v.productIds.length > 0, { message: 'Choisissez au moins un produit.', path: ['productIds'] });
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

  async getOwnerSafeConfig(shopId: string) {
    const cfg = await this.getConfig(shopId);
    const env = getEnv();
    const providerConfigured = Boolean(
      (cfg.smsProvider === 'ORANGE_MALI' && cfg.smsApiKey && cfg.smsApiSecret) ||
        (cfg.smsProvider === 'TWILIO' && cfg.smsApiKey && cfg.smsApiSecret && cfg.smsSenderId) ||
        (cfg.smsProvider === 'TEXTBEE' && cfg.smsApiKey && cfg.smsSenderId) ||
        ((!cfg.smsProvider || cfg.smsProvider === 'WEBHOOK') && (cfg.smsWebhookUrl || env.REMINDER_WEBHOOK_URL)),
    );
    return {
      smsEnabled: Boolean(cfg.smsEnabled),
      smsProvider: cfg.smsProvider || null,
      smsGatewayReady: providerConfigured,
      waveLink: cfg.waveLink ?? '',
      wavePhone: cfg.wavePhone ?? '',
      orangeMoneyCode: cfg.orangeMoneyCode ?? '',
    };
  }

  async setConfig(shopId: string, input: Partial<GrowthConfig>): Promise<GrowthConfig> {
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

  // ----- SMS / WhatsApp Cloud Multi-Fournisseurs (Orange SMS API Mali, Twilio, TextBee, Webhook)

  private normalizeMaliPhone(raw: string): string {
    const digits = raw.replace(/[^0-9+]/g, '');
    if (digits.startsWith('+')) return digits;
    if (digits.startsWith('00')) return `+${digits.slice(2)}`;
    if (digits.length === 8) return `+223${digits}`;
    if (digits.startsWith('223') && digits.length === 11) return `+${digits}`;
    return `+${digits}`;
  }

  async sendMessageForShop(
    shopId: string,
    to: string,
    message: string,
    kind: string,
  ): Promise<{ ok: boolean; provider: string; detail: string }> {
    const cfg = await this.getConfig(shopId);
    const env = getEnv();
    const provider = cfg.smsProvider || 'WEBHOOK';
    const recipient = this.normalizeMaliPhone(to);

    if (provider === 'ORANGE_MALI') {
      const clientId = cfg.smsApiKey?.trim();
      const clientSecret = cfg.smsApiSecret?.trim();
      const senderPhone = this.normalizeMaliPhone(cfg.smsSenderId?.trim() || '+22300000000');
      if (!clientId || !clientSecret) {
        return { ok: false, provider, detail: 'Client ID ou Client Secret Orange Developer manquant.' };
      }
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenRes = await fetch('https://api.orange.com/oauth/v3/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(10_000),
      });
      if (!tokenRes.ok) {
        return { ok: false, provider, detail: `Échec authentification Orange OAuth (${tokenRes.status}).` };
      }
      const tokenJson = (await tokenRes.json()) as { access_token?: string };
      if (!tokenJson.access_token) {
        return { ok: false, provider, detail: 'Jeton OAuth Orange absent de la réponse.' };
      }
      const encodedSender = encodeURIComponent(`tel:${senderPhone}`);
      const smsRes = await fetch(
        `https://api.orange.com/smsmessaging/v1/outbound/${encodedSender}/requests`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenJson.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            outboundSMSMessageRequest: {
              address: `tel:${recipient}`,
              senderAddress: `tel:${senderPhone}`,
              outboundSMSTextMessage: { message },
            },
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      return {
        ok: smsRes.ok,
        provider,
        detail: smsRes.ok ? `SMS envoyé à ${recipient} via Orange SMS API.` : `Erreur Orange SMS (${smsRes.status}).`,
      };
    }

    if (provider === 'TWILIO') {
      const accountSid = cfg.smsApiKey?.trim();
      const authToken = cfg.smsApiSecret?.trim();
      const from = cfg.smsSenderId?.trim();
      if (!accountSid || !authToken || !from) {
        return { ok: false, provider, detail: 'Account SID, Auth Token ou numéro/Sender ID Twilio manquant.' };
      }
      const basic = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
      const form = new URLSearchParams({ To: recipient, From: from, Body: message });
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: form.toString(),
          signal: AbortSignal.timeout(10_000),
        },
      );
      return {
        ok: res.ok,
        provider,
        detail: res.ok ? `SMS envoyé à ${recipient} via Twilio.` : `Erreur Twilio (${res.status}).`,
      };
    }

    if (provider === 'TEXTBEE') {
      const deviceId = cfg.smsSenderId?.trim();
      const apiKey = cfg.smsApiKey?.trim();
      if (!deviceId || !apiKey) {
        return { ok: false, provider, detail: 'Device ID ou API Key TextBee manquant.' };
      }
      const res = await fetch(
        `https://api.textbee.dev/api/v1/gateway/devices/${encodeURIComponent(deviceId)}/send-sms`,
        {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ recipients: [recipient], message }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      return {
        ok: res.ok,
        provider,
        detail: res.ok ? `SMS envoyé à ${recipient} via TextBee Cloud.` : `Erreur TextBee (${res.status}).`,
      };
    }

    // WEBHOOK générique (ou défini dans .env)
    const targetUrl = cfg.smsWebhookUrl?.trim() || env.REMINDER_WEBHOOK_URL;
    const token = cfg.smsApiKey?.trim() || env.REMINDER_WEBHOOK_TOKEN;
    if (!targetUrl) {
      return { ok: false, provider, detail: 'Aucune URL Webhook SMS configurée.' };
    }
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ to: recipient, message, kind, senderId: cfg.smsSenderId || undefined }),
      signal: AbortSignal.timeout(10_000),
    });
    return {
      ok: res.ok,
      provider,
      detail: res.ok ? `SMS envoyé à ${recipient} via Webhook.` : `Erreur Webhook (${res.status}).`,
    };
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
    await this.sendMessageForShop(
      shopId,
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
    const points = computeLoyaltyPoints(sale.totalXof, rule.pointsPer100Xof, rule.minSaleXof);
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
    const rule = pickCommissionRule(rules, sale.actorUserId);
    if (!rule) return;
    const earned = computeCommissionXof(sale.totalXof, rule);
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

  // ----- Annulation de vente : retire commission non payée et points gagnés

  async reverseSale(shopId: string, saleId: string): Promise<void> {
    const client = await this.shopDbManager.getClientForShop(shopId);
    // Une commission déjà payée est conservée : à régulariser manuellement avec l'agent.
    await client.commissionLedger.deleteMany({ where: { saleId, paidAt: null } });

    const [earns, alreadyReversed] = await Promise.all([
      client.loyaltyTransaction.findMany({ where: { saleId, type: 'EARN' } }),
      client.loyaltyTransaction.findFirst({ where: { saleId, type: 'ADJUST' } }),
    ]);
    if (alreadyReversed) return;
    for (const earn of earns) {
      await client.$transaction(async (tx) => {
        const account = await tx.loyaltyAccount.findUnique({ where: { id: earn.accountId } });
        if (!account) return;
        await tx.loyaltyAccount.update({
          where: { id: account.id },
          data: {
            currentPoints: Math.max(0, account.currentPoints - earn.points),
            lifetimePoints: Math.max(0, account.lifetimePoints - earn.points),
          },
        });
        await tx.loyaltyTransaction.create({
          data: { accountId: account.id, saleId, type: 'ADJUST', points: -earn.points, note: 'Vente annulée' },
        });
      });
    }
  }

  // ----- Promotions programmées

  async listPromotions(shopId: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const rows = await client.promotion.findMany({ orderBy: { startsAt: 'desc' } });
    return rows.map((p) => ({ ...p, discountPercent: Number(p.discountPercent) }));
  }

  async activePromotions(shopId: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const now = new Date();
    const rows = await client.promotion.findMany({
      where: { isActive: true, startsAt: { lte: now }, endsAt: { gte: now } },
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      discountPercent: Number(p.discountPercent),
      appliesToAll: p.appliesToAll,
      productIds: p.productIds,
      endsAt: p.endsAt,
    }));
  }

  async createPromotion(shopId: string, input: z.infer<typeof promotionSchema>) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    await client.promotion.create({
      data: {
        name: input.name,
        discountPercent: input.discountPercent,
        appliesToAll: input.appliesToAll,
        productIds: input.appliesToAll ? [] : input.productIds,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
      },
    });
    return this.listPromotions(shopId);
  }

  async setPromotionActive(shopId: string, id: string, isActive: boolean) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const res = await client.promotion.updateMany({ where: { id }, data: { isActive } });
    if (res.count === 0) throw new NotFoundException('Promotion introuvable.');
    return this.listPromotions(shopId);
  }

  async deletePromotion(shopId: string, id: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    await client.promotion.deleteMany({ where: { id } });
    return this.listPromotions(shopId);
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
  @ApiOperation({ summary: 'Configuration Mobile Money & activation SMS de la boutique (sans secrets)' })
  getConfig(@Param('shopId') shopId: string) {
    return this.growth.getOwnerSafeConfig(shopId);
  }

  @Put('growth/config')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Mettre à jour la configuration Mobile Money & activation SMS (Propriétaire)' })
  setConfig(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(ownerGrowthConfigSchema)) body: z.infer<typeof ownerGrowthConfigSchema>,
  ) {
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

  @Get('promotions')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Lister les promotions programmées' })
  promotions(@Param('shopId') shopId: string) {
    return this.growth.listPromotions(shopId);
  }

  @Get('promotions/active')
  @Roles('OWNER', 'AGENT')
  @ApiOperation({ summary: 'Promotions en cours (appliquées automatiquement aux ventes)' })
  activePromotions(@Param('shopId') shopId: string) {
    return this.growth.activePromotions(shopId);
  }

  @Post('promotions')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Créer une promotion programmée' })
  createPromotion(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(promotionSchema)) body: z.infer<typeof promotionSchema>,
  ) {
    return this.growth.createPromotion(shopId, body);
  }

  @Put('promotions/:id/active')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Activer ou suspendre une promotion' })
  setPromotionActive(
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ isActive: z.boolean() }))) body: { isActive: boolean },
  ) {
    return this.growth.setPromotionActive(shopId, id, body.isActive);
  }

  @Delete('promotions/:id')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Supprimer une promotion' })
  deletePromotion(@Param('shopId') shopId: string, @Param('id') id: string) {
    return this.growth.deletePromotion(shopId, id);
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

@ApiTags('Super Admin — Passerelle SMS Cloud par Boutique')
@ApiBearerAuth()
@Controller('admin/shops/:shopId/sms-gateway')
export class AdminSmsGatewayController {
  constructor(private readonly growth: GrowthService) {}

  @Get()
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Lire la configuration de la passerelle SMS Cloud d’une boutique (Super Admin)' })
  getSmsGateway(@Param('shopId') shopId: string) {
    return this.growth.getConfig(shopId);
  }

  @Put()
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Configurer le fournisseur et les clés API SMS Cloud d’une boutique (Super Admin)' })
  setSmsGateway(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(adminSmsGatewaySchema)) body: z.infer<typeof adminSmsGatewaySchema>,
  ) {
    return this.growth.setConfig(shopId, body);
  }

  @Post('test')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Envoyer un SMS de test pour une boutique (Super Admin)' })
  async testSms(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(testSmsSchema)) body: z.infer<typeof testSmsSchema>,
  ) {
    const res = await this.growth.sendMessageForShop(
      shopId,
      body.phone,
      body.message || 'Test SMS ShopControl (Super Admin) : passerelle SMS Cloud opérationnelle !',
      'TEST_SMS',
    );
    if (!res.ok) throw new BadRequestException(res.detail);
    return res;
  }
}

@Global()
@Module({
  controllers: [GrowthController, AdminSmsGatewayController],
  providers: [GrowthService],
  exports: [GrowthService],
})
export class GrowthModule {}
