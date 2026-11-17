'use client';

/**
 * Moldura da aplicação: menu lateral e conteúdo. Nas páginas públicas (entrar
 * e pedir acesso) não há menu, e o conteúdo ocupa a largura toda.
 */

import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';

const PUBLIC_PREFIXES = ['/login', '/pedir-acesso'];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isPublic) return <div className="min-h-screen bg-neutral-50">{children}</div>;
  return (
    <>
      <Sidebar />
      <div className="ml-60 min-h-screen bg-neutral-50">{children}</div>
    </>
  );
}
