import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_SUSPENDED_WRITE_KEY, IS_PUBLIC_KEY } from '../auth/auth.decorators';
import { RequestWithAuth } from '../auth/request-context.types';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Applique côté serveur :
 * - La restriction lecture seule des mandats d'assistance Super Admin (Section 4.1)
 * - La cascade de statuts ACTIF / IMPAYÉ / SUSPENDU / RÉSILIÉ (Section 3.3, Critère #29)
 */
@Injectable()
export class TenantStatusGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<RequestWithAuth>();
    const user = req.user;
    if (!user) {
      return true;
    }

    const isMutating = MUTATING_METHODS.has(req.method.toUpperCase());
    const allowSuspendedWrite = this.reflector.getAllAndOverride<boolean>(
      ALLOW_SUSPENDED_WRITE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (user.role === 'SUPER_ADMIN') {
      if (user.supportGrant?.readOnly && isMutating && !req.path.startsWith('/api/v1/admin')) {
        throw new ForbiddenException({
          code: 'SUPPORT_ACCESS_READ_ONLY',
          message: 'Votre accès d’assistance est en lecture seule : aucune modification n’est autorisée.',
        });
      }
      return true;
    }

    if (allowSuspendedWrite) {
      return true;
    }

    if (user.merchantStatus === 'TERMINATED' && isMutating) {
      throw new ForbiddenException({
        code: 'MERCHANT_TERMINATED',
        message: 'Ce compte marchand est résilié. Seule la consultation d’export est autorisée.',
      });
    }

    if (user.merchantStatus === 'SUSPENDED' && isMutating) {
      throw new ForbiddenException({
        code: 'TENANT_SUSPENDED_READ_ONLY',
        message:
          'Compte marchand suspendu : accès limité à la lecture seule et à l’export des données.',
      });
    }

    // Vérification au niveau de la boutique ciblée
    const targetShopId = (req.params?.shopId as string | undefined) || req.header('x-shop-id')?.trim();
    if (targetShopId && isMutating) {
      const shopAccess = user.shopAccesses.find((s) => s.shopId === targetShopId);
      if (shopAccess?.status === 'SUSPENDED') {
        throw new ForbiddenException({
          code: 'SHOP_SUSPENDED_READ_ONLY',
          message: 'Cette boutique est suspendue : accès limité à la lecture seule.',
        });
      }
      if (shopAccess?.status === 'TERMINATED') {
        throw new ForbiddenException({
          code: 'SHOP_TERMINATED',
          message: 'Cette boutique est résiliée : aucune écriture n’est autorisée.',
        });
      }
    }

    return true;
  }
}
