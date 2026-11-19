import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createDefaultAgentPermissions } from '@shopcontrol/shared';
import { ShopScopeGuard } from './shop-scope.guard';
import { TenantStatusGuard } from './tenant-status.guard';
import { PermissionsGuard } from './permissions.guard';
import { AuthenticatedUser } from '../auth/request-context.types';

function makeContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
    getHandler: () => (() => undefined),
    getClass: () => class Dummy {},
  } as unknown as ExecutionContext;
}

describe('Guards multi-tenant & sécurité (Critères #1, #16, #29)', () => {
  const agentUser: AuthenticatedUser = {
    userId: 'user-agent-1',
    sessionId: 'sess-1',
    email: 'agent@a.ml',
    fullName: 'Agent A',
    role: 'AGENT',
    merchantId: 'merchant-1',
    merchantStatus: 'ACTIVE',
    totpEnabled: false,
    shopAccesses: [
      {
        shopId: 'shop-a',
        shopName: 'Boutique A',
        slug: 'boutique-a',
        status: 'ACTIVE',
        dbStatus: 'READY',
        permissions: createDefaultAgentPermissions(),
        maxDiscountPercent: 5,
        maxExpenseAmountXof: 10000,
      },
    ],
  };

  it('ShopScopeGuard autorise l’Agent sur sa boutique A et refuse strictement la boutique B (Critères #1 & #16)', () => {
    const guard = new ShopScopeGuard();

    const okReq: Record<string, unknown> = {
      user: agentUser,
      params: { shopId: 'shop-a' },
      header: () => undefined,
    };
    expect(guard.canActivate(makeContext(okReq))).toBe(true);
    expect(okReq.resolvedShopId).toBe('shop-a');

    const crossShopReq: Record<string, unknown> = {
      user: agentUser,
      params: { shopId: 'shop-b' },
      header: () => undefined,
    };
    expect(() => guard.canActivate(makeContext(crossShopReq))).toThrow(ForbiddenException);
  });

  it('TenantStatusGuard bloque les écritures sur une boutique suspendue et autorise la lecture (Critère #29)', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;
    const guard = new TenantStatusGuard(reflector);

    const suspendedUser: AuthenticatedUser = {
      ...agentUser,
      shopAccesses: [{ ...agentUser.shopAccesses[0], status: 'SUSPENDED' }],
    };

    const readReq = {
      user: suspendedUser,
      method: 'GET',
      path: '/api/v1/shops/shop-a/operators',
      params: { shopId: 'shop-a' },
      header: () => undefined,
    };
    expect(guard.canActivate(makeContext(readReq))).toBe(true);

    const writeReq = {
      user: suspendedUser,
      method: 'POST',
      path: '/api/v1/shops/shop-a/operators',
      params: { shopId: 'shop-a' },
      header: () => undefined,
    };
    expect(() => guard.canActivate(makeContext(writeReq))).toThrow(ForbiddenException);
  });

  it('TenantStatusGuard bloque les écritures lors d’un accès support Super Admin en lecture seule (Section 4.1)', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;
    const guard = new TenantStatusGuard(reflector);

    const supportAdmin: AuthenticatedUser = {
      ...agentUser,
      role: 'SUPER_ADMIN',
      supportGrant: {
        grantId: 'grant-1',
        merchantId: 'merchant-1',
        readOnly: true,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    };

    const writeReq = {
      user: supportAdmin,
      method: 'PATCH',
      path: '/api/v1/shops/shop-a',
      params: { shopId: 'shop-a' },
      header: () => undefined,
    };
    expect(() => guard.canActivate(makeContext(writeReq))).toThrow(ForbiddenException);
  });

  it('PermissionsGuard bloque une permission non accordée à un Agent côté serveur', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['finance:read_margins']),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    const req = {
      user: agentUser,
      resolvedShopId: 'shop-a',
      params: { shopId: 'shop-a' },
    };
    expect(() => guard.canActivate(makeContext(req))).toThrow(ForbiddenException);
  });
});
