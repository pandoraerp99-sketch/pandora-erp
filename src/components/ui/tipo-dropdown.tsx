'use client';

/**
 * Desplegable "Tipo" — el de las maquetas (.tipo-dd / .tipo-menu / .tm-item).
 *
 * POR QUE NO ES UN <select> NATIVO (2026-09-06): lo fue, y estaba mal. El
 * truco de poner el chrome de la maqueta con un select transparente encima
 * arregla el BOTON, pero el menu que se despliega lo dibuja el sistema
 * operativo: lista blanca, resaltado azul de Windows, tipografia del sistema.
 * No se puede estilar, y al lado del menu glass de la maqueta se ve roto.
 *
 * Costo de hacerlo a mano: el teclado y el lector de pantalla hay que
 * escribirlos, que es justamente lo que el nativo regalaba. Va todo aca:
 *   - listbox con aria-activedescendant (el foco NO se mueve de item en item,
 *     se queda en el boton; asi lo espera el patron de combobox)
 *   - Flechas / Home / End para moverse, Enter o Espacio para elegir
 *   - Esc cierra y devuelve el foco al boton
 *   - Tab cierra (no deja un menu abierto flotando sobre la pantalla)
 *   - clic afuera cierra
 *
 * El CSS vive en el <style> de cada pantalla (es la copia verbatim de su
 * maqueta), no aca: las clases son las mismas pero los VALORES cambian entre
 * maquetas, y ese fue el error que hizo que Clientes "se pareciera pero no
 * fuera".
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';

export interface TipoDropdownProps {
  /** Opciones a listar. Vacio = no se renderiza nada. */
  opciones: readonly string[];
  /** Seleccion actual. Cadena vacia = "todos". */
  valor: string;
  onChange: (valor: string) => void;
  /** Texto del item que limpia el filtro. */
  etiquetaTodos?: string;
  /** Texto del boton cuando no hay filtro. */
  etiquetaVacia?: string;
  ariaLabel?: string;
  /**
   * Accion del pie del menu ("Gestionar tipos…"). Si no se pasa, el item se
   * muestra deshabilitado con su motivo: es preferible que se vea por que no
   * se puede a que no exista y el usuario lo busque.
   */
  alGestionar?: () => void;
  /** Motivo cuando `alGestionar` no esta disponible. */
  motivoGestionarDeshabilitado?: string;
}

export function TipoDropdown({
  opciones,
  valor,
  onChange,
  etiquetaTodos = 'Todos los tipos',
  etiquetaVacia = 'Tipo',
  ariaLabel = 'Filtrar por tipo',
  alGestionar,
  motivoGestionarDeshabilitado,
}: TipoDropdownProps) {
  const [abierto, setAbierto] = useState(false);
  // Item resaltado por teclado. Indice sobre `items` (0 = "todos").
  const [activo, setActivo] = useState(0);
  const contenedor = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const idBase = useId();

  const items: readonly string[] = ['', ...opciones];
  const idDe = (i: number) => `${idBase}-op-${i}`;

  const cerrar = useCallback((devolverFoco: boolean) => {
    setAbierto(false);
    if (devolverFoco) boton.current?.focus();
  }, []);

  const abrir = useCallback(() => {
    // Al abrir, el resaltado arranca en lo que ya esta elegido: es lo que
    // espera quien navega con teclado, y evita tener que contar filas.
    const i = items.indexOf(valor);
    setActivo(i >= 0 ? i : 0);
    setAbierto(true);
  }, [items, valor]);

  const elegir = (v: string) => {
    onChange(v);
    cerrar(true);
  };

  // Clic afuera. Se escucha en captura para ganarle a los stopPropagation de
  // la fila que hay debajo.
  useEffect(() => {
    if (!abierto) return;
    const afuera = (e: MouseEvent) => {
      if (!contenedor.current?.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('mousedown', afuera, true);
    return () => document.removeEventListener('mousedown', afuera, true);
  }, [abierto]);

  if (opciones.length === 0) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!abierto) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        abrir();
      }
      return;
    }
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        cerrar(true);
        break;
      case 'Tab':
        // Sin preventDefault: que el Tab siga su camino. Solo se cierra.
        setAbierto(false);
        break;
      case 'ArrowDown':
        e.preventDefault();
        setActivo((i) => Math.min(i + 1, items.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActivo((i) => Math.max(i - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        setActivo(0);
        break;
      case 'End':
        e.preventDefault();
        setActivo(items.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        elegir(items[activo] ?? '');
        break;
      default:
        break;
    }
  };

  const gestionarHabilitado = typeof alGestionar === 'function';

  return (
    <div
      className={abierto ? 'tipo-dd open' : 'tipo-dd'}
      ref={contenedor}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        className="tipo-btn glass"
        ref={boton}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-controls={`${idBase}-menu`}
        aria-activedescendant={abierto ? idDe(activo) : undefined}
        onClick={() => (abierto ? cerrar(false) : abrir())}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--purple)' }}>
          <path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.58a2 2 0 0 1 0 2.83z" />
          <circle cx="7" cy="7" r="1.5" />
        </svg>
        <span className="tb-lbl">{valor === '' ? etiquetaVacia : valor}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <div className="tipo-menu" id={`${idBase}-menu`} role="listbox" aria-label={ariaLabel}>
        {items.map((op, i) => (
          <button
            key={op === '' ? '__todos__' : op}
            type="button"
            id={idDe(i)}
            role="option"
            aria-selected={valor === op}
            // `.on` es la marca visual de la maqueta y aca vale para DOS cosas
            // distintas: lo elegido y lo resaltado por teclado. Se pinta si es
            // cualquiera de las dos, que es como se comporta un desplegable.
            className={valor === op || (abierto && activo === i) ? 'tm-item on' : 'tm-item'}
            tabIndex={-1}
            onMouseEnter={() => setActivo(i)}
            onClick={() => elegir(op)}
          >
            {op === '' ? etiquetaTodos : op}
          </button>
        ))}

        <div className="tm-div" />
        <button
          type="button"
          className="tm-item mng"
          tabIndex={-1}
          disabled={!gestionarHabilitado}
          title={gestionarHabilitado ? undefined : motivoGestionarDeshabilitado}
          aria-disabled={!gestionarHabilitado}
          onClick={() => {
            if (!gestionarHabilitado) return;
            setAbierto(false);
            alGestionar!();
          }}
        >
          Gestionar tipos…
        </button>
      </div>
    </div>
  );
}
