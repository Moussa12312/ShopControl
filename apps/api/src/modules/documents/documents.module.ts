import * as fs from 'fs';
import * as path from 'path';
import {
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import PDFDocument from 'pdfkit';
import {
  DEFAULT_RECEIPT_SETTINGS,
  formatDateTimeInTimezone,
  formatXof,
} from '@shopcontrol/shared';
import { RequirePermissions, Roles } from '../../common/auth/auth.decorators';
import { ControlPrismaService } from '../../common/database/control-prisma.service';
import { ShopDatabaseManagerService } from '../../common/database/shop-database-manager.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ShopScopeGuard } from '../../common/guards/shop-scope.guard';

function resolveLocalUploadPath(url?: string | null): string | null {
  if (!url || !url.startsWith('/api/v1/uploads/')) return null;
  const filename = url.slice('/api/v1/uploads/'.length);
  if (!/^[a-z]+_[a-f0-9-]+\.(jpg|png|webp)$/.test(filename)) return null;
  const candidates = [
    path.resolve(process.cwd(), '../../uploads', filename),
    path.resolve(process.cwd(), 'uploads', filename),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly controlPrisma: ControlPrismaService,
    private readonly shopDbManager: ShopDatabaseManagerService,
  ) {}

  /**
   * Backfill automatique idempotent pour les ventes/remboursements créés avant la migration Lot 3,
   * garantissant qu'aucune vente historique ne reste sans justificatif imprimable (Critère #11).
   */
  async ensureDocumentsForSale(shopId: string, saleId: string) {
    const shop = await this.controlPrisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    const client = await this.shopDbManager.getClientForShop(shopId);
    const sale = await client.sale.findUnique({
      where: { id: saleId },
      include: {
        client: { select: { fullName: true, phone: true } },
        lines: true,
        payments: true,
        refunds: true,
        documents: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!sale) {
      throw new NotFoundException({ code: 'SALE_NOT_FOUND', message: 'Vente introuvable.' });
    }

    const receiptCfg = {
      ...DEFAULT_RECEIPT_SETTINGS,
      ...((shop.receiptSettings as Record<string, unknown>) || {}),
    };

    const shopSnap = {
      id: shop.id,
      name: shop.name,
      slug: shop.slug,
      logoUrl: shop.logoUrl,
      phone: shop.phone,
      email: shop.email,
      address: shop.address,
      currency: shop.currency,
      timezone: shop.timezone,
    };

    let hasReceipt = sale.documents.some((d) => d.documentType === 'SALE_RECEIPT');
    if (!hasReceipt) {
      await client.saleDocument.create({
        data: {
          documentNumber: sale.saleNumber,
          documentType: 'SALE_RECEIPT',
          saleId: sale.id,
          status: sale.status === 'CANCELLED' ? 'CANCELLED' : 'VALID',
          printCount: 0,
          snapshot: {
            shop: shopSnap,
            receiptSettings: receiptCfg,
            saleNumber: sale.saleNumber,
            issuedAt: sale.createdAt.toISOString(),
            client: sale.client,
            operatorName: sale.declaredOperatorName || 'Comptoir',
            lines: sale.lines.map((l) => ({
              productName: l.productName,
              sku: l.sku,
              quantity: l.quantity,
              unitLabel: l.unitLabel,
              soldInBulk: l.soldInBulk,
              bulkMultiplier: l.bulkMultiplier,
              fractionalQtyMilli: l.fractionalQtyMilli,
              serialNumber: l.serialNumber,
              warrantyEndsAt: l.warrantyEndsAt ? l.warrantyEndsAt.toISOString() : null,
              unitPriceXof: l.unitPriceXof,
              discountXof: l.discountXof,
              lineTotalXof: l.lineTotalXof,
            })),
            grossSubtotalXof: sale.grossSubtotalXof,
            discountTotalXof: sale.discountTotalXof,
            taxMode: sale.taxMode,
            taxRateBps: sale.taxRateBps,
            taxTotalXof: sale.taxTotalXof,
            roundingXof: sale.roundingXof,
            totalXof: sale.totalXof,
            paidAmountXof: sale.paidAmountXof,
            dueAmountXof: sale.dueAmountXof,
            payments: sale.payments.map((p) => ({
              paymentMethodCode: p.paymentMethodCode,
              amountXof: p.amountXof,
              transactionRef: p.transactionRef,
            })),
          } as object,
        },
      });
      hasReceipt = true;
    }

    for (const ref of sale.refunds) {
      const exists = sale.documents.some((d) => d.refundId === ref.id);
      if (!exists) {
        let cn = ref.creditNoteNumber;
        if (!cn) {
          const seqRows = await client.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('credit_note_number_seq')`;
          cn = `AV-${String(Number(seqRows[0].nextval)).padStart(6, '0')}`;
          await client.saleRefund.update({ where: { id: ref.id }, data: { creditNoteNumber: cn } });
        }
        await client.saleDocument.create({
          data: {
            documentNumber: cn,
            documentType: 'CREDIT_NOTE',
            saleId: sale.id,
            refundId: ref.id,
            status: 'VALID',
            printCount: 0,
            snapshot: {
              shop: shopSnap,
              receiptSettings: receiptCfg,
              creditNoteNumber: cn,
              originalSaleNumber: sale.saleNumber,
              issuedAt: ref.createdAt.toISOString(),
              client: sale.client,
              operatorName: ref.declaredOperatorName || 'Comptoir',
              amountXof: ref.amountXof,
              paymentMethodCode: ref.paymentMethodCode,
              transactionRef: ref.transactionRef,
              reason: ref.reason,
            } as object,
          },
        });
      }
    }

    const docs = await client.saleDocument.findMany({
      where: { saleId: sale.id },
      orderBy: { createdAt: 'asc' },
    });

    return docs.map((d) => this.serializeDoc(d, shop));
  }

  async listDocuments(shopId: string, params: { type?: string; search?: string; limit?: number }) {
    const shop = await this.controlPrisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    const client = await this.shopDbManager.getClientForShop(shopId);

    // Assure que les 20 dernières ventes ont bien leur document créé
    const recentSales = await client.sale.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, documents: { select: { id: true } } },
    });
    for (const s of recentSales) {
      if (s.documents.length === 0) {
        await this.ensureDocumentsForSale(shopId, s.id).catch(() => undefined);
      }
    }

    const where: Record<string, unknown> = {};
    if (params.type) where.documentType = params.type;
    if (params.search?.trim()) {
      where.documentNumber = { contains: params.search.trim(), mode: 'insensitive' };
    }

    const docs = await client.saleDocument.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, Math.max(1, params.limit || 50)),
    });

    return docs.map((d) => this.serializeDoc(d, shop));
  }

  async getDocument(shopId: string, documentId: string) {
    const shop = await this.controlPrisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    const client = await this.shopDbManager.getClientForShop(shopId);
    const doc = await client.saleDocument.findUnique({ where: { id: documentId } });
    if (!doc) {
      throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Justificatif introuvable.' });
    }
    return this.serializeDoc(doc, shop);
  }

  /**
   * Enregistre une impression : la 1re impression est l'original (`isDuplicate: false`),
   * toute réimpression suivante porte la mention « DUPLICATA » (Critère #25).
   */
  async recordPrint(shopId: string, documentId: string) {
    const shop = await this.controlPrisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    const client = await this.shopDbManager.getClientForShop(shopId);
    const existing = await client.saleDocument.findUnique({ where: { id: documentId } });
    if (!existing) {
      throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Justificatif introuvable.' });
    }

    const isDuplicate = existing.printCount >= 1;
    const updated = await client.saleDocument.update({
      where: { id: documentId },
      data: {
        printCount: { increment: 1 },
        lastPrintedAt: new Date(),
      },
    });

    return {
      ...this.serializeDoc(updated, shop),
      isDuplicate,
    };
  }

  async generatePdfBuffer(shopId: string, documentId: string): Promise<{ filename: string; buffer: Buffer }> {
    const docData = await this.getDocument(shopId, documentId);
    const snap = docData.snapshot as Record<string, any>;
    const shopInfo = snap.shop || {};
    const receiptCfg = { ...DEFAULT_RECEIPT_SETTINGS, ...(snap.receiptSettings || {}) };

    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({ size: 'A5', margin: 32 });
      const chunks: Buffer[] = [];
      pdf.on('data', (c: Buffer) => chunks.push(c));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);

      // Logo boutique si présent sur disque (JPEG/PNG supportés nativement par pdfkit)
      const logoPath = resolveLocalUploadPath(shopInfo.logoUrl);
      if (logoPath && !logoPath.endsWith('.webp') && receiptCfg.showLogo !== false) {
        try {
          pdf.image(logoPath, pdf.page.width / 2 - 28, 26, { fit: [56, 56], align: 'center' });
          pdf.moveDown(4.2);
        } catch {
          // ignore unreadable logo
        }
      }

      pdf.fontSize(15).font('Helvetica-Bold').fillColor('#071A19').text(shopInfo.name || 'ShopControl', { align: 'center' });
      if (receiptCfg.slogan) {
        pdf.fontSize(8.5).font('Helvetica-Oblique').fillColor('#475569').text(receiptCfg.slogan, { align: 'center' });
      }
      const contactLine = [shopInfo.address, shopInfo.phone, shopInfo.email].filter(Boolean).join(' · ');
      if (contactLine) {
        pdf.fontSize(8).font('Helvetica').fillColor('#64748b').text(contactLine, { align: 'center' });
      }

      pdf.moveDown(0.8);
      pdf.moveTo(32, pdf.y).lineTo(pdf.page.width - 32, pdf.y).strokeColor('#cbd5e1').stroke();
      pdf.moveDown(0.6);

      const title =
        docData.documentType === 'CREDIT_NOTE'
          ? 'AVOIR / JUSTIFICATIF DE REMBOURSEMENT'
          : 'TICKET DE CAISSE / JUSTIFICATIF DE VENTE';

      pdf.fontSize(10.5).font('Helvetica-Bold').fillColor('#0f172a').text(title, { align: 'center' });
      pdf.fontSize(10).font('Helvetica-Bold').text(`N° ${docData.documentNumber}`, { align: 'center' });

      if (docData.status === 'CANCELLED') {
        pdf.moveDown(0.3);
        pdf.fontSize(12).font('Helvetica-Bold').fillColor('#dc2626').text('*** ANNULÉ ***', { align: 'center' });
      }
      if (docData.isDuplicate) {
        pdf.moveDown(0.2);
        pdf.fontSize(10).font('Helvetica-Bold').fillColor('#b45309').text('DUPLICATA', { align: 'center' });
      }

      pdf.moveDown(0.6);
      pdf.fontSize(8.5).font('Helvetica').fillColor('#334155');
      pdf.text(`Date : ${formatDateTimeInTimezone(snap.issuedAt || docData.createdAt, shopInfo.timezone || 'Africa/Bamako')}`);
      if (snap.operatorName) pdf.text(`Opérateur : ${snap.operatorName}`);
      if (snap.client?.fullName) {
        pdf.text(`Client : ${snap.client.fullName}${snap.client.phone ? ` (${snap.client.phone})` : ''}`);
      }

      pdf.moveDown(0.6);
      pdf.moveTo(32, pdf.y).lineTo(pdf.page.width - 32, pdf.y).strokeColor('#e2e8f0').stroke();
      pdf.moveDown(0.5);

      if (docData.documentType === 'CREDIT_NOTE') {
        pdf.fontSize(9.5).font('Helvetica-Bold').fillColor('#0f172a');
        pdf.text(`Vente d’origine : ${snap.originalSaleNumber || '—'}`);
        pdf.moveDown(0.3);
        pdf.fontSize(9).font('Helvetica').fillColor('#334155');
        pdf.text(`Motif : ${snap.reason || 'Remboursement client'}`);
        pdf.text(`Mode : ${snap.paymentMethodCode || 'CASH'}${snap.transactionRef ? ` (Réf: ${snap.transactionRef})` : ''}`);
        pdf.moveDown(0.7);
        pdf.fontSize(13).font('Helvetica-Bold').fillColor('#dc2626');
        pdf.text(`MONTANT REMBOURSÉ : -${formatXof(snap.amountXof || 0)}`, { align: 'right' });
      } else {
        const lines = Array.isArray(snap.lines) ? snap.lines : [];
        for (const line of lines) {
          pdf.fontSize(9).font('Helvetica-Bold').fillColor('#0f172a').text(line.productName);
          pdf
            .fontSize(8.5)
            .font('Helvetica')
            .fillColor('#475569')
            .text(
              `  ${line.quantity} × ${formatXof(line.unitPriceXof)}${line.discountXof ? ` (-${formatXof(line.discountXof)})` : ''}`,
              { continued: true },
            )
            .font('Helvetica-Bold')
            .fillColor('#0f172a')
            .text(formatXof(line.lineTotalXof), { align: 'right' });
          if (line.serialNumber || line.warrantyEndsAt) {
            const parts: string[] = [];
            if (line.serialNumber) parts.push(`N° Série / IMEI : ${line.serialNumber}`);
            if (line.warrantyEndsAt) {
              const endStr = new Date(line.warrantyEndsAt).toLocaleDateString('fr-FR');
              parts.push(
                `Garantie${line.warrantyMonths ? ` (${line.warrantyMonths} mois)` : ''} jusqu'au ${endStr}`,
              );
            }
            pdf.fontSize(7.5).font('Helvetica-Oblique').fillColor('#0f766e').text(`  ${parts.join(' · ')}`);
          }
        }

        pdf.moveDown(0.5);
        pdf.moveTo(32, pdf.y).lineTo(pdf.page.width - 32, pdf.y).strokeColor('#cbd5e1').stroke();
        pdf.moveDown(0.5);

        pdf.fontSize(8.5).font('Helvetica').fillColor('#334155');
        pdf.text(`Sous-total brut : ${formatXof(snap.grossSubtotalXof || 0)}`, { align: 'right' });
        if ((snap.discountTotalXof || 0) > 0) {
          pdf.text(`Remise : -${formatXof(snap.discountTotalXof)}`, { align: 'right' });
        }
        if ((snap.taxTotalXof || 0) > 0) {
          pdf.text(`Taxes (${snap.taxMode}) : ${formatXof(snap.taxTotalXof)}`, { align: 'right' });
        }
        if ((snap.roundingXof || 0) !== 0) {
          pdf.text(`Arrondi espèces : ${snap.roundingXof > 0 ? '+' : ''}${formatXof(snap.roundingXof)}`, { align: 'right' });
        }
        pdf.moveDown(0.3);
        pdf.fontSize(12).font('Helvetica-Bold').fillColor('#071A19');
        pdf.text(`TOTAL : ${formatXof(snap.totalXof || 0)}`, { align: 'right' });

        pdf.moveDown(0.3);
        pdf.fontSize(8.5).font('Helvetica').fillColor('#334155');
        pdf.text(`Montant payé : ${formatXof(snap.paidAmountXof || 0)}`, { align: 'right' });
        if ((snap.dueAmountXof || 0) > 0) {
          pdf.fillColor('#b45309').text(`Solde dû (créance) : ${formatXof(snap.dueAmountXof)}`, { align: 'right' });
        }

        const payments = Array.isArray(snap.payments) ? snap.payments : [];
        if (payments.length > 0) {
          pdf.moveDown(0.4);
          pdf.fillColor('#475569').fontSize(8).text('Règlements :');
          for (const p of payments) {
            pdf.text(
              `• ${p.paymentMethodCode} : ${formatXof(p.amountXof)}${p.transactionRef ? ` (Réf: ${p.transactionRef})` : ''}`,
            );
          }
        }
      }

      pdf.moveDown(1.2);
      pdf.moveTo(32, pdf.y).lineTo(pdf.page.width - 32, pdf.y).strokeColor('#e2e8f0').stroke();
      pdf.moveDown(0.5);
      pdf.fontSize(8).font('Helvetica').fillColor('#475569').text(receiptCfg.footerText || '', { align: 'center' });
      pdf.moveDown(0.2);
      pdf.fontSize(7).fillColor('#94a3b8').text(
        receiptCfg.legalNotice || 'Ticket de caisse / Justificatif de vente — document non fiscal.',
        { align: 'center' },
      );

      pdf.end();
    });

    return {
      filename: `${docData.documentNumber}.pdf`,
      buffer,
    };
  }

  private serializeDoc(doc: any, shop: { logoUrl: string | null; name: string; phone: string | null; address: string | null; email: string | null }) {
    const snap = (doc.snapshot && typeof doc.snapshot === 'object' ? doc.snapshot : {}) as Record<string, any>;
    // Injecte les infos boutique à jour si logo ajouté après coup tout en gardant les lignes immuables
    const enrichedSnapshot = {
      ...snap,
      shop: {
        ...(snap.shop || {}),
        logoUrl: snap.shop?.logoUrl ?? shop.logoUrl,
      },
    };
    return {
      id: doc.id,
      documentNumber: doc.documentNumber,
      documentType: doc.documentType,
      saleId: doc.saleId,
      refundId: doc.refundId,
      status: doc.status,
      printCount: doc.printCount,
      isDuplicate: doc.printCount >= 1,
      lastPrintedAt: doc.lastPrintedAt ? doc.lastPrintedAt.toISOString() : null,
      snapshot: enrichedSnapshot,
      createdAt: doc.createdAt.toISOString(),
    };
  }
}

