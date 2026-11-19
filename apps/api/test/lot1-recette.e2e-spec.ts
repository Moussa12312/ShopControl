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

describe('ShopControl Lot 1 — Recette complète & Isolation BDD par boutique (E2E)', () => {
  let app: INestApplication;
  let controlPrisma: ControlPrismaService;
  let shopDbManager: ShopDatabaseManagerService;

  const runId = crypto.randomBytes(3).toString('hex');
  const createdShopDbNames: string[] = [];

  let superAdminToken = '';
  let merchant1Id = '';
  let owner1Token = '';
  let shopAId = '';
  let shopASlug = '';
  let shopADbName = '';
  let shopBId = '';
  let shopBDbName = '';

  let merchant2Id = '';
  let owner2Token = '';

  let agentAId = '';
  let agentAToken = '';
  let operatorAId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    await app.init();

    controlPrisma = app.get(ControlPrismaService);
    shopDbManager = app.get(ShopDatabaseManagerService);

    // Connexion du Super Admin initialisé par seed
    const adminEmail = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL || 'admin@shopcontrol.local';
    const adminPassword = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD || 'ChangeMe!Admin2026';

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: adminPassword })
      .expect(200);

    superAdminToken = loginRes.body.accessToken;
    expect(superAdminToken).toBeTruthy();
  });

  afterAll(async () => {
    for (const dbName of createdShopDbNames) {
      await shopDbManager.dropShopDatabaseForTest(dbName).catch(() => undefined);
    }
    await app.close();
  });

  it('provisionne un marchand, son propriétaire et une 1re boutique avec sa propre base PostgreSQL dédiée', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/admin/merchants')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        merchantName: `Établissements Diallo ${runId}`,
        phone: '+22370000001',
        email: `contact-${runId}@diallo.ml`,
        ownerFullName: 'Amadou Diallo',
        ownerEmail: `owner1-${runId}@diallo.ml`,
        ownerPassword: 'Owner1!Password2026',
        initialShopName: `Boutique Bamako Centre ${runId}`,
      })
      .expect(201);

    merchant1Id = res.body.merchant.id;
    shopAId = res.body.initialShop.id;
    shopASlug = res.body.initialShop.slug;
    shopADbName = res.body.initialShop.dbName;
    createdShopDbNames.push(shopADbName);

    expect(res.body.initialShop.dbStatus).toBe('READY');
    expect(shopADbName).toMatch(/^shopcontrol_shop_/);

    // Crée un second marchand pour vérifier l'isolation inter-marchands
    const res2 = await request(app.getHttpServer())
      .post('/api/v1/admin/merchants')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        merchantName: `Commerce Traoré ${runId}`,
        phone: '+22370000002',
        email: `contact-${runId}@traore.ml`,
        ownerFullName: 'Fatoumata Traoré',
        ownerEmail: `owner2-${runId}@traore.ml`,
        ownerPassword: 'Owner2!Password2026',
      })
      .expect(201);
    merchant2Id = res2.body.merchant.id;

    // Connexion des deux propriétaires
    const loginOwner1 = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: `owner1-${runId}@diallo.ml`, password: 'Owner1!Password2026' })
      .expect(200);
    owner1Token = loginOwner1.body.accessToken;

    const loginOwner2 = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: `owner2-${runId}@traore.ml`, password: 'Owner2!Password2026' })
      .expect(200);
    owner2Token = loginOwner2.body.accessToken;
  });

  it('Critère #2 : le Propriétaire crée une 2e boutique (2e BDD dédiée distincte) et consulte chaque boutique + consolidé', async () => {
    const createB = await request(app.getHttpServer())
      .post('/api/v1/shops')
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({
        name: `Boutique Kalaban ${runId}`,
        requireOperatorPin: false,
      })
      .expect(201);

    shopBId = createB.body.id;
    shopBDbName = createB.body.dbName;
    createdShopDbNames.push(shopBDbName);

    // Vérifie physiquement que Boutique A et Boutique B ont deux bases PostgreSQL DISTINCTES
    expect(shopBDbName).toBeTruthy();
    expect(shopBDbName).not.toBe(shopADbName);

    // Active le PIN opérateur obligatoire sur Boutique A
    await request(app.getHttpServer())
      .patch(`/api/v1/shops/${shopAId}`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({ requireOperatorPin: true })
      .expect(200);

    // Crée un opérateur déclaré dans la BDD de Boutique A uniquement
    const opRes = await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopAId}/operators`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({ firstName: 'Sékou', pin: '4321' })
      .expect(201);
    operatorAId = opRes.body.id;

    // Vérifie que la BDD de Boutique B ne contient aucun opérateur (isolation physique totale !)
    const opsInB = await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopBId}/operators`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .expect(200);
    expect(opsInB.body).toHaveLength(0);

    // Vue consolidée cohérente avec la somme des boutiques
    const consolidated = await request(app.getHttpServer())
      .get('/api/v1/merchant/overview')
      .set('Authorization', `Bearer ${owner1Token}`)
      .expect(200);

    expect(consolidated.body.totals.totalShops).toBe(2);
    expect(consolidated.body.totals.readyDatabases).toBe(2);
    expect(consolidated.body.totals.activeOperatorsCount).toBe(1);
    const sumOperators = consolidated.body.byShop.reduce(
      (acc: number, s: { activeOperatorsCount: number }) => acc + s.activeOperatorsCount,
      0,
    );
    expect(sumOperators).toBe(consolidated.body.totals.activeOperatorsCount);
  });

  it('Critères #1 & #16 : un Agent de Boutique A est refusé (403) par le serveur sur toute ressource de Boutique B', async () => {
    const agentRes = await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopAId}/agents`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({
        fullName: 'Caisse Principale A',
        email: `agent-a-${runId}@diallo.ml`,
        password: 'AgentA!Password2026',
        maxDiscountPercent: 5,
      })
      .expect(201);
    agentAId = agentRes.body.id;

    const loginAgent = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: `agent-a-${runId}@diallo.ml`, password: 'AgentA!Password2026' })
      .expect(200);
    agentAToken = loginAgent.body.accessToken;

    // Accès autorisé à sa propre boutique A
    await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopAId}/overview`)
      .set('Authorization', `Bearer ${agentAToken}`)
      .expect(200);

    // Accès direct API à Boutique B -> refus 403 strict côté serveur
    await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopBId}/overview`)
      .set('Authorization', `Bearer ${agentAToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopBId}/operators`)
      .set('Authorization', `Bearer ${agentAToken}`)
      .expect(403);

    // Isolation inter-marchands : Owner 2 ne peut pas accéder aux boutiques de Merchant 1
    await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopAId}/overview`)
      .set('Authorization', `Bearer ${owner2Token}`)
      .expect(403);
  });

  it('Critère #26 : opération sensible Agent exige opérateur déclaré + PIN (si activé) et l’inscrit dans le journal d’audit boutique', async () => {
    // Sans opérateur déclaré -> 400
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopAId}/terminals/register`)
      .set('Authorization', `Bearer ${agentAToken}`)
      .send({ deviceUid: `pos-device-${runId}-1`, label: 'Tablette Comptoir 1' })
      .expect(400);

    // Avec opérateur mais sans PIN (requireOperatorPin = true sur Boutique A) -> 403
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopAId}/terminals/register`)
      .set('Authorization', `Bearer ${agentAToken}`)
      .set('X-Operator-Id', operatorAId)
      .send({ deviceUid: `pos-device-${runId}-1`, label: 'Tablette Comptoir 1' })
      .expect(403);

    // Avec opérateur + mauvais PIN -> 403
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopAId}/terminals/register`)
      .set('Authorization', `Bearer ${agentAToken}`)
      .set('X-Operator-Id', operatorAId)
      .set('X-Operator-Pin', '9999')
      .send({ deviceUid: `pos-device-${runId}-1`, label: 'Tablette Comptoir 1' })
      .expect(403);

    // Avec opérateur + bon PIN -> 201 + plage de numérotation réservée Option B
    const termRes = await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopAId}/terminals/register`)
      .set('Authorization', `Bearer ${agentAToken}`)
      .set('X-Operator-Id', operatorAId)
      .set('X-Operator-Pin', '4321')
      .send({ deviceUid: `pos-device-${runId}-1`, label: 'Tablette Comptoir 1' })
      .expect(201);

    expect(termRes.body.terminal.prefix).toBe('T01');
    expect(termRes.body.activeReceiptRange.rangeStart).toBe(1);
    expect(termRes.body.activeReceiptRange.rangeEnd).toBe(200);

    // Vérifie que le journal d'audit (Control + Shop DB) contient bien l'opérateur déclaré "Sékou"
    const auditRes = await request(app.getHttpServer())
      .get(`/api/v1/audit-logs?shopId=${shopAId}&action=TERMINAL_REGISTERED`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .expect(200);

    expect(auditRes.body.items.length).toBeGreaterThanOrEqual(1);
    expect(auditRes.body.items[0].declaredOperatorName).toBe('Sékou');
    expect(auditRes.body.items[0].source).toBe('SHOP_DB');
  });

  it('Critère #14 : les journaux d’audit (Control DB et Shop DB) sont immuables au niveau PostgreSQL et leur chaîne SHA-256 est intègre', async () => {
    // Tentative de suppression directe SQL sur audit_logs -> bloquée par trigger PostgreSQL
    await expect(
      controlPrisma.$executeRawUnsafe('DELETE FROM audit_logs WHERE id IS NOT NULL'),
    ).rejects.toThrow(/immuables/i);

    // Tentative de modification directe SQL sur shop_audit_logs de Boutique A -> bloquée par trigger PostgreSQL
    const shopAClient = await shopDbManager.getClientForShop(shopAId);
    await expect(
      shopAClient.$executeRawUnsafe(
        "UPDATE shop_audit_logs SET action = 'TAMPERED' WHERE id IS NOT NULL",
      ),
    ).rejects.toThrow(/immuables/i);

    // Vérification cryptographique des chaînes SHA-256 via l'API
    const integrity = await request(app.getHttpServer())
      .get('/api/v1/audit-logs/verify-integrity')
      .set('Authorization', `Bearer ${owner1Token}`)
      .expect(200);

    expect(integrity.body.control.valid).toBe(true);
    expect(integrity.body.allValid).toBe(true);
  });

  it('Critère #29 & Section 8.1 : suspension boutique = lecture seule + vitrine indisponible + conservation des données ; changement de slug redirige', async () => {
    // Changement de slug -> redirection automatique de l'ancien slug
    const newSlug = `bamako-central-${runId}`;
    await request(app.getHttpServer())
      .patch(`/api/v1/shops/${shopAId}`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({ slug: newSlug })
      .expect(200);

    const oldSlugCheck = await request(app.getHttpServer())
      .get(`/api/v1/public/shops/${shopASlug}/status`)
      .expect(200);
    expect(oldSlugCheck.body.redirectToSlug).toBe(newSlug);

    // Suspension de Boutique A par Super Admin
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/shops/${shopAId}/status`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ status: 'SUSPENDED', reason: 'Vérification administrative temporaire' })
      .expect(200);

    // Vitrine publique indique indisponible
    const pubSuspended = await request(app.getHttpServer())
      .get(`/api/v1/public/shops/${newSlug}/status`)
      .expect(200);
    expect(pubSuspended.body.available).toBe(false);
    expect(pubSuspended.body.status).toBe('SUSPENDED');

    // Back-office Boutique A passe en lecture seule (GET OK, POST refusé 403)
    await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopAId}/operators`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .expect(200);

    const writeBlocked = await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopAId}/operators`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({ firstName: 'Modibo' })
      .expect(403);
    expect(writeBlocked.body.code).toBe('SHOP_SUSPENDED_READ_ONLY');

    // Réactivation -> toutes les données sont conservées intactes
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/shops/${shopAId}/status`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ status: 'ACTIVE', reason: 'Situation régularisée' })
      .expect(200);

    const opsAfterReactivate = await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopAId}/operators`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .expect(200);
    expect(opsAfterReactivate.body.some((o: { firstName: string }) => o.firstName === 'Sékou')).toBe(
      true,
    );
  });

  it('Sécurité Lot 1 : accès support Super Admin borné en lecture seule + notification Propriétaire ; reset MDP Agent révoque ses sessions', async () => {
    // Super Admin ne peut pas consulter les boutiques d'un marchand sans mandat d'assistance
    await request(app.getHttpServer())
      .get('/api/v1/merchant/overview')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(403);

    // Création d'un mandat d'assistance lecture seule
    const grantRes = await request(app.getHttpServer())
      .post('/api/v1/admin/support-access')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        merchantId: merchant1Id,
        reason: 'Diagnostic demandé par Amadou Diallo suite à question technique',
        durationMinutes: 30,
        readOnly: true,
      })
      .expect(201);

    const grantId = grantRes.body.id;

    // Avec le mandat -> lecture autorisée, écriture strictement refusée
    await request(app.getHttpServer())
      .get('/api/v1/merchant/overview')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('X-Support-Grant-Id', grantId)
      .expect(200);

    const supportWriteBlocked = await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopAId}/operators`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('X-Support-Grant-Id', grantId)
      .send({ firstName: 'Intrus' })
      .expect(403);
    expect(supportWriteBlocked.body.code).toBe('SUPPORT_ACCESS_READ_ONLY');

    // Le Propriétaire a reçu la notification de l'accès d'assistance
    const notifs = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${owner1Token}`)
      .expect(200);
    expect(
      notifs.body.items.some((n: { title: string }) => n.title.includes('assistance')),
    ).toBe(true);

    // Réinitialisation du mot de passe Agent par le Propriétaire -> révoque immédiatement le token existant de l'Agent
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopAId}/agents/${agentAId}/reset-password`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({ newPassword: 'AgentA!NewPass2026' })
      .expect(201);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${agentAToken}`)
      .expect(401);
  });
});
