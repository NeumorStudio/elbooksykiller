import "server-only";

/**
 * Estado de cada cliente a partir de su historial de visitas.
 *
 * "Enfriándose" es donde está el dinero: el segmento a avisar en un día
 * bajo no es "todos", es los que venían con ritmo y lo han perdido. La
 * cadencia es personal (mediana de días entre visitas), no un genérico de
 * 30 días — quien viene cada 3 semanas y quien viene cada 2 meses se
 * enfrían en momentos distintos.
 */
export type Estado = "nuevos" | "racha" | "enfriandose" | "perdido";

export type FichaCliente = {
  visitas: number;
  ultima: string | null; // ISO
  cadenciaDias: number | null;
  estado: Estado;
};

const DIA = 86400_000;

export function estadosPorCliente(
  visitas: { customer_id: string; starts_at: string }[]
): Map<string, FichaCliente> {
  const porCliente = new Map<string, number[]>();
  for (const v of visitas) {
    const t = new Date(v.starts_at).getTime();
    porCliente.set(v.customer_id, [...(porCliente.get(v.customer_id) ?? []), t]);
  }

  const ahora = Date.now();
  const out = new Map<string, FichaCliente>();

  for (const [id, tiempos] of porCliente) {
    tiempos.sort((a, b) => a - b);
    const ultima = tiempos[tiempos.length - 1];
    const n = tiempos.length;

    if (n < 2) {
      out.set(id, {
        visitas: n,
        ultima: new Date(ultima).toISOString(),
        cadenciaDias: null,
        // Un solo corte hace >180 días ya no es "nuevo": se fue.
        estado: ahora - ultima > 180 * DIA ? "perdido" : "nuevos",
      });
      continue;
    }

    const huecos = tiempos.slice(1).map((t, i) => (t - tiempos[i]) / DIA);
    huecos.sort((a, b) => a - b);
    const cadencia =
      huecos.length % 2
        ? huecos[(huecos.length - 1) / 2]
        : (huecos[huecos.length / 2 - 1] + huecos[huecos.length / 2]) / 2;

    const desde = (ahora - ultima) / DIA;
    let estado: Estado;
    // Sesenta días, no treinta: con el suelo de 21 de «enfriándose», treinta
    // dejaba nueve días entre «hay que escribirle» y «se fue», y no da tiempo
    // ni a mandar una campaña. Dos meses sin pisar la peluquería sí es haberse
    // ido de verdad.
    if (desde > Math.max(cadencia * 2, 60) || desde > 180) estado = "perdido";
    /**
     * El suelo de 21 días es tan necesario como el de 30 de «perdido».
     *
     * Sin él, la cadencia manda sola y con dos visitas seguidas se vuelve
     * absurda: un cliente que vino dos veces el mismo día tiene cadencia de
     * medio día, y a las dieciocho horas de cortarse el pelo ya aparecía
     * «Enfriándose». Pasó en el piloto la semana de abrir, cuando por fuerza
     * todas las cadencias eran de horas.
     *
     * Veintiuno porque una peluquería se pisa cada tres o cuatro semanas:
     * antes de tres semanas nadie se ha enfriado por mucho que su cadencia
     * medida diga otra cosa. Y queda muy por debajo de los 60 de «perdido»,
     * que es el orden que tienen que guardar: hay casi seis semanas para
     * intentar recuperarlo antes de darlo por ido.
     */
    else if (desde > Math.max(cadencia * 1.5, 21)) estado = "enfriandose";
    else if (n >= 3) estado = "racha";
    else estado = "nuevos";

    out.set(id, {
      visitas: n,
      ultima: new Date(ultima).toISOString(),
      cadenciaDias: Math.round(cadencia),
      estado,
    });
  }

  return out;
}
