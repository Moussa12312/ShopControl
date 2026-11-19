'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { LoadingSkeleton } from '@/components/ui/StateViews';

export default function HomePage() {
  const router = useRouter();
  const { loading, user } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (user.role === 'SUPER_ADMIN') {
      router.replace('/admin');
    } else if (user.role === 'OWNER') {
      router.replace('/owner');
    } else if (user.role === 'AGENT') {
      router.replace('/agent');
    } else {
      router.replace('/login');
    }
  }, [loading, user, router]);

  return (
    <div className="mx-auto max-w-xl p-10">
      <LoadingSkeleton rows={4} />
    </div>
  );
}
