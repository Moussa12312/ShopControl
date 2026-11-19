import * as crypto from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalHttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ShopDatabaseManagerService } from '../src/common/database/shop-database-manager.service';

process.env.NODE_ENV = 'test';

describe('ShopControl Lot 2 — Gestion Commerciale : Recette complète (Critères #3, #4, #17, #21, #22, #23, #24)', () => {
  let app: INestApplication;
  let shopDbManager: ShopDatabaseManagerService;

  const runId = crypto.randomBytes(3).toString('hex');
  const createdShopDbNames: string[] = [];

  let superAdminToken = '';
  let ownerToken = '';
  let shopId = '';
  let supplierId = '';
  let productId = '';
  let clientId = '';
  let cashSessionId = '';
  let saleId = '';
  let saleLineId = '';

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

    const mRes = await request(app.getHttpServer())
      .post('/api/v1/admin/merchants')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        merchantName: `Shop Lot2 ${runId}`,
        phone: '+22371110000',
        email: `lot2-${runId}@shop.ml`,
        ownerFullName: 'Moussa Lot2',
        ownerEmail: `owner-lot2-${runId}@shop.ml`,
        ownerPassword: 'Owner!Password2026',
        initialShopName: `Boutique Lot2 ${runId}`,
      })
      .expect(201);

    shopId = mRes.body.initialShop.id;
    createdShopDbNames.push(mRes.body.initialShop.dbName);

    const ownerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: `owner-lot2-${runId}@shop.ml`, password: 'Owner!Password2026' })
      .expect(200);
    ownerToken = ownerLogin.body.accessToken;
  });

  afterAll(async () => {
    for (const dbName of createdShopDbNames) {
      await shopDbManager.dropShopDatabaseForTest(dbName).catch(() => undefined);
    }
    await app.close();
  });

  it('Critère #4 & CMP : une commande fournisseur ne crédite pas le stock avant réception ; réception partielle crédite la quantité reçue et recalcule le CMP', async () => {
    const prodRes = await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/products`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Sac de Riz 25kg',
        sku: `RIZ25-${runId}`,
        salePriceXof: 12500,
        costPriceXof: null,
        alertThreshold: 2,
        status: 'PUBLISHED',
      })
      .expect(201);
    productId = prodRes.body.id;

    const supRes = await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/suppliers`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Grossiste Bamako', phone: '+22372223333' })
      .expect(201);
    supplierId = supRes.body.id;

    // Création commande fournisseur de 10 unités à 10 000 XOF
    const poRes = await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/purchases`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        supplierId,
        items: [{ productId, orderedQty: 10, unitCostXof: 10000 }],
      })
      .expect(201);

    const poId = poRes.body.id;
    const poItemId = poRes.body.items[0].id;

    // Stock doit toujours être à 0 avant réception !
    const prodsBefore = await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopId}/products`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(prodsBefore.body.items[0].stockPhysical).toBe(0);

    // Réception partielle de 4 unités à 10 000 XOF
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/purchases/${poId}/receive`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ items: [{ purchaseOrderItemId: poItemId, receivedQty: 4, unitCostXof: 10000 }] })
      .expect(201);

    // Réception complémentaire de 4 unités à 12 000 XOF -> nouveau CMP attendu = (4*10000 + 4*12000)/8 = 11 000 XOF
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/purchases/${poId}/receive`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ items: [{ purchaseOrderItemId: poItemId, receivedQty: 4, unitCostXof: 12000 }] })
      .expect(201);

    const prodsAfter = await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopId}/products`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(prodsAfter.body.items[0].stockPhysical).toBe(8);
    expect(prodsAfter.body.items[0].costPriceXof).toBe(11000);
  });

  it('Critères #3, #23, #24 : vente atomique XOF, référence Mobile Money obligatoire et unique, crédit client + créance', async () => {
    // Ouvre session de caisse avec 50 000 XOF
    const openCash = await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/cash/sessions/open`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ openingAmountXof: 50000 })
      .expect(201);
    cashSessionId = openCash.body.id;

    // Paiement Orange Money SANS référence -> refusé 400 (Critère #24)
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/sales`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        lines: [{ productId, quantity: 1 }],
        payments: [{ paymentMethodCode: 'ORANGE_MONEY', amountXof: 12500 }],
      })
      .expect(400);

    // Crée un client avec plafond crédit 20 000 XOF
    const clientRes = await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/clients`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ fullName: 'Ibrahim Koné', phone: `+22379${runId}`, creditLimitXof: 20000 })
      .expect(201);
    clientId = clientRes.body.id;

    // Vente de 2 sacs (25 000 XOF) : 15 000 XOF en Orange Money (réf unique) + 10 000 XOF en créance
    const saleRes = await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/sales`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        clientId,
        lines: [{ productId, quantity: 2 }],
        payments: [
          { paymentMethodCode: 'ORANGE_MONEY', amountXof: 15000, transactionRef: `OM-${runId}-01` },
        ],
      })
      .expect(201);

    saleId = saleRes.body.id;
    saleLineId = saleRes.body.lines[0].id;
    expect(saleRes.body.totalXof).toBe(25000);
    expect(saleRes.body.paidAmountXof).toBe(15000);
    expect(saleRes.body.dueAmountXof).toBe(10000);

    // Réutilisation de la même référence Mobile Money -> refusée 409 (Critère #24)
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/sales`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        lines: [{ productId, quantity: 1 }],
        payments: [
          { paymentMethodCode: 'ORANGE_MONEY', amountXof: 12500, transactionRef: `OM-${runId}-01` },
        ],
      })
      .expect(409);

    // Vérifie la créance créée et règle 10 000 XOF en espèces
    const recs = await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopId}/receivables`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(recs.body).toHaveLength(1);
    expect(recs.body[0].remainingAmountXof).toBe(10000);

    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/receivables/${recs.body[0].id}/payments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ amountXof: 10000, paymentMethodCode: 'CASH' })
      .expect(201);
  });

  it('Critère #22 : retour revendable réintègre le stock, non revendable = perte sans réintégration, remboursement plafonné à la vente', async () => {
    // Stock actuel = 8 - 2 = 6. Retourne 1 revendable (+1 -> 7) et 1 non revendable (+0 -> reste 7)
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/sales/${saleId}/returns`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        reason: 'Sac percé et retour client',
        items: [
          { saleLineId, quantity: 1, condition: 'RESELLABLE' },
          { saleLineId, quantity: 1, condition: 'DAMAGED_LOSS' },
        ],
      })
      .expect(201);

    const prods = await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopId}/products`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(prods.body.items[0].stockPhysical).toBe(7);

    // Remboursement supérieur au montant payé (25 000 XOF) -> refusé 400
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/sales/${saleId}/refunds`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ amountXof: 30000, paymentMethodCode: 'CASH', reason: 'Test dépassement' })
      .expect(400);

    // Remboursement valide de 5 000 XOF en espèces -> décaissement en caisse
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/sales/${saleId}/refunds`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ amountXof: 5000, paymentMethodCode: 'CASH', reason: 'Geste commercial sac abîmé' })
      .expect(201);
  });

  it('Critère #17 : deux ventes simultanées sur le dernier article -> une réussit, l’autre échoue (409), stock jamais négatif', async () => {
    const scarceProd = await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/products`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Dernier Article Rare',
        sku: `RARE-${runId}`,
        salePriceXof: 5000,
        initialStockQty: 1,
        status: 'PUBLISHED',
      })
      .expect(201);

    const reqBody = {
      lines: [{ productId: scarceProd.body.id, quantity: 1 }],
      payments: [{ paymentMethodCode: 'CASH', amountXof: 5000 }],
    };

    const [r1, r2] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/shops/${shopId}/sales`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(reqBody),
      request(app.getHttpServer())
        .post(`/api/v1/shops/${shopId}/sales`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(reqBody),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const check = await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopId}/products?search=RARE-${runId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(check.body.items[0].stockPhysical).toBe(0);
  });

  it('Critère #21 : clôture de caisse avec écart notifie le Propriétaire, est immuable et se corrige uniquement par régularisation motivée', async () => {
    // Solde théorique actuel : 50 000 + 10 000 (créance) - 5 000 (remboursement) + 5 000 (vente rare) = 60 000 XOF
    // Comptage saisi : 58 000 XOF -> écart = -2 000 XOF
    const closeRes = await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/cash/sessions/${cashSessionId}/close`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ countedAmountXof: 58000, notes: 'Clôture fin de journée' })
      .expect(201);

    expect(closeRes.body.theoreticalAmountXof).toBe(60000);
    expect(closeRes.body.discrepancyXof).toBe(-2000);

    // Clôture non modifiable : un mouvement normal échoue (409)
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/cash/sessions/${cashSessionId}/movements`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ type: 'MANUAL_IN', amountXof: 2000, reason: 'Tentative modif directe' })
      .expect(409);

    // Régularisation motivée autorisée
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/cash/sessions/${cashSessionId}/regularize`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        type: 'REGULARIZATION_OUT',
        amountXof: 2000,
        reason: 'Monnaie oubliée dans enveloppe transport',
      })
      .expect(201);

    // Notification d'écart de caisse bien envoyée au Propriétaire
    const notifs = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(
      notifs.body.items.some((n: { title: string }) => n.title.includes('Écart de caisse')),
    ).toBe(true);
  });

  it('Import CSV avec aperçu, erreurs ligne par ligne, commit et rollback complet', async () => {
    const csv = [
      'nom;sku;categorie;prix_vente;cout_achat;stock_initial',
      `Huile 1L;HUILE1-${runId};Alimentation;1500;1200;10`,
      `Produit Invalide;BAD-${runId};Alimentation;-50;100;5`,
    ].join('\n');

    const prev = await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/imports/preview`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ entityType: 'PRODUCTS', csvContent: csv, fileName: 'catalogue.csv' })
      .expect(201);
    expect(prev.body.validCount).toBe(1);
    expect(prev.body.errorCount).toBe(1);

    const committed = await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/imports/commit`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ entityType: 'PRODUCTS', csvContent: csv, fileName: 'catalogue.csv' })
      .expect(201);
    expect(committed.body.batch.importedCount).toBe(1);

    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/imports/${committed.body.batch.id}/rollback`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);

    const afterRollback = await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopId}/products?search=HUILE1-${runId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(afterRollback.body.items[0].status).toBe('ARCHIVED');
    expect(afterRollback.body.items[0].stockPhysical).toBe(0);
  });
});
