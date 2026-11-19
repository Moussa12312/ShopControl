import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import * as argon2 from 'argon2';
import {
  createOperatorSchema,
  updateOperatorSchema,
  verifyOperatorPinSchema,
} from '@shopcontrol/shared';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { AuthenticatedUser, RequestWithAuth } from '../../common/auth/request-context.types';
import { ShopDatabaseManagerService } from '../../common/database/shop-database-manager.service';
import { ShopScopeGuard } from '../../common/guards/shop-scope.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import { RequestMeta } from '../auth/auth.service';

@Injectable()
export class OperatorsService {
  constructor(
    private readonly shopDbManager: ShopDatabaseManagerService,
    private readonly auditService: AuditService,
  ) {}

  async list(shopId: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const operators = await client.shopOperator.findMany({
      orderBy: [{ isActive: 'desc' }, { firstName: 'asc' }],
    });

    return operators.map((op) => ({
      id: op.id,
      firstName: op.firstName,
      hasPin: Boolean(op.pinHash),
      isActive: op.isActive,
      createdAt: op.createdAt.toISOString(),
    }));
  }

  async create(
    shopId: string,
    input: { firstName: string; pin?: string },
    actor: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const pinHash =
      input.pin && input.pin.length > 0
        ? await argon2.hash(input.pin, { type: argon2.argon2id })
        : null;

    const created = await client.shopOperator.create({
      data: {
        firstName: input.firstName.trim(),
        pinHash,
        isActive: true,
      },
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'OPERATOR_CREATED',
      entityType: 'ShopOperator',
      entityId: created.id,
      afterData: { firstName: created.firstName, hasPin: Boolean(pinHash) },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return {
      id: created.id,
      firstName: created.firstName,
      hasPin: Boolean(created.pinHash),
      isActive: created.isActive,
      createdAt: created.createdAt.toISOString(),
    };
  }

  async update(
    shopId: string,
    operatorId: string,
    input: { firstName?: string; pin?: string | null; isActive?: boolean },
    actor: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const existing = await client.shopOperator.findUnique({ where: { id: operatorId } });
    if (!existing) {
      throw new NotFoundException({
        code: 'OPERATOR_NOT_FOUND',
        message: 'Opérateur déclaré introuvable dans cette boutique.',
      });
    }

    let nextPinHash: string | null | undefined = undefined;
    if (input.pin === null || input.pin === '') {
      nextPinHash = null;
    } else if (typeof input.pin === 'string') {
      nextPinHash = await argon2.hash(input.pin, { type: argon2.argon2id });
    }

    const updated = await client.shopOperator.update({
      where: { id: operatorId },
      data: {
        ...(input.firstName !== undefined ? { firstName: input.firstName.trim() } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(nextPinHash !== undefined ? { pinHash: nextPinHash } : {}),
      },
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'OPERATOR_UPDATED',
      entityType: 'ShopOperator',
      entityId: updated.id,
      beforeData: {
        firstName: existing.firstName,
        isActive: existing.isActive,
        hasPin: Boolean(existing.pinHash),
      },
      afterData: {
        firstName: updated.firstName,
        isActive: updated.isActive,
        hasPin: Boolean(updated.pinHash),
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return {
      id: updated.id,
      firstName: updated.firstName,
      hasPin: Boolean(updated.pinHash),
      isActive: updated.isActive,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  async verifyPin(
    shopId: string,
    input: { operatorId: string; pin: string },
    actor: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const operator = await client.shopOperator.findUnique({ where: { id: input.operatorId } });
    if (!operator || !operator.isActive) {
      throw new NotFoundException({
        code: 'OPERATOR_NOT_FOUND',
        message: 'Opérateur déclaré introuvable ou désactivé.',
      });
    }

    if (!operator.pinHash) {
      throw new BadRequestException({
        code: 'OPERATOR_PIN_NOT_SET',
        message: 'Aucun code PIN n’est défini pour cet opérateur.',
      });
    }

    const ok = await argon2.verify(operator.pinHash, input.pin).catch(() => false);
    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      declaredOperatorId: operator.id,
      declaredOperatorName: operator.firstName,
      action: ok ? 'OPERATOR_PIN_VERIFIED' : 'OPERATOR_PIN_FAILED',
      entityType: 'ShopOperator',
      entityId: operator.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    if (!ok) {
      throw new ForbiddenException({
        code: 'OPERATOR_PIN_INVALID',
        message: 'Code PIN opérateur incorrect.',
      });
    }

    return {
      verified: true,
      operator: { id: operator.id, firstName: operator.firstName },
    };
  }
}

@ApiTags('Opérateurs déclarés')
@ApiBearerAuth()
@Controller('shops/:shopId/operators')
@UseGuards(ShopScopeGuard)
export class OperatorsController {
  constructor(private readonly operatorsService: OperatorsService) {}

  @Get()
  @Roles('OWNER', 'AGENT')
  @ApiOperation({ summary: 'Lister les opérateurs déclarés (lus depuis la base dédiée de la boutique)' })
  list(@Param('shopId') shopId: string) {
    return this.operatorsService.list(shopId);
  }

  @Post()
  @Roles('OWNER')
  @ApiOperation({ summary: 'Ajouter un opérateur déclaré dans la base dédiée de la boutique' })
  create(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(createOperatorSchema)) body: { firstName: string; pin?: string },
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.operatorsService.create(shopId, body, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Patch(':operatorId')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Modifier ou désactiver un opérateur déclaré' })
  update(
    @Param('shopId') shopId: string,
    @Param('operatorId') operatorId: string,
    @Body(new ZodValidationPipe(updateOperatorSchema))
    body: { firstName?: string; pin?: string | null; isActive?: boolean },
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.operatorsService.update(shopId, operatorId, body, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Post('verify-pin')
  @Roles('OWNER', 'AGENT')
  @ApiOperation({ summary: 'Vérifier le code PIN d’un opérateur déclaré et journaliser la vérification' })
  verifyPin(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(verifyOperatorPinSchema)) body: { operatorId: string; pin: string },
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.operatorsService.verifyPin(shopId, body, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }
}

@Module({
  controllers: [OperatorsController],
  providers: [OperatorsService],
  exports: [OperatorsService],
})
export class OperatorsModule {}
