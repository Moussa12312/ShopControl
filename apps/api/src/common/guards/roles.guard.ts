import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@shopcontrol/shared';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../auth/auth.decorators';
import { RequestWithAuth } from '../auth/request-context.types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest<RequestWithAuth>();
    const user = req.user;
    if (!user) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Accès refusé.' });
    }

    if (requiredRoles.includes(user.role)) {
      return true;
    }

    // Accès exceptionnel Super Admin via mandat d'assistance valide sur les routes Propriétaire (lecture seule par défaut)
    if (user.role === 'SUPER_ADMIN' && user.supportGrant && requiredRoles.includes('OWNER')) {
      return true;
    }

    throw new ForbiddenException({
      code: 'ROLE_FORBIDDEN',
      message: 'Votre rôle ne permet pas d’effectuer cette opération.',
    });
  }
}
