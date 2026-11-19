import type { Metadata, Viewport } from 'next';
import './globals.css';
import { NetworkStatusProvider } from '@/components/providers/NetworkStatusProvider';
import { AuthProvider } from '@/components/providers/AuthProvider';

export const metadata: Metadata = {
  title: 'Gestion Commerciale & Vitrine QR — Chakir’s Entreprise',
  description:
    'Plateforme SaaS de gestion commerciale multi-boutiques avec isolation par base de données dédiée et vitrine e-commerce par QR code.',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#0C2221',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap"
        />
      </head>
      <body className="min-h-screen font-sans text-[14px] leading-relaxed">
        <NetworkStatusProvider>
          <AuthProvider>{children}</AuthProvider>
        </NetworkStatusProvider>
      </body>
    </html>
  );
}
