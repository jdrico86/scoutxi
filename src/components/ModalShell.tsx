'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';

/**
 * Modal genérico: overlay com fundo escuro, esc para fechar, click no fundo
 * fecha. Usado pelo Squad Builder e pela Pesquisa Avançada.
 */
type Props = {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Largura máxima do conteúdo. Default 'max-w-md'. */
  maxWidth?: 'max-w-md' | 'max-w-lg' | 'max-w-xl' | 'max-w-2xl';
};

export function ModalShell({ title, onClose, children, maxWidth = 'max-w-md' }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className={`w-full ${maxWidth} rounded-lg border border-neutral-200 bg-white shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
