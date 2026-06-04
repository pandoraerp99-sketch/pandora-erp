import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-background font-sans p-8">
      <main className="max-w-2xl w-full bg-card border border-border rounded-3xl p-12 shadow-sm">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
            Pandora ERP
          </span>
          <span className="text-xs font-mono text-muted-foreground/60">
            · sprint 0 base
          </span>
        </div>

        <h1 className="text-4xl sm:text-5xl font-semibold leading-tight tracking-tight text-foreground mb-4">
          POS + ERP fiscal
          <br />
          hecho en Tierra del Fuego.
        </h1>

        <p className="text-base sm:text-lg text-muted-foreground mb-8 max-w-xl leading-relaxed">
          Para comercios chicos argentinos. AFIP nativo desde el día 1. Multi-tenant.
          Sin chiches, sin enterprise. Con atención al detalle.
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-foreground text-background px-6 font-medium text-sm transition-colors hover:opacity-90"
          >
            Iniciar sesión
          </Link>
          <Link
            href="/api/health"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-border bg-card text-foreground px-6 font-medium text-sm transition-colors hover:bg-muted"
          >
            Health check
          </Link>
        </div>

        <div className="mt-10 pt-6 border-t border-border flex items-center justify-between">
          <span className="text-xs font-mono text-muted-foreground/60">
            v0.0.1 · 2026-05-30
          </span>
          <span className="text-xs font-mono text-muted-foreground/60">
            Next 16 · Drizzle · Supabase
          </span>
        </div>
      </main>
    </div>
  );
}
