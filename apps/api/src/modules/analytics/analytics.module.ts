import {
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { AuthenticatedUser } from '../../common/auth/request-context.types';
import { ControlPrismaService } from '../../common/database/control-prisma.service';
import { ShopDatabaseManagerService } from '../../common/database/shop-database-manager.service';
import { ShopScopeGuard } from '../../common/guards/shop-scope.guard';

export type AnalyticsPeriod = 'daily' | 'weekly' | 'monthly';

interface PeriodBuckets {
  period: AnalyticsPeriod;
  currentStart: Date;
  previousStart: Date;
  buckets: Array<{ key: string; label: string; startMs: number; endMs: number }>;
  prevBuckets: Array<{ key: string; startMs: number; endMs: number }>;
}

function buildPeriodBuckets(rawPeriod?: string): PeriodBuckets {
  const period: AnalyticsPeriod =
    rawPeriod === 'daily' || rawPeriod === 'weekly' || rawPeriod === 'monthly'
      ? rawPeriod
      : 'monthly';

  const now = new Date();
  const endOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0),
  );
  const bucketCount = period === 'daily' ? 7 : period === 'weekly' ? 8 : 10;
  const bucketDays = period === 'daily' ? 1 : period === 'weekly' ? 7 : 3;
  const bucketMs = bucketDays * 86_400_000;
  const totalWindowMs = bucketCount * bucketMs;

  const currentStart = new Date(endOfToday.getTime() - totalWindowMs);
  const previousStart = new Date(currentStart.getTime() - totalWindowMs);

  const monthFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  const buckets: PeriodBuckets['buckets'] = [];
  const prevBuckets: PeriodBuckets['prevBuckets'] = [];

  for (let i = 0; i < bucketCount; i += 1) {
    const startMs = currentStart.getTime() + i * bucketMs;
    const endMs = startMs + bucketMs;
    const d = new Date(startMs);
    buckets.push({
      key: d.toISOString().slice(0, 10),
      label: monthFmt.format(d),
      startMs,
      endMs,
    });

    const pStartMs = previousStart.getTime() + i * bucketMs;
    prevBuckets.push({
      key: new Date(pStartMs).toISOString().slice(0, 10),
      startMs: pStartMs,
      endMs: pStartMs + bucketMs,
    });
  }

  return { period, currentStart, previousStart, buckets, prevBuckets };
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly controlPrisma: ControlPrismaService,
    private readonly shopDbManager: ShopDatabaseManagerService,
  ) {}

  async getShopAnalytics(shopId: string, rawPeriod?: string) {
    const shop = await this.controlPrisma.shop.findUniqueOrThrow({
      where: { id: shopId },
      select: { id: true, name: true, slug: true, status: true, dbName: true, dbStatus: true, currency: true },
    });

    const spec = buildPeriodBuckets(rawPeriod);
    if (shop.dbStatus !== 'READY') {
      return this.emptyResponse(spec, [shop]);
    }

    const data = await this.collectSingleShopMetrics(shop.id, shop.name, spec);
    return this.buildResponse(spec, [data], 0);
  }

  async getMerchantAnalytics(merchantId: string, rawPeriod?: string) {
    const spec = buildPeriodBuckets(rawPeriod);
    const [shops, companyExpAgg] = await Promise.all([
      this.controlPrisma.shop.findMany({
        where: { merchantId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, slug: true, status: true, dbName: true, dbStatus: true, currency: true },
      }),
      this.controlPrisma.companyExpense.aggregate({
        where: {
          merchantId,
          status: 'ACTIVE',
          expenseDate: { gte: spec.currentStart },
        },
        _sum: { amountXof: true },
      }),
    ]);

    const readyShops = shops.filter((s) => s.dbStatus === 'READY');
    if (readyShops.length === 0) {
      return this.emptyResponse(spec, shops);
    }

    const perShop = await Promise.all(
      readyShops.map((s) => this.collectSingleShopMetrics(s.id, s.name, spec)),
    );

    return this.buildResponse(spec, perShop, companyExpAgg._sum.amountXof ?? 0);
  }

  private async collectSingleShopMetrics(shopId: string, shopName: string, spec: PeriodBuckets) {
    const client = await this.shopDbManager.getClientForShop(shopId);

    const [
      salesRows,
      refundRows,
      products,
      openReceivables,
      expensesAgg,
      openSessions,
      recentDiscrepancies,
      pendingOrdersCount,
    ] = await Promise.all([
      client.sale.findMany({
        where: {
          status: 'COMPLETED',
          createdAt: { gte: spec.previousStart },
        },
        select: {
          id: true,
          totalXof: true,
          paidAmountXof: true,
          dueAmountXof: true,
          refundedAmountXof: true,
          stockConflict: true,
          createdAt: true,
          lines: {
            select: {
              productId: true,
              quantity: true,
              returnedQty: true,
              unitCostXof: true,
              lineTotalXof: true,
            },
          },
        },
      }),
      client.saleRefund.findMany({
        where: {
          createdAt: { gte: spec.previousStart },
          sale: { status: { not: 'CANCELLED' } },
        },
        select: {
          id: true,
          amountXof: true,
          createdAt: true,
        },
      }),
      client.product.findMany({
        where: { status: { not: 'ARCHIVED' } },
        include: {
          category: { select: { name: true } },
          stockBalances: { where: { variantKey: 'BASE' } },
        },
        orderBy: { name: 'asc' },
      }),
      client.receivable.findMany({
        where: { status: { in: ['OPEN', 'PARTIALLY_PAID'] } },
        select: { remainingAmountXof: true },
      }),
      client.expense.aggregate({
        where: { status: 'ACTIVE', expenseDate: { gte: spec.currentStart } },
        _sum: { amountXof: true },
      }),
      client.cashSession.findMany({
        where: { status: 'OPEN' },
        select: { id: true, openedAt: true, theoreticalAmountXof: true },
      }),
      client.cashSession.count({
        where: {
          status: 'CLOSED',
          closedAt: { gte: spec.currentStart },
          discrepancyXof: { not: 0 },
        },
      }),
      client.onlineOrder.count({
        where: { status: { in: ['NEW', 'CONFIRMED', 'PREPARING', 'READY', 'IN_DELIVERY'] } },
      }),
    ]);

    const currentSeries = new Array<number>(spec.buckets.length).fill(0);
    const previousSeries = new Array<number>(spec.buckets.length).fill(0);
    const currentCounts = new Array<number>(spec.buckets.length).fill(0);

    let grossSalesCurrentXof = 0;
    let refundsCurrentXof = 0;
    let previousSalesXof = 0;
    let currentSalesCount = 0;
    let cogsCurrentXof = 0;
    let missingCostProductsCount = 0;
    const missingCostProductIds = new Set<string>();
    let stockConflictsCount = 0;
    const productSalesQty = new Map<string, number>();

    for (const sale of salesRows) {
      const ts = sale.createdAt.getTime();
      if (ts >= spec.currentStart.getTime()) {
        grossSalesCurrentXof += sale.totalXof;
        currentSalesCount += 1;
        if (sale.stockConflict) stockConflictsCount += 1;
        const hasExplicitReturns = sale.lines.some((l) => l.returnedQty > 0);
        const refundScale =
          !hasExplicitReturns && sale.totalXof > 0 && sale.refundedAmountXof > 0
            ? Math.max(0, 1 - sale.refundedAmountXof / sale.totalXof)
            : 1;
        for (const l of sale.lines) {
          const netQty = Math.max(0, l.quantity - l.returnedQty);
          productSalesQty.set(
            l.productId,
            (productSalesQty.get(l.productId) ?? 0) + Math.round(netQty * refundScale),
          );
          if (l.unitCostXof !== null) {
            cogsCurrentXof += Math.round(l.unitCostXof * netQty * refundScale);
          } else if (netQty > 0 && refundScale > 0) {
            missingCostProductIds.add(l.productId);
          }
        }
        const idx = spec.buckets.findIndex((b) => ts >= b.startMs && ts < b.endMs);
        if (idx >= 0) {
          currentSeries[idx] += sale.totalXof;
          currentCounts[idx] += 1;
        }
      } else {
        previousSalesXof += sale.totalXof;
        const idx = spec.prevBuckets.findIndex((b) => ts >= b.startMs && ts < b.endMs);
        if (idx >= 0) {
          previousSeries[idx] += sale.totalXof;
        }
      }
    }

    // Section 11.3 : chaque remboursement se déduit du Chiffre d'affaires net à la date de l'opération !
    for (const ref of refundRows) {
      const ts = ref.createdAt.getTime();
      if (ts >= spec.currentStart.getTime()) {
        refundsCurrentXof += ref.amountXof;
        const idx = spec.buckets.findIndex((b) => ts >= b.startMs && ts < b.endMs);
        if (idx >= 0) {
          currentSeries[idx] = Math.max(0, currentSeries[idx] - ref.amountXof);
        }
      } else {
        previousSalesXof = Math.max(0, previousSalesXof - ref.amountXof);
        const idx = spec.prevBuckets.findIndex((b) => ts >= b.startMs && ts < b.endMs);
        if (idx >= 0) {
          previousSeries[idx] = Math.max(0, previousSeries[idx] - ref.amountXof);
        }
      }
    }

    const currentSalesXof = Math.max(0, grossSalesCurrentXof - refundsCurrentXof);
    missingCostProductsCount = missingCostProductIds.size;

    let lowStockCount = 0;
    let outOfStockCount = 0;

    const productRows = products.map((p) => {
      const bal = p.stockBalances[0];
      const available = (bal?.physicalQty ?? 0) - (bal?.reservedQty ?? 0);
      let health: 'OK' | 'LOW' | 'CRITICAL' = 'OK';
      if (available <= 0) {
        health = 'CRITICAL';
        outOfStockCount += 1;
        lowStockCount += 1;
      } else if (available <= p.alertThreshold) {
        health = 'LOW';
        lowStockCount += 1;
      }

      const imgs = Array.isArray(p.imageUrls) ? (p.imageUrls as string[]) : [];
      return {
        id: p.id,
        shopId,
        shopName,
        name: p.name,
        sku: p.sku,
        categoryName: p.category?.name ?? null,
        imageUrl: imgs[0] ?? null,
        salePriceXof: p.salePriceXof,
        stockAvailable: available,
        alertThreshold: p.alertThreshold,
        salesQty: productSalesQty.get(p.id) ?? 0,
        health,
      };
    });

    const openReceivablesCount = openReceivables.length;
    const openReceivablesAmountXof = openReceivables.reduce((a, r) => a + r.remainingAmountXof, 0);
    const overdueCashSessions = openSessions.filter(
      (s) => Date.now() - s.openedAt.getTime() > 24 * 3_600_000,
    ).length;

    return {
      shopId,
      shopName,
      grossSalesXof: grossSalesCurrentXof,
      refundsXof: refundsCurrentXof,
      currentSalesXof,
      previousSalesXof,
      currentSalesCount,
      cogsCurrentXof,
      missingCostProductsCount,
      totalProductsCount: products.length,
      lowStockCount,
      outOfStockCount,
      openReceivablesCount,
      openReceivablesAmountXof,
      expensesXof: expensesAgg._sum.amountXof ?? 0,
      openCashSessionsCount: openSessions.length,
      overdueCashSessions,
      recentDiscrepancies,
      stockConflictsCount,
      pendingOrdersCount,
      currentSeries,
      previousSeries,
      currentCounts,
      productRows,
    };
  }

  private buildResponse(
    spec: PeriodBuckets,
    perShop: Array<Awaited<ReturnType<AnalyticsService['collectSingleShopMetrics']>>>,
    companyExpensesXof: number,
  ) {
    const grossSalesXof = perShop.reduce((a, s) => a + s.grossSalesXof, 0);
    const refundsXof = perShop.reduce((a, s) => a + s.refundsXof, 0);
    const currentSalesXof = perShop.reduce((a, s) => a + s.currentSalesXof, 0);
    const previousSalesXof = perShop.reduce((a, s) => a + s.previousSalesXof, 0);
    const currentSalesCount = perShop.reduce((a, s) => a + s.currentSalesCount, 0);
    const cogsXof = perShop.reduce((a, s) => a + s.cogsCurrentXof, 0);
    const missingCostProductsCount = perShop.reduce((a, s) => a + s.missingCostProductsCount, 0);
    const totalProductsCount = perShop.reduce((a, s) => a + s.totalProductsCount, 0);
    const lowStockCount = perShop.reduce((a, s) => a + s.lowStockCount, 0);
    const outOfStockCount = perShop.reduce((a, s) => a + s.outOfStockCount, 0);
    const openReceivablesCount = perShop.reduce((a, s) => a + s.openReceivablesCount, 0);
    const openReceivablesAmountXof = perShop.reduce((a, s) => a + s.openReceivablesAmountXof, 0);
    const expensesXof =
      perShop.reduce((a, s) => a + s.expensesXof, 0) + companyExpensesXof;
    const grossMarginXof = currentSalesXof - cogsXof;
    const estimatedNetProfitXof = grossMarginXof - expensesXof;
    const openCashSessionsCount = perShop.reduce((a, s) => a + s.openCashSessionsCount, 0);
    const overdueCashSessions = perShop.reduce((a, s) => a + s.overdueCashSessions, 0);
    const recentDiscrepancies = perShop.reduce((a, s) => a + s.recentDiscrepancies, 0);
    const stockConflictsCount = perShop.reduce((a, s) => a + s.stockConflictsCount, 0);
    const pendingOrdersCount = perShop.reduce((a, s) => a + s.pendingOrdersCount, 0);

    const salesDeltaPercent =
      previousSalesXof > 0
        ? Math.round(((currentSalesXof - previousSalesXof) * 100) / previousSalesXof)
        : currentSalesXof > 0
          ? 100
          : 0;

    const averageOrderXof =
      currentSalesCount > 0 ? Math.round(currentSalesXof / currentSalesCount) : 0;

    const receivableRatioPercent =
      currentSalesXof > 0
        ? Number(((openReceivablesAmountXof * 100) / Math.max(1, currentSalesXof)).toFixed(1))
        : openReceivablesAmountXof > 0
          ? 100
          : 0;

    const chartSeries = spec.buckets.map((b, idx) => ({
      date: b.key,
      label: b.label,
      currentXof: perShop.reduce((acc, s) => acc + s.currentSeries[idx], 0),
      previousXof: perShop.reduce((acc, s) => acc + s.previousSeries[idx], 0),
      salesCount: perShop.reduce((acc, s) => acc + s.currentCounts[idx], 0),
    }));

    const topProducts = perShop
      .flatMap((s) => s.productRows)
      .sort((a, b) => b.salesQty - a.salesQty || a.stockAvailable - b.stockAvailable)
      .slice(0, 30);

    const priorityActionsCount =
      lowStockCount +
      openReceivablesCount +
      overdueCashSessions +
      stockConflictsCount +
      pendingOrdersCount;

    return {
      period: spec.period,
      kpis: {
        grossSalesXof,
        refundsXof,
        currentSalesXof,
        previousSalesXof,
        salesDeltaPercent,
        currentSalesCount,
        averageOrderXof,
        cogsXof,
        grossMarginXof,
        estimatedNetProfitXof,
        isEstimated: missingCostProductsCount > 0,
        missingCostProductsCount,
        totalProductsCount,
        lowStockCount,
        outOfStockCount,
        openReceivablesCount,
        openReceivablesAmountXof,
        receivableRatioPercent,
        expensesXof,
        openCashSessionsCount,
        overdueCashSessions,
        recentDiscrepancies,
        stockConflictsCount,
        pendingOrdersCount,
        priorityActionsCount,
      },
      chartSeries,
      topProducts,
    };
  }

  private emptyResponse(spec: PeriodBuckets, _shops: unknown[]) {
    return {
      period: spec.period,
      kpis: {
        grossSalesXof: 0,
        refundsXof: 0,
        currentSalesXof: 0,
        previousSalesXof: 0,
        salesDeltaPercent: 0,
        currentSalesCount: 0,
        averageOrderXof: 0,
        cogsXof: 0,
        grossMarginXof: 0,
        estimatedNetProfitXof: 0,
        isEstimated: false,
        missingCostProductsCount: 0,
        totalProductsCount: 0,
        lowStockCount: 0,
        outOfStockCount: 0,
        openReceivablesCount: 0,
        openReceivablesAmountXof: 0,
        receivableRatioPercent: 0,
        expensesXof: 0,
        openCashSessionsCount: 0,
        overdueCashSessions: 0,
        recentDiscrepancies: 0,
        stockConflictsCount: 0,
        pendingOrdersCount: 0,
        priorityActionsCount: 0,
      },
      chartSeries: spec.buckets.map((b) => ({
        date: b.key,
        label: b.label,
        currentXof: 0,
        previousXof: 0,
        salesCount: 0,
      })),
      topProducts: [],
    };
  }
}

@ApiTags('Analytique & Pilotage')
@ApiBearerAuth()
@Controller()
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('merchant/analytics')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Analytique consolidée temps réel sur toutes les boutiques du propriétaire' })
  merchantAnalytics(
    @CurrentUser() user: AuthenticatedUser,
    @Query('period') period?: string,
  ) {
    if (!user.merchantId) {
      throw new ForbiddenException({ code: 'MERCHANT_REQUIRED', message: 'Aucun marchand associé.' });
    }
    return this.analyticsService.getMerchantAnalytics(user.merchantId, period);
  }

  @Get('shops/:shopId/analytics')
  @UseGuards(ShopScopeGuard)
  @Roles('OWNER', 'AGENT')
  @ApiOperation({ summary: 'Analytique temps réel d’une boutique depuis sa base PostgreSQL dédiée' })
  shopAnalytics(@Param('shopId') shopId: string, @Query('period') period?: string) {
    return this.analyticsService.getShopAnalytics(shopId, period);
  }
}

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
