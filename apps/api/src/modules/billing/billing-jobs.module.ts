import { Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { getEnv } from '../../common/config/env.config';
import { ControlPrismaService } from '../../common/database/control-prisma.service';
import { ShopDatabaseManagerService } from '../../common/database/shop-database-manager.service';
import { NotificationsService } from '../notifications/notifications.module';

const DAY_MS = 86_400_000;
const TICK_MS = 15 * 60_000;

const dayIndex = (d: Date) => Math.floor(d.getTime() / DAY_MS);
const fmtDate = (d: Date) => d.toLocaleDateString('fr-FR');
const fmtXof = (n: number) => `${n.toLocaleString('fr-FR')} FCFA`;

/**
 * Tâches de fond de facturation :
 *  1. Cycle de vie d'abonnement : rappels d'échéance, passage Impayé (délai de grâce) puis Suspendu.
 *  2. Relances automatiques des dettes clients : propriétaire + agents de la boutique (notification interne)
 *     et client débiteur (passerelle SMS/WhatsApp configurable, sinon lien WhatsApp prêt à envoyer).
 * Idempotent : peut tourner sur plusieurs instances sans doublon grâce aux dates de dernière relance.
 */
@Injectable()
export class BillingJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingJobsService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly controlPrisma: ControlPrismaService,
    private readonly shopDbManager: ShopDatabaseManagerService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    if (getEnv().NODE_ENV === 'test') return;
    setTimeout(() => void this.tick(), 20_000).unref();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runSubscriptionLifecycle();
    } catch (err) {
      this.logger.error(`Cycle abonnements en échec : ${(err as Error).message}`);
    }
    try {
      await this.runDebtReminders();
    } catch (err) {
      this.logger.error(`Relances de dettes en échec : ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  // ---------------------------------------------------------------- Abonnements

  private async notifyOwnersOnce(
    merchantId: string,
    payload: { title: string; message: string; priority: 'INFO' | 'WARNING' | 'URGENT' },
  ): Promise<void> {
    const already = await this.controlPrisma.notification.findFirst({
      where: {
        merchantId,
        title: payload.title,
        createdAt: { gt: new Date(Date.now() - 20 * 3600_000) },
      },
      select: { id: true },
    });
    if (already) return;
    await this.notifications.notifyMerchantOwners(merchantId, {
      type: 'PLATFORM',
      priority: payload.priority,
      title: payload.title,
      message: payload.message,
      targetPath: '/owner/subscription',
    });
  }

  async runSubscriptionLifecycle(): Promise<void> {
    const now = new Date();
    const subs = await this.controlPrisma.merchantSubscription.findMany({
      where: { billingCycle: { not: 'DIRECT_SALE' }, merchant: { status: { in: ['ACTIVE', 'PAST_DUE'] } } },
      include: { merchant: { select: { id: true, status: true, gracePeriodEndsAt: true } } },
    });

    for (const sub of subs) {
      const isTrial = sub.trialEndsAt !== null;
      const label = isTrial ? 'Essai gratuit' : 'Abonnement';
      const end = sub.currentPeriodEnd;
      const m = sub.merchant;

      if (m.status === 'ACTIVE' && end <= now) {
        const graceEnd = new Date(end.getTime() + sub.autoSuspendGraceDays * DAY_MS);
        await this.controlPrisma.merchant.update({
          where: { id: m.id },
          data: {
            status: 'PAST_DUE',
            statusReason: `${label} arrivé à échéance`,
            gracePeriodEndsAt: graceEnd,
          },
        });
        await this.notifyOwnersOnce(m.id, {
          title: `${label} terminé`,
          message: `Renouvelez avant le ${fmtDate(graceEnd)} pour éviter la suspension de votre compte (lecture seule).`,
          priority: 'URGENT',
        });
        continue;
      }

      if (m.status === 'PAST_DUE') {
        const graceEnd = m.gracePeriodEndsAt ?? new Date(end.getTime() + sub.autoSuspendGraceDays * DAY_MS);
        if (graceEnd <= now) {
          await this.controlPrisma.merchant.update({
            where: { id: m.id },
            data: { status: 'SUSPENDED', statusReason: 'Abonnement impayé : délai de grâce dépassé' },
          });
          await this.notifyOwnersOnce(m.id, {
            title: 'Compte suspendu',
            message:
              'Votre compte est en lecture seule. Soumettez votre paiement (avec la référence du transfert) pour le réactiver.',
            priority: 'URGENT',
          });
        } else {
          await this.notifyOwnersOnce(m.id, {
            title: 'Abonnement impayé',
            message: `Dernier jour avant suspension : ${fmtDate(graceEnd)}. Renouvelez dès maintenant.`,
            priority: 'URGENT',
          });
        }
        continue;
      }

      const daysLeft = dayIndex(end) - dayIndex(now);
      if (m.status === 'ACTIVE' && [3, 1, 0].includes(daysLeft)) {
        await this.notifyOwnersOnce(m.id, {
          title: `${label} : ${daysLeft === 0 ? 'se termine aujourd’hui' : `se termine dans ${daysLeft} jour(s)`}`,
          message: `Échéance le ${fmtDate(end)}. Renouvelez pour garder l’accès complet.`,
          priority: daysLeft <= 1 ? 'URGENT' : 'WARNING',
        });
      }
    }
  }

  // ---------------------------------------------------------------- Dettes clients

  /** Gap minimal entre deux relances d'une dette échue (rattrapage si le serveur était arrêté). */
  private reminderDue(diffDays: number, last: Date | null, now: Date): boolean {
    if (last && dayIndex(last) === dayIndex(now)) return false;
    if (diffDays >= 0) return diffDays <= 1; // veille et jour J
    if (!last) return true;
    const overdue = -diffDays;
    const gap = overdue < 7 ? 2 : 7;
    return dayIndex(now) - dayIndex(last) >= gap;
  }

  async runDebtReminders(): Promise<void> {
    const now = new Date();
    const shops = await this.controlPrisma.shop.findMany({
      where: { dbStatus: 'READY', status: { in: ['ACTIVE', 'PAST_DUE'] } },
      select: { id: true, name: true, merchantId: true, phone: true },
    });

    for (const shop of shops) {
      try {
        const db = await this.shopDbManager.getClientForShop(shop.id);
        const receivables = await db.receivable.findMany({
          where: {
            status: { in: ['OPEN', 'PARTIALLY_PAID'] },
            remainingAmountXof: { gt: 0 },
            dueDate: { not: null, lte: new Date(now.getTime() + 2 * DAY_MS) },
          },
          include: { client: { select: { fullName: true, phone: true, email: true } } },
          take: 500,
        });
        const due = receivables.filter((r) =>
          this.reminderDue(dayIndex(r.dueDate as Date) - dayIndex(now), r.lastRemindedAt, now),
        );
        if (due.length === 0) continue;

        const agents = await this.controlPrisma.userShopAccess.findMany({
          where: { shopId: shop.id, isActive: true, user: { isActive: true, role: 'AGENT' } },
          select: { userId: true },
        });
        const owners = await this.controlPrisma.user.findMany({
          where: { merchantId: shop.merchantId, role: 'OWNER', isActive: true },
          select: { id: true },
        });
        const recipients = Array.from(new Set([...owners.map((o) => o.id), ...agents.map((a) => a.userId)]));

        for (const r of due) {
          const dueDate = r.dueDate as Date;
          const diff = dayIndex(dueDate) - dayIndex(now);
          const when =
            diff > 0 ? `demain (${fmtDate(dueDate)})` : diff === 0 ? 'aujourd’hui' : `depuis ${-diff} jour(s) (${fmtDate(dueDate)})`;
          const clientMessage =
            `Bonjour ${r.client.fullName}, rappel de ${shop.name} : votre dette de ` +
            `${fmtXof(r.remainingAmountXof)} est à régler ${diff >= 0 ? when : `— échue ${when}`}. Merci.`;

          const delivered = await this.sendClientReminder({
            shopName: shop.name,
            phone: r.client.phone,
            email: r.client.email,
            message: clientMessage,
          });

          const waPhone = r.client.phone.replace(/[^\d]/g, '');
          const waLink = `https://wa.me/${waPhone}?text=${encodeURIComponent(clientMessage)}`;
          const title = diff < 0 ? 'Dette en retard' : 'Dette à encaisser';
          const message =
            `${r.client.fullName} (${r.client.phone}) doit ${fmtXof(r.remainingAmountXof)} — échéance ${when}. ` +
            (delivered ? 'Relance envoyée au client.' : `Relancer par WhatsApp : ${waLink}`);

          await Promise.all(
            recipients.map((uid) =>
              this.notifications.create({
                merchantId: shop.merchantId,
                shopId: shop.id,
                recipientUserId: uid,
                type: 'PLATFORM',
                priority: diff < 0 ? 'URGENT' : 'WARNING',
                title,
                message,
                targetPath: '/commerce/clients',
              }),
            ),
          );

          await db.receivable.update({
            where: { id: r.id },
            data: { reminderCount: { increment: 1 }, lastRemindedAt: now },
          });
        }
      } catch (err) {
        this.logger.warn(`Relances ignorées pour la boutique ${shop.id} : ${(err as Error).message}`);
      }
    }
  }

  /** Envoie la relance au client via la passerelle configurée. Retourne false si aucune passerelle n'est active. */
  private async sendClientReminder(payload: {
    shopName: string;
    phone: string;
    email: string | null;
    message: string;
  }): Promise<boolean> {
    const env = getEnv();
    if (!env.REMINDER_WEBHOOK_URL) return false;
    try {
      const res = await fetch(env.REMINDER_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(env.REMINDER_WEBHOOK_TOKEN ? { Authorization: `Bearer ${env.REMINDER_WEBHOOK_TOKEN}` } : {}),
        },
        body: JSON.stringify({ type: 'DEBT_REMINDER', ...payload }),
        signal: AbortSignal.timeout(8000),
      });
      return res.ok;
    } catch (err) {
      this.logger.warn(`Passerelle de relance injoignable : ${(err as Error).message}`);
      return false;
    }
  }
}

@Module({
  providers: [BillingJobsService],
  exports: [BillingJobsService],
})
export class BillingJobsModule {}
