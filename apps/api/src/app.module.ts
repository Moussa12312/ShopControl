import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './common/database/database.module';
import { RedisModule } from './common/redis/redis.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { TenantStatusGuard } from './common/guards/tenant-status.guard';
import { AuditCoreModule } from './modules/audit/audit.service';
import { AuditModule } from './modules/audit/audit.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { ShopsModule } from './modules/shops/shops.module';
import { MerchantsModule } from './modules/merchants/merchants.module';
import { AgentsModule } from './modules/agents/agents.module';
import { OperatorsModule } from './modules/operators/operators.module';
import { TerminalsModule } from './modules/terminals/terminals.module';
import { AdminModule } from './modules/admin/admin.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CashModule } from './modules/cash/cash.module';
import { PurchasesModule } from './modules/purchases/purchases.module';
import { ClientsModule } from './modules/clients/clients.module';
import { SalesModule } from './modules/sales/sales.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { ImportsModule } from './modules/imports/imports.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: process.env.NODE_ENV === 'test' ? 1000 : 120,
      },
    ]),
    DatabaseModule,
    RedisModule,
    AuditCoreModule,
    NotificationsModule,
    HealthModule,
    AuthModule,
    ShopsModule,
    MerchantsModule,
    AgentsModule,
    OperatorsModule,
    TerminalsModule,
    AdminModule,
    AuditModule,
    InventoryModule,
    CatalogModule,
    CashModule,
    PurchasesModule,
    ClientsModule,
    SalesModule,
    ExpensesModule,
    ImportsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: TenantStatusGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
