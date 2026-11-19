'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Banknote,
  Bell,
  Boxes,
  Building2,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Database,
  FileSearch,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Store,
  Truck,
  Upload,
  UserCheck,
  Users,
  Wallet,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { PermissionKey, USER_ROLE_LABELS, UserRole } from '@shopcontrol/shared';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { useNetworkStatus } from '@/components/providers/NetworkStatusProvider';
import { AccessDeniedState, LoadingSkeleton } from '@/components/ui/StateViews';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  requiredPerm?: PermissionKey;
}

interface NotificationItem {
  id: string;
  type: string;
  priority: 'INFO' | 'WARNING' | 'URGENT';
  title: string;
  message: string;
  targetPath: string | null;
  isRead: boolean;
  createdAt: string;
}

const NAV_BY_ROLE: Record<'SUPER_ADMIN' | 'OWNER' | 'AGENT', NavItem[]> = {
  SUPER_ADMIN: [
    { href: '/admin', label: 'Tableau de bord', icon: LayoutDashboard },
    { href: '/admin/merchants', label: 'Marchands', icon: Building2 },
    { href: '/admin/shops', label: 'Boutiques & BDD', icon: Database },
    { href: '/admin/security', label: 'Sécurité & Audit', icon: ShieldCheck },
  ],
  OWNER: [
    { href: '/owner', label: 'Vue d’ensemble', icon: LayoutDashboard },
    { href: '/pos', label: 'Ventes / POS', icon: ShoppingCart },
    { href: '/commerce/products', label: 'Produits', icon: Package },
    { href: '/commerce/stock', label: 'Stocks', icon: Boxes },
    { href: '/commerce/cash', label: 'Caisse', icon: Banknote },
    { href: '/commerce/purchases', label: 'Achats', icon: Truck },
    { href: '/commerce/clients', label: 'Clients & Créances', icon: Receipt },
    { href: '/commerce/expenses', label: 'Dépenses', icon: Wallet },
    { href: '/commerce/import', label: 'Import CSV', icon: Upload },
    { href: '/owner/shops', label: 'Boutiques', icon: Store },
    { href: '/owner/agents', label: 'Agents', icon: Users },
    { href: '/owner/operators', label: 'Opérateurs', icon: UserCheck },
    { href: '/owner/audit', label: 'Journal d’audit', icon: FileSearch },
    { href: '/owner/settings', label: 'Paramètres', icon: Settings },
  ],
  AGENT: [
    { href: '/agent', label: 'Accueil boutique', icon: Store },
    { href: '/pos', label: 'Ventes / POS', icon: ShoppingCart, requiredPerm: 'sales:read' },
    { href: '/commerce/products', label: 'Produits', icon: Package, requiredPerm: 'products:read' },
    { href: '/commerce/stock', label: 'Stocks', icon: Boxes, requiredPerm: 'stock:read' },
    { href: '/commerce/cash', label: 'Caisse', icon: Banknote, requiredPerm: 'cash:read' },
    { href: '/commerce/purchases', label: 'Achats', icon: Truck, requiredPerm: 'purchases:read' },
    { href: '/commerce/clients', label: 'Clients', icon: Receipt, requiredPerm: 'clients:read' },
    { href: '/commerce/expenses', label: 'Dépenses', icon: Wallet, requiredPerm: 'expenses:create' },
    { href: '/agent/profile', label: 'Mon profil', icon: UserCheck },
  ],
};

