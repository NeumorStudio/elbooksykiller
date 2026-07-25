import type { Modo, HorasIniciales } from "./editor-horario";

export type Tramo = { id?: string; weekday: number; start_min: number; end_min: number };

// La semana como la lee una persona: el domingo va al final, no al principio.
const ORDEN = [1, 2, 3, 4, 5, 6, 0];
const CORTO = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export const fmtMin = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** "Lun–Sáb" si los días van seguidos; "Lun, Mié, Vie" si no. */
export function resumenDias(dias: number[]): string {
  const pos = dias.map((d) => ORDEN.indexOf(d)).sort((a, b) => a - b);
  if (pos.length === 0) return "";
  if (pos.length === 1) return CORTO[ORDEN[pos[0]]];
  const seguidos = pos.every((p, i) => i === 0 || p === pos[i - 1] + 1);
  if (seguidos && pos.length > 2)
    return `${CORTO[ORDEN[pos[0]]]}–${CORTO[ORDEN[pos[pos.length - 1]]]}`;
  return pos.map((p) => CORTO[ORDEN[p]]).join(", ");
}

/**
 * Agrupa el horario en bloques de días que trabajan igual.
 *
 * Doce filas sueltas ("lunes 10:00-13:30", "lunes 16:00-20:30", "martes
 * 10:00-13:30"…) no se leen de un vistazo, que es el criterio del panel.
 * Una jornada partida de lunes a sábado es UNA línea.
 */
export function agruparHorario(tramos: Tramo[]) {
  const porDia = new Map<number, [number, number][]>();
  for (const t of tramos) {
    porDia.set(t.weekday, [...(porDia.get(t.weekday) ?? []), [t.start_min, t.end_min]]);
  }
  for (const [, v] of porDia) v.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const grupos = new Map<string, { dias: number[]; tramos: [number, number][] }>();
  for (const d of ORDEN) {
    const t = porDia.get(d);
    if (!t?.length) continue;
    const clave = JSON.stringify(t);
    const g = grupos.get(clave) ?? { dias: [], tramos: t };
    g.dias.push(d);
    grupos.set(clave, g);
  }
  return [...grupos.values()];
}

/** Días sin ningún tramo: el salón no ofrece hueco ninguno. */
export const diasCerrados = (tramos: Tramo[]) =>
  ORDEN.filter((d) => !tramos.some((t) => t.weekday === d));

/**
 * Días cuyos tramos se pisan.
 *
 * La tabla no lo impide y el panel antiguo lo permitía sin avisar: en
 * producción hubo un empleado con 10:00-14:00 y 04:00-21:00 a la vez. Desde
 * la migración 0012 la RPC ya no duplica huecos, pero el horario sigue
 * siendo mentira y hay que enseñárselo al dueño.
 */
export function diasConSolape(tramos: Tramo[]): number[] {
  const out: number[] = [];
  for (const d of ORDEN) {
    const t = tramos
      .filter((x) => x.weekday === d)
      .sort((a, b) => a.start_min - b.start_min);
    if (t.some((x, i) => i > 0 && x.start_min < t[i - 1].end_min)) out.push(d);
  }
  return out;
}

const POR_DEFECTO: HorasIniciales = {
  inicio: "10:00", fin: "20:00",
  mInicio: "10:00", mFin: "14:00", tInicio: "16:00", tFin: "20:00",
};

/**
 * Con qué se abre el editor: el patrón que más días cubre, ya relleno.
 * Quien solo quiere retocar la hora de cierre no tiene que teclear nada más.
 */
export function estadoInicial(tramos: Tramo[]): {
  dias: number[]; modo: Modo; horas: HorasIniciales;
} {
  const grupos = agruparHorario(tramos);
  if (grupos.length === 0)
    return { dias: [1, 2, 3, 4, 5], modo: "continua", horas: POR_DEFECTO };

  const g = grupos.reduce((a, b) => (b.dias.length > a.dias.length ? b : a));
  if (g.tramos.length === 1) {
    const [ini, fin] = g.tramos[0];
    return {
      dias: g.dias,
      modo: "continua",
      horas: { ...POR_DEFECTO, inicio: fmtMin(ini), fin: fmtMin(fin) },
    };
  }
  // Dos o más: se editan como partida usando el primero y el último. Un
  // tercer tramo es rarísimo y al guardar queda absorbido en dos, que es
  // justo la limpieza que hace falta.
  const [mIni, mFin] = g.tramos[0];
  const [tIni, tFin] = g.tramos[g.tramos.length - 1];
  return {
    dias: g.dias,
    modo: "partida",
    horas: {
      ...POR_DEFECTO,
      mInicio: fmtMin(mIni), mFin: fmtMin(mFin),
      tInicio: fmtMin(tIni), tFin: fmtMin(tFin),
    },
  };
}
