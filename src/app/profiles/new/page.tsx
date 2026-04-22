'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProfileEditor, type ProfileFormValue } from '@/components/ProfileEditor';

type Profile = {
  id: string;
  name: string;
  description: string | null;
  tags: string[] | null;
  filters: unknown;
  weights: unknown;
};

export default function NewProfilePage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Profile[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [initialValue, setInitialValue] = useState<Partial<ProfileFormValue> | null>(null);

  // Carregar templates (perfis existentes para usar como ponto de partida)
  useEffect(() => {
    fetch('/api/profiles')
      .then((r) => r.json())
      .then((j) => setTemplates(j.profiles ?? []));
  }, []);

  const startFromTemplate = async (templateId: string) => {
    if (!templateId) {
      // Começar em branco
      setInitialValue({ name: '', description: '', filters: { min_minutes: 500 }, peer_group_positions: [], entries: [] });
      return;
    }
    const res = await fetch(`/api/profiles/${templateId}`);
    const json = await res.json();
    const p = json.profile;
    if (!p) return;
    const w = (p.weights ?? {}) as { entries?: ProfileFormValue['entries']; peer_group_positions?: string[] };
    setInitialValue({
      name: `${p.name} (cópia)`,
      description: p.description ?? '',
      filters: (p.filters ?? {}) as ProfileFormValue['filters'],
      peer_group_positions: w.peer_group_positions ?? [],
      entries: w.entries ?? [],
    });
  };

  const handleCreate = async (value: ProfileFormValue) => {
    const res = await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: value.name,
        description: value.description || undefined,
        filters: value.filters,
        weights: { entries: value.entries, peer_group_positions: value.peer_group_positions },
      }),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json.error };
    return { ok: true, redirectTo: '/profiles' as const };
  };

  return (
    <main className="min-h-screen bg-neutral-50 py-10">
      <div className="mx-auto max-w-4xl px-6">
        <header className="mb-8">
          <button
            type="button"
            onClick={() => router.push('/profiles')}
            className="mb-2 text-xs text-neutral-500 hover:text-neutral-800"
          >
            ← Voltar aos perfis
          </button>
          <h1 className="text-2xl font-semibold text-neutral-900">Novo perfil</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Começa do zero ou escolhe um perfil existente como template.
          </p>
        </header>

        {initialValue === null ? (
          // Escolher template
          <section className="rounded-lg border border-neutral-200 bg-white p-6">
            <h2 className="text-sm font-semibold text-neutral-900">Começar com template</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Um template copia filtros e pesos; depois ajustas ao teu modelo de jogo.
            </p>
            <div className="mt-4 flex items-end gap-3">
              <div className="flex-1">
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">— começar em branco —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} {t.tags?.includes('seed') ? '(seed)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => startFromTemplate(selectedTemplateId)}
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
              >
                Avançar
              </button>
            </div>
          </section>
        ) : (
          <ProfileEditor
            initialProfile={initialValue}
            submitLabel="Criar perfil"
            onSubmit={handleCreate}
          />
        )}
      </div>
    </main>
  );
}