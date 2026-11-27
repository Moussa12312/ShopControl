'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  MessageSquare,
  Phone,
  Plus,
  Search,
  Send,
  ShoppingBag,
  UserCheck,
  X,
} from 'lucide-react';
import {
  CONVERSATION_TYPE_LABELS,
  ConversationType,
  formatDateTimeInTimezone,
} from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import { ImageUploader } from '@/components/ui/ImageUploader';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateViews';

interface ConversationListItem {
  id: string;
  type: ConversationType;
  shopId: string | null;
  shopName: string | null;
  subject: string;
  clientName: string | null;
  clientPhone: string | null;
  orderNumber: string | null;
  assignedAgentUserId: string | null;
  assignedAgentName: string | null;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  unreadCount: number;
}

interface ConversationDetail {
  id: string;
  type: ConversationType;
  shopId: string | null;
  subject: string;
  clientName: string | null;
  clientPhone: string | null;
  orderNumber: string | null;
  assignedAgentUserId: string | null;
  messages: Array<{
    id: string;
    senderRole: string;
    senderName: string;
    body: string;
    attachmentUrl: string | null;
    createdAt: string;
  }>;
}

interface AgentOpt {
  id: string;
  fullName: string;
}

function getInitials(label: string): string {
  return (
    label
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || 'SC'
  );
}

