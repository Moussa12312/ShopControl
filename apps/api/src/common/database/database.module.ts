import { Global, Module } from '@nestjs/common';
import { ControlPrismaService } from './control-prisma.service';
import { ShopDatabaseManagerService } from './shop-database-manager.service';

@Global()
@Module({
  providers: [ControlPrismaService, ShopDatabaseManagerService],
  exports: [ControlPrismaService, ShopDatabaseManagerService],
})
export class DatabaseModule {}
