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
  Plus,
  Receipt,
  Search,
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
  shortLabel?: string;
  icon: React.ComponentType<{ className?: string }>;
  requiredPerm?: PermissionKey;
  inTopBar?: boolean;
  inMobileDock?: boolean;
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
    { href: '/admin', label: 'Tableau de bord', shortLabel: 'Accueil', icon: LayoutDashboard, inTopBar: true, inMobileDock: true },
    { href: '/admin/merchants', label: 'Marchands', icon: Building2, inTopBar: true, inMobileDock: true },
    { href: '/admin/shops', label: 'Boutiques & BDD', shortLabel: 'Boutiques', icon: Database, inTopBar: true, inMobileDock: true },
    { href: '/admin/security', label: 'Sécurité & Audit', shortLabel: 'Sécurité', icon: ShieldCheck, inTopBar: true, inMobileDock: true },
  ],
  OWNER: [
    { href: '/owner', label: 'Vue d’ensemble', shortLabel: 'Accueil', icon: LayoutDashboard, inTopBar: true, inMobileDock: true },
    { href: '/pos', label: 'Ventes / POS', shortLabel: 'POS', icon: ShoppingCart, inTopBar: true, inMobileDock: true },
    { href: '/commerce/products', label: 'Produits', icon: Package, inTopBar: true, inMobileDock: true },
    { href: '/commerce/stock', label: 'Stocks', icon: Boxes, inTopBar: true },
    { href: '/commerce/cash', label: 'Caisse', icon: Banknote, inTopBar: true, inMobileDock: true },
    { href: '/commerce/purchases', label: 'Achats', icon: Truck },
    { href: '/commerce/clients', label: 'Clients & Créances', shortLabel: 'Clients', icon: Receipt },
    { href: '/commerce/expenses', label: 'Dépenses', icon: Wallet },
    { href: '/commerce/import', label: 'Import CSV', icon: Upload },
    { href: '/owner/shops', label: 'Boutiques', icon: Store },
    { href: '/owner/agents', label: 'Agents', icon: Users },
    { href: '/owner/operators', label: 'Opérateurs', icon: UserCheck },
    { href: '/owner/audit', label: 'Journal d’audit', shortLabel: 'Audit', icon: FileSearch },
    { href: '/owner/settings', label: 'Paramètres', icon: Settings },
  ],
  AGENT: [
    { href: '/agent', label: 'Accueil boutique', shortLabel: 'Accueil', icon: Store, inTopBar: true, inMobileDock: true },
    { href: '/pos', label: 'Ventes / POS', shortLabel: 'POS', icon: ShoppingCart, requiredPerm: 'sales:read', inTopBar: true, inMobileDock: true },
    { href: '/commerce/products', label: 'Produits', icon: Package, requiredPerm: 'products:read', inTopBar: true, inMobileDock: true },
    { href: '/commerce/stock', label: 'Stocks', icon: Boxes, requiredPerm: 'stock:read', inTopBar: true },
    { href: '/commerce/cash', label: 'Caisse', icon: Banknote, requiredPerm: 'cash:read', inTopBar: true, inMobileDock: true },
    { href: '/commerce/purchases', label: 'Achats', icon: Truck, requiredPerm: 'purchases:read' },
    { href: '/commerce/clients', label: 'Clients', icon: Receipt, requiredPerm: 'clients:read' },
    { href: '/commerce/expenses', label: 'Dépenses', icon: Wallet, requiredPerm: 'expenses:create' },
    { href: '/agent/profile', label: 'Mon profil', icon: UserCheck },
  ],
};

