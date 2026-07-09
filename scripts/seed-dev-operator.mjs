/**
 * seed-dev-operator.mjs — operador de dev para el POS funcional (Slice 1 auth).
 *
 * Crea (idempotente) un usuario Supabase Auth + su empresa + el link
 * company_users(role=owner), y verifica que un sign-in real trae el claim
 * `company_id` inyectado por el Custom Access Token Hook (migration 0015).
 *
 * NO es data productiva — es un operador local para desarrollar el POS.
 * Lee credenciales de .env.test (no las hardcodea). Correr:
 *   node scripts/seed-dev-operator.mjs
 */
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.test', 'utf8')
    .split('\n')
    .filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const DB = env.DATABASE_URL;

const EMAIL = 'operador@pandora.dev';
const PASSWORD = 'pandora-dev-1234';
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── 1. Crear o encontrar el auth user ──
let userId;
const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD,
  email_confirm: true,
});
if (created?.user) {
  userId = created.user.id;
} else {
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  userId = list?.users?.find((u) => u.email === EMAIL)?.id;
}
if (!userId) {
  throw new Error(`No pude crear/encontrar el auth user: ${createErr?.message}`);
}

// ── 2. Empresa + public.users + company_users (via pg, bypassa RLS) ──
const sql = postgres(DB);
try {
  await sql`
    INSERT INTO companies (id, name, legal_name, cuit, tax_regime,
      merchant_jurisdiction_province, merchant_special_regime,
      afip_environment, afip_sale_point, demo_status)
    VALUES (${COMPANY_ID}, 'Kiosco Demo TDF', 'Kiosco Demo TDF SRL',
      '20111111112', 'responsable_inscripto', 'TIERRA_DEL_FUEGO', NULL,
      'homologacion', '0001', 'trial')
    ON CONFLICT (id) DO NOTHING`;

  await sql`
    INSERT INTO users (id, email, full_name, is_support)
    VALUES (${userId}, ${EMAIL}, 'Operador Demo', false)
    ON CONFLICT (id) DO NOTHING`;

  await sql`
    INSERT INTO company_users (id, company_id, user_id, role)
    SELECT gen_random_uuid(), ${COMPANY_ID}, ${userId}, 'owner'
    WHERE NOT EXISTS (
      SELECT 1 FROM company_users
      WHERE company_id = ${COMPANY_ID} AND user_id = ${userId}
    )`;

  // ── Catálogo demo (para el POS funcional Slice 5) ──
  // sku único por tenant → ON CONFLICT no re-inserta en corridas repetidas.
  // Algunos tdf_exempt=true (Ley 19.640) para ver el badge + ImpOpEx.
  const DEMO_PRODUCTS = [
    ['COCA600', 'Coca-Cola 600ml', '1800.0000', '1200.0000', '21.00', false, '48.0000'],
    ['SPRITE600', 'Sprite 600ml', '1750.0000', '1150.0000', '21.00', false, '36.0000'],
    ['YERBA1K', 'Yerba Playadito 1kg', '3800.0000', '2600.0000', '21.00', false, '20.0000'],
    ['PANLAC', 'Pan Lactal Bimbo', '2900.0000', '1900.0000', '21.00', false, '12.0000'],
    ['CAFE250', 'Café La Virginia 250g', '3200.0000', '2100.0000', '21.00', false, '15.0000'],
    ['AGUA15', 'Agua Mineral 1.5L', '1200.0000', '700.0000', '21.00', true, '60.0000'],
    ['NOTEBOOK', 'Cuaderno A4 Rivadavia', '2500.0000', '1500.0000', '21.00', true, '30.0000'],
  ];
  for (const [sku, name, price, cost, tax, exempt, stock] of DEMO_PRODUCTS) {
    // products no tiene UNIQUE(tenant_id, sku) → WHERE NOT EXISTS (idempotente).
    await sql`
      INSERT INTO products (id, tenant_id, sku, name, unit_type, price, cost,
        tax_rate, tdf_exempt, stock_current, stock_minimum, stock_tracking_enabled, is_active)
      SELECT gen_random_uuid(), ${COMPANY_ID}, ${sku}, ${name}, 'unidad',
        ${price}, ${cost}, ${tax}, ${exempt}, ${stock}, '3.0000', true, true
      WHERE NOT EXISTS (
        SELECT 1 FROM products WHERE tenant_id = ${COMPANY_ID} AND sku = ${sku}
      )`;
  }
} finally {
  await sql.end();
}

console.log('SEED OK →', { userId, companyId: COMPANY_ID, email: EMAIL });

// ── 3. Verificar: sign-in real trae company_id inyectado por el hook ──
const anon = createClient(URL, ANON, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: signin, error: signinErr } = await anon.auth.signInWithPassword({
  email: EMAIL,
  password: PASSWORD,
});
if (signinErr) throw new Error(`Sign-in falló: ${signinErr.message}`);

const payload = JSON.parse(
  Buffer.from(signin.session.access_token.split('.')[1], 'base64url').toString()
);
console.log('JWT claims inyectados →', {
  company_id: payload.company_id,
  active_company_id: payload.active_company_id,
  app_role: payload.app_role,
  is_support: payload.is_support,
});

if (payload.company_id !== COMPANY_ID) {
  throw new Error(
    `❌ HOOK NO INYECTÓ company_id (esperado ${COMPANY_ID}, got ${payload.company_id})`
  );
}
console.log('✅ Hook OK: el JWT del login real lleva company_id + app_role.');
