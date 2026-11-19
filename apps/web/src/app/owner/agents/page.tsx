'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, Laptop, Plus, Shield, UserX } from 'lucide-react';
import {
  createDefaultAgentPermissions,
  formatXof,
  PERMISSION_CATALOG,
  PermissionKey,
  PermissionMap,
} from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import {
  ConfirmModal,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
} from '@/components/ui/StateViews';

interface AgentRow {
  id: string;
  shopId: string;
  fullName: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  permissions: PermissionMap;
  maxDiscountPercent: number;
  maxExpenseAmountXof: number;
  activeSessionsCount: number;
  lastLoginAt: string | null;
}

interface AgentSessionRow {
  id: string;
  deviceName: string;
  ipAddress: string | null;
  lastActiveAt: string;
}

export default function OwnerAgentsPage() {
  const { shops, selectedShopId, supportGrantId } = useAuth();
  const activeShopId = selectedShopId !== 'ALL' ? selectedShopId : shops[0]?.shopId || '';

  const [targetShopId, setTargetShopId] = useState(activeShopId);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentRow | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    maxDiscountPercent: 0,
    maxExpenseAmountXof: 0,
    permissions: createDefaultAgentPermissions(),
  });

  const [resetModal, setResetModal] = useState<{ agent: AgentRow; newPassword: string } | null>(
    null,
  );
  const [sessionsModal, setSessionsModal] = useState<{
    agent: AgentRow;
    sessions: AgentSessionRow[];
  } | null>(null);

  useEffect(() => {
    if (selectedShopId !== 'ALL') {
      setTargetShopId(selectedShopId);
    } else if (shops[0]) {
      setTargetShopId((prev) => (prev && shops.some((s) => s.shopId === prev) ? prev : shops[0].shopId));
    }
  }, [selectedShopId, shops]);

  const domains = useMemo(() => {
    const map = new Map<string, typeof PERMISSION_CATALOG>();
    for (const item of PERMISSION_CATALOG) {
      const list = map.get(item.domain) || [];
      list.push(item);
      map.set(item.domain, list);
    }
    return Array.from(map.entries());
  }, []);

  const load = useCallback(async () => {
    if (!targetShopId) {
      setAgents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<AgentRow[]>(`/shops/${targetShopId}/agents`, {
        shopId: targetShopId,
        supportGrantId,
      });
      setAgents(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement des agents.');
    } finally {
      setLoading(false);
    }
  }, [targetShopId, supportGrantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditingAgent(null);
    setFormError(null);
    setForm({
      fullName: '',
      email: '',
      phone: '',
      password: '',
      maxDiscountPercent: 0,
      maxExpenseAmountXof: 0,
      permissions: createDefaultAgentPermissions(),
    });
    setModalOpen(true);
  };

  const openEdit = (agent: AgentRow) => {
    setEditingAgent(agent);
    setFormError(null);
    setForm({
      fullName: agent.fullName,
      email: agent.email,
      phone: agent.phone || '',
      password: '',
      maxDiscountPercent: agent.maxDiscountPercent,
      maxExpenseAmountXof: agent.maxExpenseAmountXof,
      permissions: { ...agent.permissions },
    });
    setModalOpen(true);
  };

  const togglePermission = (key: PermissionKey) => {
    setForm((prev) => ({
      ...prev,
      permissions: { ...prev.permissions, [key]: !prev.permissions[key] },
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetShopId) return;
    setFormError(null);
    setBusy(true);
    try {
      if (editingAgent) {
        await apiFetch(`/shops/${targetShopId}/agents/${editingAgent.id}`, {
          method: 'PATCH',
          shopId: targetShopId,
          body: {
            fullName: form.fullName,
            phone: form.phone.trim() || null,
            maxDiscountPercent: Number(form.maxDiscountPercent) || 0,
            maxExpenseAmountXof: Number(form.maxExpenseAmountXof) || 0,
            permissions: form.permissions,
          },
        });
      } else {
        await apiFetch(`/shops/${targetShopId}/agents`, {
          method: 'POST',
          shopId: targetShopId,
          body: {
            fullName: form.fullName,
            email: form.email,
            phone: form.phone.trim() || undefined,
            password: form.password,
            maxDiscountPercent: Number(form.maxDiscountPercent) || 0,
            maxExpenseAmountXof: Number(form.maxExpenseAmountXof) || 0,
            permissions: form.permissions,
          },
        });
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleActive = async (agent: AgentRow) => {
    await apiFetch(`/shops/${targetShopId}/agents/${agent.id}`, {
      method: 'PATCH',
      shopId: targetShopId,
      body: { isActive: !agent.isActive },
    });
    await load();
  };

  const handleResetPassword = async () => {
    if (!resetModal) return;
    setBusy(true);
    try {
      await apiFetch(`/shops/${targetShopId}/agents/${resetModal.agent.id}/reset-password`, {
        method: 'POST',
        shopId: targetShopId,
        body: { newPassword: resetModal.newPassword },
      });
      setResetModal(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Réinitialisation échouée.');
    } finally {
      setBusy(false);
    }
  };

  const openSessions = async (agent: AgentRow) => {
    const sessions = await apiFetch<AgentSessionRow[]>(
      `/shops/${targetShopId}/agents/${agent.id}/sessions`,
      { shopId: targetShopId },
    );
    setSessionsModal({ agent, sessions });
  };

  const revokeSession = async (sessionId: string) => {
    if (!sessionsModal) return;
    await apiFetch(`/shops/${targetShopId}/agents/${sessionsModal.agent.id}/sessions/${sessionId}`, {
      method: 'DELETE',
      shopId: targetShopId,
    });
    await openSessions(sessionsModal.agent);
    await load();
  };

  return (
    <AppShell allowedRoles={['OWNER']}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Comptes Agents & Permissions</h1>
            <p className="text-sm text-slate-600">
              Un compte Agent est strictement cloisonné à une seule boutique. Contrôle appliqué côté serveur.
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {shops.length > 0 ? (
              <select
                value={targetShopId}
                onChange={(e) => setTargetShopId(e.target.value)}
                aria-label="Choisir la boutique"
                className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm sm:flex-none"
              >
                {shops.map((s) => (
                  <option key={s.shopId} value={s.shopId}>
                    {s.shopName}
                  </option>
                ))}
              </select>
            ) : null}
            {!supportGrantId && targetShopId ? (
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-2 rounded-xl bg-forest-900 px-4 py-2 text-sm font-semibold text-white hover:bg-forest-800"
              >
                <Plus className="h-4 w-4" />
                Nouvel Agent
              </button>
            ) : null}
          </div>
        </div>

        {loading ? (
          <LoadingSkeleton rows={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !targetShopId ? (
          <EmptyState
            title="Créez d’abord une boutique"
            description="Les comptes Agent doivent être rattachés à une boutique existante."
          />
        ) : agents.length === 0 ? (
          <EmptyState
            title="Aucun compte Agent dans cette boutique"
            description="Vous pouvez travailler vous-même en tant que Propriétaire ou créer un compte Agent opérationnel partagé pour votre équipe."
          />
        ) : (
          <div className="grid gap-4">
            {agents.map((agent) => {
              const enabledCount = Object.values(agent.permissions).filter(Boolean).length;
              return (
                <div
                  key={agent.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-slate-900">{agent.fullName}</h2>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          agent.isActive
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {agent.isActive ? 'Actif' : 'Désactivé'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">{agent.email}</p>
                    <p className="mt-1.5 text-xs text-slate-600">
                      <strong>{enabledCount}</strong> permissions · Plafond remise :{' '}
                      <strong>{agent.maxDiscountPercent} %</strong> · Plafond dépense :{' '}
                      <strong>{formatXof(agent.maxExpenseAmountXof)}</strong> ·{' '}
                      {agent.activeSessionsCount} session(s) active(s)
                    </p>
                  </div>

                  {!supportGrantId ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(agent)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        <Shield className="h-3.5 w-3.5" />
                        Permissions
                      </button>
                      <button
                        type="button"
                        onClick={() => setResetModal({ agent, newPassword: '' })}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        Mot de passe
                      </button>
                      <button
                        type="button"
                        onClick={() => openSessions(agent)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        <Laptop className="h-3.5 w-3.5" />
                        Sessions ({agent.activeSessionsCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(agent)}
                        className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                          agent.isActive
                            ? 'bg-red-50 text-red-700 hover:bg-red-100'
                            : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        }`}
                      >
                        <UserX className="h-3.5 w-3.5" />
                        {agent.isActive ? 'Désactiver' : 'Réactiver'}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {/* Modale Création / Édition Agent & Matrice de permissions */}
        {modalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
              <h2 className="text-lg font-bold text-slate-900">
                {editingAgent ? `Permissions : ${editingAgent.fullName}` : 'Créer un compte Agent'}
              </h2>
              {formError ? (
                <div className="mt-3 rounded-xl bg-red-50 p-3 text-xs text-red-700">{formError}</div>
              ) : null}

              <form onSubmit={handleSave} className="mt-4 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Libellé du compte (ex. Caisse 1) *
                    </label>
                    <input
                      required
                      value={form.fullName}
                      onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">E-mail *</label>
                    <input
                      type="email"
                      required
                      disabled={Boolean(editingAgent)}
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
                    />
                  </div>
                </div>

                {!editingAgent ? (
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Mot de passe (8+ car., majuscule, minuscule, chiffre) *
                    </label>
                    <input
                      type="password"
                      required
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Plafond de remise autorisé (%)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={form.maxDiscountPercent}
                      onChange={(e) =>
                        setForm({ ...form, maxDiscountPercent: Number(e.target.value) })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Plafond par dépense (XOF)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={100}
                      value={form.maxExpenseAmountXof}
                      onChange={(e) =>
                        setForm({ ...form, maxExpenseAmountXof: Number(e.target.value) })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Matrice de permissions par domaine (Section 4.3)
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {domains.map(([domain, list]) => (
                      <div key={domain} className="rounded-xl border border-slate-200 p-3">
                        <p className="mb-2 text-xs font-bold uppercase text-brand-800">{domain}</p>
                        <div className="space-y-1.5">
                          {list.map((perm) => (
                            <label
                              key={perm.key}
                              className="flex items-start gap-2 text-xs text-slate-700"
                            >
                              <input
                                type="checkbox"
                                checked={Boolean(form.permissions[perm.key])}
                                onChange={() => togglePermission(perm.key)}
                                className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300"
                              />
                              <span>
                                {perm.label}
                                {perm.sensitive ? (
                                  <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">
                                    Sensible
                                  </span>
                                ) : null}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
                  >
                    {busy ? 'Enregistrement…' : 'Enregistrer'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {/* Modale Reset mot de passe Agent */}
        <ConfirmModal
          open={Boolean(resetModal)}
          title={`Réinitialiser le mot de passe de ${resetModal?.agent.fullName || ''}`}
          description="L’ancien mot de passe n’est jamais affiché. Toutes les sessions actives de cet Agent seront immédiatement déconnectées."
          confirmLabel="Réinitialiser et déconnecter"
          danger
          busy={busy}
          onCancel={() => setResetModal(null)}
          onConfirm={handleResetPassword}
        >
          {resetModal ? (
            <input
              type="password"
              required
              placeholder="Nouveau mot de passe (8+ car., majuscule, chiffre)"
              value={resetModal.newPassword}
              onChange={(e) => setResetModal({ ...resetModal, newPassword: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          ) : null}
        </ConfirmModal>

        {/* Modale Sessions actives Agent */}
        {sessionsModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
              <h3 className="text-base font-bold text-slate-900">
                Sessions actives — {sessionsModal.agent.fullName}
              </h3>
              <div className="mt-4 space-y-2">
                {sessionsModal.sessions.length === 0 ? (
                  <p className="text-sm text-slate-500">Aucune session active.</p>
                ) : (
                  sessionsModal.sessions.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between rounded-xl border border-slate-200 p-3 text-xs"
                    >
                      <div>
                        <p className="font-semibold text-slate-800">{s.deviceName}</p>
                        <p className="text-slate-500">IP : {s.ipAddress || '—'}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => revokeSession(s.id)}
                        className="rounded-lg bg-red-50 px-2.5 py-1 font-semibold text-red-700 hover:bg-red-100"
                      >
                        Déconnecter
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={() => setSessionsModal(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
