'use client';

import React, { useEffect, useState } from 'react';
import { Store } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';

/**
 * Hook utilitaire qui résout la boutique opérationnelle active pour les écrans Lot 2 :
 * - Pour un Agent : toujours sa boutique unique
 * - Pour un Propriétaire : suit le sélecteur d'en-tête ou bascule sur sa 1re boutique active si "ALL"
 */
export function useActiveOperationalShop() {
  const { user, shops, selectedShopId, setSelectedShopId } = useAuth();
  const [localShopId, setLocalShopId] = useState<string>('');

  useEffect(() => {
    if (user?.role === 'AGENT' && shops[0]) {
      setLocalShopId(shops[0].shopId);
    } else if (selectedShopId !== 'ALL' && shops.some((s) => s.shopId === selectedShopId)) {
      setLocalShopId(selectedShopId);
    } else if (shops[0]) {
      setLocalShopId((prev) => (prev && shops.some((s) => s.shopId === prev) ? prev : shops[0].shopId));
    } else {
      setLocalShopId('');
    }
  }, [user, shops, selectedShopId]);

  const activeShop = shops.find((s) => s.shopId === localShopId) || null;

  const selectShop = (shopId: string) => {
    setLocalShopId(shopId);
    if (user?.role === 'OWNER') {
      setSelectedShopId(shopId);
    }
  };

  return {
    shopId: localShopId,
    activeShop,
    shops,
    selectShop,
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
    <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm">
      <Store className="h-4 w-4 text-brand-700" />
      <select
        value={shopId}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Boutique active"
        className="bg-transparent font-medium text-slate-800 focus:outline-none"
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
