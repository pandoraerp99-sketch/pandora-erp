'use client';

/**
 * AppShell — el shell visual COMPARTIDO de Pandora: sidebar + topbar + atmósfera.
 *
 * Por qué existe (2026-09-03): el POS se había construido siguiendo
 * `docs/POS-DESIGN-V1.1-DIRECTION.md` en vez de la maqueta, y quedó SIN sidebar
 * y SIN topbar — es decir, sin la estructura que le da identidad a la app. El
 * owner entró y no reconoció el producto. Causa raíz: cada pantalla negociaba
 * su propio look.
 *
 * Regla que este componente hace cumplir: **la maqueta es la autoridad visual**
 * (`pos-preview/checkpoint-v19-top-tools.html`). El CSS de `shellCss.ts` está
 * extraído literal de ahí; los íconos del sidebar también. Nada se reinterpreta.
 *
 * Toda pantalla nueva se monta acá adentro y hereda el shell sin decidir nada.
 *
 * Layout (grid de la maqueta): 210px sidebar | 1fr contenido | 280px aside.
 * El aside es opcional: el POS le pasa el carrito, el resto no le pasa nada y
 * la grilla colapsa a 2 columnas.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SHELL_CSS } from './shellCss';
import { NAV_ITEMS, IMPLEMENTED_ROUTES } from './navItems';

export interface AppShellProps {
  /** Contenido principal (columna del medio). */
  children: React.ReactNode;
  /** Columna derecha opcional (el carrito, en el POS). */
  aside?: React.ReactNode;
  /** Barra superior. Si no se pasa, se usa la del shell con el buscador. */
  topbar?: React.ReactNode;
  /** Nombre del comercio para el pill de la topbar. */
  storeName?: string;
  /** Nombre y rol del usuario, para el pie del sidebar. */
  userName?: string;
  userRole?: string;
  /** Estado de AFIP en el pie del sidebar. */
  afipConnected?: boolean;
  afipDetail?: string;
}

function initials(name: string): string {
  const partes = name.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '··';
  const primera = partes[0]?.[0] ?? '';
  const segunda = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : '';
  return (primera + segunda).toUpperCase();
}

export function AppShell({
  children,
  aside,
  topbar,
  storeName = 'Mi comercio',
  userName = 'Operador',
  userRole = 'Cajero',
  afipConnected = false,
  afipDetail = 'WSFEv1',
}: AppShellProps) {
  const pathname = usePathname();

  // Tema claro/oscuro — mismo mecanismo que los mockups y que /caja-real:
  // localStorage['pandora-theme'] + data-theme en <html>.
  const [dark, setDark] = useState(false);
  useEffect(() => {
    let guardado: string | null = null;
    try {
      guardado = window.localStorage.getItem('pandora-theme');
    } catch {
      guardado = null;
    }
    const esOscuro = guardado === 'dark';
    setDark(esOscuro);
    document.documentElement.dataset.theme = esOscuro ? 'dark' : 'light';
  }, []);

  const toggleTema = () => {
    const siguiente = !dark;
    setDark(siguiente);
    document.documentElement.dataset.theme = siguiente ? 'dark' : 'light';
    try {
      window.localStorage.setItem('pandora-theme', siguiente ? 'dark' : 'light');
    } catch {
      // Modo privado o storage bloqueado: el tema igual aplica en esta sesión.
    }
  };

  const gridColumns = aside ? '210px 1fr 280px' : '210px 1fr';

  return (
    <>
      <style>{SHELL_CSS}</style>

      {/* Atmósfera dawn: gradiente base + glows radiales. Va fixed detrás de
          todo (z-index -10). Sin esto el glass queda sobre blanco y se ve
          plano — que es exactamente lo que le pasaba al POS. */}
      <div className="bg" aria-hidden="true">
        <div className="base" />
        <div className="glow" />
      </div>

      <div className="shell" style={{ gridTemplateColumns: gridColumns }}>
        {/* ════ SIDEBAR ════ */}
        <aside className="sidebar glass-strong">
          <div className="logo-row">
            <span className="logo-mark">
              <svg viewBox="0 0 32 32">
                <defs>
                  <linearGradient id="pandora-logo" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#6b5fff" />
                    <stop offset="100%" stopColor="#5b8cff" />
                  </linearGradient>
                </defs>
                <rect width="32" height="32" rx="9" fill="url(#pandora-logo)" />
                <path
                  d="M11 22V10h5a4 4 0 0 1 0 8h-5"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="logo-text">Pandora</span>
          </div>

          <nav
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '3px',
              flex: 1,
              overflowY: 'auto',
              minHeight: 0,
              paddingRight: '4px',
              marginRight: '-4px',
            }}
          >
            {NAV_ITEMS.map((item) => {
              const activo = pathname === item.href;
              const existe = IMPLEMENTED_ROUTES.has(item.href);
              const contenido = (
                <>
                  <div
                    className="nav-icon-box"
                    dangerouslySetInnerHTML={{ __html: item.icon }}
                  />
                  <span>{item.label}</span>
                </>
              );

              // Las rutas que todavía no existen se pintan igual (son parte de
              // la identidad de la app) pero no navegan a un 404.
              if (!existe) {
                return (
                  <div
                    key={item.href}
                    className="nav-item"
                    style={{ opacity: 0.45, cursor: 'default' }}
                    title="Todavía no construida"
                    aria-disabled="true"
                  >
                    {contenido}
                  </div>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={activo ? 'nav-item active' : 'nav-item'}
                  aria-current={activo ? 'page' : undefined}
                >
                  {contenido}
                </Link>
              );
            })}
          </nav>

          <div className="side-foot">
            <div className="afip">
              <div className="afip-top">
                <span
                  className="afip-dot"
                  style={afipConnected ? undefined : { background: 'var(--ink-4)' }}
                />
                <span className="afip-name">
                  {afipConnected ? 'AFIP conectado' : 'AFIP sin conectar'}
                </span>
                {afipConnected && <span className="afip-live">LIVE</span>}
              </div>
              <div className="afip-sub">{afipDetail}</div>
            </div>

            <div className="cashier">
              <span className="avatar-ring">
                <span className="cashier-av">{initials(userName)}</span>
              </span>
              <div>
                <div className="cashier-name">{userName}</div>
                <div className="cashier-role">{userRole}</div>
              </div>
            </div>
          </div>
        </aside>

        {/* ════ CONTENIDO ════ */}
        <section className="main" data-view="prod">
          {topbar ?? (
            <div className="topbar">
              <div className="search glass">
                <svg
                  className="lead"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input placeholder="Buscar producto, cliente o comprobante…" />
              </div>

              <div className="store-pill glass">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 9 5 3h14l2 6" />
                  <path d="M4 9v11h16V9" />
                </svg>
                <span>{storeName}</span>
              </div>

              <div className="top-tools">
                <button
                  type="button"
                  className="store-pill glass"
                  onClick={toggleTema}
                  aria-label={dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
                  title={dark ? 'Modo claro' : 'Modo oscuro'}
                >
                  {dark ? (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="4" />
                      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                    </svg>
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          )}

          {children}
        </section>

        {/* ════ ASIDE (carrito en el POS) ════ */}
        {aside}
      </div>
    </>
  );
}
