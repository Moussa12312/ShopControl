import {
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createCategorySchema,
  createProductSchema,
  updateCategorySchema,
  updateProductSchema,
} from '@shopcontrol/shared';
import {
  CurrentOperator,
  CurrentUser,
  RequirePermissions,
  Roles,
} from '../../common/auth/auth.decorators';
import {
  AuthenticatedUser,
  DeclaredOperatorContext,
  RequestWithAuth,
} from '../../common/auth/request-context.types';
import { ShopDatabaseManagerService } from '../../common/database/shop-database-manager.service';
import { OperatorGuard } from '../../common/guards/operator.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ShopScopeGuard } from '../../common/guards/shop-scope.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from '../inventory/inventory.module';
import { RequestMeta } from '../auth/auth.service';

@Injectable()
export class CatalogService {
  constructor(
    private readonly shopDbManager: ShopDatabaseManagerService,
    private readonly inventoryService: InventoryService,
    private readonly auditService: AuditService,
  ) {}

  private canReadCosts(user: AuthenticatedUser, shopId: string): boolean {
    if (user.role === 'OWNER' || user.role === 'SUPER_ADMIN') return true;
    const access = user.shopAccesses.find((s) => s.shopId === shopId);
    return Boolean(access?.permissions['finance:read_margins']);
  }

