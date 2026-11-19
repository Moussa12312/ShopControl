import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { RequestWithAuth } from '../auth/request-context.types';

/**
 * Contrôle strict d'isolation inter-boutiques et inter-marchands côté serveur
 * (Critères de recette #1 et #16 : un Agent de la boutique A ne peut jamais accéder à la boutique B,
 * même en appelant l'API directement).
 */
@Injectable()
export class ShopScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithAuth>();
    const user = req.user;
    if (!user) {
      throw new ForbiddenException({ code: 'AUTH_REQUIRED', message: 'Authentification requise.' });
    }

    const shopId =
      (req.params?.shopId as string | undefined)?.trim() ||
      req.header('x-shop-id')?.trim();

    if (!shopId) {
      throw new ForbiddenException({
        code: 'SHOP_SCOPE_REQUIRED',
        message: 'Identifiant de boutique manquant pour cette opération.',
      });
    }

    const matchingAccess = user.shopAccesses.find((access) => access.shopId === shopId);
    if (!matchingAccess) {
      throw new ForbiddenException({
        code: 'SHOP_ACCESS_DENIED',
        message: 'Accès refusé : vous n’êtes pas autorisé à accéder aux données de cette boutique.',
      });
    }

    req.resolvedShopId = shopId;
    return true;
  }
}
