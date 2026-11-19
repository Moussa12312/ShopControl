'use client';

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

  // Option B (Section 14.3) : bloque proprement les opérations qui exigent une connexion active
  if ((options.requiresOnline ?? isMutating) && typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new ApiError(
      0,
      'OFFLINE_REQUIRED_ONLINE',
      'Connexion requise : cette opération ne peut pas être exécutée hors ligne.',
    );
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
      parsed = { message: rawText };
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

  return parsed as T;
}
