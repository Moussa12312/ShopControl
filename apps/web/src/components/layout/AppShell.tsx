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
    { href: '/admin', label: 'Tableau de bord', shortLabel: 'Accueil', icon: LayoutDashboard, inTopBar: true },
    { href: '/admin/merchants', label: 'Marchands', icon: Building2, inTopBar: true },
    { href: '/admin/shops', label: 'Boutiques & BDD', shortLabel: 'Boutiques', icon: Database, inTopBar: true },
    { href: '/admin/security', label: 'Sécurité & Audit', shortLabel: 'Sécurité', icon: ShieldCheck, inTopBar: true },
  ],
  OWNER: [
    { href: '/owner', label: 'Vue d’ensemble', shortLabel: 'Accueil', icon: LayoutDashboard, inTopBar: true },
    { href: '/pos', label: 'Ventes / POS', shortLabel: 'Ventes POS', icon: ShoppingCart, inTopBar: true },
    { href: '/commerce/products', label: 'Produits', icon: Package, inTopBar: true },
    { href: '/commerce/stock', label: 'Stocks', icon: Boxes, inTopBar: true },
    { href: '/commerce/cash', label: 'Caisse', icon: Banknote, inTopBar: true },
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
    { href: '/agent', label: 'Accueil boutique', shortLabel: 'Accueil', icon: Store, inTopBar: true },
    { href: '/pos', label: 'Ventes / POS', shortLabel: 'Ventes POS', icon: ShoppingCart, requiredPerm: 'sales:read', inTopBar: true },
    { href: '/commerce/products', label: 'Produits', icon: Package, requiredPerm: 'products:read', inTopBar: true },
    { href: '/commerce/stock', label: 'Stocks', icon: Boxes, requiredPerm: 'stock:read', inTopBar: true },
    { href: '/commerce/cash', label: 'Caisse', icon: Banknote, requiredPerm: 'cash:read', inTopBar: true },
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

  // Rail slim par défaut sur desktop (style design de référence), dépliable en un clic (Section 13.2)
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
  const topBarItems = navItems.filter((i) => i.inTopBar);

  const activeShop = shops.find((s) => s.shopId === selectedShopId);
  const isSuspended =
    merchant?.status === 'SUSPENDED' ||
    merchant?.status === 'TERMINATED' ||
    activeShop?.status === 'SUSPENDED';
  const isPastDue = merchant?.status === 'PAST_DUE';

  const isNavActive = (href: string) =>
    pathname === href ||
    (href !== '/admin' && href !== '/owner' && href !== '/agent' && pathname.startsWith(href));

  const quickActionHref =
    navRole === 'SUPER_ADMIN' ? '/admin/merchants' : '/pos';

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
    <div className="min-h-screen bg-[#e6f4ef] p-0 sm:p-3 lg:p-4">
      <div className="mx-auto flex min-h-screen max-w-[1600px] gap-3 sm:min-h-[calc(100vh-1.5rem)] lg:min-h-[calc(100vh-2rem)]">
        {/* Overlay mobile */}
        {mobileOpen ? (
          <div
            className="fixed inset-0 z-40 bg-forest-950/60 backdrop-blur-xs lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        ) : null}

        {/* Rail vertical Dark Forest Emerald (repliable icônes <-> libellés) */}
        <aside
          aria-label="Navigation principale"
          className={`fixed inset-y-0 left-0 z-50 flex flex-col bg-forest-900 text-slate-200 shadow-shell transition-all duration-200 lg:static lg:rounded-[26px] ${
            expanded ? 'w-60' : 'w-[70px]'
          } ${mobileOpen ? 'w-64 translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
        >
          {/* Logo marque + bouton repli */}
          <div className="flex h-16 items-center justify-between px-3.5">
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

          {/* Bouton d'action rapide (+) style rail de référence */}
          <div className="px-3 pb-2">
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

          {/* Items de navigation */}
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

          {/* Pied du rail : repli, paramètres/avatar, déconnexion */}
          <div className="space-y-1.5 border-t border-white/10 p-3">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? 'Replier le rail en icônes' : 'Déplier le menu avec libellés'}
              title={expanded ? 'Replier le menu' : 'Afficher les libellés'}
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

        {/* Conteneur principal arrondi (Header Dark Forest + Hero optionnel + Surface claire) */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#f4f8f7] shadow-shell sm:rounded-[28px]">
          {/* Bandeau supérieur Dark Forest Emerald */}
          <div className="bg-forest-900 text-white">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 lg:px-6">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setMobileOpen(true)}
                  aria-label="Ouvrir la navigation"
                  className="rounded-xl bg-white/10 p-2 text-white hover:bg-white/15 lg:hidden"
                >
                  <Menu className="h-5 w-5" />
                </button>

                {/* Pilules de navigation rapide en haut (comme le design de référence) */}
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

              {/* Droite : Sélecteur boutique, recherche rapide, réseau, notifications */}
              <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
                {/* Recherche rapide navigation (PC) */}
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

                {/* Sélecteur boutique Propriétaire */}
                {(user.role === 'OWNER' || (user.role === 'SUPER_ADMIN' && supportGrantId)) && (
                  <div className="flex items-center">
                    <label htmlFor="shop-selector" className="sr-only">
                      Sélectionner une boutique
                    </label>
                    <select
                      id="shop-selector"
                      value={selectedShopId}
                      onChange={(e) => setSelectedShopId(e.target.value)}
                      className="max-w-[210px] rounded-full border border-white/15 bg-forest-800 px-3 py-1.5 text-xs font-medium text-white hover:border-limeglow-400/60"
                    >
                      <option value="ALL" className="bg-forest-900 text-white">
                        Toutes les boutiques (Consolidé)
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
                  <div className="flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-forest-800 px-3 py-1 text-xs font-semibold text-emerald-100 ring-1 ring-white/10">
                      <Store className="h-3.5 w-3.5 text-limeglow-400" />
                      {shops[0].shopName}
                    </span>
                    <span className="hidden items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs text-emerald-100 sm:inline-flex">
                      <UserCheck className="h-3.5 w-3.5" />
                      {activeOperator ? activeOperator.firstName : 'Opérateur ?'}
                    </span>
                  </div>
                ) : null}

                {/* Indicateur réseau permanent (Section 13.2 & Option B) */}
                <div
                  role="status"
                  aria-live="polite"
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    isOnline && apiReachable
                      ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/25'
                      : 'bg-amber-400/20 text-amber-200 ring-1 ring-amber-300/30'
                  }`}
                >
                  {isOnline && apiReachable ? (
                    <>
                      <Wifi className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">En ligne</span>
                    </>
                  ) : (
                    <>
                      <WifiOff className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Hors ligne</span>
                    </>
                  )}
                </div>

                {/* Centre de notifications */}
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
                    <div className="absolute right-0 z-50 mt-2 w-80 max-w-[90vw] rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl sm:w-96">
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

            {/* Bandeaux contextuels obligatoires */}
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
                <span>
                  Mode accès d’assistance exceptionnel actif (lecture seule — journalisé et notifié au marchand).
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSupportGrantId(null);
                    router.push('/admin/security');
                  }}
                  className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold hover:bg-white/25"
                >
                  Quitter l’accès support
                </button>
              </div>
            ) : null}

            {isSuspended ? (
              <div
                role="alert"
                className="flex items-center gap-2 bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white lg:px-6"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  Lecture seule : ce compte ou cette boutique est suspendu(e). Toutes les données
                  sont conservées mais aucune écriture n’est autorisée.
                </span>
              </div>
            ) : isPastDue ? (
              <div
                role="alert"
                className="flex items-center gap-2 bg-amber-400 px-4 py-2 text-xs font-semibold text-forest-950 lg:px-6"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  Abonnement en délai de grâce (Impayé) : régularisez votre situation avant suspension.
                </span>
              </div>
            ) : null}

            {/* Slot Hero optionnel (Greeting + 4 cartes KPI sombres glass sur les tableaux de bord) */}
            {hero ? <div className="px-4 pb-6 pt-5 lg:px-6">{hero}</div> : null}
          </div>

          {/* Zone principale claire (cartes blanches arrondies) */}
          <main className="mx-auto w-full max-w-[1480px] flex-1 p-4 lg:p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
