import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as argon2 from 'argon2';
import { REQUIRE_OPERATOR_KEY, REQUIRE_OPERATOR_SENSITIVE_KEY } from '../auth/auth.decorators';
import { ControlPrismaService } from '../database/control-prisma.service';
import { ShopDatabaseManagerService } from '../database/shop-database-manager.service';
import { RequestWithAuth } from '../auth/request-context.types';

/**
 * Valide l'opérateur déclaré dans la base dédiée de la boutique (Section 4.3, Critère #26).
 * Pour un compte Agent partagé :
 * - Enregistre l'opérateur déclaré sur le contexte requête pour le journal d'audit
 * - Exige un PIN valide si l'opération est sensible et que `shop.requireOperatorPin` est activé
 */
@Injectable()
export class OperatorGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly controlPrisma: ControlPrismaService,
    private readonly shopDbManager: ShopDatabaseManagerService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithAuth>();
    const user = req.user;
    if (!user) {
      return true;
    }

    const requireSensitive = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_OPERATOR_SENSITIVE_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requireOperator =
      requireSensitive ||
      this.reflector.getAllAndOverride<boolean>(REQUIRE_OPERATOR_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);

    const operatorId = req.header('x-operator-id')?.trim();
    const shopId = req.resolvedShopId || (req.params?.shopId as string | undefined);

    if (!shopId) {
      return true;
    }

    // Le Propriétaire travaille en son nom propre sans obligation d'opérateur déclaré
    if (user.role !== 'AGENT' && !operatorId) {
      return true;
    }

    if (!operatorId) {
      if (requireOperator) {
        throw new BadRequestException({
          code: 'OPERATOR_REQUIRED',
          message: 'Veuillez sélectionner l’opérateur déclaré avant d’effectuer cette action.',
        });
      }
      return true;
    }

    const shopClient = await this.shopDbManager.getClientForShop(shopId);
    const operator = await shopClient.shopOperator.findUnique({
      where: { id: operatorId },
    });

    if (!operator || !operator.isActive) {
      throw new ForbiddenException({
        code: 'OPERATOR_INVALID',
        message: 'L’opérateur déclaré sélectionné est introuvable ou désactivé pour cette boutique.',
      });
    }

    let pinVerified = false;
    const providedPin = req.header('x-operator-pin')?.trim();

    if (requireSensitive && user.role === 'AGENT') {
      const shop = await this.controlPrisma.shop.findUnique({
        where: { id: shopId },
        select: { requireOperatorPin: true },
      });

      if (shop?.requireOperatorPin) {
        if (!operator.pinHash) {
          throw new ForbiddenException({
            code: 'OPERATOR_PIN_NOT_CONFIGURED',
            message:
              'Un code PIN opérateur est requis par cette boutique mais aucun PIN n’est défini pour cet opérateur.',
          });
        }
        if (!providedPin) {
          throw new ForbiddenException({
            code: 'OPERATOR_PIN_REQUIRED',
            message: 'Le code PIN de l’opérateur déclaré est obligatoire pour cette opération sensible.',
          });
        }
        const ok = await argon2.verify(operator.pinHash, providedPin);
        if (!ok) {
          throw new ForbiddenException({
            code: 'OPERATOR_PIN_INVALID',
            message: 'Code PIN opérateur incorrect.',
          });
        }
        pinVerified = true;
      }
    } else if (providedPin && operator.pinHash) {
      pinVerified = await argon2.verify(operator.pinHash, providedPin).catch(() => false);
    }

    req.declaredOperator = {
      id: operator.id,
      firstName: operator.firstName,
      pinVerified,
    };

    return true;
  }
}
