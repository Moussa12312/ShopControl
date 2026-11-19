'use client';

import React, { useMemo } from 'react';
import { Store } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';

/**
 * Résout de manière synchrone et fiable la boutique opérationnelle active pour les écrans Commerce & POS :
 * - Agent : toujours sa boutique unique
 * - Propriétaire : suit le sélecteur d'en-tête, ou bascule immédiatement sur la 1re boutique active si "ALL"
 */
export function useActiveOperationalShop() {
  const { loading, user, shops, selectedShopId, setSelectedShopId } = useAuth();

  const shopId = useMemo(() => {
    if (shops.length === 0) return '';
    if (user?.role === 'AGENT') return shops[0].shopId;
    if (selectedShopId && selectedShopId !== 'ALL' && shops.some((s) => s.shopId === selectedShopId)) {
      return selectedShopId;
    }
    const firstActive = shops.find((s) => s.status === 'ACTIVE') || shops[0];
    return firstActive.shopId;
  }, [user?.role, shops, selectedShopId]);

  const activeShop = useMemo(
    () => shops.find((s) => s.shopId === shopId) || null,
    [shops, shopId],
  );

  const selectShop = (nextId: string) => {
    if (user?.role === 'OWNER') {
      setSelectedShopId(nextId);
    }
  };

  return {
    shopId,
    activeShop,
    shops,
    selectShop,
    resolving: loading,
    isOwner: user?.role === 'OWNER',
  };
}

export function ShopPickerInline({
  shopId,
  onChange,
}: {
  shopId: string;
  onChange: (shopId: string) => void;
}) {
  const { user, shops } = useAuth();
  if (user?.role !== 'OWNER' || shops.length <= 1) return null;

  return (
    <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200/90 bg-white px-3 py-2 text-sm shadow-xs">
      <Store className="h-4 w-4 text-brand-600" />
      <select
        value={shopId}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Boutique active"
        className="bg-transparent font-semibold text-slate-800 focus:outline-none"
      >
        {shops.map((s) => (
          <option key={s.shopId} value={s.shopId}>
            {s.shopName}
          </option>
        ))}
      </select>
    </div>
  );
}
