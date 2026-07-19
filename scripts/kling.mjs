// Cliente CLI de Kling (vídeo) para el pipeline de sprites de scroll.
// Uso:
//   node scripts/kling.mjs test
//   node scripts/kling.mjs i2v inicio.png salida.mp4 --prompt "..." \
//        [--tail fin.png] [--dur 5] [--mode std|pro] [--model kling-v2-1]
//
// Lee KLING_API_KEY de .env.local (clave única Bearer de la consola nueva).
// Si algún día se usan las claves clásicas AK/SK, definir KLING_ACCESS_KEY y
// KLING_SECRET_KEY y el script firmará el JWT él solo.
//
// El flujo: crear tarea → sondear cada 10 s → descargar el MP4. Después,
// ffmpeg trocea el vídeo en frames WebP (ver docs/ y scripts del sprite).

import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(resolve(raiz, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const HOSTS = [
  "https://api-singapore.klingai.com",
  "https://api.klingai.com",
];

function jwtDesdeAkSk(ak, sk) {
  const b64 = (o) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const ahora = Math.floor(Date.now() / 1000);
  const cabeza = b64({ alg: "HS256", typ: "JWT" });
  const cuerpo = b64({ iss: ak, exp: ahora + 1800, nbf: ahora - 5 });
  const firma = createHmac("sha256", sk)
    .update(`${cabeza}.${cuerpo}`)
    .digest("base64url");
  return `${cabeza}.${cuerpo}.${firma}`;
}

function token() {
  if (env.KLING_ACCESS_KEY && env.KLING_SECRET_KEY) {
    return jwtDesdeAkSk(env.KLING_ACCESS_KEY, env.KLING_SECRET_KEY);
  }
  if (env.KLING_API_KEY) return env.KLING_API_KEY;
  console.error("Falta KLING_API_KEY (o KLING_ACCESS_KEY + KLING_SECRET_KEY) en .env.local");
  process.exit(1);
}

async function llamar(metodo, ruta, body) {
  let ultimo;
  for (const host of HOSTS) {
    try {
      const res = await fetch(`${host}${ruta}`, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${token()}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(60000),
      });
      const out = await res.json().catch(() => null);
      if (res.ok && out) return { host, out };
      ultimo = `HTTP ${res.status} en ${host}: ${JSON.stringify(out).slice(0, 300)}`;
      // 401/403 puede ser cuestión de host equivocado: probar el siguiente.
    } catch (e) {
      ultimo = `${host}: ${e.message}`;
    }
  }
  throw new Error(ultimo ?? "sin respuesta");
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "test") {
  // Consulta de paquetes de recursos: barata y suficiente para validar auth.
  const fin = Date.now();
  const inicio = fin - 30 * 24 * 3600 * 1000;
  try {
    const { host, out } = await llamar(
      "GET",
      `/account/costs?start_time=${inicio}&end_time=${fin}`,
    );
    console.log(`AUTH OK en ${host}`);
    console.log(JSON.stringify(out, null, 2).slice(0, 800));
  } catch (e) {
    console.error("AUTH FALLA:", e.message);
    process.exit(1);
  }
} else if (cmd === "i2v") {
  const [entrada, salida] = args;
  const flags = {};
  for (let i = 2; i < args.length; i++) {
    if (args[i].startsWith("--")) flags[args[i].slice(2)] = args[i + 1];
  }
  if (!entrada || !salida || !flags.prompt) {
    console.error('Uso: kling.mjs i2v inicio.png salida.mp4 --prompt "..." [--tail fin.png] [--dur 5] [--mode std|pro] [--model kling-v2-1]');
    process.exit(1);
  }

  const b64img = (p) => readFileSync(resolve(p)).toString("base64");
  const body = {
    model_name: flags.model ?? "kling-v2-1",
    image: b64img(entrada),
    prompt: flags.prompt,
    mode: flags.mode ?? "std",
    duration: flags.dur ?? "5",
    cfg_scale: 0.5,
  };
  if (flags.tail) body.image_tail = b64img(flags.tail);

  const { host, out } = await llamar("POST", "/v1/videos/image2video", body);
  if (out.code !== 0) {
    console.error("Kling rechazó la tarea:", JSON.stringify(out).slice(0, 400));
    process.exit(1);
  }
  const id = out.data.task_id;
  console.log(`tarea ${id} creada en ${host}; sondeando…`);

  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    const { out: st } = await llamar("GET", `/v1/videos/image2video/${id}`);
    const estado = st?.data?.task_status;
    process.stdout.write(`\r${estado}   (${(i + 1) * 10}s)   `);
    if (estado === "succeed") {
      const url = st.data.task_result?.videos?.[0]?.url;
      if (!url) throw new Error("succeed sin URL de vídeo");
      const res = await fetch(url);
      writeFileSync(resolve(salida), Buffer.from(await res.arrayBuffer()));
      console.log(`\n✓ vídeo → ${salida}`);
      process.exit(0);
    }
    if (estado === "failed") {
      console.error(`\nFALLÓ: ${st.data.task_status_msg ?? "sin motivo"}`);
      process.exit(1);
    }
  }
  console.error("\nTiempo agotado (15 min)");
  process.exit(1);
} else {
  console.error("Comandos: test | i2v");
  process.exit(1);
}
