import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalHttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ShopDatabaseManagerService } from '../src/common/database/shop-database-manager.service';

process.env.NODE_ENV = 'test';

// 1x1 PNG pixel valide (magic bytes 89 50 4E 47 0D 0A 1A 0A)
const VALID_1PX_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('ShopControl Lots 3 à 7 + Correctifs — Recette intégrale (Documents, Multi-boutiques, E-commerce QR, Messagerie, Plateforme)', () => {
  let app: INestApplication;
  let shopDbManager: ShopDatabaseManagerService;

  const runId = crypto.randomBytes(3).toString('hex');
  const createdShopDbNames: string[] = [];
  const uploadedFilenames: string[] = [];

  let superAdminToken = '';
  let ownerToken = '';
  let merchantId = '';
  let shopAId = '';
  let shopASlug = '';
  let shopBId = '';
  let prodAId = '';
  let prodNoCostId = '';
  let sale1Id = '';
  let sale1DocId = '';
  let transferId = '';
  let transferItemId = '';
  let order1Id = '';
  let order1Number = '';
  let order1Token = '';
  let order2Id = '';
  let convId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    await app.init();

    shopDbManager = app.get(ShopDatabaseManagerService);

    const adminEmail = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL || 'admin@shopcontrol.local';
    const adminPassword = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD || 'ChangeMe!Admin2026';

    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: adminPassword })
      .expect(200);
    superAdminToken = adminLogin.body.accessToken;

    // 1. Créer marchand + Boutique A
    const mRes = await request(app.getHttpServer())
      .post('/api/v1/admin/merchants')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        merchantName: `Entreprise Lots37 ${runId}`,
        phone: '+22372220000',
        email: `lots37-${runId}@shop.ml`,
        ownerFullName: 'Proprio Lots37',
        ownerEmail: `owner-lots37-${runId}@shop.ml`,
        ownerPassword: 'Owner!Password2026',
        initialShopName: `Boutique A ${runId}`,
      })
      .expect(201);

    merchantId = mRes.body.merchant.id;
    shopAId = mRes.body.initialShop.id;
    shopASlug = mRes.body.initialShop.slug;
    createdShopDbNames.push(mRes.body.initialShop.dbName);

    const ownerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: `owner-lots37-${runId}@shop.ml`, password: 'Owner!Password2026' })
      .expect(200);
    ownerToken = ownerLogin.body.accessToken;

    // 2. Créer Boutique B pour tester multi-boutiques & transferts
    const shopBRes = await request(app.getHttpServer())
      .post('/api/v1/shops')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: `Boutique B ${runId}`,
        phone: '+22372220002',
        address: 'ACI 2000, Bamako',
      })
      .expect(201);

    shopBId = shopBRes.body.id;
    createdShopDbNames.push(shopBRes.body.dbName);
  }, 60000);

  afterAll(async () => {
    for (const dbName of createdShopDbNames) {
      await shopDbManager.dropShopDatabaseForTest(dbName).catch(() => undefined);
    }
    const uploadsDir = path.resolve(process.cwd(), '../../uploads');
    for (const filename of uploadedFilenames) {
      try {
        fs.unlinkSync(path.join(uploadsDir, filename));
      } catch {
        // ignore
      }
    }
    await app.close();
  });

  it('Upload sécurisé + Logo boutique + Produit créé directement avec photo', async () => {
    // Rejet faux contenu
    await request(app.getHttpServer())
      .post('/api/v1/uploads/image')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ dataUrl: 'data:image/png;base64,aGVsbG8gd29ybGQh', purpose: 'product' })
      .expect(400);

    // Upload logo valide
    const logoUp = await request(app.getHttpServer())
      .post('/api/v1/uploads/image')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ dataUrl: VALID_1PX_PNG_DATA_URL, purpose: 'logo' })
      .expect(201);

    expect(logoUp.body.url).toMatch(/^\/api\/v1\/uploads\/logo_.+\.png$/);
    uploadedFilenames.push(logoUp.body.filename);

    // Lecture publique du fichier téléversé
    const mediaRes = await request(app.getHttpServer()).get(logoUp.body.url).expect(200);
    expect(mediaRes.headers['content-type']).toContain('image/png');

    // Mise à jour Logo + Infos + Paramètres ticket & livraison de Boutique A
    const patchShop = await request(app.getHttpServer())
      .patch(`/api/v1/shops/${shopAId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        logoUrl: logoUp.body.url,
        address: 'Hamdallaye ACI 2000',
        receiptSettings: {
          slogan: 'Qualité Premium Bamako',
          headerText: 'Boutique A Officielle',
          footerText: 'Merci et à bientôt chez ShopControl !',
          legalNotice: 'Ticket justificatif non fiscal.',
          showLogo: true,
          paperWidthMm: 80,
        },
        deliveryConfig: {
          pickupEnabled: true,
          deliveryEnabled: true,
          defaultDeliveryFeeXof: 1500,
          deliveryZones: [{ name: 'Bamako Centre', feeXof: 1500 }],
          whatsappNumber: '+22372220001',
          maxOrderQty: 10,
          maxOrderAmountXof: 2000000,
        },
      })
      .expect(200);
    expect(patchShop.body.logoUrl).toBe(logoUp.body.url);

    // Upload photo produit + création produit avec imageUrl
    const prodImg = await request(app.getHttpServer())
      .post('/api/v1/uploads/image')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ dataUrl: VALID_1PX_PNG_DATA_URL, purpose: 'product' })
      .expect(201);
    uploadedFilenames.push(prodImg.body.filename);

    const pRes = await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopAId}/products`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Bazin Riche Getzner',
        sku: `BAZ-${runId}`,
        salePriceXof: 25000,
        costPriceXof: 15000,
        alertThreshold: 2,
        status: 'PUBLISHED',
        imageUrls: [prodImg.body.url],
      })
      .expect(201);
    prodAId = pRes.body.id;
    expect(pRes.body.imageUrls).toContain(prodImg.body.url);

    // Entrée de stock initiale de 10 unités dans Boutique A
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopAId}/stock/adjustments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        productId: prodAId,
        movementType: 'MANUAL_IN',
        quantityDelta: 10,
        reason: 'Stock initial de recette',
      })
      .expect(201);

    // Produit sans coût d'achat pour vérifier Critère #13 (bénéfice estimé)
    const pNoCost = await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopAId}/products`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Écharpe Artisanale',
        sku: `ECH-${runId}`,
        salePriceXof: 5000,
        costPriceXof: null,
        status: 'PUBLISHED',
      })
      .expect(201);
    prodNoCostId = pNoCost.body.id;

    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopAId}/stock/adjustments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        productId: prodNoCostId,
        movementType: 'MANUAL_IN',
        quantityDelta: 5,
        reason: 'Stock initial sans coût',
      })
      .expect(201);
  });

  it('Bug Remboursement + Lot 3 (Critères #11 & #25) : Vente -> Ticket -> 1re impression vs DUPLICATA -> PDF -> Remboursement déduit du CA Net + Avoir AV-*', async () => {
    // Ouvrir caisse Boutique A
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopAId}/cash/sessions/open`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ openingAmountXof: 50000 })
      .expect(201);

    // Vente 1 : 2 Bazin = 50 000 FCFA
    const s1 = await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopAId}/sales`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        lines: [{ productId: prodAId, quantity: 2 }],
        payments: [{ paymentMethodCode: 'CASH', amountXof: 50000 }],
      })
      .expect(201);
    sale1Id = s1.body.id;

    // Vente 2 : 1 Écharpe (sans coût) = 5 000 FCFA
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopAId}/sales`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        lines: [{ productId: prodNoCostId, quantity: 1 }],
        payments: [{ paymentMethodCode: 'CASH', amountXof: 5000 }],
      })
      .expect(201);

    // CA avant remboursement = 55 000
    const anaBefore = await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopAId}/analytics?period=monthly`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(anaBefore.body.kpis.currentSalesXof).toBe(55000);
    expect(anaBefore.body.kpis.refundsXof).toBe(0);
    expect(anaBefore.body.kpis.isEstimated).toBe(true); // produit sans coût vendu !

    // Lot 3 : Récupérer ticket de Vente 1
    const docsRes = await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopAId}/documents/by-sale/${sale1Id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const receiptDoc = docsRes.body.find((d: any) => d.documentType === 'SALE_RECEIPT');
    expect(receiptDoc).toBeDefined();
    sale1DocId = receiptDoc.id;

    // 1re impression -> original (isDuplicate: false), 2e impression -> DUPLICATA (isDuplicate: true)
    const p1 = await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopAId}/documents/${sale1DocId}/print`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);
    expect(p1.body.isDuplicate).toBe(false);
    expect(p1.body.printCount).toBe(1);

    const p2 = await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopAId}/documents/${sale1DocId}/print`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);
    expect(p2.body.isDuplicate).toBe(true);
    expect(p2.body.printCount).toBe(2);

    // Téléchargement PDF valide (%PDF-)
    const pdfRes = await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopAId}/documents/${sale1DocId}/pdf`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .buffer(true)
      .expect(200);
    expect(pdfRes.headers['content-type']).toContain('application/pdf');
    expect(pdfRes.body.slice(0, 5).toString('ascii')).toBe('%PDF-');

    // Remboursement partiel de 25 000 FCFA sur Vente 1 -> génère Avoir AV-* et déduit du CA Net !
    const refRes = await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopAId}/sales/${sale1Id}/refunds`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        amountXof: 25000,
        paymentMethodCode: 'CASH',
        reason: 'Client retourne 1 article non conforme',
      })
      .expect(201);
    expect(refRes.body.creditNoteNumber).toMatch(/^AV-/);

    // Vérifier que le CA Net a BIEN diminué à 30 000 FCFA (55 000 brut - 25 000 remboursé) !
    const anaAfter = await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopAId}/analytics?period=monthly`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(anaAfter.body.kpis.grossSalesXof).toBe(55000);
    expect(anaAfter.body.kpis.refundsXof).toBe(25000);
    expect(anaAfter.body.kpis.currentSalesXof).toBe(30000);

    // Vérifier que l'avoir apparaît dans les documents de la vente
    const docsAfter = await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopAId}/documents/by-sale/${sale1Id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const creditNotes = docsAfter.body.filter((d: any) => d.documentType === 'CREDIT_NOTE');
    expect(creditNotes.length).toBe(1);
  });

  it('Lot 4 (Critères #5, #12, #13, #20) : Transfert bloqué avant validation, En transit compté 1 fois, Réception avec écart + Rapport consolidé exact + Bilan journalier + Exports CSV/PDF', async () => {
    // Créer demande transfert A -> B (3 unités de Bazin)
    const trfRes = await request(app.getHttpServer())
      .post('/api/v1/transfers')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        sourceShopId: shopAId,
        destShopId: shopBId,
        notes: 'Réapprovisionnement Boutique B',
        items: [{ sourceProductId: prodAId, requestedQty: 3 }],
      })
      .expect(201);
    transferId = trfRes.body.id;
    transferItemId = trfRes.body.items[0].id;
    expect(trfRes.body.status).toBe('PENDING_APPROVAL');

    // Critère #5 : Impossible d'expédier avant validation Propriétaire !
    await request(app.getHttpServer())
      .post(`/api/v1/transfers/${transferId}/dispatch`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(403);

    // Validation Propriétaire -> Expédition (IN_TRANSIT)
    await request(app.getHttpServer())
      .post(`/api/v1/transfers/${transferId}/approve`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);

    const dispRes = await request(app.getHttpServer())
      .post(`/api/v1/transfers/${transferId}/dispatch`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);
    expect(dispRes.body.status).toBe('IN_TRANSIT');

    // Critère #12 : Consolidé pendant transit -> stock en transit = 3 unités comptées exactement 1 fois
    const consInTransit = await request(app.getHttpServer())
      .get('/api/v1/merchant/reports/consolidated')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(consInTransit.body.totals.inTransitQty).toBe(3);
    expect(consInTransit.body.totals.netSalesXof).toBe(30000);
    const sumShopNet = consInTransit.body.byShop.reduce((a: number, s: any) => a + s.netSalesXof, 0);
    expect(consInTransit.body.totals.netSalesXof).toBe(sumShopNet);

    // Critère #20 : Réception avec écart (2 reçus sur 3 expédiés)
    const recRes = await request(app.getHttpServer())
      .post(`/api/v1/transfers/${transferId}/receive`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        notes: '1 unité abîmée pendant transport',
        items: [{ itemId: transferItemId, receivedQty: 2, discrepancyReason: 'Colis déchiré' }],
      })
      .expect(201);
    expect(recRes.body.status).toBe('RECEIVED_WITH_DISCREPANCY');
    expect(recRes.body.hasDiscrepancy).toBe(true);

    // Bilan journalier versionné (caisse ouverte => PROVISIONAL)
    const daily1 = await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopAId}/reports/daily/generate`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(201);
    expect(daily1.body.status).toBe('PROVISIONAL');
    expect(daily1.body.version).toBe(1);

    // Export CSV & PDF
    const csvRes = await request(app.getHttpServer())
      .get('/api/v1/merchant/reports/export.csv')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(csvRes.text).toContain('TOTAL CONSOLIDÉ');

    const repPdf = await request(app.getHttpServer())
      .get('/api/v1/merchant/reports/export.pdf')
      .set('Authorization', `Bearer ${ownerToken}`)
      .buffer(true)
      .expect(200);
    expect(repPdf.body.slice(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('Lot 5 (Critères #6, #7, #8, #18, #19, #27, #28, #29) : QR permanent, Vitrine temps réel, Commande sans compte, Réservation/Libération stock, Conversion Vente, Suivi sécurisé & Anti-abus', async () => {
    // QR Code permanent
    const qrRes = await request(app.getHttpServer())
      .get(`/api/v1/public/shops/${shopASlug}/qr?origin=https://shopcontrol.test`)
      .expect(200);
    expect(qrRes.body.storefrontUrl).toBe(`https://shopcontrol.test/s/${shopASlug}`);
    expect(qrRes.body.pngDataUrl).toContain('data:image/png;base64,');
    expect(qrRes.body.svg).toContain('<svg');

    // Vitrine temps réel : stock disponible de Bazin = 10 - 2 (vente) - 3 (transfert) = 5
    const sf1 = await request(app.getHttpServer())
      .get(`/api/v1/public/shops/${shopASlug}/storefront`)
      .expect(200);
    const bazin1 = sf1.body.products.find((p: any) => p.id === prodAId);
    expect(bazin1.stockAvailable).toBe(5);
    expect(bazin1.imageUrls.length).toBeGreaterThan(0);

    // Commande client #1 sans compte (2 Bazin en livraison)
    const ord1 = await request(app.getHttpServer())
      .post(`/api/v1/public/shops/${shopASlug}/orders`)
      .send({
        clientName: 'Aminata Diallo',
        clientPhone: '+22376001122',
        fulfillmentMode: 'DELIVERY',
        deliveryAddress: 'Badalabougou Rue 14',
        deliveryDistrict: 'Bamako Centre',
        items: [{ productId: prodAId, quantity: 2 }],
      })
      .expect(201);
    order1Id = ord1.body.orderId;
    order1Number = ord1.body.orderNumber;
    order1Token = ord1.body.secretToken;
    expect(ord1.body.status).toBe('NEW');
    expect(ord1.body.totalXof).toBe(51500); // 2 * 25000 + 1500 livraison

    // Confirmer commande #1 -> stock réservé immédiatement (disponible passe de 5 à 3 !)
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopAId}/orders/${order1Id}/confirm`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);

    const sf2 = await request(app.getHttpServer())
      .get(`/api/v1/public/shops/${shopASlug}/storefront`)
      .expect(200);
    expect(sf2.body.products.find((p: any) => p.id === prodAId).stockAvailable).toBe(3);

    // Annuler commande #1 -> libère le stock réservé (disponible revient à 5 !)
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopAId}/orders/${order1Id}/status`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'CANCELLED', reason: 'Client a changé d’avis' })
      .expect(201);

    const sf3 = await request(app.getHttpServer())
      .get(`/api/v1/public/shops/${shopASlug}/storefront`)
      .expect(200);
    expect(sf3.body.products.find((p: any) => p.id === prodAId).stockAvailable).toBe(5);

    // Suivi via lien secret + Lookup minimal + Anti-bruteforce 5 échecs (Critère #28)
    const trackSecret = await request(app.getHttpServer())
      .get(`/api/v1/public/shops/${shopASlug}/orders/track?token=${order1Token}`)
      .expect(200);
    expect(trackSecret.body.order.orderNumber).toBe(order1Number);
    expect(trackSecret.body.order.status).toBe('CANCELLED');

    const trackMin = await request(app.getHttpServer())
      .post(`/api/v1/public/shops/${shopASlug}/orders/track-lookup`)
      .send({ orderNumber: order1Number, clientPhone: '+22376001122' })
      .expect(201);
    expect(trackMin.body.status).toBe('CANCELLED');
    expect(trackMin.body.clientPhone).toBeUndefined(); // minimal uniquement !

    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post(`/api/v1/public/shops/${shopASlug}/orders/track-lookup`)
        .send({ orderNumber: order1Number, clientPhone: '+22300000000' })
        .expect(404);
    }
    await request(app.getHttpServer())
      .post(`/api/v1/public/shops/${shopASlug}/orders/track-lookup`)
      .send({ orderNumber: order1Number, clientPhone: '+22300000000' })
      .expect(429);

    // Commande #2 -> Confirmer -> Remettre au client (Conversion en Vente + Ticket + Encaissement)
    const ord2 = await request(app.getHttpServer())
      .post(`/api/v1/public/shops/${shopASlug}/orders`)
      .send({
        clientName: 'Ibrahim Koné',
        clientPhone: '+22376009988',
        fulfillmentMode: 'PICKUP',
        items: [{ productId: prodAId, quantity: 1 }],
      })
      .expect(201);
    order2Id = ord2.body.orderId;

    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopAId}/orders/${order2Id}/confirm`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);

    const compRes = await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopAId}/orders/${order2Id}/complete`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ paymentMethodCode: 'CASH', amountPaidXof: 25000 })
      .expect(201);
    expect(compRes.body.sale.saleNumber).toMatch(/^VTE-/);
    expect(compRes.body.sale.totalXof).toBe(25000);

    // Bloquer un numéro abusif -> commande bloquée (403)
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopAId}/blocked-phones`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ phone: '+22379999999', reason: 'Fausses commandes répétées' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/public/shops/${shopASlug}/orders`)
      .send({
        clientName: 'Spammer',
        clientPhone: '+22379999999',
        fulfillmentMode: 'PICKUP',
        items: [{ productId: prodAId, quantity: 1 }],
      })
      .expect(403);
  });

  it('Lot 6 (Critères #9 & #10) & Lot 7 : Messagerie Client/Boutique (sans agent) + Filtrage liens + Abonnements, Paiements, Tickets Support & Annonces', async () => {
    // Client ouvre un chat public sur la vitrine (0 agent -> Propriétaire reçoit quand même !)
    const chatStart = await request(app.getHttpServer())
      .post(`/api/v1/public/shops/${shopASlug}/chat/start`)
      .send({
        clientName: 'Fatoumata Traoré',
        clientPhone: '+22375001122',
        message: 'Bonjour, est-ce disponible ? Voir http://spam.example.com',
      })
      .expect(201);
    convId = chatStart.body.conversationId;
    expect(chatStart.body.messages[0].body).toContain('[lien masqué]');

    // Propriétaire voit la conversation et répond
    const inbox = await request(app.getHttpServer())
      .get('/api/v1/messaging/conversations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(inbox.body.some((c: any) => c.id === convId)).toBe(true);

    await request(app.getHttpServer())
      .post(`/api/v1/messaging/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ body: 'Bonjour Fatoumata, oui il reste 4 pièces en boutique !' })
      .expect(201);

    // Lot 7 : Super Admin configure abonnement + paiement + annonce
    await request(app.getHttpServer())
      .put(`/api/v1/admin/merchants/${merchantId}/subscription`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        planCode: 'PRO',
        monthlyPriceXof: 35000,
        maxShops: 5,
        maxAgentsPerShop: 20,
        enabledModules: ['POS', 'INVENTORY', 'ECOMMERCE_QR', 'MULTI_SHOP', 'REPORTS', 'MESSAGING'],
      })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/admin/platform-payments')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        merchantId,
        amountXof: 35000,
        paymentMethodCode: 'ORANGE_MONEY',
        periodLabel: 'Novembre 2026',
        reference: `OM-SUB-${runId}`,
      })
      .expect(201);

    // Propriétaire consulte son abonnement & ouvre un ticket support
    const mySub = await request(app.getHttpServer())
      .get('/api/v1/merchant/subscription')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(mySub.body.subscription.planCode).toBe('PRO');
    expect(mySub.body.payments.length).toBe(1);

    const ticket = await request(app.getHttpServer())
      .post('/api/v1/support/tickets')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        subject: 'Demande imprimante thermique 58mm',
        priority: 'INFO',
        message: 'Bonjour, pouvez-vous conseiller un modèle Bluetooth compatible ?',
      })
      .expect(201);
    expect(ticket.body.ticketNumber).toMatch(/^TCK-/);

    // Super Admin répond au ticket et publie une annonce active
    await request(app.getHttpServer())
      .post(`/api/v1/support/tickets/${ticket.body.id}/reply`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ body: 'Oui, toutes les imprimantes ESC/POS 58mm/80mm sont compatibles.' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/admin/announcements')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        title: `Nouveauté Lots 3-7 ${runId}`,
        body: 'Vitrine QR, transferts et bilans PDF sont désormais disponibles.',
        priority: 'INFO',
        targetRole: 'ALL',
      })
      .expect(201);

    const ann = await request(app.getHttpServer())
      .get('/api/v1/announcements/active')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(ann.body.some((a: any) => a.title.includes(runId))).toBe(true);
  });
});
