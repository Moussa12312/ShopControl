export const PERMISSION_KEYS = [
  // Ventes
  'sales:create',
  'sales:read',
  'sales:discount',
  'sales:cancel',
  'sales:refund',
  // Produits
  'products:read',
  'products:create',
  'products:update',
  'products:publish',
  'products:archive',
  // Stocks
  'stock:read',
  'stock:receive',
  'stock:move',
  'stock:inventory',
  'stock:adjust',
  // Achats
  'purchases:read',
  'purchases:create',
  'purchases:receive',
  // Commandes
  'orders:read',
  'orders:contact',
  'orders:confirm',
  'orders:refuse',
  'orders:prepare',
  'orders:deliver',
  // Clients
  'clients:read',
  'clients:create',
  'clients:update',
  // Caisse
  'cash:open',
  'cash:read',
  'cash:in',
  'cash:out',
  'cash:close',
  // Messagerie
  'messaging:client',
  'messaging:owner',
  // Transferts (demande uniquement pour un Agent — validation réservée au Propriétaire en v1)
  'transfers:request',
  // Dépenses (avec plafond configurable)
  'expenses:create',
  // Finances confidentielles (désactivé par défaut pour les Agents — Section 4.3)
  'finance:read_margins',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export type PermissionMap = Record<PermissionKey, boolean>;

export interface PermissionMeta {
  key: PermissionKey;
  domain: string;
  label: string;
  sensitive?: boolean;
  defaultForAgent: boolean;
}

export const PERMISSION_CATALOG: PermissionMeta[] = [
  { key: 'sales:create', domain: 'Ventes', label: 'Créer une vente', defaultForAgent: true },
  { key: 'sales:read', domain: 'Ventes', label: 'Consulter les ventes', defaultForAgent: true },
  { key: 'sales:discount', domain: 'Ventes', label: 'Appliquer une remise (plafonnée)', sensitive: true, defaultForAgent: false },
  { key: 'sales:cancel', domain: 'Ventes', label: 'Annuler une vente validée', sensitive: true, defaultForAgent: false },
  { key: 'sales:refund', domain: 'Ventes', label: 'Effectuer un remboursement', sensitive: true, defaultForAgent: false },

  { key: 'products:read', domain: 'Produits', label: 'Consulter le catalogue', defaultForAgent: true },
  { key: 'products:create', domain: 'Produits', label: 'Créer un produit', defaultForAgent: false },
  { key: 'products:update', domain: 'Produits', label: 'Modifier un produit', defaultForAgent: false },
  { key: 'products:publish', domain: 'Produits', label: 'Publier sur la vitrine', defaultForAgent: false },
  { key: 'products:archive', domain: 'Produits', label: 'Archiver un produit', defaultForAgent: false },

  { key: 'stock:read', domain: 'Stocks', label: 'Consulter les stocks', defaultForAgent: true },
  { key: 'stock:receive', domain: 'Stocks', label: 'Réceptionner une livraison', defaultForAgent: true },
  { key: 'stock:move', domain: 'Stocks', label: 'Enregistrer entrée / sortie', defaultForAgent: false },
  { key: 'stock:inventory', domain: 'Stocks', label: 'Réaliser un inventaire', defaultForAgent: false },
  { key: 'stock:adjust', domain: 'Stocks', label: 'Corriger le stock (avec motif)', sensitive: true, defaultForAgent: false },

  { key: 'purchases:read', domain: 'Achats', label: 'Consulter les achats', defaultForAgent: false },
  { key: 'purchases:create', domain: 'Achats', label: 'Préparer une commande fournisseur', defaultForAgent: false },
  { key: 'purchases:receive', domain: 'Achats', label: 'Enregistrer une réception fournisseur', defaultForAgent: true },

  { key: 'orders:read', domain: 'Commandes', label: 'Consulter les commandes vitrine', defaultForAgent: true },
  { key: 'orders:contact', domain: 'Commandes', label: 'Contacter le client', defaultForAgent: true },
  { key: 'orders:confirm', domain: 'Commandes', label: 'Confirmer une commande', defaultForAgent: true },
  { key: 'orders:refuse', domain: 'Commandes', label: 'Refuser une commande (motif)', defaultForAgent: true },
  { key: 'orders:prepare', domain: 'Commandes', label: 'Préparer la commande', defaultForAgent: true },
  { key: 'orders:deliver', domain: 'Commandes', label: 'Remettre / livrer la commande', defaultForAgent: true },

  { key: 'clients:read', domain: 'Clients', label: 'Consulter les clients', defaultForAgent: true },
  { key: 'clients:create', domain: 'Clients', label: 'Créer une fiche client', defaultForAgent: true },
  { key: 'clients:update', domain: 'Clients', label: 'Modifier les coordonnées client', defaultForAgent: false },

  { key: 'cash:open', domain: 'Caisse', label: 'Ouvrir une session de caisse', defaultForAgent: true },
  { key: 'cash:read', domain: 'Caisse', label: 'Consulter le solde de caisse', defaultForAgent: true },
  { key: 'cash:in', domain: 'Caisse', label: 'Enregistrer un encaissement', defaultForAgent: true },
  { key: 'cash:out', domain: 'Caisse', label: 'Enregistrer un décaissement', sensitive: true, defaultForAgent: false },
  { key: 'cash:close', domain: 'Caisse', label: 'Clôturer la caisse', sensitive: true, defaultForAgent: true },

  { key: 'messaging:client', domain: 'Messagerie', label: 'Répondre aux clients', defaultForAgent: true },
  { key: 'messaging:owner', domain: 'Messagerie', label: 'Contacter le propriétaire', defaultForAgent: true },

  { key: 'transfers:request', domain: 'Transferts', label: 'Créer une demande de transfert', defaultForAgent: true },

  { key: 'expenses:create', domain: 'Dépenses', label: 'Enregistrer une dépense (plafonnée)', sensitive: true, defaultForAgent: false },

  { key: 'finance:read_margins', domain: 'Finances', label: 'Voir coûts d’achat, marges et bénéfices', sensitive: true, defaultForAgent: false },
];

export function createDefaultAgentPermissions(): PermissionMap {
  const map = {} as PermissionMap;
  for (const meta of PERMISSION_CATALOG) {
    map[meta.key] = meta.defaultForAgent;
  }
  return map;
}

export function createAllPermissions(): PermissionMap {
  const map = {} as PermissionMap;
  for (const key of PERMISSION_KEYS) {
    map[key] = true;
  }
  return map;
}

export function normalizePermissionMap(raw: unknown): PermissionMap {
  const defaults = createDefaultAgentPermissions();
  if (!raw || typeof raw !== 'object') {
    return defaults;
  }
  const input = raw as Record<string, unknown>;
  const result = {} as PermissionMap;
  for (const key of PERMISSION_KEYS) {
    result[key] = typeof input[key] === 'boolean' ? input[key] : defaults[key];
  }
  return result;
}
