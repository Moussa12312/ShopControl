import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import PDFDocument from 'pdfkit';
import { formatXof, generateDailyReportSchema } from '@shopcontrol/shared';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { AuthenticatedUser } from '../../common/auth/request-context.types';
import { ControlPrismaService } from '../../common/database/control-prisma.service';
import { ShopDatabaseManagerService } from '../../common/database/shop-database-manager.service';
import { ShopScopeGuard } from '../../common/guards/shop-scope.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';

export interface ShopFinancialSummary {
  shopId: string;
  shopName: string;
  from: string;
  to: string;
  salesCount: number;
  itemsSoldQty: number;
  grossSalesXof: number;
  refundsXof: number;
  netSalesXof: number;
  cogsXof: number;
  grossMarginXof: number;
  expensesXof: number;
  estimatedNetProfitXof: number;
  isEstimated: boolean;
  missingCostProductsCount: number;
  receivablesCreatedXof: number;
  receivablesOutstandingXof: number;
  paymentsBreakdown: Record<string, number>;
  openCashSessionsCount: number;
  cashDiscrepancyTotalXof: number;
  lowStockCount: number;
  pendingOrdersCount: number;
}

function parseRange(from?: string, to?: string): { start: Date; end: Date } {
  const now = new Date();
  const start = from
    ? new Date(`${from.slice(0, 10)}T00:00:00.000Z`)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
  const end = to
    ? new Date(`${to.slice(0, 10)}T23:59:59.999Z`)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  return { start, end };
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly controlPrisma: ControlPrismaService,
    private readonly shopDbManager: ShopDatabaseManagerService,
  ) {}

  async computeShopSummary(
    shopId: string,
    from?: string,
    to?: string,
  ): Promise<ShopFinancialSummary> {
    const shop = await this.controlPrisma.shop.findUniqueOrThrow({
      where: { id: shopId },
      select: { id: true, name: true, dbStatus: true },
    });
    const { start, end } = parseRange(from, to);

    if (shop.dbStatus !== 'READY') {
      return {
        shopId: shop.id,
        shopName: shop.name,
        from: start.toISOString(),
        to: end.toISOString(),
        salesCount: 0,
        itemsSoldQty: 0,
        grossSalesXof: 0,
        refundsXof: 0,
        netSalesXof: 0,
        cogsXof: 0,
        grossMarginXof: 0,
        expensesXof: 0,
        estimatedNetProfitXof: 0,
        isEstimated: false,
        missingCostProductsCount: 0,
        receivablesCreatedXof: 0,
        receivablesOutstandingXof: 0,
        paymentsBreakdown: {},
        openCashSessionsCount: 0,
        cashDiscrepancyTotalXof: 0,
        lowStockCount: 0,
        pendingOrdersCount: 0,
      };
    }

    const client = await this.shopDbManager.getClientForShop(shopId);
    const [sales, refunds, expenses, openReceivables, cashSessions, products, pendingOrdersCount] =
      await Promise.all([
        client.sale.findMany({
          where: { status: 'COMPLETED', createdAt: { gte: start, lte: end } },
          include: { lines: true, payments: true },
        }),
        client.saleRefund.findMany({
          where: { createdAt: { gte: start, lte: end }, sale: { status: { not: 'CANCELLED' } } },
        }),
        client.expense.aggregate({
          where: { status: 'ACTIVE', expenseDate: { gte: start, lte: end } },
          _sum: { amountXof: true },
        }),
        client.receivable.aggregate({
          where: { status: { in: ['OPEN', 'PARTIALLY_PAID'] } },
          _sum: { remainingAmountXof: true },
        }),
        client.cashSession.findMany({
          where: {
            OR: [{ status: 'OPEN' }, { closedAt: { gte: start, lte: end } }],
          },
          select: { status: true, discrepancyXof: true },
        }),
        client.product.findMany({
          where: { status: { not: 'ARCHIVED' } },
          select: { alertThreshold: true, stockBalances: { where: { variantKey: 'BASE' } } },
        }),
        client.onlineOrder.count({
          where: { status: { in: ['NEW', 'CONFIRMED', 'PREPARING', 'READY', 'IN_DELIVERY'] } },
        }),
      ]);

    let grossSalesXof = 0;
    let itemsSoldQty = 0;
    let cogsXof = 0;
    let receivablesCreatedXof = 0;
    const missingCostIds = new Set<string>();
    const paymentsBreakdown: Record<string, number> = {};

    for (const s of sales) {
      grossSalesXof += s.totalXof;
      receivablesCreatedXof += s.dueAmountXof;
      const hasExplicitReturns = s.lines.some((l) => l.returnedQty > 0);
      const refundScale =
        !hasExplicitReturns && s.totalXof > 0 && s.refundedAmountXof > 0
          ? Math.max(0, 1 - s.refundedAmountXof / s.totalXof)
          : 1;
      for (const l of s.lines) {
        const netQty = Math.max(0, l.quantity - l.returnedQty);
        itemsSoldQty += Math.round(netQty * refundScale);
        if (l.unitCostXof !== null) {
          cogsXof += Math.round(l.unitCostXof * netQty * refundScale);
        } else if (netQty > 0 && refundScale > 0) {
          missingCostIds.add(l.productId);
        }
      }
      for (const p of s.payments) {
        paymentsBreakdown[p.paymentMethodCode] =
          (paymentsBreakdown[p.paymentMethodCode] || 0) + p.amountXof;
      }
    }

    const refundsXof = refunds.reduce((a, r) => a + r.amountXof, 0);
    const netSalesXof = Math.max(0, grossSalesXof - refundsXof);
    const expensesXof = expenses._sum.amountXof ?? 0;
    const grossMarginXof = netSalesXof - cogsXof;
    const estimatedNetProfitXof = grossMarginXof - expensesXof;

    const openCashSessionsCount = cashSessions.filter((c) => c.status === 'OPEN').length;
    const cashDiscrepancyTotalXof = cashSessions.reduce((a, c) => a + (c.discrepancyXof ?? 0), 0);
    const lowStockCount = products.filter((p) => {
      const bal = p.stockBalances[0];
      const avail = (bal?.physicalQty ?? 0) - (bal?.reservedQty ?? 0);
      return avail <= p.alertThreshold;
    }).length;

    return {
      shopId: shop.id,
      shopName: shop.name,
      from: start.toISOString(),
      to: end.toISOString(),
      salesCount: sales.length,
      itemsSoldQty,
      grossSalesXof,
      refundsXof,
      netSalesXof,
      cogsXof,
      grossMarginXof,
      expensesXof,
      estimatedNetProfitXof,
      isEstimated: missingCostIds.size > 0,
      missingCostProductsCount: missingCostIds.size,
      receivablesCreatedXof,
      receivablesOutstandingXof: openReceivables._sum.remainingAmountXof ?? 0,
      paymentsBreakdown,
      openCashSessionsCount,
      cashDiscrepancyTotalXof,
      lowStockCount,
      pendingOrdersCount,
    };
  }

  /**
   * Bilan consolidé multi-boutiques (Critères #12, #13 & #20) :
   * - Somme EXACTE des bilans boutiques
   * - Dépenses communes d'entreprise sur une ligne distincte
   * - Stock en transit affiché sur une ligne à part et compté UNE SEULE FOIS !
   */
  async computeConsolidatedReport(merchantId: string, from?: string, to?: string) {
    const { start, end } = parseRange(from, to);
    const [shops, companyExpAgg, inTransitTransfers] = await Promise.all([
      this.controlPrisma.shop.findMany({
        where: { merchantId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true },
      }),
      this.controlPrisma.companyExpense.aggregate({
        where: { merchantId, status: 'ACTIVE', expenseDate: { gte: start, lte: end } },
        _sum: { amountXof: true },
      }),
      this.controlPrisma.stockTransfer.findMany({
        where: { merchantId, status: 'IN_TRANSIT' },
        include: { items: true },
      }),
    ]);

    const byShop = await Promise.all(
      shops.map((s) => this.computeShopSummary(s.id, from, to)),
    );

    const companyExpensesXof = companyExpAgg._sum.amountXof ?? 0;

    let inTransitQty = 0;
    let inTransitValueXof = 0;
    for (const trf of inTransitTransfers) {
      for (const item of trf.items) {
        inTransitQty += item.dispatchedQty;
        inTransitValueXof += item.dispatchedQty * (item.unitCostXof ?? item.salePriceXof);
      }
    }

    const paymentsBreakdown: Record<string, number> = {};
    for (const s of byShop) {
      for (const [k, v] of Object.entries(s.paymentsBreakdown)) {
        paymentsBreakdown[k] = (paymentsBreakdown[k] || 0) + v;
      }
    }

    const salesCount = byShop.reduce((a, s) => a + s.salesCount, 0);
    const itemsSoldQty = byShop.reduce((a, s) => a + s.itemsSoldQty, 0);
    const grossSalesXof = byShop.reduce((a, s) => a + s.grossSalesXof, 0);
    const refundsXof = byShop.reduce((a, s) => a + s.refundsXof, 0);
    const netSalesXof = byShop.reduce((a, s) => a + s.netSalesXof, 0);
    const cogsXof = byShop.reduce((a, s) => a + s.cogsXof, 0);
    const grossMarginXof = byShop.reduce((a, s) => a + s.grossMarginXof, 0);
    const shopsExpensesXof = byShop.reduce((a, s) => a + s.expensesXof, 0);
    const totalExpensesXof = shopsExpensesXof + companyExpensesXof;
    const estimatedNetProfitXof = grossMarginXof - totalExpensesXof;
    const missingCostProductsCount = byShop.reduce((a, s) => a + s.missingCostProductsCount, 0);

    return {
      from: start.toISOString(),
      to: end.toISOString(),
      totals: {
        salesCount,
        itemsSoldQty,
        grossSalesXof,
        refundsXof,
        netSalesXof,
        cogsXof,
        grossMarginXof,
        shopsExpensesXof,
        companyExpensesXof,
        totalExpensesXof,
        estimatedNetProfitXof,
        isEstimated: missingCostProductsCount > 0,
        missingCostProductsCount,
        receivablesOutstandingXof: byShop.reduce((a, s) => a + s.receivablesOutstandingXof, 0),
        cashDiscrepancyTotalXof: byShop.reduce((a, s) => a + s.cashDiscrepancyTotalXof, 0),
        paymentsBreakdown,
        inTransitTransfersCount: inTransitTransfers.length,
        inTransitQty,
        inTransitValueXof,
      },
      byShop,
    };
  }

  /**
   * Archive un bilan journalier horodaté (Section 11.1) :
   * - PROVISIONAL si une caisse est encore ouverte, FINAL sinon
   * - Si un bilan existait déjà pour la date, il passe en SUPERSEDED (« remplacé ») et reste consultable !
   */
  async generateDailyReport(shopId: string, reportDateInput: string | undefined, actorUserId: string) {
    const reportDate = reportDateInput || new Date().toISOString().slice(0, 10);
    const summary = await this.computeShopSummary(shopId, reportDate, reportDate);
    const client = await this.shopDbManager.getClientForShop(shopId);

    const existing = await client.dailyReport.findMany({
      where: { reportDate },
      orderBy: { version: 'desc' },
    });
    const nextVersion = (existing[0]?.version ?? 0) + 1;

    if (existing.length > 0) {
      await client.dailyReport.updateMany({
        where: { reportDate, status: { not: 'SUPERSEDED' } },
        data: { status: 'SUPERSEDED' },
      });
    }

    const status = summary.openCashSessionsCount > 0 ? 'PROVISIONAL' : 'FINAL';
    const created = await client.dailyReport.create({
      data: {
        reportDate,
        version: nextVersion,
        status,
        generatedBy: 'MANUAL',
        metrics: summary as unknown as object,
        actorUserId,
      },
    });

    return {
      ...created,
      createdAt: created.createdAt.toISOString(),
    };
  }

  async listDailyReports(shopId: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const list = await client.dailyReport.findMany({
      orderBy: [{ reportDate: 'desc' }, { version: 'desc' }],
      take: 30,
    });
    return list.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  async exportConsolidatedCsv(merchantId: string, from?: string, to?: string): Promise<string> {
    const report = await this.computeConsolidatedReport(merchantId, from, to);
    const headers = [
      'Boutique',
      'Ventes',
      'CA Brut (XOF)',
      'Remboursements (XOF)',
      'CA Net (XOF)',
      'Coût Marchandises (XOF)',
      'Marge Brute (XOF)',
      'Dépenses (XOF)',
      'Bénéfice Net Estimé (XOF)',
      'Estimé',
    ];
    const rows = report.byShop.map((s) =>
      [
        `"${s.shopName.replace(/"/g, '""')}"`,
        s.salesCount,
        s.grossSalesXof,
        s.refundsXof,
        s.netSalesXof,
        s.cogsXof,
        s.grossMarginXof,
        s.expensesXof,
        s.estimatedNetProfitXof,
        s.isEstimated ? 'OUI' : 'NON',
      ].join(';'),
    );
    rows.push(
      [
        '"Dépenses communes entreprise"',
        0,
        0,
        0,
        0,
        0,
        0,
        report.totals.companyExpensesXof,
        -report.totals.companyExpensesXof,
        'NON',
      ].join(';'),
    );
    rows.push(
      [
        '"TOTAL CONSOLIDÉ"',
        report.totals.salesCount,
        report.totals.grossSalesXof,
        report.totals.refundsXof,
        report.totals.netSalesXof,
        report.totals.cogsXof,
        report.totals.grossMarginXof,
        report.totals.totalExpensesXof,
        report.totals.estimatedNetProfitXof,
        report.totals.isEstimated ? 'OUI' : 'NON',
      ].join(';'),
    );
    return '\uFEFF' + [headers.join(';'), ...rows].join('\n');
  }

  async exportConsolidatedPdf(merchantId: string, from?: string, to?: string): Promise<Buffer> {
    const [merchant, report] = await Promise.all([
      this.controlPrisma.merchant.findUniqueOrThrow({ where: { id: merchantId } }),
      this.computeConsolidatedReport(merchantId, from, to),
    ]);

    return new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks: Buffer[] = [];
      pdf.on('data', (c: Buffer) => chunks.push(c));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);

      pdf.fontSize(18).font('Helvetica-Bold').fillColor('#071A19').text(`Bilan Consolidé — ${merchant.name}`);
      pdf.fontSize(9.5).font('Helvetica').fillColor('#64748b').text(
        `Période du ${report.from.slice(0, 10)} au ${report.to.slice(0, 10)} · Devise : ${merchant.currency}`,
      );
      pdf.moveDown(1);

      const t = report.totals;
      pdf.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text('Synthèse Globale');
      pdf.moveDown(0.3);
      pdf.fontSize(10).font('Helvetica').fillColor('#334155');
      pdf.text(`Chiffre d’affaires brut : ${formatXof(t.grossSalesXof)} (${t.salesCount} vente(s))`);
      pdf.text(`Remboursements / Avoirs : -${formatXof(t.refundsXof)}`);
      pdf.font('Helvetica-Bold').text(`Chiffre d’affaires NET : ${formatXof(t.netSalesXof)}`);
      pdf.font('Helvetica').text(`Coût des marchandises vendues (CMP) : ${formatXof(t.cogsXof)}`);
      pdf.text(`Marge brute : ${formatXof(t.grossMarginXof)}`);
      pdf.text(`Dépenses boutiques : ${formatXof(t.shopsExpensesXof)} · Dépenses entreprise : ${formatXof(t.companyExpensesXof)}`);
      pdf.font('Helvetica-Bold').fillColor(t.estimatedNetProfitXof >= 0 ? '#047857' : '#dc2626').text(
        `Bénéfice net ${t.isEstimated ? 'estimé ' : ''}: ${formatXof(t.estimatedNetProfitXof)}`,
      );
      if (t.isEstimated) {
        pdf.fontSize(8.5).font('Helvetica-Oblique').fillColor('#b45309').text(
          `Note : bénéfice estimé (${t.missingCostProductsCount} produit(s) vendu(s) sans coût d’achat renseigné).`,
        );
      }
      pdf.fillColor('#334155').fontSize(9.5).font('Helvetica').text(
        `Stock en transit (ligne distincte, compté une seule fois) : ${t.inTransitQty} unité(s) · Valeur ${formatXof(t.inTransitValueXof)}`,
      );

      pdf.moveDown(1);
      pdf.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text('Ventilation par Boutique');
      pdf.moveDown(0.4);
      for (const s of report.byShop) {
        pdf.fontSize(10).font('Helvetica-Bold').fillColor('#071A19').text(s.shopName);
        pdf.fontSize(9).font('Helvetica').fillColor('#334155').text(
          `  Ventes : ${s.salesCount} · CA Net : ${formatXof(s.netSalesXof)} (Remb. -${formatXof(s.refundsXof)}) · Marge : ${formatXof(s.grossMarginXof)} · Dépenses : ${formatXof(s.expensesXof)} · Résultat : ${formatXof(s.estimatedNetProfitXof)}`,
        );
        pdf.moveDown(0.3);
      }

      pdf.end();
    });
  }
}

