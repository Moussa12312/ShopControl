'use client';

import Dexie, { Table } from 'dexie';

export interface LocalTerminalState {
  id: string; // 'current'
  deviceUid: string;
  terminalPrefix?: string;
  terminalLabel?: string;
  offlineNextSeq?: number;
  selectedShopId?: string;
  activeOperatorId?: string;
  activeOperatorName?: string;
  updatedAt: string;
}

export interface CachedProductItem {
  id: string;
  shopId: string;
  name: string;
  sku: string;
  barcode: string | null;
  salePriceXof: number;
  stockAvailable: number;
  stockAvailableDecimal?: number;
  status: string;
  unit: string;
  imageUrls?: string[];
  brand?: string | null;
  modelName?: string | null;
  isPinnedPos?: boolean;
  bulkUnitLabel?: string | null;
  unitsPerBulk?: number | null;
  bulkSalePriceXof?: number | null;
  allowFractionalSale?: boolean;
  warrantyMonths?: number | null;
  trackSerialNumber?: boolean;
  variants?: Array<{
    id: string;
    name: string;
    sku?: string;
    barcode?: string | null;
    salePriceXof?: number | null;
    stockAvailable?: number;
    isActive?: boolean;
  }>;
  cachedAt: string;
}

export interface OfflineOperationItem {
  id?: number;
  clientOperationId: string;
  shopId: string;
  type: 'SALE_CREATE' | 'CASH_MOVEMENT';
  offlineSaleNumber?: string;
  totalXof?: number;
  payload: unknown;
  status: 'PENDING' | 'SYNCED' | 'CONFLICT' | 'ERROR' | 'FAILED_FATAL';
  errorMessage?: string;
  retryCount?: number;
  createdAt: string;
}

export interface CachedApiResponse {
  key: string;
  data: unknown;
  cachedAt: string;
}

class ShopControlLocalDatabase extends Dexie {
  terminalState!: Table<LocalTerminalState, string>;
  offlineQueue!: Table<OfflineOperationItem, number>;
  productsCache!: Table<CachedProductItem, string>;
  apiCache!: Table<CachedApiResponse, string>;

  constructor() {
    super('ShopControlLocalDB');
    this.version(1).stores({
      terminalState: 'id',
      offlineQueue: '++id, clientOperationId, shopId, status, createdAt',
    });
    this.version(2).stores({
      terminalState: 'id',
      offlineQueue: '++id, clientOperationId, shopId, status, createdAt',
      productsCache: 'id, shopId, sku, barcode',
    });
    this.version(3).stores({
      terminalState: 'id',
      offlineQueue: '++id, clientOperationId, shopId, status, createdAt',
      productsCache: 'id, shopId, sku, barcode, name',
    });
    this.version(4).stores({
      terminalState: 'id',
      offlineQueue: '++id, clientOperationId, shopId, status, createdAt',
      productsCache: 'id, shopId, sku, barcode, name',
      apiCache: 'key, cachedAt',
    });
  }
}

export const localDb = typeof window !== 'undefined' ? new ShopControlLocalDatabase() : null;

export async function getOrCreateDeviceUid(): Promise<string> {
  if (!localDb) return 'ssr-device';
  const existing = await localDb.terminalState.get('current');
  if (existing?.deviceUid) {
    return existing.deviceUid;
  }
  const newUid = `sc-pos-${crypto.randomUUID()}`;
  await localDb.terminalState.put({
    id: 'current',
    deviceUid: newUid,
    offlineNextSeq: 1,
    updatedAt: new Date().toISOString(),
  });
  return newUid;
}

export async function saveLocalTerminalMeta(
  patch: Partial<Omit<LocalTerminalState, 'id' | 'deviceUid'>>,
): Promise<void> {
  if (!localDb) return;
  const deviceUid = await getOrCreateDeviceUid();
  const current = await localDb.terminalState.get('current');
  await localDb.terminalState.put({
    ...(current ?? { id: 'current', deviceUid }),
    ...patch,
    id: 'current',
    deviceUid,
    updatedAt: new Date().toISOString(),
  });
}

export async function getLocalTerminalMeta(): Promise<LocalTerminalState | undefined> {
  if (!localDb) return undefined;
  return localDb.terminalState.get('current');
}

export async function cacheShopProducts(shopId: string, products: CachedProductItem[]): Promise<void> {
  if (!localDb) return;
  await localDb.transaction('rw', localDb.productsCache, async () => {
    await localDb.productsCache.where('shopId').equals(shopId).delete();
    if (products.length > 0) {
      await localDb.productsCache.bulkPut(products);
    }
  });
}

export async function getCachedShopProducts(shopId: string): Promise<CachedProductItem[]> {
  if (!localDb) return [];
  return localDb.productsCache.where('shopId').equals(shopId).toArray();
}

export async function enqueueOfflineSale(
  shopId: string,
  payload: Record<string, unknown>,
  totalXof: number,
): Promise<OfflineOperationItem> {
  if (!localDb) {
    throw new Error('IndexedDB indisponible.');
  }
  const meta = await getLocalTerminalMeta();
  const prefix = meta?.terminalPrefix || 'OFF';
  const seq = meta?.offlineNextSeq ?? 1;
  const offlineSaleNumber = `${prefix}-${String(seq).padStart(6, '0')}`;
  const clientOperationId = crypto.randomUUID();

  await saveLocalTerminalMeta({ offlineNextSeq: seq + 1 });

  const item: OfflineOperationItem = {
    clientOperationId,
    shopId,
    type: 'SALE_CREATE',
    offlineSaleNumber,
    totalXof,
    payload: {
      ...payload,
      clientOperationId,
      offlineSaleNumber,
      offlineCapturedAt: new Date().toISOString(),
    },
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  };

  const id = await localDb.offlineQueue.add(item);
  return { ...item, id };
}

export async function getPendingOfflineSales(shopId: string): Promise<OfflineOperationItem[]> {
  if (!localDb) return [];
  return localDb.offlineQueue
    .where('shopId')
    .equals(shopId)
    .filter((i) => i.status === 'PENDING' || (i.status === 'ERROR' && (i.retryCount ?? 0) < 5))
    .toArray();
}

export async function updateOfflineSaleStatus(
  id: number,
  status: OfflineOperationItem['status'],
  errorMessage?: string,
  retryCount?: number,
): Promise<void> {
  if (!localDb) return;
  const updates: Partial<OfflineOperationItem> = { status, errorMessage };
  if (retryCount !== undefined) updates.retryCount = retryCount;
  await localDb.offlineQueue.update(id, updates);
}

export async function getCachedApiResponse<T>(key: string): Promise<T | null> {
  if (!localDb) return null;
  try {
    const entry = await localDb.apiCache.get(key);
    return (entry?.data as T) ?? null;
  } catch {
    return null;
  }
}

export async function saveCachedApiResponse(key: string, data: unknown): Promise<void> {
  if (!localDb) return;
  try {
    await localDb.apiCache.put({
      key,
      data,
      cachedAt: new Date().toISOString(),
    });
  } catch {
    // Ignore storage quota errors
  }
}
