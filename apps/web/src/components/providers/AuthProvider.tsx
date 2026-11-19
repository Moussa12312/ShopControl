'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { PermissionMap, TenantStatus, UserRole } from '@shopcontrol/shared';
import { apiFetch } from '@/lib/api-client';
import { getLocalTerminalMeta, saveLocalTerminalMeta } from '@/lib/local-db';

export type OwnerWorkspaceMode = 'supervision' | 'management';

export interface AuthUserSummary {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  totpEnabled: boolean;
  mustSetupTwoFactor: boolean;
}

export interface AuthMerchantSummary {
  id: string;
  name: string;
  status: TenantStatus;
  statusReason: string | null;
  gracePeriodEndsAt: string | null;
  currency: string;
  defaultTimezone: string;
}

export interface AuthShopAccess {
  shopId: string;
  shopName: string;
  slug: string;
  logoUrl?: string | null;
  status: TenantStatus;
  dbStatus: string;
  permissions: PermissionMap;
  maxDiscountPercent: number;
  maxExpenseAmountXof: number;
}

export interface AuthMeResponse {
  user: AuthUserSummary;
  merchant: AuthMerchantSummary | null;
  shops: AuthShopAccess[];
  supportGrant: {
    grantId: string;
    merchantId: string;
    readOnly: boolean;
    expiresAt: string;
  } | null;
}

export interface ActiveOperator {
  id: string;
  firstName: string;
}

interface AuthContextValue {
  loading: boolean;
  user: AuthUserSummary | null;
  merchant: AuthMerchantSummary | null;
  shops: AuthShopAccess[];
  selectedShopId: string;
  setSelectedShopId: (shopId: string) => void;
  ownerMode: OwnerWorkspaceMode;
  setOwnerMode: (mode: OwnerWorkspaceMode) => void;
  activeOperator: ActiveOperator | null;
  setActiveOperator: (op: ActiveOperator | null) => void;
  supportGrantId: string | null;
  setSupportGrantId: (grantId: string | null) => void;
  refreshMe: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUserSummary | null>(null);
  const [merchant, setMerchant] = useState<AuthMerchantSummary | null>(null);
  const [shops, setShops] = useState<AuthShopAccess[]>([]);
  const [selectedShopId, setSelectedShopIdState] = useState<string>('ALL');
  const [ownerMode, setOwnerModeState] = useState<OwnerWorkspaceMode>('supervision');
  const [activeOperator, setActiveOperatorState] = useState<ActiveOperator | null>(null);
  const [supportGrantId, setSupportGrantIdState] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('sc_owner_mode');
      if (saved === 'management' || saved === 'supervision') {
        setOwnerModeState(saved);
      }
    }
  }, []);

  const setSelectedShopId = useCallback((shopId: string) => {
    setSelectedShopIdState(shopId);
    void saveLocalTerminalMeta({ selectedShopId: shopId });
  }, []);

  const setOwnerMode = useCallback(
    (mode: OwnerWorkspaceMode) => {
      setOwnerModeState(mode);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('sc_owner_mode', mode);
      }
      if (mode === 'management' && selectedShopId === 'ALL' && shops.length > 0) {
        setSelectedShopId(shops[0].shopId);
      }
    },
    [selectedShopId, shops, setSelectedShopId],
  );

  const setActiveOperator = useCallback((op: ActiveOperator | null) => {
    setActiveOperatorState(op);
    void saveLocalTerminalMeta({
      activeOperatorId: op?.id,
      activeOperatorName: op?.firstName,
    });
  }, []);

  const setSupportGrantId = useCallback((grantId: string | null) => {
    setSupportGrantIdState(grantId);
    if (typeof window !== 'undefined') {
      if (grantId) sessionStorage.setItem('sc_support_grant_id', grantId);
      else sessionStorage.removeItem('sc_support_grant_id');
    }
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const storedGrant =
        typeof window !== 'undefined' ? sessionStorage.getItem('sc_support_grant_id') : null;
      const data = await apiFetch<AuthMeResponse>('/auth/me', {
        supportGrantId: storedGrant,
        requiresOnline: false,
      });
      setUser(data.user);
      setMerchant(data.merchant);
      setShops(data.shops);
      if (data.supportGrant) {
        setSupportGrantIdState(data.supportGrant.grantId);
      } else {
        setSupportGrantIdState(null);
      }

      const localMeta = await getLocalTerminalMeta();
      if (data.user.role === 'AGENT' && data.shops.length > 0) {
        setSelectedShopIdState(data.shops[0].shopId);
      } else if (data.user.role === 'OWNER') {
        const saved = localMeta?.selectedShopId;
        if (saved && (saved === 'ALL' || data.shops.some((s) => s.shopId === saved))) {
          setSelectedShopIdState(saved);
        } else {
          setSelectedShopIdState('ALL');
        }
      }

      if (data.user.role === 'AGENT' && localMeta?.activeOperatorId && localMeta?.activeOperatorName) {
        setActiveOperatorState({
          id: localMeta.activeOperatorId,
          firstName: localMeta.activeOperatorName,
        });
      } else {
        setActiveOperatorState(null);
      }
    } catch {
      setUser(null);
      setMerchant(null);
      setShops([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST', requiresOnline: false });
    } catch {
      // Ignore network errors on logout
    }
    setUser(null);
    setMerchant(null);
    setShops([]);
    setActiveOperator(null);
    setSupportGrantId(null);
  }, [setActiveOperator, setSupportGrantId]);

  return (
    <AuthContext.Provider
      value={{
        loading,
        user,
        merchant,
        shops,
        selectedShopId,
        setSelectedShopId,
        ownerMode,
        setOwnerMode,
        activeOperator,
        setActiveOperator,
        supportGrantId,
        setSupportGrantId,
        refreshMe,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider.');
  return ctx;
}