export function AppShell({
  allowedRoles,
  children,
}: {
  allowedRoles: UserRole[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    loading,
    user,
    merchant,
    shops,
    selectedShopId,
    setSelectedShopId,
    activeOperator,
    supportGrantId,
    setSupportGrantId,
    logout,
  } = useAuth();
  const { isOnline, apiReachable } = useNetworkStatus();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiFetch<{ items: NotificationItem[]; unreadCount: number }>(
        '/notifications?limit=10',
        { requiresOnline: false },
      );
      setNotifications(res.items);
      setUnreadCount(res.unreadCount);
    } catch {
      // Ignore silent polling errors when offline
    }
  }, [user]);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    void loadNotifications();
    const timer = window.setInterval(loadNotifications, 20_000);
    return () => window.clearInterval(timer);
  }, [user, loadNotifications]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl p-8">
        <LoadingSkeleton rows={6} />
      </div>
    );
  }

  if (!user) return null;

  const effectiveAllowed =
    allowedRoles.includes(user.role) ||
    (user.role === 'SUPER_ADMIN' && Boolean(supportGrantId) && allowedRoles.includes('OWNER'));

  if (!effectiveAllowed) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <AccessDeniedState />
      </div>
    );
  }

  const navRole =
    user.role === 'SUPER_ADMIN' && supportGrantId
      ? 'OWNER'
      : (user.role as 'SUPER_ADMIN' | 'OWNER' | 'AGENT');

  const agentPerms = user.role === 'AGENT' ? shops[0]?.permissions : null;
  const navItems = (NAV_BY_ROLE[navRole] || []).filter((item) => {
    if (!item.requiredPerm || user.role !== 'AGENT') return true;
    return Boolean(agentPerms?.[item.requiredPerm]);
  });

  const activeShop = shops.find((s) => s.shopId === selectedShopId);
  const isSuspended =
    merchant?.status === 'SUSPENDED' ||
    merchant?.status === 'TERMINATED' ||
    activeShop?.status === 'SUSPENDED';
  const isPastDue = merchant?.status === 'PAST_DUE';

  const handleMarkRead = async (notif: NotificationItem) => {
    if (!notif.isRead) {
      await apiFetch(`/notifications/${notif.id}/read`, { method: 'PATCH' }).catch(() => undefined);
      setUnreadCount((c) => Math.max(0, c - 1));
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, isRead: true } : n)),
      );
    }
    setNotifOpen(false);
    if (notif.targetPath) {
      router.push(notif.targetPath);
    }
  };

  const handleMarkAllRead = async () => {
    await apiFetch('/notifications/read-all', { method: 'PATCH' }).catch(() => undefined);
    setUnreadCount(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside
        aria-label="Navigation principale"
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-slate-200 bg-white transition-all duration-200 lg:static ${
          collapsed ? 'w-[72px]' : 'w-64'
        } ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
          <Link href={navItems[0]?.href || '/'} className="flex items-center gap-2.5 overflow-hidden">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-700 font-bold text-white">
              SC
            </span>
            {!collapsed ? (
              <div className="truncate">
                <p className="truncate text-sm font-bold text-slate-900">ShopControl</p>
                <p className="truncate text-[11px] text-slate-500">
                  {merchant?.name || USER_ROLE_LABELS[user.role]}
                </p>
              </div>
            ) : null}
          </Link>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Déplier le menu latéral' : 'Replier le menu latéral'}
            className="hidden rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:inline-flex"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Fermer le menu"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href ||
              (item.href !== '/admin' &&
                item.href !== '/owner' &&
                item.href !== '/agent' &&
                pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-brand-50 text-brand-800'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed ? <span className="truncate">{item.label}</span> : null}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <button
            type="button"
            onClick={handleLogout}
            title={collapsed ? 'Déconnexion' : undefined}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-700"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed ? <span>Déconnexion</span> : null}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Ouvrir le menu"
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>

            {(user.role === 'OWNER' || (user.role === 'SUPER_ADMIN' && supportGrantId)) && (
              <div className="flex items-center gap-2">
                <Store className="hidden h-4 w-4 text-brand-700 sm:block" aria-hidden="true" />
                <label htmlFor="shop-selector" className="sr-only">
                  Sélectionner une boutique
                </label>
                <select
                  id="shop-selector"
                  value={selectedShopId}
                  onChange={(e) => setSelectedShopId(e.target.value)}
                  className="max-w-[240px] rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-800 hover:border-brand-600"
                >
                  <option value="ALL">Toutes les boutiques (Consolidé)</option>
                  {shops.map((s) => (
                    <option key={s.shopId} value={s.shopId}>
                      {s.shopName} {s.status !== 'ACTIVE' ? `(${s.status})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {user.role === 'AGENT' && shops[0] ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800">
                  <Store className="h-3.5 w-3.5" />
                  {shops[0].shopName}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                  <UserCheck className="h-3.5 w-3.5" />
                  {activeOperator ? `Opérateur : ${activeOperator.firstName}` : 'Opérateur non sélectionné'}
                </span>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div
              role="status"
              aria-live="polite"
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                isOnline && apiReachable
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-amber-100 text-amber-900'
              }`}
            >
              {isOnline && apiReachable ? (
                <>
                  <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">En ligne</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Hors ligne</span>
                </>
              )}
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((o) => !o)}
                aria-label="Centre de notifications"
                className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100"
              >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                ) : null}
              </button>

              {notifOpen ? (
                <div className="absolute right-0 mt-2 w-80 max-w-[90vw] rounded-2xl border border-slate-200 bg-white shadow-xl sm:w-96">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <h3 className="text-sm font-semibold text-slate-900">Notifications</h3>
                    {unreadCount > 0 ? (
                      <button
                        type="button"
                        onClick={handleMarkAllRead}
                        className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
                      >
                        <CheckCheck className="h-3.5 w-3.5" />
                        Tout lire
                      </button>
                    ) : null}
                  </div>
                  <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="p-6 text-center text-xs text-slate-500">
                        Aucune notification pour le moment.
                      </p>
                    ) : (
                      notifications.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => handleMarkRead(n)}
                          className={`block w-full px-4 py-3 text-left hover:bg-slate-50 ${
                            !n.isRead ? 'bg-brand-50/40' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`text-xs font-semibold ${
                                n.priority === 'URGENT'
                                  ? 'text-red-700'
                                  : n.priority === 'WARNING'
                                    ? 'text-amber-700'
                                    : 'text-slate-900'
                              }`}
                            >
                              {n.title}
                            </span>
                            {!n.isRead ? (
                              <span className="h-2 w-2 shrink-0 rounded-full bg-brand-600" />
                            ) : null}
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{n.message}</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="hidden text-right sm:block">
              <p className="text-xs font-semibold text-slate-900">{user.fullName}</p>
              <p className="text-[11px] text-slate-500">{USER_ROLE_LABELS[user.role]}</p>
            </div>
          </div>
        </header>

        {user.mustSetupTwoFactor ? (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-600 px-4 py-2 text-xs font-medium text-white">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Sécurité Super Admin : la double authentification (2FA) est obligatoire.
            </span>
            <Link
              href="/setup-2fa"
              className="rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-50"
            >
              Configurer le 2FA
            </Link>
          </div>
        ) : null}

        {supportGrantId ? (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-indigo-700 px-4 py-2 text-xs font-medium text-white">
            <span>
              Mode accès d’assistance exceptionnel actif (lecture seule — journalisé et notifié au marchand).
            </span>
            <button
              type="button"
              onClick={() => {
                setSupportGrantId(null);
                router.push('/admin/security');
              }}
              className="rounded-md bg-white/15 px-2.5 py-1 text-xs font-semibold hover:bg-white/25"
            >
              Quitter l’accès support
            </button>
          </div>
        ) : null}

        {isSuspended ? (
          <div
            role="alert"
            className="flex items-center gap-2 bg-red-600 px-4 py-2.5 text-xs font-medium text-white"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Accès en lecture seule : ce compte ou cette boutique est actuellement suspendu(e).
              Vos données sont conservées, mais aucune modification n’est autorisée.
            </span>
          </div>
        ) : isPastDue ? (
          <div
            role="alert"
            className="flex items-center gap-2 bg-amber-500 px-4 py-2 text-xs font-medium text-amber-950"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Abonnement en délai de grâce (Impayé) : veuillez régulariser votre situation avant suspension.
            </span>
          </div>
        ) : null}

        <main className="mx-auto w-full max-w-7xl flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
