'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeftRight,
  Banknote,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Crown,
  Database,
  FileSearch,
  FileText,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MessageSquare,
  Package,
  Plus,
  Receipt,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
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
  group: string;
  icon: React.ComponentType<{ className?: string }>;
  requiredPerm?: PermissionKey;
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

interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  priority: 'INFO' | 'WARNING' | 'URGENT';
}

const NAV_BY_ROLE: Record<'SUPER_ADMIN' | 'OWNER' | 'AGENT', NavItem[]> = {
  SUPER_ADMIN: [
    { href: '/admin', label: 'Tableau de bord', shortLabel: 'Accueil', group: 'Plateforme', icon: LayoutDashboard, inMobileDock: true },
    { href: '/admin/merchants', label: 'Marchands', group: 'Plateforme', icon: Building2, inMobileDock: true },
    { href: '/admin/shops', label: 'Boutiques & BDD', shortLabel: 'Boutiques', group: 'Plateforme', icon: Database, inMobileDock: true },
    { href: '/admin/platform', label: 'Abonnements & Support', shortLabel: 'SaaS', group: 'Plateforme', icon: Crown, inMobileDock: true },
    { href: '/messaging', label: 'Messagerie', group: 'Communication', icon: MessageSquare },
    { href: '/admin/security', label: 'Sécurité & Audit', shortLabel: 'Sécurité', group: 'Sécurité', icon: ShieldCheck },
  ],
  OWNER: [
    { href: '/owner', label: 'Vue d’ensemble', shortLabel: 'Accueil', group: 'Pilotage', icon: LayoutDashboard, inMobileDock: true },
    { href: '/pos', label: 'Ventes / POS', shortLabel: 'POS', group: 'Opérations', icon: ShoppingCart, inMobileDock: true },
    { href: '/commerce/orders', label: 'Commandes QR', shortLabel: 'Commandes', group: 'Opérations', icon: ShoppingBag, inMobileDock: true },
    { href: '/commerce/documents', label: 'Tickets & Avoirs', shortLabel: 'Tickets', group: 'Opérations', icon: FileText },
    { href: '/commerce/cash', label: 'Caisse', group: 'Opérations', icon: Banknote },
    { href: '/commerce/products', label: 'Produits', group: 'Catalogue & Stocks', icon: Package, inMobileDock: true },
    { href: '/commerce/stock', label: 'Stocks', group: 'Catalogue & Stocks', icon: Boxes },
    { href: '/commerce/transfers', label: 'Transferts', group: 'Catalogue & Stocks', icon: ArrowLeftRight },
    { href: '/commerce/purchases', label: 'Achats', group: 'Catalogue & Stocks', icon: Truck },
    { href: '/commerce/clients', label: 'Clients & Créances', shortLabel: 'Clients', group: 'Finances & Clients', icon: Receipt },
    { href: '/commerce/expenses', label: 'Dépenses', group: 'Finances & Clients', icon: Wallet },
    { href: '/owner/reports', label: 'Bilans & Exports', shortLabel: 'Bilans', group: 'Finances & Clients', icon: BarChart3 },
    { href: '/messaging', label: 'Messagerie', group: 'Communication', icon: MessageSquare },
    { href: '/owner/shops', label: 'Boutiques & QR', shortLabel: 'Boutiques', group: 'Entreprise', icon: Store },
    { href: '/owner/agents', label: 'Agents', group: 'Entreprise', icon: Users },
    { href: '/owner/operators', label: 'Opérateurs', group: 'Entreprise', icon: UserCheck },
    { href: '/commerce/import', label: 'Import CSV', group: 'Entreprise', icon: Upload },
    { href: '/owner/audit', label: 'Journal d’audit', shortLabel: 'Audit', group: 'Entreprise', icon: FileSearch },
    { href: '/owner/settings', label: 'Paramètres & Logo', shortLabel: 'Paramètres', group: 'Entreprise', icon: Settings },
  ],
  AGENT: [
    { href: '/agent', label: 'Accueil boutique', shortLabel: 'Accueil', group: 'Comptoir', icon: Store, inMobileDock: true },
    { href: '/pos', label: 'Ventes / POS', shortLabel: 'POS', group: 'Comptoir', icon: ShoppingCart, requiredPerm: 'sales:read', inMobileDock: true },
    { href: '/commerce/orders', label: 'Commandes QR', shortLabel: 'Commandes', group: 'Comptoir', icon: ShoppingBag, requiredPerm: 'orders:read', inMobileDock: true },
    { href: '/commerce/documents', label: 'Tickets & Avoirs', shortLabel: 'Tickets', group: 'Comptoir', icon: FileText, requiredPerm: 'sales:read' },
    { href: '/commerce/cash', label: 'Caisse', group: 'Comptoir', icon: Banknote, requiredPerm: 'cash:read', inMobileDock: true },
    { href: '/commerce/products', label: 'Produits', group: 'Gestion', icon: Package, requiredPerm: 'products:read' },
    { href: '/commerce/stock', label: 'Stocks', group: 'Gestion', icon: Boxes, requiredPerm: 'stock:read' },
    { href: '/commerce/transfers', label: 'Transferts', group: 'Gestion', icon: ArrowLeftRight, requiredPerm: 'stock:read' },
    { href: '/commerce/purchases', label: 'Achats', group: 'Gestion', icon: Truck, requiredPerm: 'purchases:read' },
    { href: '/commerce/clients', label: 'Clients', group: 'Gestion', icon: Receipt, requiredPerm: 'clients:read' },
    { href: '/commerce/expenses', label: 'Dépenses', group: 'Gestion', icon: Wallet, requiredPerm: 'expenses:create' },
    { href: '/messaging', label: 'Messagerie', group: 'Communication', icon: MessageSquare },
    { href: '/agent/profile', label: 'Mon profil', group: 'Compte', icon: UserCheck },
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

  const [expanded, setExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [dismissedAnn, setDismissedAnn] = useState<string[]>([]);
  const [quickJump, setQuickJump] = useState('');

  const loadNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiFetch<{ items: NotificationItem[]; unreadCount: number }>(
        '/notifications?limit=12',
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
    apiFetch<AnnouncementItem[]>('/announcements/active', { requiresOnline: false })
      .then((list) => setAnnouncements(Array.isArray(list) ? list : []))
      .catch(() => undefined);
    const timer = window.setInterval(loadNotifications, 25_000);
    return () => window.clearInterval(timer);
  }, [user, loadNotifications]);

  if (loading) {
    return (
      <div className="min-h-screen w-full bg-porcelain-100 p-6">
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
      <div className="flex min-h-screen w-full items-center justify-center bg-porcelain-100 p-6">
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
  const mobileDockItems = navItems.filter((i) => i.inMobileDock).slice(0, 4);

  const groupedNav = navItems.reduce<Array<{ group: string; items: NavItem[] }>>((acc, item) => {
    const existing = acc.find((g) => g.group === item.group);
    if (existing) existing.items.push(item);
    else acc.push({ group: item.group, items: [item] });
    return acc;
  }, []);

  const activeShop = shops.find((s) => s.shopId === selectedShopId);
  const isSuspended =
    merchant?.status === 'SUSPENDED' ||
    merchant?.status === 'TERMINATED' ||
    activeShop?.status === 'SUSPENDED';
  const isPastDue = merchant?.status === 'PAST_DUE';

  const visibleAnnouncements = announcements.filter((a) => !dismissedAnn.includes(a.id));

  const isNavActive = (href: string) =>
    pathname === href ||
    (href !== '/admin' && href !== '/owner' && href !== '/agent' && pathname.startsWith(href));

  const currentNavItem = navItems.find((i) => isNavActive(i.href)) || navItems[0];
  const CurrentIcon = currentNavItem?.icon || LayoutDashboard;

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
    const match = navItems.find(
      (i) => i.label.toLowerCase().includes(q) || (i.shortLabel || '').toLowerCase().includes(q),
    );
    if (match) {
      router.push(match.href);
      setQuickJump('');
    }
  };

  const sidebarWidthClass = expanded ? 'lg:w-60' : 'lg:w-[72px]';
  const contentOffsetClass = expanded ? 'lg:pl-60' : 'lg:pl-[72px]';
  const headerLeftClass = expanded ? 'lg:left-60' : 'lg:left-[72px]';

  return (
    <div className="min-h-screen w-full bg-porcelain-100">
      {/* Overlay mobile drawer */}
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-forest-950/65 backdrop-blur-xs lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      {/* Sidebar FIXE plein hauteur (100dvh) — ne défile JAMAIS avec la page */}
      <aside
        aria-label="Navigation principale"
        className={`no-print fixed inset-y-0 left-0 z-50 flex h-dvh flex-col border-r border-white/[0.08] bg-forest-950 text-slate-200 transition-all duration-200 ${sidebarWidthClass} ${
          mobileOpen ? 'w-72 translate-x-0 shadow-2xl' : 'w-72 -translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/[0.08] px-3.5">
          <Link
            href={navItems[0]?.href || '/'}
            className="flex items-center gap-2.5 overflow-hidden"
            title="ShopControl"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-forest-700 font-black tracking-tight text-white shadow-sm ring-1 ring-white/20">
              SC
            </span>
            {expanded || mobileOpen ? (
              <div className="truncate">
                <p className="truncate text-sm font-extrabold tracking-tight text-white">ShopControl</p>
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

        {/* CTA rapide vert lime */}
        <div className="shrink-0 px-3 pb-2 pt-3">
          <Link
            href={quickActionHref}
            onClick={() => setMobileOpen(false)}
            title={navRole === 'SUPER_ADMIN' ? 'Nouveau marchand' : 'Nouvelle vente POS'}
            className={`flex items-center justify-center gap-2 rounded-2xl bg-limeglow-400 py-2.5 text-xs font-extrabold text-forest-950 shadow-lime transition hover:bg-limeglow-300 ${
              expanded || mobileOpen ? 'px-3' : 'px-0'
            }`}
          >
            <Plus className="h-4 w-4 shrink-0 stroke-[2.6]" />
            {expanded || mobileOpen ? (
              <span className="truncate">
                {navRole === 'SUPER_ADMIN' ? 'Nouveau marchand' : 'Nouvelle vente POS'}
              </span>
            ) : null}
          </Link>
        </div>

        {/* Menu principal scrollable indépendamment à l'intérieur du sidebar fixe */}
        <nav className="flex-1 space-y-3 overflow-y-auto px-3 py-2">
          {groupedNav.map((section) => (
            <div key={section.group} className="space-y-0.5">
              {expanded || mobileOpen ? (
                <p className="px-2.5 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wider text-emerald-200/45">
                  {section.group}
                </p>
              ) : null}
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = isNavActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    title={!expanded && !mobileOpen ? item.label : undefined}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-all ${
                      active
                        ? 'bg-white font-semibold text-forest-950 shadow-sm'
                        : 'text-[#8aa8a2] hover:bg-white/[0.08] hover:text-white'
                    } ${!expanded && !mobileOpen ? 'justify-center px-0' : ''}`}
                  >
                    <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-brand-700' : ''}`} />
                    {expanded || mobileOpen ? <span className="truncate">{item.label}</span> : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Pied fixe du sidebar */}
        <div className="shrink-0 space-y-1.5 border-t border-white/[0.08] p-3">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Replier le menu' : 'Déplier le menu'}
            className={`hidden w-full items-center gap-3 rounded-xl px-3 py-2 text-xs font-medium text-[#8aa8a2] hover:bg-white/10 hover:text-white lg:flex ${
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
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-xs font-medium text-[#8aa8a2] hover:bg-rose-500/20 hover:text-rose-200 ${
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
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-forest-700 text-xs font-bold text-emerald-100 ring-2 ring-limeglow-400/50">
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

      {/* Header FIXE en haut — sans AUCUNE répétition des liens du sidebar */}
      <header
        className={`no-print fixed left-0 right-0 top-0 z-30 flex h-16 items-center justify-between gap-2 border-b border-white/[0.08] bg-forest-950/95 px-3 text-white backdrop-blur-md transition-all duration-200 sm:px-5 lg:px-6 ${headerLeftClass}`}
      >
        {/* Gauche : Hamburger mobile + Contexte / Titre de la page active */}
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Ouvrir la navigation"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white hover:bg-white/15 lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>

          <span className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.08] text-limeglow-400 sm:flex">
            <CurrentIcon className="h-4 w-4" />
          </span>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-extrabold tracking-tight text-white">
                {currentNavItem?.label || 'ShopControl'}
              </p>
              {currentNavItem?.group ? (
                <span className="hidden rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] font-semibold text-emerald-200/80 md:inline-block">
                  {currentNavItem.group}
                </span>
              ) : null}
            </div>
            <p className="hidden truncate text-[11px] text-emerald-200/60 sm:block">
              {merchant?.name || 'Plateforme ShopControl'}
              {activeShop ? ` · ${activeShop.shopName}` : selectedShopId === 'ALL' && user.role === 'OWNER' ? ' · Vue consolidée' : ''}
            </p>
          </div>
        </div>

        {/* Droite : Accès rapide page, Sélecteur boutique, Statut réseau, Notifications */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
          <form onSubmit={handleQuickJumpSubmit} className="relative hidden md:block">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-[#7d9c97]" />
            <input
              type="search"
              value={quickJump}
              onChange={(e) => setQuickJump(e.target.value)}
              placeholder="Aller à une page…"
              className="w-44 rounded-full border border-white/10 bg-forest-800/80 py-1.5 pl-8 pr-3 text-xs text-white placeholder-[#7d9c97] transition focus:w-56 focus:border-limeglow-400"
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
                className="max-w-[145px] truncate rounded-full border border-white/15 bg-forest-800/90 px-2.5 py-1.5 text-xs font-semibold text-white hover:border-limeglow-400/60 sm:max-w-[210px] sm:px-3.5"
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
            <span className="hidden items-center gap-1 rounded-full bg-forest-800 px-3 py-1.5 text-xs font-semibold text-emerald-100 ring-1 ring-white/10 sm:inline-flex">
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
            className={`inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-[11px] font-semibold sm:px-2.5 ${
              isOnline && apiReachable
                ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/25'
                : 'bg-amber-400/20 text-amber-200 ring-1 ring-amber-300/30'
            }`}
          >
            {isOnline && apiReachable ? (
              <>
                <Wifi className="h-3.5 w-3.5" />
                <span className="hidden xl:inline">En ligne</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3.5 w-3.5" />
                <span className="hidden xl:inline">Hors ligne</span>
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
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-forest-950">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              ) : null}
            </button>

            {notifOpen ? (
              <div className="fixed inset-x-3 top-[68px] z-50 rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96">
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
                        className={`block w-full px-4 py-3 text-left transition hover:bg-slate-50 ${
                          !n.isRead ? 'bg-brand-50/50' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`text-xs font-bold ${
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

      {/* Contenu principal décalé sous le header fixe (pt-16) et à droite du sidebar fixe */}
      <div className={`flex min-h-screen flex-col pt-16 transition-all duration-200 ${contentOffsetClass}`}>
        {/* Bandeaux d'alertes + Hero éventuel */}
        {visibleAnnouncements.length > 0 ||
        user.mustSetupTwoFactor ||
        supportGrantId ||
        isSuspended ||
        isPastDue ||
        hero ? (
          <div className="no-print obsidian-hero text-white">
            {visibleAnnouncements.slice(0, 1).map((ann) => (
              <div
                key={ann.id}
                className={`flex items-center justify-between gap-3 px-4 py-2 text-xs font-medium lg:px-6 ${
                  ann.priority === 'URGENT'
                    ? 'bg-rose-600 text-white'
                    : ann.priority === 'WARNING'
                      ? 'bg-amber-400 text-forest-950'
                      : 'bg-brand-700/90 text-white'
                }`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Megaphone className="h-4 w-4 shrink-0" />
                  <span className="truncate">
                    <strong>{ann.title} :</strong> {ann.body}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setDismissedAnn((prev) => [...prev, ann.id])}
                  aria-label="Masquer l’annonce"
                  className="rounded-lg p-1 hover:bg-black/10"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

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
        ) : null}

        {/* Zone principale scrollable */}
        <main className="w-full flex-1 p-3 pb-24 sm:p-5 sm:pb-24 lg:p-6 lg:pb-8">{children}</main>

        {/* Dock mobile natif fixé en bas (< lg) */}
        <nav
          aria-label="Navigation rapide mobile"
          className="no-print fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-white/10 bg-forest-950/95 px-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-[10px] font-semibold text-[#8aa8a2] backdrop-blur-md lg:hidden"
        >
          {mobileDockItems.map((item) => {
            const Icon = item.icon;
            const active = isNavActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1.5 py-1 transition ${
                  active ? 'bg-white text-forest-950' : 'hover:text-white'
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
