import { redirect } from 'next/navigation';

/**
 * Endereço antigo da comparação. A comparação passou a viver numa página só,
 * `/comparar`; este ficheiro existe para os endereços guardados continuarem a
 * funcionar.
 */
export default async function LegacyCompararPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { a, b } = await searchParams;
  const params = new URLSearchParams();
  if (a) params.set('a', a);
  if (b) params.set('b', b);
  redirect(`/comparar?${params.toString()}`);
}
