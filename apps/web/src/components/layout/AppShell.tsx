'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crown,
  Gift,  Database,
  Eye,
  FileSearch,
  FileText,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MessageSquare,
  Package,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Store,
  Truck,
  Upload,
  User,
  UserCheck,
  Users,
  Wallet,
  Wrench,
  X,
} from 'lucide-react';
import { PermissionKey, USER_ROLE_LABELS, UserRole } from '@shopcontrol/shared';
import { apiFetch } from '@/lib/api-client';
import { OwnerWorkspaceMode, useAuth } from '@/components/providers/AuthProvider';
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

const OWNER_SUPERVISION_NAV: NavItem[] = [
  { href: '/owner', label: 'Tableau de bord', shortLabel: 'Accueil', group: 'Pilotage', icon: LayoutDashboard, inMobileDock: true },
  { href: '/owner/shops', label: 'Boutiques & QR', shortLabel: 'Boutiques', group: 'Pilotage', icon: Store, inMobileDock: true },
  { href: '/owner/reports', label: 'Bilans & Exports', shortLabel: 'Bilans', group: 'Pilotage', icon: BarChart3, inMobileDock: true },
  { href: '/owner/subscription', label: 'Mon abonnement', shortLabel: 'Abonnement', group: 'Pilotage', icon: Crown },
  { href: '/owner/agents', label: 'Équipe & Agents', shortLabel: 'Agents', group: 'Organisation', icon: Users },
  { href: '/owner/growth', label: 'Croissance & Compta', shortLabel: 'Croissance', group: 'Pilotage', icon: Gift },
  { href: '/owner/operators', label: 'Opérateurs', group: 'Organisation', icon: UserCheck },
  { href: '/messaging', label: 'Messagerie', shortLabel: 'Messages', group: 'Communication', icon: MessageSquare, inMobileDock: true },
];

const OWNER_MANAGEMENT_NAV: NavItem[] = [
  { href: '/pos', label: 'Ventes / POS', shortLabel: 'POS', group: 'Comptoir', icon: ShoppingCart, inMobileDock: true },
  { href: '/commerce/orders', label: 'Commandes QR', shortLabel: 'Cmds', group: 'Comptoir', icon: ShoppingBag, inMobileDock: true },
  { href: '/commerce/cash', label: 'Caisse', group: 'Comptoir', icon: Banknote, inMobileDock: true },
  { href: '/commerce/documents', label: 'Tickets & Avoirs', shortLabel: 'Tickets', group: 'Comptoir', icon: FileText },
  { href: '/commerce/products', label: 'Produits', group: 'Catalogue', icon: Package, inMobileDock: true },
  { href: '/commerce/stock', label: 'Stocks', group: 'Catalogue', icon: Boxes },
  { href: '/commerce/clients', label: 'Clients & Dettes', shortLabel: 'Clients', group: 'Gestion', icon: Receipt },
  { href: '/commerce/purchases', label: 'Achats', group: 'Gestion', icon: Truck },
  { href: '/commerce/expenses', label: 'Dépenses', group: 'Gestion', icon: Wallet },
  { href: '/commerce/transfers', label: 'Transferts', group: 'Gestion', icon: ArrowLeftRight },
  { href: '/messaging', label: 'Messagerie', shortLabel: 'Messages', group: 'Communication', icon: MessageSquare },
];

const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Tableau de bord', shortLabel: 'Accueil', group: 'Plateforme', icon: LayoutDashboard, inMobileDock: true },
  { href: '/admin/merchants', label: 'Marchands', group: 'Plateforme', icon: Building2, inMobileDock: true },
  { href: '/admin/shops', label: 'Boutiques & BDD', shortLabel: 'Boutiques', group: 'Plateforme', icon: Database, inMobileDock: true },
  { href: '/admin/platform', label: 'Abonnements & Support', shortLabel: 'SaaS', group: 'Plateforme', icon: Crown, inMobileDock: true },
  { href: '/messaging', label: 'Messagerie', group: 'Communication', icon: MessageSquare },
  { href: '/admin/security', label: 'Sécurité & Audit', shortLabel: 'Sécurité', group: 'Sécurité', icon: ShieldCheck },
];

