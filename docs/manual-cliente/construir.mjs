// Genera el manual autocontenido a partir de la plantilla, incrustando las
// capturas de capturas/ como data: URI. Así el HTML es un único fichero que se
// puede enviar por correo y se imprime igual sin depender de nada.
//
//   node construir.mjs        → manual.html
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";

const DIR = new URL(".", import.meta.url).pathname;
let html = readFileSync(DIR + "manual-plantilla.html", "utf8");

const nombres = [...new Set([...html.matchAll(/IMG:([\w-]+)/g)].map((m) => m[1]))];
const faltan = nombres.filter((n) => !existsSync(`${DIR}capturas/${n}.webp`));
if (faltan.length) throw new Error("faltan capturas: " + faltan.join(", "));

for (const n of nombres) {
  const uri = "data:image/webp;base64," + readFileSync(`${DIR}capturas/${n}.webp`).toString("base64");
  html = html.split("IMG:" + n).join(uri);
}

writeFileSync(DIR + "manual.html", html);
console.log(`${nombres.length} capturas incrustadas · ${(statSync(DIR + "manual.html").size / 1024 / 1024).toFixed(2)} MB`);