@ApiTags('Documents & Tickets (Lot 3)')
@ApiBearerAuth()
@Controller('shops/:shopId/documents')
@UseGuards(ShopScopeGuard, PermissionsGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('sales:read')
  @ApiOperation({ summary: 'Lister les justificatifs de vente et avoirs de la boutique' })
  list(
    @Param('shopId') shopId: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    return this.documentsService.listDocuments(shopId, {
      type,
      search,
      limit: limit ? Number(limit) : 50,
    });
  }

  @Get('by-sale/:saleId')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('sales:read')
  @ApiOperation({ summary: 'Récupérer le ticket de caisse et les avoirs liés à une vente' })
  bySale(@Param('shopId') shopId: string, @Param('saleId') saleId: string) {
    return this.documentsService.ensureDocumentsForSale(shopId, saleId);
  }

  @Get(':documentId')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('sales:read')
  @ApiOperation({ summary: 'Consulter le détail complet d’un justificatif' })
  getOne(@Param('shopId') shopId: string, @Param('documentId') documentId: string) {
    return this.documentsService.getDocument(shopId, documentId);
  }

  @Post(':documentId/print')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('sales:read')
  @ApiOperation({ summary: 'Enregistrer une impression (1re = original, suivantes = DUPLICATA)' })
  recordPrint(@Param('shopId') shopId: string, @Param('documentId') documentId: string) {
    return this.documentsService.recordPrint(shopId, documentId);
  }

  @Get(':documentId/pdf')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('sales:read')
  @ApiOperation({ summary: 'Télécharger le justificatif (ticket ou avoir) au format PDF' })
  async downloadPdf(
    @Param('shopId') shopId: string,
    @Param('documentId') documentId: string,
    @Res() res: Response,
  ) {
    const { filename, buffer } = await this.documentsService.generatePdfBuffer(shopId, documentId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(buffer);
  }
}

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
