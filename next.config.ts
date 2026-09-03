import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ── /panel = el mockup dashboard.html copiado LITERAL a public/ ──
  // Slice Panel (feedback owner 2026-07-09: copiar el mockup tal cual, sin
  // reinterpretar). El rewrite sirve public/panel.html en /panel. El proxy
  // (src/proxy.ts) exime /panel del CSP/auth para no romper los estilos/scripts
  // inline + fuentes del mockup. TODO F1: portar a componentes React nativos.
  async rewrites() {
    return [
      { source: "/panel", destination: "/panel.html" },
      // /caja YA NO tiene rewrite (2026-09-03): sirve el React de
      // src/app/caja/, montado sobre <AppShell> igual que el POS. La maqueta
      // que se servía acá quedó archivada en public/_maquetas/caja.html como
      // referencia visual — fuera del alcance de los rewrites.
    ];
  },

  // ── Resolución de imports `.js` → `.ts` (extensionAlias) ──
  // El codebase usa imports relativos con extensión `.js` (estilo NodeNext/ESM,
  // requerido por vitest + tsc) mientras moduleResolution es "bundler". Webpack
  // los resuelve a los `.ts` reales vía extensionAlias. Turbopack NO tiene un
  // equivalente (solo `resolveExtensions` para imports SIN extensión, y
  // `resolveAlias` para nombres de paquete — doc oficial verificada 2026-07-09),
  // por eso dev+build corren en webpack (`--webpack` en package.json). Sin esto,
  // NINGUNA ruta de Next que importe `src/lib/*` compila (Module not found
  // '../env.js'). Trade-off F0 aceptado: webpack es más lento que turbopack pero
  // correcto; volver a turbopack requeriría un codemod de imports a extensionless.
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return config;
  },
};

export default nextConfig;
