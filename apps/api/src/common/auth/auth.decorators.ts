import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { PermissionKey, UserRole } from '@shopcontrol/shared';
import { AuthenticatedUser, DeclaredOperatorContext, RequestWithAuth } from './request-context.types';

export const IS_PUBLIC_KEY = 'sc_is_public';
export const ROLES_KEY = 'sc_roles';
export const PERMISSIONS_KEY = 'sc_permissions';
export const ALLOW_SUSPENDED_WRITE_KEY = 'sc_allow_suspended_write';
export const REQUIRE_OPERATOR_KEY = 'sc_require_operator';
export const REQUIRE_OPERATOR_SENSITIVE_KEY = 'sc_require_operator_sensitive';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
export const AllowSuspendedWrite = () => SetMetadata(ALLOW_SUSPENDED_WRITE_KEY, true);
export const RequireOperator = (sensitive = false) =>
  SetMetadata(sensitive ? REQUIRE_OPERATOR_SENSITIVE_KEY : REQUIRE_OPERATOR_KEY, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest<RequestWithAuth>();
    return req.user!;
  },
);

export const CurrentOperator = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): DeclaredOperatorContext | undefined => {
    const req = ctx.switchToHttp().getRequest<RequestWithAuth>();
    return req.declaredOperator;
  },
);
