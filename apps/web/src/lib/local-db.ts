'use client';

import Dexie, { Table } from 'dexie';

export interface LocalTerminalState {
  id: string; // 'current'
  deviceUid: string;
  terminalPrefix?: string;
  terminalLabel?: string;
  selectedShopId?: string;
  activeOperatorId?: string;
  activeOperatorName?: string;
  updatedAt: string;
}

export interface OfflineOperationItem {
  id?: number;
  clientOperationId: string;
  shopId: string;
  type: 'SALE_CREATE' | 'CASH_MOVEMENT';
  payload: unknown;
  status: 'PENDING' | 'SYNCED' | 'CONFLICT';
  createdAt: string;
}

class ShopControlLocalDatabase extends Dexie {
  terminalState!: Table<LocalTerminalState, string>;
  offlineQueue!: Table<OfflineOperationItem, number>;

  constructor() {
    super('ShopControlLocalDB');
    this.version(1).stores({
      terminalState: 'id',
      offlineQueue: '++id, clientOperationId, shopId, status, createdAt',
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
