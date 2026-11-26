'use client';

import { getCachedApiResponse, saveCachedApiResponse } from '@/lib/local-db';

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || '/api/v1';

export class ApiError extends Error {
  statusCode: number;
  code: string;
  errors?: Array<{ path: string; message: string }>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    errors?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.errors = errors;
  }
}

export interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  shopId?: string | null;
  operatorId?: string | null;
  operatorPin?: string | null;
  supportGrantId?: string | null;
  requiresOnline?: boolean;
  skipRefresh?: boolean;
}

let refreshInFlight: Promise<boolean> | null = null;

async function attemptTokenRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const method = options.method || 'GET';
  const isMutating = method !== 'GET';
  const isGet = method === 'GET';
  const cacheKey = isGet ? `${options.shopId || 'global'}:${path}` : null;

  // Option B (Section 14.3) : bloque proprement les opérations qui exigent une connexion active
  if ((options.requiresOnline ?? isMutating) && typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new ApiError(
      0,
      'OFFLINE_REQUIRED_ONLINE',
      'Connexion requise : cette opération ne peut pas être exécutée hors ligne.',
    );
  }

  // En mode hors ligne, servir immédiatement depuis le cache local IndexedDB pour les requêtes de lecture
  if (isGet && cacheKey && typeof navigator !== 'undefined' && !navigator.onLine) {
    const cached = await getCachedApiResponse<T>(cacheKey);
    if (cached !== null) {
      return cached;
    }
    if (options.requiresOnline === false) {
      if (path.includes('products') || path.includes('sales') || path.includes('sessions') || path.includes('movements') || path.includes('clients') || path.includes('expenses') || path.includes('orders') || path.includes('purchases') || path.includes('transfers') || path.includes('categories') || path.includes('alerts')) {
        return { items: [], total: 0 } as T;
      }
      return [] as T;
    }
  }

  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.shopId) {
    headers['X-Shop-Id'] = options.shopId;
  }
  if (options.operatorId) {
    headers['X-Operator-Id'] = options.operatorId;
  }
  if (options.operatorPin) {
    headers['X-Operator-Pin'] = options.operatorPin;
  }
  if (options.supportGrantId) {
    headers['X-Support-Grant-Id'] = options.supportGrantId;
  }

  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'include',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    // Si la requête échoue suite à une coupure réseau, basculer sur le cache local
    if (isGet && cacheKey) {
      const cached = await getCachedApiResponse<T>(cacheKey);
      if (cached !== null) {
        return cached;
      }
      if (options.requiresOnline === false) {
        if (path.includes('products') || path.includes('sales') || path.includes('sessions') || path.includes('movements') || path.includes('clients') || path.includes('expenses') || path.includes('orders') || path.includes('purchases') || path.includes('transfers') || path.includes('categories') || path.includes('alerts')) {
          return { items: [], total: 0 } as T;
        }
        return [] as T;
      }
    }
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Impossible de joindre le serveur ShopControl. Vérifiez votre connexion réseau.',
    );
  }

  if (response.status === 401 && !options.skipRefresh && !path.startsWith('/auth/login')) {
    const refreshed = await attemptTokenRefresh();
    if (refreshed) {
      return apiFetch<T>(path, { ...options, skipRefresh: true });
    }
  }

  const rawText = await response.text();
  let parsed: unknown = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // Détection des erreurs Nginx / Reverse Proxy (502 Bad Gateway, 503, 504) ou HTML brut
      if (
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504 ||
        rawText.includes('<html') ||
        rawText.includes('Bad Gateway')
      ) {
        parsed = {
          code: 'SERVER_BOOTING',
          message:
            'Le serveur est en cours de redémarrage ou de synchronisation. Veuillez patienter quelques instants et cliquer sur Réessayer.',
        };
      } else {
        // Élimine toute balise HTML parasite pour un message propre
        const cleanMsg = rawText.replace(/<[^>]*>/g, '').trim();
        parsed = { message: cleanMsg || 'Une erreur est survenue lors de la communication avec le serveur.' };
      }
    }
  }

  if (!response.ok) {
    const errObj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
    throw new ApiError(
      response.status,
      typeof errObj.code === 'string' ? errObj.code : 'API_ERROR',
      typeof errObj.message === 'string' ? errObj.message : 'Une erreur est survenue.',
      Array.isArray(errObj.errors)
        ? (errObj.errors as Array<{ path: string; message: string }>)
        : undefined,
    );
  }

  if (isGet && cacheKey) {
    void saveCachedApiResponse(cacheKey, parsed);
  }

  return parsed as T;
}