const AGENT_NAV: NavItem[] = [
  { href: '/agent', label: 'Accueil boutique', shortLabel: 'Accueil', group: 'Comptoir', icon: Store, inMobileDock: true },
  { href: '/pos', label: 'Ventes / POS', shortLabel: 'POS', group: 'Comptoir', icon: ShoppingCart, requiredPerm: 'sales:read', inMobileDock: true },
  { href: '/commerce/orders', label: 'Commandes QR', shortLabel: 'Cmds', group: 'Comptoir', icon: ShoppingBag, requiredPerm: 'orders:read', inMobileDock: true },
  { href: '/commerce/cash', label: 'Caisse', group: 'Comptoir', icon: Banknote, requiredPerm: 'cash:read', inMobileDock: true },
  { href: '/commerce/documents', label: 'Tickets & Avoirs', shortLabel: 'Tickets', group: 'Comptoir', icon: FileText, requiredPerm: 'sales:read' },
  { href: '/commerce/products', label: 'Produits', group: 'Gestion', icon: Package, requiredPerm: 'products:read' },
  { href: '/commerce/stock', label: 'Stocks', group: 'Gestion', icon: Boxes, requiredPerm: 'stock:read' },
  { href: '/commerce/clients', label: 'Clients & Dettes', shortLabel: 'Clients', group: 'Gestion', icon: Receipt, requiredPerm: 'clients:read' },
  { href: '/commerce/purchases', label: 'Achats', group: 'Gestion', icon: Truck, requiredPerm: 'purchases:read' },
  { href: '/commerce/expenses', label: 'Dépenses', group: 'Gestion', icon: Wallet, requiredPerm: 'expenses:create' },
  { href: '/commerce/transfers', label: 'Transferts', group: 'Gestion', icon: ArrowLeftRight, requiredPerm: 'stock:read' },
  { href: '/messaging', label: 'Messagerie', group: 'Communication', icon: MessageSquare },
];

