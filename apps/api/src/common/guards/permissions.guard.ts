import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionKey } from '@shopcontrol/shared';
import { PERMISSIONS_KEY } from '../auth/auth.decorators';
import { RequestWithAuth } from '../auth/request-context.types';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest<RequestWithAuth>();
    const user = req.user;
    if (!user) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Accès refusé.' });
    }

    if (user.role === 'OWNER' || (user.role === 'SUPER_ADMIN' && user.supportGrant)) {
      return true;
    }

    const shopId = req.resolvedShopId || (req.params?.shopId as string | undefined);
    const access = shopId
      ? user.shopAccesses.find((s) => s.shopId === shopId)
      : user.shopAccesses[0];

    if (!access) {
      throw new ForbiddenException({
        code: 'SHOP_ACCESS_DENIED',
        message: 'Aucun accès boutique actif pour ce compte.',
      });
    }

    for (const perm of required) {
      if (!access.permissions[perm]) {
        throw new ForbiddenException({
          code: 'PERMISSION_DENIED',
          message: `Permission insuffisante pour cette action (${perm}).`,
        });
      }
    }

    return true;
  }
}
