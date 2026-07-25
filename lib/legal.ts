import "server-only";

/**
 * Quién opera Salonio, para el aviso legal y las notas de privacidad.
 *
 * Vive en variables de entorno y no en el código por dos razones: son datos
 * fiscales que cambian sin que cambie el producto, y porque un dato legal
 * inventado es peor que un hueco — el hueco se ve y se rellena, el inventado
 * se publica y nadie lo revisa. Si falta alguno, la página lo señala en vez
 * de improvisar.
 *
 * El art. 10 de la LSSI-CE pide nombre o denominación social, NIF, domicilio
 * y un medio de contacto directo. Los cuatro son obligatorios antes de que
 * la web de un salón esté abierta al público.
 */
export const OPERADOR = {
  titular: process.env.LEGAL_TITULAR || null,
  nif: process.env.LEGAL_NIF || null,
  domicilio: process.env.LEGAL_DOMICILIO || null,
  email: process.env.LEGAL_EMAIL || null,
} as const;

/** Marca el hueco en lugar de dejar la frase coja o inventar el dato. */
export const dato = (v: string | null) => v ?? "«pendiente de completar»";

/** ¿Está el aviso legal listo para enseñarse? Lo usa el propio panel. */
export const legalCompleto = () => Object.values(OPERADOR).every(Boolean);

/**
 * Encargados del tratamiento: por dónde pasan de verdad los datos.
 *
 * Se listan aunque el RGPD permita describirlos por categorías, porque un
 * dueño de salón que quiera contestar a un cliente necesita nombres, no
 * "proveedores tecnológicos".
 */
export const SUBENCARGADOS = [
  { nombre: "Supabase", para: "base de datos y autenticación", donde: "Unión Europea (Irlanda)" },
  { nombre: "Vercel", para: "alojamiento de la web", donde: "Unión Europea, con CDN global" },
  { nombre: "Resend", para: "envío de los emails de cita y newsletter", donde: "Estados Unidos, con cláusulas contractuales tipo" },
  { nombre: "Stripe", para: "cobro de la señal, solo si el salón lo activa", donde: "Unión Europea / Estados Unidos" },
] as const;
