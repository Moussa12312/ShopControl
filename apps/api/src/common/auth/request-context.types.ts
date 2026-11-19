import {
  BusinessProfileConfig,
  PermissionMap,
  ShopType,
  TenantStatus,
  UserRole,
} from '@shopcontrol/shared';
import { RequestWithCorrelation } from '../middleware/correlation-id.middleware';

export interface ShopAccessSummary {
  shopId: string;
  shopName: string;
  slug: string;
  logoUrl?: string | null;
  shopType?: ShopType;
  businessProfile?: BusinessProfileConfig;
  status: TenantStatus;
  dbStatus: string;
  permissions: PermissionMap;
  maxDiscountPercent: number;
  maxExpenseAmountXof: number;
}

export interface SupportGrantContext {
  grantId: string;
  merchantId: string;
  readOnly: boolean;
  expiresAt: string;
}

export interface DeclaredOperatorContext {
  id: string;
  firstName: string;
  pinVerified: boolean;
}

export interface AuthenticatedUser {
  userId: string;
  sessionId: string;
  email: string;
  fullName: string;
  role: UserRole;
  merchantId: string | null;
  merchantStatus: TenantStatus | null;
  totpEnabled: boolean;
  shopAccesses: ShopAccessSummary[];
  supportGrant?: SupportGrantContext | null;
}

export interface RequestWithAuth extends RequestWithCorrelation {
  user?: AuthenticatedUser;
  resolvedShopId?: string;
  declaredOperator?: DeclaredOperatorContext;
}