@ApiTags('Rapports & Bilans (Lot 4)')
@ApiBearerAuth()
@Controller()
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('shops/:shopId/reports/summary')
  @UseGuards(ShopScopeGuard)
  @Roles('OWNER')
  @ApiOperation({ summary: 'Bilan financier détaillé d’une boutique sur une période' })
  shopSummary(
    @Param('shopId') shopId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.computeShopSummary(shopId, from, to);
  }

  @Get('shops/:shopId/reports/daily')
  @UseGuards(ShopScopeGuard)
  @Roles('OWNER')
  @ApiOperation({ summary: 'Lister les bilans journaliers archivés et versionnés de la boutique' })
  listDaily(@Param('shopId') shopId: string) {
    return this.reportsService.listDailyReports(shopId);
  }

  @Post('shops/:shopId/reports/daily/generate')
  @UseGuards(ShopScopeGuard)
  @Roles('OWNER')
  @ApiOperation({ summary: 'Générer et archiver un bilan journalier (provisoire si caisse ouverte, définitif sinon)' })
  generateDaily(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(generateDailyReportSchema)) body: { reportDate?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reportsService.generateDailyReport(shopId, body.reportDate, user.userId);
  }

  @Get('merchant/reports/consolidated')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Bilan consolidé multi-boutiques (somme exacte + entreprise + stock en transit distinct)' })
  consolidated(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!user.merchantId) throw new ForbiddenException('Marchand requis.');
    return this.reportsService.computeConsolidatedReport(user.merchantId, from, to);
  }

  @Get('merchant/reports/export.csv')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Exporter le bilan consolidé au format CSV' })
  async exportCsv(
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!user.merchantId) throw new ForbiddenException('Marchand requis.');
    const csv = await this.reportsService.exportConsolidatedCsv(user.merchantId, from, to);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="bilan-shopcontrol.csv"');
    res.send(csv);
  }

  @Get('merchant/reports/export.pdf')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Exporter le bilan consolidé au format PDF' })
  async exportPdf(
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!user.merchantId) throw new ForbiddenException('Marchand requis.');
    const buf = await this.reportsService.exportConsolidatedPdf(user.merchantId, from, to);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="bilan-shopcontrol.pdf"');
    res.send(buf);
  }
}

@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