function MessagingContent() {
  const searchParams = useSearchParams();
  const initialConvId = searchParams.get('c') || '';
  const { user, shops, selectedShopId } = useAuth();

  const [convs, setConvs] = useState<ConversationListItem[]>([]);
  const [selectedId, setSelectedId] = useState(initialConvId);
  const [mobileShowThread, setMobileShowThread] = useState(Boolean(initialConvId));
  const [typeFilter, setTypeFilter] = useState<'' | ConversationType>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [agents, setAgents] = useState<AgentOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [bodyText, setBodyText] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  // Modale nouvelle conversation
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState({
    type: (user?.role === 'SUPER_ADMIN'
      ? 'SUPPORT_ADMIN_OWNER'
      : 'INTERNAL_OWNER_AGENT') as ConversationType,
    shopId: shops[0]?.shopId || '',
    subject: '',
    clientName: '',
    clientPhone: '',
    initialMessage: '',
  });

  const loadList = useCallback(async () => {
    try {
      const qs =
        user?.role === 'OWNER' && selectedShopId !== 'ALL' ? `?shopId=${selectedShopId}` : '';
      const list = await apiFetch<ConversationListItem[]>(`/messaging/conversations${qs}`, {
        requiresOnline: false,
      });
      setConvs(list);
      setSelectedId((prev) => prev || list[0]?.id || '');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement de la messagerie.');
    } finally {
      setLoading(false);
    }
  }, [user?.role, selectedShopId]);

  const loadDetail = useCallback(
    async (id: string) => {
      if (!id) {
        setDetail(null);
        return;
      }
      try {
        const res = await apiFetch<ConversationDetail>(`/messaging/conversations/${id}`, {
          requiresOnline: false,
        });
        setDetail(res);
        if (user?.role === 'OWNER' && res.shopId) {
          apiFetch<AgentOpt[]>(`/shops/${res.shopId}/agents`, { shopId: res.shopId })
            .then(setAgents)
            .catch(() => setAgents([]));
        } else {
          setAgents([]);
        }
      } catch {
        // ignore
      }
    },
    [user?.role],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [detail?.messages.length, selectedId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadList();
      if (selectedId) void loadDetail(selectedId);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [loadList, loadDetail, selectedId]);

  const filteredConvs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return convs.filter((c) => {
      if (typeFilter && c.type !== typeFilter) return false;
      if (!q) return true;
      return (
        c.subject.toLowerCase().includes(q) ||
        (c.clientName && c.clientName.toLowerCase().includes(q)) ||
        (c.clientPhone && c.clientPhone.toLowerCase().includes(q)) ||
        (c.lastMessagePreview && c.lastMessagePreview.toLowerCase().includes(q))
      );
    });
  }, [convs, typeFilter, searchQuery]);

  const handleSelectConversation = (id: string) => {
    setSelectedId(id);
    setMobileShowThread(true);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId || !bodyText.trim()) return;
    setSending(true);
    try {
      await apiFetch(`/messaging/conversations/${selectedId}/messages`, {
        method: 'POST',
        body: { body: bodyText.trim(), attachmentUrl },
      });
      setBodyText('');
      setAttachmentUrl(null);
      await Promise.all([loadDetail(selectedId), loadList()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Envoi impossible.');
    } finally {
      setSending(false);
    }
  };

  const handleAssign = async (agentId: string) => {
    if (!selectedId) return;
    await apiFetch(`/messaging/conversations/${selectedId}/assign`, {
      method: 'PATCH',
      body: { assignedAgentUserId: agentId || null },
    });
    await Promise.all([loadDetail(selectedId), loadList()]);
  };

  const handleCreateConv = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const created = await apiFetch<{ id: string }>('/messaging/conversations', {
        method: 'POST',
        body: {
          type: newForm.type,
          shopId:
            newForm.type === 'SUPPORT_ADMIN_OWNER'
              ? null
              : newForm.shopId || shops[0]?.shopId || null,
          subject: newForm.subject.trim(),
          clientName: newForm.type === 'CLIENT_SHOP' ? newForm.clientName.trim() || undefined : undefined,
          clientPhone:
            newForm.type === 'CLIENT_SHOP' ? newForm.clientPhone.trim() || undefined : undefined,
          initialMessage: newForm.initialMessage.trim(),
        },
      });
      setNewOpen(false);
      setNewForm({
        type: user?.role === 'SUPER_ADMIN' ? 'SUPPORT_ADMIN_OWNER' : 'INTERNAL_OWNER_AGENT',
        shopId: shops[0]?.shopId || '',
        subject: '',
        clientName: '',
        clientPhone: '',
        initialMessage: '',
      });
      setSelectedId(created.id);
      setMobileShowThread(true);
      await loadList();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de créer la conversation.');
    } finally {
      setSending(false);
    }
  };

  return (
    <AppShell
      allowedRoles={['SUPER_ADMIN', 'OWNER', 'AGENT']}
      title="Messagerie Unifiée"
      subtitle="Discussions clients vitrine QR, coordination équipe et support plateforme."
      headerActions={
        user?.role !== 'SUPER_ADMIN' ? (
          <button type="button" onClick={() => setNewOpen(true)} className="sc-hero-btn-primary">
            <Plus className="h-3.5 w-3.5" />
            Nouvelle discussion
          </button>
        ) : null
      }
    >
      <div className="space-y-4">

        {error ? <ErrorState message={error} onRetry={loadList} /> : null}

        {loading ? (
          <LoadingSkeleton rows={5} />
        ) : convs.length === 0 ? (
          <EmptyState
            title="Boîte de réception vide"
            description="Les messages clients depuis votre vitrine QR et vos discussions d’équipe apparaîtront ici en temps réel."
            action={
              user?.role !== 'SUPER_ADMIN' ? (
                <button type="button" onClick={() => setNewOpen(true)} className="sc-btn-primary text-xs">
                  Démarrer une discussion
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="sc-card grid overflow-hidden lg:grid-cols-12 h-[calc(100dvh-5.5rem)] sm:h-[calc(100dvh-12rem)]">
            {/* Colonne Liste des conversations */}
            <aside
              className={`flex flex-col overflow-hidden border-r border-slate-200/80 bg-white lg:col-span-4 lg:flex ${
                mobileShowThread ? 'hidden' : 'flex'
              }`}
            >
              {/* Recherche & Filtres */}
              <div className="space-y-2.5 border-b border-slate-100 bg-porcelain-50 p-3.5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Rechercher un client, objet…"
                    className="sc-input py-2 pl-8 text-xs"
                  />
                </div>
                <div className="flex gap-1 overflow-x-auto pb-0.5 text-[11px] font-bold">
                  {(
                    [
                      { key: '', label: `Toutes (${convs.length})` },
                      { key: 'CLIENT_SHOP', label: 'Clients' },
                      { key: 'INTERNAL_OWNER_AGENT', label: 'Équipe' },
                      { key: 'SUPPORT_ADMIN_OWNER', label: 'Support' },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setTypeFilter(f.key)}
                      className={`shrink-0 rounded-full px-2.5 py-1 transition ${
                        typeFilter === f.key
                          ? 'bg-forest-900 text-white'
                          : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Liste scrollable */}
              <div className="flex-1 divide-y divide-slate-100 overflow-y-auto">
                {filteredConvs.length === 0 ? (
                  <p className="p-8 text-center text-xs text-slate-400">
                    Aucune discussion ne correspond à votre recherche.
                  </p>
                ) : (
                  filteredConvs.map((c) => {
                    const active = c.id === selectedId;
                    const displayTitle = c.clientName || c.subject;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleSelectConversation(c.id)}
                        className={`flex w-full items-start gap-3 px-4 py-3.5 text-left transition ${
                          active
                            ? 'bg-forest-900 text-white'
                            : c.unreadCount > 0
                              ? 'bg-brand-50/40 hover:bg-porcelain-50'
                              : 'hover:bg-porcelain-50'
                        }`}
                      >
                        <span
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-xs font-extrabold ${
                            active
                              ? 'bg-limeglow-400 text-forest-950'
                              : c.type === 'CLIENT_SHOP'
                                ? 'bg-brand-100 text-brand-800'
                                : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {getInitials(displayTitle)}
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p
                              className={`truncate text-sm font-bold ${
                                active ? 'text-white' : 'text-slate-900'
                              }`}
                            >
                              {c.subject}
                            </p>
                            {c.unreadCount > 0 ? (
                              <span className="shrink-0 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                {c.unreadCount}
                              </span>
                            ) : null}
                          </div>

                          {c.lastMessagePreview ? (
                            <p
                              className={`mt-0.5 truncate text-xs ${
                                active ? 'text-emerald-100/80' : 'text-slate-500'
                              }`}
                            >
                              {c.lastMessagePreview}
                            </p>
                          ) : null}

                          <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px]">
                            <span
                              className={`rounded-full px-2 py-0.5 font-bold ${
                                active
                                  ? 'bg-white/15 text-limeglow-300'
                                  : c.type === 'CLIENT_SHOP'
                                    ? 'bg-brand-50 text-brand-700'
                                    : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {CONVERSATION_TYPE_LABELS[c.type]}
                            </span>
                            <span className={active ? 'text-emerald-200/70' : 'text-slate-400'}>
                              {formatDateTimeInTimezone(c.lastMessageAt)}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </aside>

            {/* Colonne Fil de discussion actif */}
            <section
              className={`flex flex-col overflow-hidden bg-porcelain-50 lg:col-span-8 lg:flex ${
                mobileShowThread ? 'flex' : 'hidden'
              }`}
            >
              {detail ? (
                <>
                  {/* En-tête thread */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 bg-white px-4 py-3 sm:px-5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => setMobileShowThread(false)}
                        aria-label="Retour aux discussions"
                        className="rounded-xl border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 lg:hidden"
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </button>
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-forest-900 text-xs font-extrabold text-limeglow-400">
                        {getInitials(detail.clientName || detail.subject)}
                      </span>
                      <div className="min-w-0">
                        <h2 className="truncate text-sm font-extrabold text-slate-900">
                          {detail.subject}
                        </h2>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                          <span>{CONVERSATION_TYPE_LABELS[detail.type]}</span>
                          {detail.clientPhone ? (
                            <a
                              href={`tel:${detail.clientPhone}`}
                              className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline"
                            >
                              <Phone className="h-3 w-3" />
                              {detail.clientPhone}
                            </a>
                          ) : null}
                          {detail.orderNumber ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-1.5 py-0.5 font-mono font-bold text-brand-800">
                              <ShoppingBag className="h-3 w-3" />
                              {detail.orderNumber}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {user?.role === 'OWNER' && agents.length > 0 ? (
                      <div className="flex items-center gap-1.5 text-xs">
                        <UserCheck className="h-4 w-4 text-brand-700" />
                        <select
                          value={detail.assignedAgentUserId || ''}
                          onChange={(e) => handleAssign(e.target.value)}
                          className="rounded-xl border border-slate-200 bg-porcelain-50 px-2.5 py-1.5 text-xs font-bold text-slate-700"
                        >
                          <option value="">Non assignée</option>
                          {agents.map((a) => (
                            <option key={a.id} value={a.id}>
                              Assigner : {a.fullName}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                  </div>

                  {/* Messages bulles modernes */}
                  <div className="flex-1 space-y-3 overflow-y-auto px-4 py-5 sm:px-6">
                    {detail.messages.map((m) => {
                      const isMine =
                        m.senderRole === user?.role && m.senderName === user?.fullName;
                      const isClient = m.senderRole === 'CLIENT';
                      return (
                        <div
                          key={m.id}
                          className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
                        >
                          <div
                            className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow-xs sm:max-w-[74%] ${
                              isMine
                                ? 'rounded-br-sm bg-forest-900 text-white'
                                : isClient
                                  ? 'rounded-bl-sm border border-brand-200 bg-brand-50 text-slate-900'
                                  : 'rounded-bl-sm border border-slate-200 bg-white text-slate-900'
                            }`}
                          >
                            <p
                              className={`text-[10px] font-extrabold ${
                                isMine
                                  ? 'text-limeglow-300'
                                  : isClient
                                    ? 'text-brand-800'
                                    : 'text-slate-500'
                              }`}
                            >
                              {m.senderName}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed sm:text-sm">
                              {m.body}
                            </p>
                            {m.attachmentUrl ? (
                              <a
                                href={m.attachmentUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-2 block"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={m.attachmentUrl}
                                  alt="Pièce jointe"
                                  className="max-h-48 rounded-xl border border-black/10 object-cover"
                                />
                              </a>
                            ) : null}
                          </div>
                          <span className="mt-1 px-1 text-[10px] text-slate-400">
                            {formatDateTimeInTimezone(m.createdAt)}
                          </span>
                        </div>
                      );
                    })}
                    <div ref={threadEndRef} />
                  </div>

                  {/* Zone de rédaction */}
                  <form
                    onSubmit={handleSend}
                    className="space-y-1.5 border-t border-slate-200/80 bg-white p-2.5 sm:p-4 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
                  >
                    <ImageUploader
                      purpose="message"
                      compact
                      label="Joindre une photo"
                      value={attachmentUrl}
                      onChange={setAttachmentUrl}
                    />
                    <div className="flex gap-2">
                      <input
                        required
                        value={bodyText}
                        onChange={(e) => setBodyText(e.target.value)}
                        placeholder="Écrire votre réponse…"
                        className="sc-input text-sm"
                      />
                      <button type="submit" disabled={sending} className="sc-btn-primary px-4">
                        <Send className="h-4 w-4" />
                        <span className="hidden sm:inline">Envoyer</span>
                      </button>
                    </div>
                  </form>
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center p-10 text-center text-slate-400">
                  <span className="flex h-14 w-14 items-center justify-center rounded-3xl bg-white shadow-xs">
                    <MessageSquare className="h-7 w-7 text-brand-600" />
                  </span>
                  <p className="mt-3 text-sm font-bold text-slate-700">
                    Sélectionnez une discussion
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Choisissez un échange dans la liste de gauche pour répondre immédiatement.
                  </p>
                </div>
              )}
            </section>
          </div>
        )}

        {/* Modale Nouvelle Conversation */}
        {newOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/65 p-4 backdrop-blur-xs">
            <form
              onSubmit={handleCreateConv}
              className="w-full max-w-md space-y-3.5 rounded-3xl bg-white p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-extrabold text-slate-900">Nouvelle discussion</h2>
                <button
                  type="button"
                  onClick={() => setNewOpen(false)}
                  className="rounded-xl p-1 text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Type d’échange</label>
                <select
                  value={newForm.type}
                  onChange={(e) =>
                    setNewForm({ ...newForm, type: e.target.value as ConversationType })
                  }
                  className="sc-input mt-1"
                >
                  <option value="INTERNAL_OWNER_AGENT">Équipe boutique (Propriétaire ↔ Agents)</option>
                  {user?.role === 'OWNER' ? (
                    <option value="SUPPORT_ADMIN_OWNER">Support Plateforme ShopControl</option>
                  ) : null}
                  <option value="CLIENT_SHOP">Suivi client boutique</option>
                </select>
              </div>

              {newForm.type !== 'SUPPORT_ADMIN_OWNER' && shops.length > 1 ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Boutique</label>
                  <select
                    value={newForm.shopId}
                    onChange={(e) => setNewForm({ ...newForm, shopId: e.target.value })}
                    className="sc-input mt-1"
                  >
                    {shops.map((s) => (
                      <option key={s.shopId} value={s.shopId}>
                        {s.shopName}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {newForm.type === 'CLIENT_SHOP' ? (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={newForm.clientName}
                    onChange={(e) => setNewForm({ ...newForm, clientName: e.target.value })}
                    placeholder="Nom du client"
                    className="sc-input text-xs"
                  />
                  <input
                    value={newForm.clientPhone}
                    onChange={(e) => setNewForm({ ...newForm, clientPhone: e.target.value })}
                    placeholder="Téléphone client"
                    className="sc-input text-xs"
                  />
                </div>
              ) : null}

              <input
                required
                minLength={2}
                value={newForm.subject}
                onChange={(e) => setNewForm({ ...newForm, subject: e.target.value })}
                placeholder="Objet de la conversation *"
                className="sc-input"
              />

              <textarea
                required
                rows={3}
                value={newForm.initialMessage}
                onChange={(e) => setNewForm({ ...newForm, initialMessage: e.target.value })}
                placeholder="Votre premier message *"
                className="sc-input"
              />

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setNewOpen(false)} className="sc-btn-ghost">
                  Annuler
                </button>
                <button type="submit" disabled={sending} className="sc-btn-primary">
                  Envoyer
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}

export default function MessagingPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6">
          <LoadingSkeleton rows={5} />
        </div>
      }
    >
      <MessagingContent />
    </Suspense>
  );
}
