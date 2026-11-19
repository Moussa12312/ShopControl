'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/lib/api-client';

interface NetworkStatusContextValue {
  isOnline: boolean;
  apiReachable: boolean;
  lastCheckedAt: string | null;
}

const NetworkStatusContext = createContext<NetworkStatusContextValue>({
  isOnline: true,
  apiReachable: true,
  lastCheckedAt: null,
});

export function NetworkStatusProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [apiReachable, setApiReachable] = useState(true);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Enregistrement du Service Worker PWA (Option B)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }

    const updateOnline = () => setIsOnline(navigator.onLine);
    updateOnline();

    const probeApi = async () => {
      if (!navigator.onLine) {
        setApiReachable(false);
        return;
      }
      try {
        const res = await fetch(`${API_BASE_URL}/health`, { cache: 'no-store' });
        setApiReachable(res.ok);
        setLastCheckedAt(new Date().toISOString());
      } catch {
        setApiReachable(false);
      }
    };

    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    void probeApi();
    const timer = window.setInterval(probeApi, 30_000);

    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
      window.clearInterval(timer);
    };
  }, []);

  return (
    <NetworkStatusContext.Provider value={{ isOnline, apiReachable, lastCheckedAt }}>
      {children}
    </NetworkStatusContext.Provider>
  );
}

export function useNetworkStatus() {
  return useContext(NetworkStatusContext);
}
