// Comprueba la migración 0032 contra la base de DEV, por los dos caminos
// reales: una reserva de la web pública (visitante anónimo) y un alta a mano
// del panel (sesión del dueño). Falla si alguna sale mal etiquetada.
//
//   npm run build && npm start          # el panel necesita el servidor
//   node supabase/migrations/comprobar-0032.mjs
//
// Requiere BD=dev en .env.local y un salón con servicio, profesional y
// horario en dev (ver docs/manual-cliente/salon-demo.mjs).
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
);
const admin = createClient(env.SUPABASE_DEV_URL, env.SUPABASE_DEV_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── Cerrojo ────────────────────────────────────────────────────────────
// Esto crea y borra citas de verdad, así que se niega a correr fuera de la
// base de dev. Cuidado: el salón de dev se LLAMA «Paye Villalobos» pero su
// slug es `salon-de-pruebas`; el piloto real es el slug `paye-villalobos` y
// vive solo en producción. Por eso el corte va por slug y por proyecto, que
// son los que no mienten, y nunca por el nombre.
const REF_DEV = "cjyfbmyidqubqikkbvpx";
if (!env.SUPABASE_DEV_URL?.includes(REF_DEV)) {
  console.error(`ABORTADO: SUPABASE_DEV_URL no apunta al proyecto de dev (${REF_DEV}).`);
  process.exit(1);
}

let fallos = 0;
const comprobar = (ok, texto) => {
  console.log(`${ok ? "✔" : "✘"} ${texto}`);
  if (!ok) fallos++;
};

// ── 0. ¿Está aplicada? ─────────────────────────────────────────────────
const sonda = await admin.from("bookings").select("source").limit(1);
if (sonda.error) {
  console.error("La migración 0032 NO está aplicada en dev:", sonda.error.message);
  process.exit(1);
}
console.log("Migración 0032 aplicada en dev.\n");

// ── 1. Camino público: la RPC, llamada con la clave anónima ────────────
const anon = createClient(env.SUPABASE_DEV_URL, env.SUPABASE_DEV_ANON_KEY, {
  auth: { persistSession: false },
});
const { data: emp } = await admin.from("employees").select("id,salon_id").eq("active", true).limit(1).single();

// Segundo cerrojo: nunca sobre el salón piloto real.
const { data: destino } = await admin.from("salons").select("slug,name").eq("id", emp.salon_id).single();
if (destino.slug === "paye-villalobos") {
  console.error("ABORTADO: ese es el salón piloto real. Solo sobre el de pruebas.");
  process.exit(1);
}
console.log(`Salón de pruebas: "${destino.name}" (slug ${destino.slug})\n`);
const { data: srv } = await admin.from("services").select("id").eq("salon_id", emp.salon_id).eq("active", true).limit(1).single();

// Un hueco libre cualquiera de los próximos días.
let hueco = null;
for (let d = 1; d <= 10 && !hueco; d++) {
  const dia = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  const { data } = await anon.rpc("available_slots", { p_employee: emp.id, p_service: srv.id, p_day: dia });
  if (data?.length) hueco = data[Math.floor(data.length / 2)];
}
if (!hueco) { console.error("Sin huecos libres en dev: añade horario al profesional."); process.exit(1); }

const { data: idWeb, error: eWeb } = await anon.rpc("create_booking", {
  p_employee: emp.id, p_service: srv.id, p_start: hueco,
  p_name: "Prueba Web", p_phone: "600111222",
});
comprobar(!eWeb, `reserva pública creada${eWeb ? " — ERROR: " + eWeb.message : ""}`);
if (idWeb) {
  const { data } = await admin.from("bookings").select("source").eq("id", idWeb).single();
  comprobar(data?.source === "cliente", `reserva de la web → source='${data?.source}' (esperado 'cliente')`);
}

// ── 2. Camino del panel: INSERT con la sesión del dueño ────────────────
// Se replica lo que hace la server action: sesión real del dueño, no
// service_role — con service_role auth.uid() es NULL y saldría 'cliente'.
const { data: salon } = await admin.from("salons").select("owner_id").eq("id", emp.salon_id).single();
const { data: users } = await admin.auth.admin.listUsers();
const dueno = users.users.find((u) => u.id === salon.owner_id);
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: dueno.email });

const comoDueno = createClient(env.SUPABASE_DEV_URL, env.SUPABASE_DEV_ANON_KEY, { auth: { persistSession: false } });
const { error: eOtp } = await comoDueno.auth.verifyOtp({
  token_hash: link.properties.hashed_token, type: "magiclink",
});
comprobar(!eOtp, `sesión del dueño abierta${eOtp ? " — ERROR: " + eOtp.message : ""}`);

const inicio = new Date(new Date(hueco).getTime() + 6 * 3600000).toISOString();
const { data: creada, error: ePanel } = await comoDueno.from("bookings").insert({
  salon_id: emp.salon_id, employee_id: emp.id, service_id: srv.id,
  customer_name: "Prueba Panel", customer_phone: "—",
  starts_at: inicio,
  ends_at: new Date(new Date(inicio).getTime() + 30 * 60000).toISOString(),
  status: "confirmed",
}).select("id").single();
comprobar(!ePanel, `alta desde el panel creada${ePanel ? " — ERROR: " + ePanel.message : ""}`);
if (creada) {
  const { data } = await admin.from("bookings").select("source").eq("id", creada.id).single();
  comprobar(data?.source === "panel", `alta del panel → source='${data?.source}' (esperado 'panel')`);
}

// ── 3. Limpieza ────────────────────────────────────────────────────────
for (const id of [idWeb, creada?.id].filter(Boolean)) await admin.from("bookings").delete().eq("id", id);
await admin.from("customers").delete().eq("phone", "+34600111222");
console.log("\ncitas de prueba borradas");

console.log(fallos === 0 ? "\nTODO CORRECTO" : `\n${fallos} COMPROBACIONES FALLIDAS`);
process.exit(fallos === 0 ? 0 : 1);
