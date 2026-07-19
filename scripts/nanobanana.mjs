// Generador/editor de imágenes de marca con Nano Banana (Gemini image).
// Uso:
//   node scripts/nanobanana.mjs "<prompt>" salida.png
//   node scripts/nanobanana.mjs "<prompt>" salida.png --in foto.jpg   (edición)
//   node scripts/nanobanana.mjs "<prompt>" salida.png --ratio 16:9
//   NANOBANANA_MODEL=gemini-3.1-flash-image node ... (modelo rápido/barato)
//
// Lee GEMINI_API_KEY de .env.local. Las imágenes se revisan A OJO antes de
// entrar en public/: la IA es para material de marca/ambiente, nunca para
// inventar platos que el cliente vaya a comparar con la realidad.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(resolve(raiz, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const KEY = env.GEMINI_API_KEY;
if (!KEY) {
  console.error("Falta GEMINI_API_KEY en .env.local");
  process.exit(1);
}

// Nano Banana Pro por defecto (máxima calidad para material de marca); para
// tandas rápidas: NANOBANANA_MODEL=gemini-3.1-flash-image
const MODELO = process.env.NANOBANANA_MODEL ?? "gemini-3-pro-image";

const [prompt, salida, ...resto] = process.argv.slice(2);
if (!prompt || !salida) {
  console.error('Uso: node scripts/nanobanana.mjs "<prompt>" salida.png [--in foto.jpg] [--ratio 16:9]');
  process.exit(1);
}

const flags = {};
for (let i = 0; i < resto.length; i += 2) flags[resto[i]] = resto[i + 1];

const partes = [{ text: prompt }];
if (flags["--in"]) {
  const buf = readFileSync(resolve(flags["--in"]));
  const mime =
    extname(flags["--in"]).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
  partes.push({ inline_data: { mime_type: mime, data: buf.toString("base64") } });
}

const cuerpo = {
  contents: [{ parts: partes }],
  generationConfig: {
    responseModalities: ["IMAGE"],
    ...(flags["--ratio"]
      ? { imageConfig: { aspectRatio: flags["--ratio"] } }
      : {}),
  },
};

const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent?key=${KEY}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  },
);

if (!res.ok) {
  console.error(`HTTP ${res.status}:`, (await res.text()).slice(0, 600));
  process.exit(1);
}

const out = await res.json();
const img = out.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
if (!img) {
  console.error("La respuesta no trae imagen:", JSON.stringify(out).slice(0, 600));
  process.exit(1);
}

writeFileSync(resolve(salida), Buffer.from(img.inlineData.data, "base64"));
console.log(`✓ ${MODELO} → ${salida}`);
