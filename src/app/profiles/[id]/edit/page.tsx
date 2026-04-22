'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProfileEditor, type ProfileFormValue } from '@/components/ProfileEditor';

export default function EditProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [initialValue, setInitialValue] = useState<Partial<ProfileFormValue> | null>(null);
  const [profileName, setProfileName] = useState<string>('');
  const [isSeed, setIsSeed] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/profiles/${id}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) {
          setLoadError(j.error);
          return;
        }
        const p = j.profile;
        const w = (p.weights ?? {}) as { entries?: ProfileFormValue['entries']; peer_group_positions?: string[] };
        setProfileName(p.name);
        setIsSeed((p.tags ?? []).includes('seed'));
        setInitialValue({
          name: p.name,
          description: p.description ?? '',
          filters: (p.filters ?? {}) as ProfileFormValue['filters'],
          peer_group_positions: w.peer_group_positions ?? [],
          entries: w.entries ?? [],
        });
      })
      .catch((e) => setLoadError((e as Error).message));
  }, [id]);

  const handleSave = async (value: ProfileFormValue) => {
    const res = await fetch(`/api/profiles/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: value.name,
        description: value.description || null,
        filters: value.filters,
        weights: { entries: value.entries, peer_group_positions: value.peer_group_positions },
      }),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json.error };
    return { ok: true, redirectTo: '/profiles' as const };
  };

  const handleDelete = async () => {
    if (!confirm(`Apagar o perfil "${profileName}"? Esta acção não pode ser desfeita.`)) return;
    const res = await fetch(`/api/profiles/${id}`, { method: 'DELETE' });
    if (res.ok) router.push('/profiles');
  };

  if (loadError) {
    return (
      <main className="min-h-screen bg-neutral-50 py-10">
        <div className="mx-auto max-w-4xl px-6">
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800">
            Erro a carregar perfil: {loadError}
          </div>
        </div>
      </main>
    );
  }

  if (!initialValue) {
    return (
      <main className="min-h-screen bg-neutral-50 py-10">
        <div className="mx-auto max-w-4xl px-6 text-sm text-neutral-500">A carregar…</div>
      </main>
    );
  }

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
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-neutral-900">{profileName}</h1>
              {isSeed && (
                <p className="mt-1 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                  perfil seed
                </p>
              )}
              <p className="mt-2 text-sm text-neutral-600">
                {isSeed
                  ? 'Estás a editar um perfil-semente. Se preferires preservar o original, volta e usa "Duplicar".'
                  : 'Edita o perfil como quiseres.'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleDelete}
              className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
            >
              Apagar
            </button>
          </div>
        </header>

        <ProfileEditor
          initialProfile={initialValue}
          submitLabel="Guardar alterações"
          onSubmit={handleSave}
        />
      </div>
    </main>
  );
}