  async listCategories(shopId: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const categories = await client.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: true } } },
    });
    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      sortOrder: c.sortOrder,
      isActive: c.isActive,
      productsCount: c._count.products,
    }));
  }

  async createCategory(
    shopId: string,
    input: { name: string; description?: string; sortOrder?: number },
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const existing = await client.category.findUnique({ where: { name: input.name } });
    if (existing) {
      throw new ConflictException({
        code: 'CATEGORY_EXISTS',
        message: `La catégorie « ${input.name} » existe déjà.`,
      });
    }
    return client.category.create({
      data: {
        name: input.name,
        description: input.description || null,
        sortOrder: input.sortOrder ?? 0,
      },
    });
  }

  async updateCategory(
    shopId: string,
    categoryId: string,
    input: { name?: string; description?: string; sortOrder?: number; isActive?: boolean },
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const existing = await client.category.findUnique({ where: { id: categoryId } });
    if (!existing) {
      throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND', message: 'Catégorie introuvable.' });
    }
    return client.category.update({
      where: { id: categoryId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
  }

  async listProducts(
    shopId: string,
    user: AuthenticatedUser,
    params: {
      search?: string;
      categoryId?: string;
      status?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(200, Math.max(1, params.limit || 50));
    const showCost = this.canReadCosts(user, shopId);

    const where: Record<string, unknown> = {};
    if (params.categoryId) where.categoryId = params.categoryId;
    if (params.status) where.status = params.status;
    if (params.search?.trim()) {
      const q = params.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { sku: { contains: q, mode: 'insensitive' } },
        { barcode: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, products] = await Promise.all([
      client.product.count({ where }),
      client.product.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          category: { select: { id: true, name: true } },
          variants: { where: { isActive: true }, orderBy: { name: 'asc' } },
          stockBalances: true,
        },
      }),
    ]);

    return {
      items: products.map((p) => {
        const baseBal = p.stockBalances.find((b) => b.variantKey === 'BASE');
        const stockPhysical = baseBal?.physicalQty ?? 0;
        const stockReserved = baseBal?.reservedQty ?? 0;
        return {
          id: p.id,
          name: p.name,
          sku: p.sku,
          barcode: p.barcode,
          description: p.description,
          categoryId: p.categoryId,
          categoryName: p.category?.name ?? null,
          unit: p.unit,
          salePriceXof: p.salePriceXof,
          costPriceXof: showCost ? p.costPriceXof : null,
          hasCostPrice: p.costPriceXof !== null,
          alertThreshold: p.alertThreshold,
          status: p.status,
          imageUrls: Array.isArray(p.imageUrls) ? p.imageUrls : [],
          availableSizes: Array.isArray(p.availableSizes) ? p.availableSizes : [],
          availableColors: Array.isArray(p.availableColors) ? p.availableColors : [],
          stockPhysical,
          stockReserved,
          stockAvailable: stockPhysical - stockReserved,
          variants: p.variants.map((v) => {
            const vBal = p.stockBalances.find((b) => b.variantKey === v.id);
            const vPhys = vBal?.physicalQty ?? 0;
            const vRes = vBal?.reservedQty ?? 0;
            return {
              id: v.id,
              name: v.name,
              sku: v.sku,
              barcode: v.barcode,
              salePriceXof: v.salePriceXof ?? p.salePriceXof,
              costPriceXof: showCost ? (v.costPriceXof ?? p.costPriceXof) : null,
              alertThreshold: v.alertThreshold,
              stockPhysical: vPhys,
              stockReserved: vRes,
              stockAvailable: vPhys - vRes,
            };
          }),
          createdAt: p.createdAt.toISOString(),
        };
      }),
      total,
      page,
      limit,
    };
  }

  async createProduct(
    shopId: string,
    input: any,
    user: AuthenticatedUser,
    operator: DeclaredOperatorContext | undefined,
    meta: RequestMeta,
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const dup = await client.product.findUnique({ where: { sku: input.sku } });
    if (dup) {
      throw new ConflictException({
        code: 'SKU_ALREADY_USED',
        message: `La référence SKU « ${input.sku} » existe déjà dans cette boutique.`,
      });
    }

    const created = await client.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          name: input.name,
          sku: input.sku,
          barcode: input.barcode || null,
          description: input.description || null,
          categoryId: input.categoryId ?? null,
          unit: input.unit || 'unité',
          salePriceXof: input.salePriceXof,
          costPriceXof: input.costPriceXof ?? null,
          alertThreshold: input.alertThreshold ?? 5,
          status: input.status || 'DRAFT',
          imageUrls: input.imageUrls || [],
          availableSizes: input.availableSizes || [],
          availableColors: input.availableColors || [],
          ...(input.variants?.length
            ? {
                variants: {
                  create: input.variants.map((v: any) => ({
                    name: v.name,
                    sku: v.sku || null,
                    barcode: v.barcode || null,
                    salePriceXof: v.salePriceXof ?? null,
                    costPriceXof: v.costPriceXof ?? null,
                    alertThreshold: v.alertThreshold ?? 5,
                    isActive: v.isActive ?? true,
                  })),
                },
              }
            : {}),
        },
        include: { variants: true },
      });

      if (input.initialStockQty && input.initialStockQty > 0) {
        await this.inventoryService.applyMovementInTx(tx, {
          productId: product.id,
          movementType: 'INITIAL_IMPORT',
          quantityDelta: input.initialStockQty,
          unitCostXof: product.costPriceXof,
          referenceType: 'PRODUCT_CREATE',
          referenceId: product.id,
          reason: 'Stock initial à la création du produit',
          actorUserId: user.userId,
          declaredOperatorId: operator?.id ?? null,
          declaredOperatorName: operator?.firstName ?? null,
        });
      }

      return product;
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: user.userId,
      actorRole: user.role,
      declaredOperatorId: operator?.id ?? null,
      declaredOperatorName: operator?.firstName ?? null,
      action: 'PRODUCT_CREATED',
      entityType: 'Product',
      entityId: created.id,
      afterData: {
        name: created.name,
        sku: created.sku,
        salePriceXof: created.salePriceXof,
        status: created.status,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return created;
  }

  async updateProduct(
    shopId: string,
    productId: string,
    input: any,
    user: AuthenticatedUser,
    operator: DeclaredOperatorContext | undefined,
    meta: RequestMeta,
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const existing = await client.product.findUnique({ where: { id: productId } });
    if (!existing) {
      throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Produit introuvable.' });
    }

    if (input.sku && input.sku !== existing.sku) {
      const dup = await client.product.findUnique({ where: { sku: input.sku } });
      if (dup) {
        throw new ConflictException({
          code: 'SKU_ALREADY_USED',
          message: `La référence SKU « ${input.sku} » est déjà utilisée.`,
        });
      }
    }

    const updated = await client.product.update({
      where: { id: productId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.sku !== undefined ? { sku: input.sku } : {}),
        ...(input.barcode !== undefined ? { barcode: input.barcode || null } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.salePriceXof !== undefined ? { salePriceXof: input.salePriceXof } : {}),
        ...(input.costPriceXof !== undefined ? { costPriceXof: input.costPriceXof } : {}),
        ...(input.alertThreshold !== undefined ? { alertThreshold: input.alertThreshold } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.imageUrls !== undefined ? { imageUrls: input.imageUrls } : {}),
        ...(input.availableSizes !== undefined ? { availableSizes: input.availableSizes } : {}),
        ...(input.availableColors !== undefined ? { availableColors: input.availableColors } : {}),
      },
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: user.userId,
      actorRole: user.role,
      declaredOperatorId: operator?.id ?? null,
      declaredOperatorName: operator?.firstName ?? null,
      action: 'PRODUCT_UPDATED',
      entityType: 'Product',
      entityId: productId,
      beforeData: {
        name: existing.name,
        salePriceXof: existing.salePriceXof,
        status: existing.status,
      },
      afterData: {
        name: updated.name,
        salePriceXof: updated.salePriceXof,
        status: updated.status,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return updated;
  }
}

@ApiTags('Catalogue Produits & Catégories')
@ApiBearerAuth()
@Controller('shops/:shopId')
@UseGuards(ShopScopeGuard, PermissionsGuard, OperatorGuard)
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('categories')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('products:read')
  @ApiOperation({ summary: 'Lister les catégories de la boutique' })
  listCategories(@Param('shopId') shopId: string) {
    return this.catalogService.listCategories(shopId);
  }

  @Post('categories')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('products:create')
  @ApiOperation({ summary: 'Créer une catégorie produit' })
  createCategory(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(createCategorySchema)) body: any,
  ) {
    return this.catalogService.createCategory(shopId, body);
  }

  @Patch('categories/:categoryId')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('products:update')
  @ApiOperation({ summary: 'Modifier une catégorie produit' })
  updateCategory(
    @Param('shopId') shopId: string,
    @Param('categoryId') categoryId: string,
    @Body(new ZodValidationPipe(updateCategorySchema)) body: any,
  ) {
    return this.catalogService.updateCategory(shopId, categoryId, body);
  }

  @Get('products')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('products:read')
  @ApiOperation({ summary: 'Lister les produits avec stock temps réel (coût masqué si non autorisé)' })
  listProducts(
    @Param('shopId') shopId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.catalogService.listProducts(shopId, user, {
      search,
      categoryId,
      status,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
  }

  @Post('products')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('products:create')
  @ApiOperation({ summary: 'Créer un produit dans la base dédiée de la boutique' })
  createProduct(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(createProductSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.catalogService.createProduct(shopId, body, user, operator, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Patch('products/:productId')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('products:update')
  @ApiOperation({ summary: 'Modifier un produit (sans jamais éditer directement le stock)' })
  updateProduct(
    @Param('shopId') shopId: string,
    @Param('productId') productId: string,
    @Body(new ZodValidationPipe(updateProductSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.catalogService.updateProduct(shopId, productId, body, user, operator, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }
}

@Module({
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
