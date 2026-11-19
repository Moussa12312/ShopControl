import type { Metadata, Viewport } from 'next';
import './globals.css';
import { NetworkStatusProvider } from '@/components/providers/NetworkStatusProvider';
import { AuthProvider } from '@/components/providers/AuthProvider';

export const metadata: Metadata = {
  title: 'ShopControl — Gestion Commerciale Multi-Boutiques',
  description:
    'Plateforme SaaS de gestion commerciale multi-boutiques avec isolation par base de données dédiée et mode comptoir résilient.',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#0f766e',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen font-sans">
        <NetworkStatusProvider>
          <AuthProvider>{children}</AuthProvider>
        </NetworkStatusProvider>
      </body>
    </html>
  );
}