export function AppShell({
  allowedRoles,
  hero,
  children,
}: {
  allowedRoles: UserRole[];
  hero?: React.ReactNode;
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

  const [expanded, setExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [quickJump, setQuickJump] = useState('');

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
      // ignore offline
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
      <div className="min-h-screen w-full bg-[#f4f8f7] p-6">
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
      <div className="flex min-h-screen w-full items-center justify-center bg-[#f4f8f7] p-6">
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
  const topBarItems = navItems.filter((i) => i.inTopBar);
  const mobileDockItems = navItems.filter((i) => i.inMobileDock).slice(0, 4);

  const activeShop = shops.find((s) => s.shopId === selectedShopId);
  const isSuspended =
    merchant?.status === 'SUSPENDED' ||
    merchant?.status === 'TERMINATED' ||
    activeShop?.status === 'SUSPENDED';
  const isPastDue = merchant?.status === 'PAST_DUE';

  const isNavActive = (href: string) =>
    pathname === href ||
    (href !== '/admin' && href !== '/owner' && href !== '/agent' && pathname.startsWith(href));

  const quickActionHref = navRole === 'SUPER_ADMIN' ? '/admin/merchants' : '/pos';

  const initials = user.fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

  const handleMarkRead = async (notif: NotificationItem) => {
    if (!notif.isRead) {
      await apiFetch(`/notifications/${notif.id}/read`, { method: 'PATCH' }).catch(() => undefined);
      setUnreadCount((c) => Math.max(0, c - 1));
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, isRead: true } : n)),
      );
    }
    setNotifOpen(false);
    if (notif.targetPath) router.push(notif.targetPath);
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

  const handleQuickJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = quickJump.trim().toLowerCase();
    if (!q) return;
    const match = navItems.find((i) => i.label.toLowerCase().includes(q));
    if (match) {
      router.push(match.href);
      setQuickJump('');
    }
  };

  return (
    <div className="flex min-h-screen w-full overflow-x-hidden bg-[#f4f8f7]">
      {/* Overlay mobile drawer */}
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-forest-950/60 backdrop-blur-xs lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      {/* Rail vertical plein écran Dark Forest Emerald (collé bord gauche, hauteur 100vh) */}
      <aside
        aria-label="Navigation principale"
        className={`fixed inset-y-0 left-0 z-50 flex h-screen flex-col border-r border-white/10 bg-forest-950 text-slate-200 transition-all duration-200 lg:sticky lg:top-0 ${
          expanded ? 'w-60' : 'w-[70px]'
        } ${mobileOpen ? 'w-72 translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0'}`}
      >
        <div className="flex h-16 items-center justify-between border-b border-white/10 px-3.5">
          <Link
            href={navItems[0]?.href || '/'}
            className="flex items-center gap-2.5 overflow-hidden"
            title="ShopControl"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/10 font-black tracking-tight text-white ring-1 ring-white/15">
              SC
            </span>
            {expanded || mobileOpen ? (
              <div className="truncate">
                <p className="truncate text-sm font-bold text-white">ShopControl</p>
                <p className="truncate text-[11px] text-emerald-200/70">
                  {merchant?.name || USER_ROLE_LABELS[user.role]}
                </p>
              </div>
            ) : null}
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Fermer le menu"
            className="rounded-xl p-1.5 text-emerald-200/70 hover:bg-white/10 hover:text-white lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Bouton d'action rapide vert lime (+) */}
        <div className="px-3 pb-2 pt-3">
          <Link
            href={quickActionHref}
            onClick={() => setMobileOpen(false)}
            title={navRole === 'SUPER_ADMIN' ? 'Nouveau marchand' : 'Nouvelle vente POS'}
            className={`flex items-center justify-center gap-2 rounded-2xl bg-limeglow-400 py-2.5 text-xs font-bold text-forest-950 shadow-sm transition hover:bg-lime-300 ${
              expanded || mobileOpen ? 'px-3' : 'px-0'
            }`}
          >
            <Plus className="h-4 w-4 shrink-0 stroke-[2.5]" />
            {expanded || mobileOpen ? (
              <span>{navRole === 'SUPER_ADMIN' ? 'Nouveau marchand' : 'Nouvelle vente'}</span>
            ) : null}
          </Link>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isNavActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                title={!expanded && !mobileOpen ? item.label : undefined}
                className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-all ${
                  active
                    ? 'bg-white text-forest-900 shadow-sm'
                    : 'text-[#8ea9a4] hover:bg-white/10 hover:text-white'
                } ${!expanded && !mobileOpen ? 'justify-center px-0' : ''}`}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                {expanded || mobileOpen ? <span className="truncate">{item.label}</span> : null}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-1.5 border-t border-white/10 p-3">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Replier le rail en icônes' : 'Déplier le menu avec libellés'}
            className={`hidden w-full items-center gap-3 rounded-2xl px-3 py-2 text-xs font-medium text-[#8ea9a4] hover:bg-white/10 hover:text-white lg:flex ${
              !expanded ? 'justify-center px-0' : ''
            }`}
          >
            {expanded ? (
              <>
                <ChevronLeft className="h-4 w-4 shrink-0" />
                <span>Réduire</span>
              </>
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0" />
            )}
          </button>

          <button
            type="button"
            onClick={handleLogout}
            title={!expanded && !mobileOpen ? 'Déconnexion' : undefined}
            className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-xs font-medium text-[#8ea9a4] hover:bg-rose-500/20 hover:text-rose-200 ${
              !expanded && !mobileOpen ? 'justify-center px-0' : ''
            }`}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {expanded || mobileOpen ? <span>Déconnexion</span> : null}
          </button>

          <div
            className={`flex items-center gap-2.5 pt-1 ${
              !expanded && !mobileOpen ? 'justify-center' : 'px-1'
            }`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-forest-700 text-xs font-bold text-emerald-100 ring-2 ring-limeglow-400/40">
              {initials || 'SC'}
            </span>
            {expanded || mobileOpen ? (
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-white">{user.fullName}</p>
                <p className="truncate text-[10px] text-emerald-200/70">
                  {USER_ROLE_LABELS[user.role]}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </aside>

      {/* Zone principale plein écran (edge-to-edge 100%) */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        {/* Bandeau supérieur Dark Forest Emerald */}
        <div className="bg-forest-900 text-white">
          <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-white/10 bg-forest-900/95 px-3 py-2.5 backdrop-blur-xs sm:px-5 lg:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                aria-label="Ouvrir la navigation"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white hover:bg-white/15 lg:hidden"
              >
                <Menu className="h-5 w-5" />
              </button>

              {/* Marque compacte mobile (masquée si sélecteur boutique affiché sur très petit écran) */}
              <span
                className={`truncate text-sm font-bold text-white md:hidden ${
                  user.role === 'OWNER' || (user.role === 'SUPER_ADMIN' && supportGrantId)
                    ? 'hidden sm:inline'
                    : ''
                }`}
              >
                ShopControl
              </span>

              {/* Pilules de navigation rapide en haut (tablette & desktop) */}
              <div className="hidden items-center gap-1 md:flex">
                {topBarItems.map((item) => {
                  const Icon = item.icon;
                  const active = isNavActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${
                        active
                          ? 'bg-white text-forest-900 shadow-xs'
                          : 'text-[#9ab5b0] hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{item.shortLabel || item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Droite : Sélecteur boutique, recherche, statut réseau, cloche */}
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
              <form onSubmit={handleQuickJumpSubmit} className="relative hidden xl:block">
                <Search className="pointer-events-none absolute left-3 top-2 h-3.5 w-3.5 text-[#7d9c97]" />
                <input
                  type="search"
                  value={quickJump}
                  onChange={(e) => setQuickJump(e.target.value)}
                  placeholder="Aller à une page…"
                  className="w-44 rounded-full border border-white/10 bg-forest-800 py-1.5 pl-8 pr-3 text-xs text-white placeholder-[#7d9c97] focus:border-limeglow-400"
                />
              </form>

              {(user.role === 'OWNER' || (user.role === 'SUPER_ADMIN' && supportGrantId)) && (
                <div className="flex items-center">
                  <label htmlFor="shop-selector" className="sr-only">
                    Sélectionner une boutique
                  </label>
                  <select
                    id="shop-selector"
                    value={selectedShopId}
                    onChange={(e) => setSelectedShopId(e.target.value)}
                    className="max-w-[165px] truncate rounded-full border border-white/15 bg-forest-800 px-2.5 py-1.5 text-xs font-medium text-white hover:border-limeglow-400/60 sm:max-w-[230px] sm:px-3"
                  >
                    <option value="ALL" className="bg-forest-900 text-white">
                      Toutes (Consolidé)
                    </option>
                    {shops.map((s) => (
                      <option key={s.shopId} value={s.shopId} className="bg-forest-900 text-white">
                        {s.shopName} {s.status !== 'ACTIVE' ? `(${s.status})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {user.role === 'AGENT' && shops[0] ? (
                <span className="hidden items-center gap-1 rounded-full bg-forest-800 px-3 py-1 text-xs font-semibold text-emerald-100 ring-1 ring-white/10 sm:inline-flex">
                  <Store className="h-3.5 w-3.5 text-limeglow-400" />
                  <span className="max-w-[120px] truncate">{shops[0].shopName}</span>
                  {activeOperator ? (
                    <span className="text-limeglow-400">· {activeOperator.firstName}</span>
                  ) : null}
                </span>
              ) : null}

              <div
                role="status"
                aria-live="polite"
                title={isOnline && apiReachable ? 'En ligne' : 'Hors ligne'}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold sm:px-2.5 ${
                  isOnline && apiReachable
                    ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/25'
                    : 'bg-amber-400/20 text-amber-200 ring-1 ring-amber-300/30'
                }`}
              >
                {isOnline && apiReachable ? (
                  <>
                    <Wifi className="h-3.5 w-3.5" />
                    <span className="hidden md:inline">En ligne</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="h-3.5 w-3.5" />
                    <span className="hidden md:inline">Hors ligne</span>
                  </>
                )}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setNotifOpen((o) => !o)}
                  aria-label="Centre de notifications"
                  className="relative flex h-9 w-9 items-center justify-center rounded-full bg-forest-800 text-emerald-100 ring-1 ring-white/10 hover:bg-forest-700"
                >
                  <Bell className="h-4 w-4" />
                  {unreadCount > 0 ? (
                    <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-forest-900" />
                  ) : null}
                </button>

                {notifOpen ? (
                  <div className="fixed inset-x-3 top-16 z-50 rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96">
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                      <h3 className="text-sm font-bold text-slate-900">
                        Notifications {unreadCount > 0 ? `(${unreadCount})` : ''}
                      </h3>
                      {unreadCount > 0 ? (
                        <button
                          type="button"
                          onClick={handleMarkAllRead}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
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
                              !n.isRead ? 'bg-brand-50/50' : ''
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className={`text-xs font-semibold ${
                                  n.priority === 'URGENT'
                                    ? 'text-rose-700'
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
            </div>
          </header>

          {/* Bandeaux contextuels */}
          {user.mustSetupTwoFactor ? (
            <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-500 px-4 py-2 text-xs font-semibold text-forest-950 lg:px-6">
              <span className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Sécurité Super Admin : activez la double authentification (2FA).
              </span>
              <Link
                href="/setup-2fa"
                className="rounded-full bg-forest-900 px-3 py-1 text-xs font-semibold text-white hover:bg-forest-800"
              >
                Configurer le 2FA
              </Link>
            </div>
          ) : null}

          {supportGrantId ? (
            <div className="flex flex-wrap items-center justify-between gap-2 bg-indigo-600 px-4 py-2 text-xs font-medium text-white lg:px-6">
              <span>Mode accès d’assistance exceptionnel actif (lecture seule).</span>
              <button
                type="button"
                onClick={() => {
                  setSupportGrantId(null);
                  router.push('/admin/security');
                }}
                className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold hover:bg-white/25"
              >
                Quitter support
              </button>
            </div>
          ) : null}

          {isSuspended ? (
            <div
              role="alert"
              className="flex items-center gap-2 bg-rose-600 px-4 py-2 text-xs font-semibold text-white lg:px-6"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Lecture seule : ce compte ou cette boutique est suspendu(e).</span>
            </div>
          ) : isPastDue ? (
            <div
              role="alert"
              className="flex items-center gap-2 bg-amber-400 px-4 py-2 text-xs font-semibold text-forest-950 lg:px-6"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Abonnement en délai de grâce (Impayé) : régularisez avant suspension.</span>
            </div>
          ) : null}

          {hero ? <div className="px-4 pb-6 pt-5 sm:px-5 lg:px-6">{hero}</div> : null}
        </div>

        {/* Contenu principal plein écran (padding bas mobile pour la barre dock) */}
        <main className="w-full flex-1 p-3 pb-24 sm:p-5 sm:pb-24 lg:p-6 lg:pb-6">{children}</main>

        {/* Barre de navigation mobile fixe en bas (< lg) pour une UX native sur téléphone */}
        <nav
          aria-label="Navigation rapide mobile"
          className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-white/10 bg-forest-950/95 px-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-[10px] font-semibold text-[#8ea9a4] backdrop-blur-md lg:hidden"
        >
          {mobileDockItems.map((item) => {
            const Icon = item.icon;
            const active = isNavActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1.5 py-1 transition ${
                  active ? 'bg-white text-forest-900' : 'hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="max-w-full truncate">{item.shortLabel || item.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1.5 py-1 hover:text-white"
          >
            <Menu className="h-4 w-4 shrink-0" />
            <span>Plus</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
