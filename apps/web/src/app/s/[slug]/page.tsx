import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Store } from 'lucide-react';
import { StorefrontClient } from './StorefrontClient';

export const dynamic = 'force-dynamic';

async function fetchStorefront(slug: string) {
  const apiBase = process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000';
  try {
    const res = await fetch(`${apiBase}/api/v1/public/shops/${encodeURIComponent(slug)}/storefront`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export default async function PublicShopStorefrontPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await fetchStorefront(slug);

  if (data?.redirectToSlug) {
    redirect(`/s/${data.redirectToSlug}`);
  }

  if (!data || !data.available) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-porcelain-100 p-6 text-center">
        <div className="sc-card max-w-md p-8">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-forest-900 text-limeglow-400">
            <Store className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-xl font-extrabold text-slate-900">
            {data?.shop?.name || 'Boutique indisponible'}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            {data?.message ||
              'Cette vitrine boutique n’est pas disponible actuellement ou son lien est incorrect.'}
          </p>
          <Link href="/" className="sc-btn-primary mt-5 inline-flex text-xs">
            Retour à ShopControl
          </Link>
        </div>
      </div>
    );
  }

  return <StorefrontClient initialData={data} />;
}
