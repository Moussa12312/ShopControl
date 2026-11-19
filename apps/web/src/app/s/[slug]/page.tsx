import { redirect } from 'next/navigation';
import { Clock, MapPin, Phone, ShieldAlert, Store } from 'lucide-react';

interface PublicShopStatusResponse {
  redirectToSlug: string | null;
  available: boolean;
  status: string;
  shopName?: string;
  message?: string;
  shop?: {
    id: string;
    name: string;
    slug: string;
    phone: string | null;
    address: string | null;
    currency: string;
    timezone: string;
  };
}

export default async function PublicStorefrontStatusPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const apiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
  const normalizedApi = apiUrl.endsWith('/api/v1') ? apiUrl : `${apiUrl}/api/v1`;

  let data: PublicShopStatusResponse | null = null;
  let notFound = false;

  try {
    const res = await fetch(`${normalizedApi}/public/shops/${encodeURIComponent(slug)}/status`, {
      cache: 'no-store',
    });
    if (res.status === 404) {
      notFound = true;
    } else if (res.ok) {
      data = (await res.json()) as PublicShopStatusResponse;
    }
  } catch {
    data = null;
  }

  if (data?.redirectToSlug) {
    redirect(`/s/${data.redirectToSlug}`);
  }

  if (notFound) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xs">
          <Store className="mx-auto h-10 w-10 text-slate-400" />
          <h1 className="mt-4 text-xl font-bold text-slate-900">Boutique introuvable</h1>
          <p className="mt-2 text-sm text-slate-600">
            Vérifiez le lien ou le QR code scanné : aucune vitrine active ne correspond à « {slug} ».
          </p>
        </div>
      </main>
    );
  }

  if (!data || !data.available) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-xs">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">
            {data?.shopName || 'Vitrine ShopControl'}
          </h1>
          <p className="mt-2 text-sm font-medium text-amber-800">
            {data?.message || 'Boutique momentanément indisponible.'}
          </p>
          <p className="mt-4 text-xs text-slate-500">
            Aucune commande ne peut être enregistrée pendant cette indisponibilité.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-700 text-white">
            <Store className="h-6 w-6" />
          </div>
          <div>
            <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
              Vitrine en ligne
            </span>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">{data.shop?.name}</h1>
          </div>
        </div>

        <div className="mt-6 grid gap-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-700 sm:grid-cols-2">
          {data.shop?.phone ? (
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-brand-700" />
              <span>{data.shop.phone}</span>
            </div>
          ) : null}
          {data.shop?.address ? (
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-brand-700" />
              <span>{data.shop.address}</span>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-brand-700" />
            <span>Fuseau : {data.shop?.timezone} · Devise : {data.shop?.currency}</span>
          </div>
        </div>

        <p className="mt-6 rounded-xl border border-brand-100 bg-brand-50/50 p-4 text-sm text-brand-900">
          URL stable active (<code className="font-mono">/s/{data.shop?.slug}</code>). Le catalogue
          public et la prise de commande sans compte seront branchés sur cette vitrine dès les lots
          Produits (Lot 2) et E-commerce (Lot 5).
        </p>
      </div>
    </main>
  );
}
