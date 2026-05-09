'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import {
  Upload,
  Target,
  ClipboardList,
  Trophy,
  Search,
  UserCircle2,
  Users,
  Shield,
  LayoutGrid,
  LogOut,
} from 'lucide-react';
import { FavoriteStar } from '@/components/FavoriteStar';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import type { User } from '@supabase/supabase-js';

type NavItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  adminOnly?: boolean;
};

const NAV: NavItem[] = [
  { label: 'Perfis', href: '/profiles', icon: Target },
  { label: 'Equipas', href: '/teams', icon: Users },
  { label: 'Melhor 11', href: '/best-eleven', icon: Trophy },
  { label: 'Minhas Equipas', href: '/squads', icon: LayoutGrid },
  { label: 'Shortlists', href: '/shortlists', icon: ClipboardList },
  { label: 'Importar', href: '/import', icon: Upload, adminOnly: true },
];

type PlayerHit = {
  id: string;
  name: string;
  current_team: string | null;
  position_primary: string | null;
  age: number | null;
  pool_name: string | null;
};

type TeamHit = {
  name: string;
  pool_id: string;
  pool_name: string | null;
};

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const [playerResults, setPlayerResults] = useState<PlayerHit[]>([]);
  const [teamResults, setTeamResults] = useState<TeamHit[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(false);

  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const supabase = createSupabaseBrowserClient();

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Obter user actual + admin flag
  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      setUser(data.user);

      if (data.user) {
        try {
          const res = await fetch('/api/me');
          if (res.ok) {
            const json = await res.json();
            if (!cancelled) setIsAdmin(json.user?.is_admin ?? false);
          }
        } catch {
          // não bloqueia render
        }
      } else {
        setIsAdmin(false);
      }
    }

    loadUser();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setUser(session?.user ?? null);
      if (!session?.user) setIsAdmin(false);
      else loadUser();
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Debounce da pesquisa
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (query.trim().length < 2) {
      setPlayerResults([]);
      setTeamResults([]);
      return;
    }

    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/players/search?q=${encodeURIComponent(query.trim())}`);
        const json = await res.json();
        setPlayerResults(json.players ?? []);
        setTeamResults(json.teams ?? []);
        setShowResults(true);
      } finally {
        setLoading(false);
      }
    }, 250);
  }, [query]);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(href + '/');
  };

  const goToPlayer = (id: string) => {
    setQuery('');
    setPlayerResults([]);
    setTeamResults([]);
    setShowResults(false);
    router.push(`/players/${id}`);
  };

  const goToTeam = (poolId: string, teamName: string) => {
    setQuery('');
    setPlayerResults([]);
    setTeamResults([]);
    setShowResults(false);
    const params = new URLSearchParams({ pool: poolId, team: teamName });
    router.push(`/teams?${params}`);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  const hasResults = playerResults.length > 0 || teamResults.length > 0;
  const visibleNav = NAV.filter((item) => !item.adminOnly || isAdmin);

  return (
    <aside className="fixed left-0 top-0 bottom-0 z-20 flex w-60 flex-col border-r border-neutral-200 bg-white">
      {/* Brand */}
      <div className="border-b border-neutral-200 px-5 py-5">
        <button
          type="button"
          onClick={() => router.push('/')}
          className="block text-left"
        >
          <h1 className="text-base font-semibold tracking-tight text-neutral-900">Scout XI</h1>
          <p className="mt-0.5 text-xs text-neutral-500">Plataforma de scouting</p>
        </button>
      </div>

      {/* Navegação */}
      <nav className="flex-1 px-3 py-4">
        <ul className="space-y-0.5">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <li key={item.href}>
                <button
                  type="button"
                  onClick={() => router.push(item.href)}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                    active
                      ? 'bg-neutral-100 font-medium text-neutral-900'
                      : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={active ? 2.2 : 1.8} />
                  <span>{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* Pesquisar jogador ou equipa */}
        <div className="mt-6" ref={containerRef}>
          <div className="px-3 pb-2 text-xs font-medium uppercase tracking-wider text-neutral-400">
            Pesquisar
          </div>
          <div className="relative">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" strokeWidth={2} />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => query.length >= 2 && setShowResults(true)}
                placeholder="Jogador ou equipa…"
                className="w-full rounded-md border border-neutral-200 bg-neutral-50 py-1.5 pl-9 pr-3 text-sm placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white focus:outline-none"
              />
            </div>

            {showResults && (query.length >= 2) && (
              <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-96 overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-lg">
                {loading ? (
                  <div className="px-3 py-2 text-xs text-neutral-500">A procurar…</div>
                ) : !hasResults ? (
                  <div className="px-3 py-2 text-xs text-neutral-500">Sem resultados.</div>
                ) : (
                  <>
                    {teamResults.length > 0 && (
                      <div>
                        <div className="border-b border-neutral-100 bg-neutral-50 px-3 py-1 text-xs font-medium uppercase tracking-wider text-neutral-500">
                          Equipas
                        </div>
                        <ul>
                          {teamResults.map((t) => (
                            <li key={`${t.pool_id}-${t.name}`}>
                              <button
                                type="button"
                                onClick={() => goToTeam(t.pool_id, t.name)}
                                className="block w-full px-3 py-2 text-left hover:bg-neutral-50"
                              >
                                <div className="flex items-center gap-2">
                                  <Shield className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={1.6} />
                                  <span className="truncate text-sm font-medium text-neutral-900">{t.name}</span>
                                </div>
                                {t.pool_name && (
                                  <div className="ml-6 mt-0.5 truncate text-xs text-neutral-500">
                                    {t.pool_name}
                                  </div>
                                )}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {playerResults.length > 0 && (
                      <div>
                        <div className="border-b border-neutral-100 bg-neutral-50 px-3 py-1 text-xs font-medium uppercase tracking-wider text-neutral-500">
                          Jogadores
                        </div>
                        <ul>
                          {playerResults.map((p) => (
                            <li key={p.id} className="flex items-center gap-1 hover:bg-neutral-50">
                              <div className="px-2">
                                <FavoriteStar playerId={p.id} />
                              </div>
                              <button
                                type="button"
                                onClick={() => goToPlayer(p.id)}
                                className="block flex-1 py-2 pr-3 text-left"
                              >
                                <div className="flex items-center gap-2">
                                  <UserCircle2 className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={1.6} />
                                  <span className="truncate text-sm font-medium text-neutral-900">{p.name}</span>
                                </div>
                                <div className="ml-6 mt-0.5 truncate text-xs text-neutral-500">
                                  {[p.current_team, p.position_primary, p.age].filter(Boolean).join(' · ')}
                                  {p.pool_name && <span className="text-neutral-400"> · {p.pool_name}</span>}
                                </div>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Footer com user e botão sair */}
      <div className="border-t border-neutral-200">
        {user && (
          <div className="px-3 py-3">
            <div className="mb-2 px-2 text-xs text-neutral-500 truncate" title={user.email ?? ''}>
              {user.email}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
            >
              <LogOut className="h-3.5 w-3.5" strokeWidth={1.8} />
              <span>Sair</span>
            </button>
          </div>
        )}
        <div className="border-t border-neutral-200 px-5 py-2 text-xs text-neutral-400">
          v0.5 · Ligas Portuguesas
        </div>
      </div>
    </aside>
  );
}