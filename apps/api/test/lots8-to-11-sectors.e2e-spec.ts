import * as crypto from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalHttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ControlPrismaService } from '../src/common/database/control-prisma.service';
import { ShopDatabaseManagerService } from '../src/common/database/shop-database-manager.service';

process.env.NODE_ENV = 'test';

describe('ShopControl Lots 8 à 11 — Profils Métiers Multi-Secteurs, Gros/Détail, Vente au montant, DLC FEFO, IMEI/Garantie & Vitrines adaptatives', () => {
  let app: INestApplication;
  let shopDbManager: ShopDatabaseManagerService;

  const runId = crypto.randomBytes(3).toString('hex');
  const createdShopDbNames: string[] = [];

  let superAdminToken = '';
  let ownerToken = '';
  let merchantId = '';

  let fashionShopId = '';
  let fashionSlug = '';

  let groceryShopId = '';
  let grocerySlug = '';

  let elecShopId = '';
  let elecSlug = '';

  let milkProductId = '';
  let sugarProductId = '';
  let yogurtProductId = '';
  let expiredBatchId = '';
  let soonBatchId = '';
  let phoneProductId = '';

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
        merchantName: `Groupe MultiSecteurs ${runId}`,
        phone: '+22376660000',
        email: `sectors-${runId}@shop.ml`,
        ownerFullName: 'Moussa MultiSecteurs',
        ownerEmail: `owner-sectors-${runId}@shop.ml`,
        ownerPassword: 'Owner!Password2026',
        initialShopName: `Mode Bamako ${runId}`,
      })
      .expect(201);

    merchantId = mRes.body.merchant.id;
    fashionShopId = mRes.body.initialShop.id;
    fashionSlug = mRes.body.initialShop.slug;
    createdShopDbNames.push(mRes.body.initialShop.dbName);

    const ownerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: `owner-sectors-${runId}@shop.ml`, password: 'Owner!Password2026' })
      .expect(200);
    ownerToken = ownerLogin.body.accessToken;
  }, 90000);

  afterAll(async () => {
    for (const dbName of createdShopDbNames) {
      await shopDbManager.dropShopDatabaseForTest(dbName).catch(() => undefined);
    }
    if (merchantId) {
      const controlPrisma = app.get(ControlPrismaService);
      await controlPrisma.merchant.delete({ where: { id: merchantId } }).catch(() => undefined);
    }
    await app?.close();
  }, 60000);

  it('[Lot 8] configure une boutique Mode (FASHION), crée une boutique Quartier (GROCERY) et une boutique Électronique (ELECTRONICS) avec presets et catégories suggérées', async () => {
    // 1. Passer la première boutique en FASHION
    const patchFashion = await request(app.getHttpServer())
      .patch(`/api/v1/shops/${fashionShopId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ shopType: 'FASHION' })
      .expect(200);

    expect(patchFashion.body.shopType).toBe('FASHION');
    expect(patchFashion.body.businessProfile.enableSizes).toBe(true);
    expect(patchFashion.body.businessProfile.enableColors).toBe(true);
    expect(patchFashion.body.businessProfile.enableMultiPhotos).toBe(true);
    expect(patchFashion.body.businessProfile.storefrontLayout).toBe('GALLERY');

    // Seed catégories suggérées Mode
    const seedFashionCats = await request(app.getHttpServer())
      .post(`/api/v1/shops/${fashionShopId}/categories/seed-suggested`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);
    expect(seedFashionCats.body.createdCount).toBeGreaterThanOrEqual(4);

    // 2. Créer une boutique de quartier (GROCERY)
    const createGrocery = await request(app.getHttpServer())
      .post('/api/v1/shops')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: `Alimentation Quartier ${runId}`,
        shopType: 'GROCERY',
      })
      .expect(201);

    groceryShopId = createGrocery.body.id;
    grocerySlug = createGrocery.body.slug;
    createdShopDbNames.push(createGrocery.body.dbName);

    const getGrocery = await request(app.getHttpServer())
      .get(`/api/v1/shops/${groceryShopId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(getGrocery.body.shopType).toBe('GROCERY');
    expect(getGrocery.body.businessProfile.enableSizes).toBe(false);
    expect(getGrocery.body.businessProfile.enableColors).toBe(false);
    expect(getGrocery.body.businessProfile.enableBulkUnits).toBe(true);
    expect(getGrocery.body.businessProfile.enableAmountSale).toBe(true);
    expect(getGrocery.body.businessProfile.enableExpiryTracking).toBe(true);
    expect(getGrocery.body.businessProfile.enableFastPosFavorites).toBe(true);
    expect(getGrocery.body.businessProfile.storefrontLayout).toBe('QUICK_LIST');

    // Seed catégories suggérées Alimentation
    const seedGroceryCats = await request(app.getHttpServer())
      .post(`/api/v1/shops/${groceryShopId}/categories/seed-suggested`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);
    expect(seedGroceryCats.body.createdCount).toBeGreaterThanOrEqual(5);

    // 3. Créer une boutique Électronique (ELECTRONICS)
    const createElec = await request(app.getHttpServer())
      .post('/api/v1/shops')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: `Tech & Mobile ${runId}`,
        shopType: 'ELECTRONICS',
      })
      .expect(201);

    elecShopId = createElec.body.id;
    elecSlug = createElec.body.slug;
    createdShopDbNames.push(createElec.body.dbName);

    // 4. Vérifier que /auth/me expose bien shopType et businessProfile sur les 3 boutiques
    const meRes = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const groceryInMe = meRes.body.shops.find((s: any) => s.shopId === groceryShopId);
    expect(groceryInMe.shopType).toBe('GROCERY');
    expect(groceryInMe.businessProfile.storefrontLayout).toBe('QUICK_LIST');
  }, 60000);

  it('[Lot 9 — Gros ↔ Détail] réceptionne 3 cartons de 24 boîtes (72 boîtes), recalcule le CMP détail, vend au détail puis au carton', async () => {
    // Ouvrir la caisse de la boutique de quartier
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${groceryShopId}/cash/sessions/open`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ openingAmountXof: 50000 })
      .expect(201);

    // Créer le produit Lait Bonnet Rouge (détail = boîte à 500 F, gros = carton de 24 à 11 000 F)
    const milkRes = await request(app.getHttpServer())
      .post(`/api/v1/shops/${groceryShopId}/products`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Lait Bonnet Rouge',
        sku: 'LAIT-BR-01',
        barcode: '6001234567890',
        unit: 'boîte',
        salePriceXof: 500,
        bulkUnitLabel: 'carton',
        unitsPerBulk: 24,
        bulkSalePriceXof: 11000,
        isPinnedPos: true,
        status: 'PUBLISHED',
        initialStockQty: 0,
      })
      .expect(201);
    milkProductId = milkRes.body.id;

    // Créer fournisseur & commande de 3 cartons à 9 600 F / carton
    const supRes = await request(app.getHttpServer())
      .post(`/api/v1/shops/${groceryShopId}/suppliers`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Grossiste Alimentaire Bamako', phone: '+22370112233' })
      .expect(201);

    const poRes = await request(app.getHttpServer())
      .post(`/api/v1/shops/${groceryShopId}/purchases`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        supplierId: supRes.body.id,
        items: [{ productId: milkProductId, orderedQty: 3, unitCostXof: 9600 }],
      })
      .expect(201);

    const poItemId = poRes.body.items[0].id;
    const futureExpiry = new Date(Date.now() + 90 * 86_400_000).toISOString();

    // Réceptionner les 3 cartons en cochant receivedInBulk = true (+ DLC)
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${groceryShopId}/purchases/${poRes.body.id}/receive`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        items: [
          {
            purchaseOrderItemId: poItemId,
            receivedQty: 3,
            unitCostXof: 9600,
            receivedInBulk: true,
            expiryDate: futureExpiry,
            batchNumber: 'LOT-LAIT-01',
          },
        ],
      })
      .expect(201);

    // Vérifier que le stock est de 3 * 24 = 72 boîtes et le CMP détail est de 9600 / 24 = 400 F
    const prodsAfterReceipt = await request(app.getHttpServer())
      .get(`/api/v1/shops/${groceryShopId}/products`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const milkAfterReceipt = prodsAfterReceipt.body.items.find((p: any) => p.id === milkProductId);
    expect(milkAfterReceipt.stockAvailable).toBe(72);
    expect(milkAfterReceipt.costPriceXof).toBe(400);
    expect(milkAfterReceipt.activeBatches.length).toBe(1);
    expect(milkAfterReceipt.activeBatches[0].remainingQty).toBe(72);

    // Vendre 2 boîtes au détail (2 * 500 = 1 000 F) -> stock passe à 70
    const retailSale = await request(app.getHttpServer())
      .post(`/api/v1/shops/${groceryShopId}/sales`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        lines: [{ productId: milkProductId, quantity: 2, soldInBulk: false }],
        payments: [{ paymentMethodCode: 'CASH', amountXof: 1000 }],
      })
      .expect(201);
    expect(retailSale.body.totalXof).toBe(1000);

    // Vendre 1 carton en gros (soldInBulk: true -> 11 000 F, déduit 24 boîtes) -> stock passe à 46
    const bulkSale = await request(app.getHttpServer())
      .post(`/api/v1/shops/${groceryShopId}/sales`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        lines: [{ productId: milkProductId, quantity: 1, soldInBulk: true }],
        payments: [{ paymentMethodCode: 'CASH', amountXof: 11000 }],
      })
      .expect(201);
    expect(bulkSale.body.totalXof).toBe(11000);
    expect(bulkSale.body.lines[0].soldInBulk).toBe(true);
    expect(bulkSale.body.lines[0].bulkMultiplier).toBe(24);

    const prodsAfterSales = await request(app.getHttpServer())
      .get(`/api/v1/shops/${groceryShopId}/products`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const milkAfterSales = prodsAfterSales.body.items.find((p: any) => p.id === milkProductId);
    expect(milkAfterSales.stockAvailable).toBe(46);
    expect(milkAfterSales.activeBatches[0].remainingQty).toBe(46);
  });

  it('[Lot 9 — Vente au montant / fraction] vend "250 FCFA de sucre" (0,25 kg sur 10 kg à 1 000 F/kg) avec précision au millième et réintègre à l’annulation', async () => {
    const sugarRes = await request(app.getHttpServer())
      .post(`/api/v1/shops/${groceryShopId}/products`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Sucre en poudre',
        sku: 'SUCRE-KG',
        unit: 'kg',
        salePriceXof: 1000,
        costPriceXof: 700,
        allowFractionalSale: true,
        isPinnedPos: true,
        status: 'PUBLISHED',
        initialStockQty: 10,
      })
      .expect(201);
    sugarProductId = sugarRes.body.id;

    // 1. Vendre pour 250 FCFA de sucre (= 0,250 kg)
    const sale250 = await request(app.getHttpServer())
      .post(`/api/v1/shops/${groceryShopId}/sales`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        lines: [{ productId: sugarProductId, quantity: 1, customAmountXof: 250 }],
        payments: [{ paymentMethodCode: 'CASH', amountXof: 250 }],
      })
      .expect(201);

    expect(sale250.body.totalXof).toBe(250);
    expect(sale250.body.lines[0].fractionalQtyMilli).toBe(250);
    expect(sale250.body.lines[0].productName).toContain('0,25 kg');

    // Vérifier le stock exact : 9.75 kg (physicalQty = 9, stockRemainderMilli = 750)
    let prods = await request(app.getHttpServer())
      .get(`/api/v1/shops/${groceryShopId}/products`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    let sugar = prods.body.items.find((p: any) => p.id === sugarProductId);
    expect(sugar.stockPhysical).toBe(9);
    expect(sugar.stockRemainderMilli).toBe(750);
    expect(sugar.stockAvailableDecimal).toBe(9.75);

    // 2. Vendre encore pour 500 FCFA de sucre (= 0,500 kg) -> reste 9.25 kg
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${groceryShopId}/sales`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        lines: [{ productId: sugarProductId, quantity: 1, customAmountXof: 500 }],
        payments: [{ paymentMethodCode: 'CASH', amountXof: 500 }],
      })
      .expect(201);

    prods = await request(app.getHttpServer())
      .get(`/api/v1/shops/${groceryShopId}/products`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    sugar = prods.body.items.find((p: any) => p.id === sugarProductId);
    expect(sugar.stockPhysical).toBe(9);
    expect(sugar.stockRemainderMilli).toBe(250);
    expect(sugar.stockAvailableDecimal).toBe(9.25);

    // 3. Annuler la vente de 250 F -> le stock remonte exactement à 9.5 kg !
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${groceryShopId}/sales/${sale250.body.id}/cancel`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'Erreur saisie montant sucre', refundCashFromDrawer: true })
      .expect(201);

    prods = await request(app.getHttpServer())
      .get(`/api/v1/shops/${groceryShopId}/products`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    sugar = prods.body.items.find((p: any) => p.id === sugarProductId);
    expect(sugar.stockPhysical).toBe(9);
    expect(sugar.stockRemainderMilli).toBe(500);
    expect(sugar.stockAvailableDecimal).toBe(9.5);
  });

  it('[Lot 10 — DLC & Lots FEFO] remonte les alertes de péremption, met au rebut un lot périmé en perte, et applique le FEFO sur les ventes', async () => {
    const expiredDate = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const soonDate = new Date(Date.now() + 5 * 86_400_000).toISOString();

    // Créer Yaourt avec un lot initial déjà périmé (5 pots)
    const yogRes = await request(app.getHttpServer())
      .post(`/api/v1/shops/${groceryShopId}/products`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Yaourt Nature Danone',
        sku: 'YAO-DAN-01',
        unit: 'pot',
        salePriceXof: 350,
        costPriceXof: 225,
        expiryDate: expiredDate,
        batchNumber: 'LOT-EXP-01',
        initialStockQty: 5,
        status: 'PUBLISHED',
      })
      .expect(201);
    yogurtProductId = yogRes.body.id;

    // Ajouter un 2e lot frais (10 pots, expire dans 5 jours)
    const batch2Res = await request(app.getHttpServer())
      .post(`/api/v1/shops/${groceryShopId}/stock/batches`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        productId: yogurtProductId,
        batchNumber: 'LOT-FRAIS-02',
        expiryDate: soonDate,
        quantity: 10,
      })
      .expect(201);
    soonBatchId = batch2Res.body.id;

    // Consulter les alertes DLC
    const alertsRes = await request(app.getHttpServer())
      .get(`/api/v1/shops/${groceryShopId}/stock/expiry-alerts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(alertsRes.body.summary.expiredCount).toBeGreaterThanOrEqual(1);
    expect(alertsRes.body.summary.expiring7dCount).toBeGreaterThanOrEqual(1);

    const expiredItem = alertsRes.body.items.find(
      (i: any) => i.productId === yogurtProductId && i.severity === 'EXPIRED',
    );
    expect(expiredItem).toBeDefined();
    expiredBatchId = expiredItem.batchId;

    // Mettre au rebut le lot périmé (5 pots retirés du stock en perte)
    const writeOffRes = await request(app.getHttpServer())
      .post(`/api/v1/shops/${groceryShopId}/stock/batches/${expiredBatchId}/write-off`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'Lot dépassé de 3 jours retiré du frigo' })
      .expect(201);

    expect(writeOffRes.body.status).toBe('WRITTEN_OFF');
    expect(writeOffRes.body.stockDeductedQty).toBe(5);

    // Vendre 4 pots -> doit déduire du lot restant (LOT-FRAIS-02 passe de 10 à 6)
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${groceryShopId}/sales`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        lines: [{ productId: yogurtProductId, quantity: 4 }],
        payments: [{ paymentMethodCode: 'CASH', amountXof: 1400 }],
      })
      .expect(201);

    const alertsAfter = await request(app.getHttpServer())
      .get(`/api/v1/shops/${groceryShopId}/stock/expiry-alerts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const remainingBatch = alertsAfter.body.items.find((i: any) => i.batchId === soonBatchId);
    expect(remainingBatch.remainingQty).toBe(6);
  });

  it('[Lot 10 — Électronique IMEI & Garantie] exige le N° de série, calcule la fin de garantie sur le ticket PDF et retrouve la vente en SAV par IMEI', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${elecShopId}/cash/sessions/open`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ openingAmountXof: 100000 })
      .expect(201);

    const phoneRes = await request(app.getHttpServer())
      .post(`/api/v1/shops/${elecShopId}/products`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Samsung Galaxy A55 5G',
        sku: 'SAM-A55-256',
        brand: 'Samsung',
        modelName: 'SM-A556E 256Go',
        unit: 'pièce',
        salePriceXof: 215000,
        costPriceXof: 175000,
        warrantyMonths: 12,
        trackSerialNumber: true,
        status: 'PUBLISHED',
        initialStockQty: 3,
      })
      .expect(201);
    phoneProductId = phoneRes.body.id;

    // 1. Tenter de vendre sans IMEI -> refus 400 SERIAL_NUMBER_REQUIRED
    const failNoSerial = await request(app.getHttpServer())
      .post(`/api/v1/shops/${elecShopId}/sales`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        lines: [{ productId: phoneProductId, quantity: 1 }],
        payments: [{ paymentMethodCode: 'CASH', amountXof: 215000 }],
      })
      .expect(400);
    expect(failNoSerial.body.code).toBe('SERIAL_NUMBER_REQUIRED');

    // 2. Vendre avec IMEI valide
    const imei = '359881009911223';
    const saleElec = await request(app.getHttpServer())
      .post(`/api/v1/shops/${elecShopId}/sales`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        lines: [{ productId: phoneProductId, quantity: 1, serialNumber: imei }],
        payments: [{ paymentMethodCode: 'CASH', amountXof: 215000 }],
      })
      .expect(201);

    expect(saleElec.body.lines[0].serialNumber).toBe(imei);
    expect(saleElec.body.lines[0].warrantyEndsAt).toBeTruthy();

    // 3. Vérifier le snapshot et le PDF du ticket de caisse
    const docsRes = await request(app.getHttpServer())
      .get(`/api/v1/shops/${elecShopId}/documents/by-sale/${saleElec.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const receiptDoc = docsRes.body[0];
    expect(receiptDoc.snapshot.lines[0].serialNumber).toBe(imei);
    expect(receiptDoc.snapshot.lines[0].warrantyEndsAt).toBeTruthy();

    const pdfRes = await request(app.getHttpServer())
      .get(`/api/v1/shops/${elecShopId}/documents/${receiptDoc.id}/pdf`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(pdfRes.headers['content-type']).toContain('application/pdf');

    // 4. Recherche SAV par numéro IMEI
    const savSearch = await request(app.getHttpServer())
      .get(`/api/v1/shops/${elecShopId}/sales?serial=9911223`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(savSearch.body.items.length).toBe(1);
    expect(savSearch.body.items[0].id).toBe(saleElec.body.id);
  });

  it('[Lot 11 — Vitrines adaptatives & Commande publique en gros] expose le layout adapté et traite une commande vitrine au Carton de bout en bout', async () => {
    // 1. Vérifier les 3 vitrines publiques
    const [sfFashion, sfGrocery, sfElec] = await Promise.all([
      request(app.getHttpServer()).get(`/api/v1/public/shops/${fashionSlug}/storefront`).expect(200),
      request(app.getHttpServer()).get(`/api/v1/public/shops/${grocerySlug}/storefront`).expect(200),
      request(app.getHttpServer()).get(`/api/v1/public/shops/${elecSlug}/storefront`).expect(200),
    ]);

    expect(sfFashion.body.shop.businessProfile.storefrontLayout).toBe('GALLERY');
    expect(sfGrocery.body.shop.businessProfile.storefrontLayout).toBe('QUICK_LIST');
    expect(sfElec.body.shop.businessProfile.storefrontLayout).toBe('TECH_SPEC');

    const publicMilk = sfGrocery.body.products.find((p: any) => p.id === milkProductId);
    expect(publicMilk.bulkUnitLabel).toBe('carton');
    expect(publicMilk.unitsPerBulk).toBe(24);
    expect(publicMilk.bulkSalePriceXof).toBe(11000);
    expect(publicMilk.stockAvailable).toBe(46);

    const publicPhone = sfElec.body.products.find((p: any) => p.id === phoneProductId);
    expect(publicPhone.brand).toBe('Samsung');
    expect(publicPhone.modelName).toBe('SM-A556E 256Go');
    expect(publicPhone.warrantyMonths).toBe(12);

    // 2. Passer une commande vitrine sur l'épicerie pour 1 Carton de Lait (soldInBulk: true)
    const orderRes = await request(app.getHttpServer())
      .post(`/api/v1/public/shops/${grocerySlug}/orders`)
      .send({
        clientName: 'Aminata Traoré',
        clientPhone: '+22379998877',
        fulfillmentMode: 'PICKUP',
        items: [{ productId: milkProductId, quantity: 1, soldInBulk: true }],
      })
      .expect(201);

    expect(orderRes.body.totalXof).toBe(11000);
    expect(orderRes.body.lines[0].soldInBulk).toBe(true);
    expect(orderRes.body.lines[0].bulkMultiplier).toBe(24);

    // 3. Confirmer la commande -> réserve 24 boîtes (stock dispo sur vitrine passe de 46 à 22)
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${groceryShopId}/orders/${orderRes.body.orderId}/confirm`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);

    const sfAfterConfirm = await request(app.getHttpServer())
      .get(`/api/v1/public/shops/${grocerySlug}/storefront`)
      .expect(200);
    const milkAfterConfirm = sfAfterConfirm.body.products.find((p: any) => p.id === milkProductId);
    expect(milkAfterConfirm.stockAvailable).toBe(22);

    // 4. Finaliser & encaisser la commande en vente -> déduit physiquement les 24 boîtes
    const completeRes = await request(app.getHttpServer())
      .post(`/api/v1/shops/${groceryShopId}/orders/${orderRes.body.orderId}/complete`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        paymentMethodCode: 'CASH',
        amountPaidXof: 11000,
      })
      .expect(201);

    expect(completeRes.body.sale.totalXof).toBe(11000);

    const prodsEnd = await request(app.getHttpServer())
      .get(`/api/v1/shops/${groceryShopId}/products`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const milkEnd = prodsEnd.body.items.find((p: any) => p.id === milkProductId);
    expect(milkEnd.stockPhysical).toBe(22);
    expect(milkEnd.stockReserved).toBe(0);
    expect(milkEnd.stockAvailable).toBe(22);
  });
});
