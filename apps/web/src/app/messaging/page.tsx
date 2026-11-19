'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  MessageSquare,
  Plus,
  Send,
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

function MessagingContent() {
  const searchParams = useSearchParams();
  const initialConvId = searchParams.get('c') || '';
  const { user, shops, selectedShopId } = useAuth();

  const [convs, setConvs] = useState<ConversationListItem[]>([]);
  const [selectedId, setSelectedId] = useState(initialConvId);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [agents, setAgents] = useState<AgentOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [bodyText, setBodyText] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

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

  const loadDetail = useCallback(async (id: string) => {
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
  }, [user?.role]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadList();
      if (selectedId) void loadDetail(selectedId);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [loadList, loadDetail, selectedId]);

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
          shopId: newForm.type === 'SUPPORT_ADMIN_OWNER' ? null : newForm.shopId || shops[0]?.shopId || null,
          subject: newForm.subject.trim(),
          clientName: newForm.type === 'CLIENT_SHOP' ? newForm.clientName.trim() || undefined : undefined,
          clientPhone: newForm.type === 'CLIENT_SHOP' ? newForm.clientPhone.trim() || undefined : undefined,
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
      await loadList();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de créer la conversation.');
    } finally {
      setSending(false);
    }
  };

  return (
    <AppShell allowedRoles={['SUPER_ADMIN', 'OWNER', 'AGENT']}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
              Messagerie Intégrée
            </h1>
            <p className="text-sm text-slate-600">
              Échanges équipe boutique, messages clients vitrine QR et support plateforme en temps réel.
            </p>
          </div>
          {user?.role !== 'SUPER_ADMIN' ? (
            <button type="button" onClick={() => setNewOpen(true)} className="sc-btn-primary text-xs">
              <Plus className="h-4 w-4" />
              Nouvelle discussion
            </button>
          ) : null}
        </div>

        {error ? <ErrorState message={error} onRetry={loadList} /> : null}

        {loading ? (
          <LoadingSkeleton rows={5} />
        ) : convs.length === 0 ? (
          <EmptyState
            title="Boîte de réception vide"
            description="Les messages clients depuis votre vitrine QR et vos échanges d’équipe apparaîtront ici."
            action={
              user?.role !== 'SUPER_ADMIN' ? (
                <button type="button" onClick={() => setNewOpen(true)} className="sc-btn-primary text-xs">
                  Démarrer une conversation
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-12" style={{ minHeight: '66vh' }}>
            {/* Colonne Liste des fils */}
            <aside className="sc-card flex flex-col overflow-hidden lg:col-span-4">
              <div className="border-b border-slate-100 bg-porcelain-50 px-4 py-3 text-xs font-extrabold uppercase tracking-wide text-slate-500">
                Conversations ({convs.length})
              </div>
              <div className="flex-1 divide-y divide-slate-100 overflow-y-auto">
                {convs.map((c) => {
                  const active = c.id === selectedId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className={`block w-full px-4 py-3.5 text-left transition ${
                        active ? 'bg-forest-900 text-white' : 'hover:bg-porcelain-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            active
                              ? 'bg-white/15 text-limeglow-400'
                              : c.type === 'CLIENT_SHOP'
                                ? 'bg-brand-50 text-brand-800'
                                : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {CONVERSATION_TYPE_LABELS[c.type]}
                        </span>
                        {c.unreadCount > 0 ? (
                          <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white">
                            {c.unreadCount}
                          </span>
                        ) : null}
                      </div>
                      <p className={`mt-1.5 truncate text-sm font-bold ${active ? 'text-white' : 'text-slate-900'}`}>
                        {c.subject}
                      </p>
                      {c.lastMessagePreview ? (
                        <p className={`mt-0.5 truncate text-xs ${active ? 'text-emerald-100/75' : 'text-slate-500'}`}>
                          {c.lastMessagePreview}
                        </p>
                      ) : null}
                      <p className={`mt-1 text-[10px] ${active ? 'text-emerald-200/60' : 'text-slate-400'}`}>
                        {c.shopName ? `${c.shopName} · ` : ''}
                        {formatDateTimeInTimezone(c.lastMessageAt)}
                      </p>
                    </button>
                  );
                })}
              </div>
            </aside>

            {/* Colonne Fil de messages actif */}
            <section className="sc-card flex flex-col overflow-hidden lg:col-span-8">
              {detail ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-porcelain-50 px-5 py-3.5">
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-extrabold text-slate-900">
                        {detail.subject}
                      </h2>
                      <p className="text-xs text-slate-500">
                        {CONVERSATION_TYPE_LABELS[detail.type]}
                        {detail.clientPhone ? ` · Client : ${detail.clientPhone}` : ''}
                        {detail.orderNumber ? ` · Commande ${detail.orderNumber}` : ''}
                      </p>
                    </div>

                    {user?.role === 'OWNER' && agents.length > 0 ? (
                      <div className="flex items-center gap-1.5 text-xs">
                        <UserCheck className="h-4 w-4 text-brand-700" />
                        <select
                          value={detail.assignedAgentUserId || ''}
                          onChange={(e) => handleAssign(e.target.value)}
                          className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold"
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

                  <div className="flex-1 space-y-3 overflow-y-auto p-5">
                    {detail.messages.map((m) => {
                      const isMine =
                        m.senderRole === user?.role && m.senderName === user?.fullName;
                      return (
                        <div
                          key={m.id}
                          className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm ${
                            isMine
                              ? 'ml-auto bg-forest-900 text-white'
                              : m.senderRole === 'CLIENT'
                                ? 'border border-brand-200 bg-brand-50 text-slate-900'
                                : 'border border-slate-200 bg-porcelain-50 text-slate-900'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3 text-[10px] opacity-75">
                            <span className="font-bold">{m.senderName}</span>
                            <span>{formatDateTimeInTimezone(m.createdAt)}</span>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap text-xs sm:text-sm">{m.body}</p>
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
                                className="max-h-48 rounded-xl border border-white/20 object-cover"
                              />
                            </a>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  <form onSubmit={handleSend} className="space-y-2 border-t border-slate-100 bg-white p-4">
                    <ImageUploader
                      purpose="message"
                      compact
                      label="Photo"
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
                  <MessageSquare className="h-10 w-10 opacity-40" />
                  <p className="mt-2 text-sm">Sélectionnez une conversation à gauche.</p>
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
                <h2 className="text-lg font-extrabold text-slate-900">Nouvelle conversation</h2>
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
    <Suspense fallback={<div className="p-6"><LoadingSkeleton rows={5} /></div>}>
      <MessagingContent />
    </Suspense>
  );
}