export function AppShell({
  allowedRoles,
  hero,
  title,
  subtitle,
  headerActions,
  children,
}: {
  allowedRoles: UserRole[];
  hero?: React.ReactNode;
  title?: string;
  subtitle?: string;
  headerActions?: React.ReactNode;
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
    ownerMode,
    setOwnerMode,
    activeOperator,
    supportGrantId,
    setSupportGrantId,
    logout,
  } = useAuth();

  // Sidebar fermé par défaut sur desktop et rétractable sur mobile
  const [expanded, setExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileCollapsed, setMobileCollapsed] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [dismissedAnn, setDismissedAnn] = useState<string[]>([]);

  const notifRef = useRef<HTMLDivElement | null>(null);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const touchStartXRef = useRef<number | null>(null);

  // Fermeture des menus déroulants au clic extérieur
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

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
      <div className="min-h-screen w-full bg-[#edf1f5] p-4 sm:p-6">
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
      <div className="flex min-h-screen w-full items-center justify-center bg-[#edf1f5] p-6">
        <AccessDeniedState />
      </div>
    );
  }

  const navRole =
    user.role === 'SUPER_ADMIN' && supportGrantId
      ? 'OWNER'
      : (user.role as 'SUPER_ADMIN' | 'OWNER' | 'AGENT');

  const isOwnerLike = navRole === 'OWNER';
  const agentPerms = user.role === 'AGENT' ? shops[0]?.permissions : null;

  const rawNav =
    navRole === 'SUPER_ADMIN'
      ? ADMIN_NAV
      : navRole === 'AGENT'
        ? AGENT_NAV
        : ownerMode === 'management'
          ? OWNER_MANAGEMENT_NAV
          : OWNER_SUPERVISION_NAV;

  const navItems = rawNav.filter((item) => {
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
  // Marque dynamique dans le sidebar : logo & nom de la boutique active (ou première boutique / entreprise)
  const brandShop = activeShop || shops[0] || null;
  const brandTitle =
    user.role === 'SUPER_ADMIN' && !supportGrantId
      ? 'Administration'
      : activeShop
        ? activeShop.shopName
        : shops.length === 1
          ? shops[0].shopName
          : merchant?.name || 'Espace Boutique';
  const brandSubtitle =
    user.role === 'SUPER_ADMIN' && !supportGrantId
      ? 'Plateforme'
      : activeShop && merchant?.name && activeShop.shopName !== merchant.name
        ? merchant.name
        : USER_ROLE_LABELS[user.role];
  const brandLogoUrl = brandShop?.logoUrl || null;
  const brandMonogram = brandTitle
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || 'B';

  const isSuspended =
    merchant?.status === 'SUSPENDED' ||
    merchant?.status === 'TERMINATED' ||
    activeShop?.status === 'SUSPENDED';
  const isPastDue = merchant?.status === 'PAST_DUE';
  const visibleAnnouncements = announcements.filter((a) => !dismissedAnn.includes(a.id));

  const allPossibleNav = [
    ...OWNER_SUPERVISION_NAV,
    ...OWNER_MANAGEMENT_NAV,
    ...ADMIN_NAV,
    ...AGENT_NAV,
  ];
  const isNavActive = (href: string) =>
    pathname === href ||
    (href !== '/admin' && href !== '/owner' && href !== '/agent' && pathname.startsWith(href));

  const currentNavItem =
    navItems.find((i) => isNavActive(i.href)) ||
    allPossibleNav.find((i) => isNavActive(i.href)) ||
    null;

  const pageTitle =
    pathname === '/owner/settings'
      ? 'Paramètres & Boutique'
      : pathname === '/owner/audit'
        ? 'Journal d’audit'
        : pathname === '/commerce/import'
          ? 'Import CSV'
          : pathname === '/agent/profile'
            ? 'Mon profil'
            : pathname === '/setup-2fa'
              ? 'Sécurité 2FA'
              : currentNavItem?.label || brandTitle;

  const CurrentIcon =
    pathname === '/owner/settings'
      ? Settings
      : pathname === '/owner/audit'
        ? FileSearch
        : pathname === '/commerce/import'
          ? Upload
          : pathname === '/agent/profile'
            ? User
            : currentNavItem?.icon || LayoutDashboard;

  const initials = user.fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

  const profileHref =
    user.role === 'AGENT'
      ? '/agent/profile'
      : user.role === 'SUPER_ADMIN' && !supportGrantId
        ? '/admin/security'
        : '/owner/settings';

  const settingsHref =
    user.role === 'AGENT'
      ? '/agent/profile'
      : user.role === 'SUPER_ADMIN' && !supportGrantId
        ? '/admin/platform'
        : '/owner/settings';

  const handleSwitchOwnerMode = (nextMode: OwnerWorkspaceMode) => {
    setOwnerMode(nextMode);
    setMobileOpen(false);
    if (nextMode === 'management') {
      if (pathname === '/owner' || pathname.startsWith('/owner/')) {
        router.push('/pos');
      }
    } else {
      if (pathname === '/pos' || pathname.startsWith('/commerce/')) {
        router.push('/owner');
      }
    }
  };

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
    setProfileOpen(false);
    await logout();
    router.replace('/login');
  };

  const showLabels = mobileOpen ? !mobileCollapsed : expanded;
  const sidebarWidthClass = expanded ? 'lg:w-[216px]' : 'lg:w-[64px]';
  const contentOffsetClass = expanded ? 'lg:pl-[216px]' : 'lg:pl-[64px]';
  const headerLeftClass = expanded ? 'lg:left-[216px]' : 'lg:left-[64px]';

  return (
    <div className="min-h-screen w-full overflow-x-clip overscroll-none bg-porcelain-100">
      {/* Overlay mobile drawer */}
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-forest-950/65 backdrop-blur-xs lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      {/* Sidebar FIXE, rétractable sur desktop ET sur mobile — sans profil ni déconnexion */}
      <aside
        aria-label="Navigation principale"
        onTouchStart={(e) => {
          touchStartXRef.current = e.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          if (touchStartXRef.current === null) return;
          const endX = e.changedTouches[0]?.clientX ?? touchStartXRef.current;
          if (endX - touchStartXRef.current < -48) {
            setMobileOpen(false);
          }
          touchStartXRef.current = null;
        }}
        className={`no-print overscroll-none fixed inset-y-0 left-0 z-50 flex h-dvh flex-col border-r border-white/[0.07] bg-forest-950 pt-[env(safe-area-inset-top,0px)] text-slate-200 transition-all duration-200 ${sidebarWidthClass} ${
          mobileOpen
            ? `${mobileCollapsed ? 'w-[68px]' : 'w-64'} translate-x-0 shadow-2xl`
            : 'w-64 -translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Marque dynamique : Logo + Nom de la boutique */}
        <div
          className={`flex h-14 shrink-0 items-center border-b border-white/[0.08] ${
            !showLabels ? 'justify-center px-2' : 'justify-between px-3'
          }`}
        >
          <Link
            href={navItems[0]?.href || '/'}
            onClick={() => setMobileOpen(false)}
            className={`flex min-w-0 items-center gap-2.5 overflow-hidden ${
              !showLabels ? 'mx-auto' : ''
            }`}
            title={brandTitle}
          >
            {brandLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brandLogoUrl}
                alt={brandTitle}
                className="h-9 w-9 shrink-0 rounded-xl border border-white/15 bg-white object-contain p-0.5"
              />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-forest-700 text-xs font-extrabold tracking-tight text-white ring-1 ring-white/15">
                {brandMonogram}
              </span>
            )}
            {showLabels ? (
              <div className="min-w-0">
                <p className="truncate text-[13px] font-bold tracking-tight text-white">
                  {brandTitle}
                </p>
                <p className="truncate text-[10px] text-emerald-200/65">{brandSubtitle}</p>
              </div>
            ) : null}
          </Link>
          {mobileOpen && !mobileCollapsed ? (
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Fermer le menu"
              className="rounded-lg p-1.5 text-emerald-200/70 hover:bg-white/10 hover:text-white lg:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {/* Sélecteur Supervision / Gestion dans le tiroir mobile pour OWNER */}
        {isOwnerLike && mobileOpen && !mobileCollapsed ? (
          <div className="shrink-0 border-b border-white/[0.07] p-2.5 lg:hidden">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-forest-900 p-1 text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => handleSwitchOwnerMode('supervision')}
                className={`flex items-center justify-center gap-1 rounded-lg py-1.5 transition ${
                  ownerMode === 'supervision'
                    ? 'bg-limeglow-400 text-forest-950 font-bold'
                    : 'text-emerald-200/75 hover:text-white'
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                Supervision
              </button>
              <button
                type="button"
                onClick={() => handleSwitchOwnerMode('management')}
                className={`flex items-center justify-center gap-1 rounded-lg py-1.5 transition ${
                  ownerMode === 'management'
                    ? 'bg-limeglow-400 text-forest-950 font-bold'
                    : 'text-emerald-200/75 hover:text-white'
                }`}
              >
                <Wrench className="h-3.5 w-3.5" />
                Gestion
              </button>
            </div>
          </div>
        ) : null}

        {/* Navigation épurée */}
        <nav className="flex-1 space-y-2.5 overflow-y-auto px-2.5 py-3">
          {groupedNav.map((section) => (
            <div key={section.group} className="space-y-0.5">
              {showLabels ? (
                <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-200/40">
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
                    title={!showLabels ? item.label : undefined}
                    className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[12.5px] font-medium transition-all ${
                      active
                        ? 'bg-white font-semibold text-forest-950 shadow-xs'
                        : 'text-[#8aa8a2] hover:bg-white/[0.08] hover:text-white'
                    } ${!showLabels ? 'justify-center px-0' : ''}`}
                  >
                    <Icon className={`h-[17px] w-[17px] shrink-0 ${active ? 'text-brand-700' : ''}`} />
                    {showLabels ? <span className="truncate">{item.label}</span> : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Bouton d'ouverture/repli desktop ET mobile */}
        <div className="shrink-0 space-y-1 border-t border-white/[0.07] p-2.5">
          <button
            type="button"
            onClick={() => setMobileCollapsed((v) => !v)}
            aria-label={mobileCollapsed ? 'Déplier le menu mobile' : 'Réduire le menu mobile'}
            title={mobileCollapsed ? 'Déplier' : 'Réduire'}
            className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-medium text-[#8aa8a2] transition hover:bg-white/10 hover:text-white lg:hidden ${
              mobileCollapsed ? 'justify-center px-0' : ''
            }`}
          >
            {mobileCollapsed ? (
              <ChevronRight className="h-4 w-4 shrink-0" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4 shrink-0" />
                <span>Réduire</span>
              </>
            )}
          </button>

          {mobileCollapsed ? (
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Fermer le menu"
              title="Fermer le menu"
              className="flex w-full items-center justify-center rounded-xl py-2 text-xs font-medium text-emerald-200/75 transition hover:bg-white/10 hover:text-white lg:hidden"
            >
              <X className="h-4 w-4 shrink-0" />
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Replier le menu' : 'Ouvrir le menu'}
            title={expanded ? 'Replier' : 'Déplier le menu'}
            className={`hidden w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-medium text-[#8aa8a2] transition hover:bg-white/10 hover:text-white lg:flex ${
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
        </div>
      </aside>

      {/* Header FIXE Obsidian Emerald — profil cliquable & sélecteur Supervision/Gestion */}
      <header
        className={`no-print fixed left-0 right-0 top-0 z-30 flex min-h-14 items-center justify-between gap-2 border-b border-white/[0.08] bg-forest-950 px-3 pt-[env(safe-area-inset-top,0px)] text-white transition-all duration-200 sm:px-5 ${headerLeftClass}`}
        style={{ height: 'calc(3.5rem + env(safe-area-inset-top, 0px))' }}
      >
        {/* Gauche : Hamburger mobile + Titre page active */}
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setMobileCollapsed(false);
              setMobileOpen(true);
            }}
            aria-label="Ouvrir la navigation"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white hover:bg-white/15 lg:hidden"
          >
            <Menu className="h-4 w-4" />
          </button>

          <span className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.08] text-limeglow-400 sm:flex">
            <CurrentIcon className="h-4 w-4" />
          </span>

          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold tracking-tight text-white sm:text-sm">
              {pageTitle}
            </p>
            <p className="hidden truncate text-[11px] text-emerald-200/65 md:block">
              {brandTitle}
              {user.role === 'AGENT' && activeOperator ? ` · Op. ${activeOperator.firstName}` : ''}
            </p>
          </div>
        </div>

        {/* Droite : Mode Supervision/Gestion (OWNER), Boutique, Réseau, Notifications, Profil */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {/* Sélecteur Mode Supervision / Mode Gestion pour Propriétaire */}
          {isOwnerLike ? (
            <div
              role="group"
              aria-label="Mode de travail propriétaire"
              className="hidden items-center rounded-full border border-white/10 bg-forest-800/80 p-0.5 text-[11px] font-semibold md:inline-flex"
            >
              <button
                type="button"
                onClick={() => handleSwitchOwnerMode('supervision')}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition ${
                  ownerMode === 'supervision'
                    ? 'bg-white text-forest-950 font-bold shadow-xs'
                    : 'text-[#8aa8a2] hover:text-white'
                }`}
              >
                <Eye className="h-3 w-3" />
                <span>Supervision</span>
              </button>
              <button
                type="button"
                onClick={() => handleSwitchOwnerMode('management')}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition ${
                  ownerMode === 'management'
                    ? 'bg-white text-forest-950 font-bold shadow-xs'
                    : 'text-[#8aa8a2] hover:text-white'
                }`}
              >
                <Wrench className="h-3 w-3" />
                <span>Gestion</span>
              </button>
            </div>
          ) : null}

          {/* Sélecteur de boutique (OWNER) */}
          {isOwnerLike && shops.length > 0 ? (
            <div className="flex items-center">
              <label htmlFor="shop-selector" className="sr-only">
                Sélectionner une boutique
              </label>
              <select
                id="shop-selector"
                value={selectedShopId}
                onChange={(e) => setSelectedShopId(e.target.value)}
                className="max-w-[115px] truncate rounded-full border border-white/15 bg-forest-800/90 px-2.5 py-1.5 text-xs font-semibold text-white hover:border-limeglow-400/60 sm:max-w-[175px] sm:px-3"
              >
                {ownerMode === 'supervision' ? (
                  <option value="ALL" className="bg-forest-900 text-white">
                    Toutes (Consolidé)
                  </option>
                ) : null}
                {shops.map((s) => (
                  <option key={s.shopId} value={s.shopId} className="bg-forest-900 text-white">
                    {s.shopName} {s.status !== 'ACTIVE' ? `(${s.status})` : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {/* Notifications */}
          <div className="relative" ref={notifRef}>
            <button
              type="button"
              onClick={() => {
                setNotifOpen((o) => !o);
                setProfileOpen(false);
              }}
              aria-label="Centre de notifications"
              className="relative flex h-9 w-9 items-center justify-center rounded-full bg-forest-800 text-emerald-100 ring-1 ring-white/10 transition hover:bg-forest-700"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-forest-950">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              ) : null}
            </button>

            {notifOpen ? (
              <div
                className="fixed inset-x-3 z-50 rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-80"
                style={{ top: 'calc(3.75rem + env(safe-area-inset-top, 0px))' }}
              >
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <h3 className="text-xs font-bold text-slate-900">
                    Notifications {unreadCount > 0 ? `(${unreadCount})` : ''}
                  </h3>
                  {unreadCount > 0 ? (
                    <button
                      type="button"
                      onClick={handleMarkAllRead}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:underline"
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                      Tout lire
                    </button>
                  ) : null}
                </div>
                <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
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
                        className={`block w-full px-4 py-2.5 text-left transition hover:bg-slate-50 ${
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
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-600">{n.message}</p>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>

          {/* Menu Profil cliquable dans le Header (Profil, Paramètres, Déconnexion) */}
          <div className="relative" ref={profileRef}>
            <button
              type="button"
              onClick={() => {
                setProfileOpen((o) => !o);
                setNotifOpen(false);
              }}
              aria-label="Menu profil utilisateur"
              aria-expanded={profileOpen}
              className="flex items-center gap-1.5 rounded-full bg-forest-800 py-1 pl-1 pr-2 text-left ring-1 ring-white/15 transition hover:bg-forest-700"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-forest-950 text-[11px] font-bold text-limeglow-400 ring-1 ring-limeglow-400/50">
                {initials || 'U'}
              </span>
              <span className="hidden max-w-[100px] truncate text-xs font-semibold text-white sm:inline">
                {user.fullName.split(' ')[0]}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-emerald-200/70" />
            </button>

            {profileOpen ? (
              <div
                className="fixed inset-x-3 z-50 rounded-2xl border border-slate-200 bg-white p-1.5 text-slate-900 shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-60"
                style={{ top: 'calc(3.75rem + env(safe-area-inset-top, 0px))' }}
              >
                <div className="border-b border-slate-100 px-3 py-2.5">
                  <p className="truncate text-xs font-bold text-slate-900">{user.fullName}</p>
                  <p className="truncate text-[11px] text-slate-500">{user.email}</p>
                  <span className="mt-1 inline-block rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-800">
                    {USER_ROLE_LABELS[user.role]}
                  </span>
                </div>

                {/* Switch rapide mobile Supervision / Gestion dans le menu profil également */}
                {isOwnerLike ? (
                  <div className="border-b border-slate-100 p-2 md:hidden">
                    <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Mode d’affichage
                    </p>
                    <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-0.5 text-[11px] font-semibold">
                      <button
                        type="button"
                        onClick={() => {
                          setProfileOpen(false);
                          handleSwitchOwnerMode('supervision');
                        }}
                        className={`rounded-lg py-1.5 ${
                          ownerMode === 'supervision'
                            ? 'bg-forest-900 text-white'
                            : 'text-slate-600'
                        }`}
                      >
                        Supervision
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setProfileOpen(false);
                          handleSwitchOwnerMode('management');
                        }}
                        className={`rounded-lg py-1.5 ${
                          ownerMode === 'management'
                            ? 'bg-forest-900 text-white'
                            : 'text-slate-600'
                        }`}
                      >
                        Gestion
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="py-1">
                  <Link
                    href={profileHref}
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 hover:text-slate-950"
                  >
                    <User className="h-4 w-4 text-slate-400" />
                    <span>Mon profil</span>
                  </Link>
                  <Link
                    href={settingsHref}
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 hover:text-slate-950"
                  >
                    <Settings className="h-4 w-4 text-slate-400" />
                    <span>Paramètres</span>
                  </Link>
                </div>

                <div className="border-t border-slate-100 pt-1">
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Déconnexion</span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {/* Contenu principal décalé sous le header fixe (pt-14 + safe-area) et à droite du sidebar fixe */}
      <div
        className={`flex min-h-screen min-w-0 flex-col transition-all duration-200 ${contentOffsetClass}`}
        style={{ paddingTop: 'calc(3.5rem + env(safe-area-inset-top, 0px))' }}
      >
        {/* Bandeaux d'alertes + Entête Obsidian Emerald présente sur TOUTES les pages */}
        <div className="no-print">
            {visibleAnnouncements.slice(0, 1).map((ann) => (
              <div
                key={ann.id}
                className={`flex items-center justify-between gap-3 px-4 py-2 text-xs font-medium lg:px-6 ${
                  ann.priority === 'URGENT'
                    ? 'bg-rose-600 text-white'
                    : ann.priority === 'WARNING'
                      ? 'bg-amber-400 text-forest-950'
                      : 'bg-brand-700 text-white'
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

            {hero ? (
              <div className="obsidian-hero px-4 pb-5 pt-4 text-white sm:px-5 lg:px-6">{hero}</div>
            ) : (
              <div className="obsidian-hero px-3.5 py-3.5 text-white sm:px-5 sm:py-4 lg:px-6">
                <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
                  <div className="min-w-0">
                    <h1 className="line-clamp-2 text-base font-extrabold tracking-tight text-white sm:truncate sm:text-xl">
                      {title || pageTitle}
                    </h1>
                    {subtitle ? (
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-emerald-200/75 sm:text-xs">
                        {subtitle}
                      </p>
                    ) : null}
                  </div>
                  {headerActions ? (
                    <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:gap-2">
                      {headerActions}
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>

        {/* Zone principale scrollable */}
        <main className="w-full min-w-0 flex-1 overflow-x-clip overscroll-none p-3 pb-24 sm:p-5 sm:pb-24 lg:p-6 lg:pb-8">
          {children}

          {/* Signature entreprise en indice en bas de page */}
          <footer className="no-print mt-10 border-t border-slate-200/70 pt-3 text-center text-[11px] text-slate-400">
            <span>Propulsé par </span>
            <sub className="bottom-[-0.18em] text-[10px] font-semibold tracking-wide text-slate-500">
              Chakir’s Entreprise
            </sub>
          </footer>
        </main>

        {/* Dock mobile natif fixé en bas (< lg) — Obsidian Emerald */}
        <nav
          aria-label="Navigation rapide mobile"
          className="no-print fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-white/10 bg-forest-950 px-1 pb-[max(0.45rem,env(safe-area-inset-bottom))] pt-1.5 text-[10px] font-semibold text-[#8aa8a2] lg:hidden"
        >
          {mobileDockItems.map((item) => {
            const Icon = item.icon;
            const active = isNavActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1 transition ${
                  active ? 'bg-white text-forest-950 font-bold' : 'hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="max-w-full truncate">{item.shortLabel || item.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => {
              setMobileCollapsed(false);
              setMobileOpen(true);
            }}
            className="flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1 hover:text-white"
          >
            <Menu className="h-4 w-4 shrink-0" />
            <span>Menu</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
