// Crea un dueño + salón de demostración en la base de DEV para las capturas
// del manual. Se borra con borrar-demo.mjs al terminar.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync("/home/mate0s/Proyectos/NeumorStudio/salonio/.env.local", "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
);

const admin = createClient(env.SUPABASE_DEV_URL, env.SUPABASE_DEV_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const EMAIL = "onboarding-demo@salonio.test";
const PASSWORD = "DemoOnboarding2026!";

const { data: u, error: e1 } = await admin.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD,
  email_confirm: true,
});
if (e1) throw new Error("usuario: " + e1.message);
console.log("usuario:", u.user.id);

const { data: s, error: e2 } = await admin
  .from("salons")
  .insert({
    owner_id: u.user.id,
    name: "Peluquería Ejemplo",
    slug: "peluqueria-ejemplo",
    timezone: "Europe/Madrid",
  })
  .select("id, slug")
  .single();
if (e2) throw new Error("salón: " + e2.message);
console.log("salón:", s.id, s.slug);
