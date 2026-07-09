/**
 * POSLayout — el shell de zonas del POS (grid named areas).
 *
 * Define la composición espacial de las 4 zonas del POS sin conocer su
 * contenido. Cada zona es un slot:
 *   - Zone S (status):  StatusBar — full width, arriba.
 *   - Zone C (cart):    CartRail — columna fija 340px a la izquierda.
 *   - Zone K (catalog): catálogo — flex, ocupa el resto.
 *   - Zone A (action):  ActionBar — full width, abajo (sticky glass).
 *
 * La ASIMETRÍA (cart 340 fijo + catalog flex, NO 50/50) es intencional y
 * vive acá: es decisión de composición, no de los componentes hijos
 * (POS-DESIGN-V1.1-DIRECTION.md §10 quality gate "Compose").
 *
 * Implementado con CSS Grid de áreas nombradas para que las zonas sean
 * declarativas y reordenables sin tocar los hijos.
 *
 * Spec: docs/POS-DESIGN-V1.md §4 (zonas) + POS-DESIGN-V1.1-DIRECTION.md §9.
 * Target: tablet 10" landscape (1024×768) primero, desktop 1440+ segundo.
 */
import * as React from 'react';

export interface POSLayoutProps {
  /** Zone S — barra de estado superior (StatusBar). */
  statusBar: React.ReactNode;
  /** Zone C — riel del carrito (CartRail). */
  cartRail: React.ReactNode;
  /** Zone K — catálogo de productos. */
  catalog: React.ReactNode;
  /** Zone A — barra de acciones inferior (ActionBar). */
  actionBar: React.ReactNode;
}

/** Ancho fijo del riel de carrito — único valor "mágico" del layout. */
const CART_RAIL_WIDTH = '340px';

export function POSLayout({
  statusBar,
  cartRail,
  catalog,
  actionBar,
}: POSLayoutProps) {
  return (
    <div
      className="pos-stage min-h-screen w-full overflow-hidden"
      style={{
        fontFamily: 'var(--font-ui)',
        display: 'grid',
        gridTemplateRows: 'auto minmax(0, 1fr) auto',
        gridTemplateColumns: `${CART_RAIL_WIDTH} minmax(0, 1fr)`,
        gridTemplateAreas: `
          "status status"
          "cart   catalog"
          "action action"
        `,
      }}
    >
      {/* Zone S — status */}
      <div style={{ gridArea: 'status' }}>{statusBar}</div>

      {/* Zone C — cart rail (340 fijo). Padding del layout; surface en el hijo. */}
      <div
        style={{ gridArea: 'cart' }}
        className="min-h-0 flex p-3 pr-1.5"
      >
        {cartRail}
      </div>

      {/* Zone K — catalog (flex). */}
      <div
        style={{ gridArea: 'catalog' }}
        className="min-h-0 flex flex-col overflow-hidden p-3 pl-1.5"
      >
        {catalog}
      </div>

      {/* Zone A — action bar (sticky glass dentro del propio componente). */}
      <div style={{ gridArea: 'action' }}>{actionBar}</div>
    </div>
  );
}
