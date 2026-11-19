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
      products,
      openReceivables,
      expensesAgg,
      openSessions,
      recentDiscrepancies,
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
          stockConflict: true,
          createdAt: true,
          lines: { select: { productId: true, quantity: true, lineTotalXof: true } },
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
    ]);

    const currentSeries = new Array<number>(spec.buckets.length).fill(0);
    const previousSeries = new Array<number>(spec.buckets.length).fill(0);
    const currentCounts = new Array<number>(spec.buckets.length).fill(0);

    let currentSalesXof = 0;
    let previousSalesXof = 0;
    let currentSalesCount = 0;
    let stockConflictsCount = 0;
    const productSalesQty = new Map<string, number>();

    for (const sale of salesRows) {
      const ts = sale.createdAt.getTime();
      if (ts >= spec.currentStart.getTime()) {
        currentSalesXof += sale.totalXof;
        currentSalesCount += 1;
        if (sale.stockConflict) stockConflictsCount += 1;
        for (const l of sale.lines) {
          productSalesQty.set(l.productId, (productSalesQty.get(l.productId) ?? 0) + l.quantity);
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

      return {
        id: p.id,
        shopId,
        shopName,
        name: p.name,
        sku: p.sku,
        categoryName: p.category?.name ?? null,
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
      currentSalesXof,
      previousSalesXof,
      currentSalesCount,
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
    const currentSalesXof = perShop.reduce((a, s) => a + s.currentSalesXof, 0);
    const previousSalesXof = perShop.reduce((a, s) => a + s.previousSalesXof, 0);
    const currentSalesCount = perShop.reduce((a, s) => a + s.currentSalesCount, 0);
    const totalProductsCount = perShop.reduce((a, s) => a + s.totalProductsCount, 0);
    const lowStockCount = perShop.reduce((a, s) => a + s.lowStockCount, 0);
    const outOfStockCount = perShop.reduce((a, s) => a + s.outOfStockCount, 0);
    const openReceivablesCount = perShop.reduce((a, s) => a + s.openReceivablesCount, 0);
    const openReceivablesAmountXof = perShop.reduce((a, s) => a + s.openReceivablesAmountXof, 0);
    const expensesXof =
      perShop.reduce((a, s) => a + s.expensesXof, 0) + companyExpensesXof;
    const openCashSessionsCount = perShop.reduce((a, s) => a + s.openCashSessionsCount, 0);
    const overdueCashSessions = perShop.reduce((a, s) => a + s.overdueCashSessions, 0);
    const recentDiscrepancies = perShop.reduce((a, s) => a + s.recentDiscrepancies, 0);
    const stockConflictsCount = perShop.reduce((a, s) => a + s.stockConflictsCount, 0);

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
      lowStockCount + openReceivablesCount + overdueCashSessions + stockConflictsCount;

    return {
      period: spec.period,
      kpis: {
        currentSalesXof,
        previousSalesXof,
        salesDeltaPercent,
        currentSalesCount,
        averageOrderXof,
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
        currentSalesXof: 0,
        previousSalesXof: 0,
        salesDeltaPercent: 0,
        currentSalesCount: 0,
        averageOrderXof: 0,
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
