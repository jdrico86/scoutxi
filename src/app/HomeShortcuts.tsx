'use client';

import { useRouter } from 'next/navigation';
import { Upload, Target, ClipboardList } from 'lucide-react';

export default function HomeShortcuts() {
  const router = useRouter();

  return (
    <section>
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-neutral-500">
        Atalhos
      </h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Shortcut
          icon={Upload}
          label="Importar dados"
          description="Fazer upload de ficheiros Wyscout XLSX."
          onClick={() => router.push('/import')}
        />
        <Shortcut
          icon={Target}
          label="Aplicar perfis"
          description="Escolher um perfil e ver ranking num pool."
          onClick={() => router.push('/profiles')}
        />
        <Shortcut
          icon={ClipboardList}
          label="Ver shortlists"
          description="Listas de prospects guardadas com workflow."
          onClick={() => router.push('/shortlists')}
        />
      </div>
    </section>
  );
}

function Shortcut({
  icon: Icon,
  label,
  description,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-lg border border-neutral-200 bg-white p-5 text-left transition-colors hover:border-neutral-300"
    >
      <Icon className="h-5 w-5 text-neutral-500 group-hover:text-neutral-900" strokeWidth={1.8} />
      <div className="mt-3 text-sm font-medium text-neutral-900">{label}</div>
      <div className="mt-1 text-xs text-neutral-500">{description}</div>
    </button>
  );
}