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
  variant = 'dark',
}: {
  shopId: string;
  onChange: (shopId: string) => void;
  variant?: 'light' | 'dark';
}) {
  const { user, shops } = useAuth();
  if (user?.role !== 'OWNER' || shops.length <= 1) return null;

  const isDark = variant === 'dark';

  const activeShop = shops.find((s) => s.shopId === shopId);

  return (
    <div
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs shadow-sm sm:px-3 ${
        isDark
          ? 'border-white/15 bg-forest-800/90 text-white'
          : 'border-slate-200/90 bg-white text-slate-800'
      }`}
    >
      {activeShop?.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={activeShop.logoUrl}
          alt={activeShop.shopName}
          className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/20 bg-white object-contain"
        />
      ) : (
        <Store className={`h-3.5 w-3.5 shrink-0 ${isDark ? 'text-limeglow-400' : 'text-brand-600'}`} />
      )}
      <select
        value={shopId}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Boutique active"
        className={`max-w-[150px] truncate bg-transparent font-semibold focus:outline-none sm:max-w-[220px] ${
          isDark ? 'text-white' : 'text-slate-800'
        }`}
      >
        {shops.map((s) => (
          <option
            key={s.shopId}
            value={s.shopId}
            className={isDark ? 'bg-forest-900 text-white' : 'bg-white text-slate-900'}
          >
            {s.shopName}
          </option>
        ))}
      </select>
    </div>
  );
}
