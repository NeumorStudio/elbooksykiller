"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { features } from "@/lib/features";
import { sesionAdmin } from "@/lib/sesion-admin";

// Comprueba sesión y que el salón no esté bloqueado por el superadmin.
const db = sesionAdmin;

/**
 * Formatos de imagen admitidos, los mismos que el logo y la galería.
 *
 * SVG fuera a propósito: el bucket es público, y un .svg con <script>
 * dentro queda como página ejecutable bajo nuestro dominio de almacenamiento.
 */
const TIPOS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * Sube la foto de un producto y devuelve su ruta en el almacén.
 *
 * La columna `image_path` existía desde la migración 0008, pero no había
 * pantalla para llenarla: los productos se listaban como texto suelto, y un
 * bote de cera sin foto no se vende ni en el mostrador ni en una web.
 *
 * Nombre con marca de tiempo para que al reemplazar la foto el navegador no
 * siga enseñando la vieja de su caché.
 */
async function subirFoto(
  file: File,
  salonId: string
): Promise<{ path?: string; error?: string }> {
  if (!TIPOS[file.type]) return { error: "La foto tiene que ser PNG, JPG o WebP." };
  if (file.size > 3 * 1024 * 1024) return { error: "La foto pasa de 3 MB." };

  const { supabaseAdmin } = await import("@/lib/supabase/server");
  const path = `productos/${salonId}/${Date.now()}.${TIPOS[file.type]}`;
  const { error } = await supabaseAdmin()
    .storage.from("logos")
    .upload(path, file, { contentType: file.type });
  if (error) {
    console.error("subirFoto:", error.message);
    return { error: "No se pudo subir la foto. Inténtalo de nuevo." };
  }
  return { path };
}

export async function addProducto(formData: FormData) {
  const { productos } = await features();
  if (!productos) return { error: "Todavía no está activada." };

  const { supabase, user } = await db();
  const { data: salon } = await supabase
    .from("salons")
    .select("id")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!salon) return { error: "Primero crea tu peluquería." };

  const nombre = String(formData.get("name") ?? "").trim();
  const precio = Math.round(Number(formData.get("price") ?? 0) * 100);
  const stockRaw = String(formData.get("stock") ?? "").trim();

  if (nombre.length < 2) return { error: "Pon el nombre del producto." };
  if (!Number.isFinite(precio) || precio < 0) return { error: "Revisa el precio." };

  const foto = formData.get("foto");
  let imagePath: string | null = null;
  if (foto instanceof File && foto.size > 0) {
    const r = await subirFoto(foto, salon.id);
    if (r.error) return { error: r.error };
    imagePath = r.path!;
  }

  const { error } = await supabase.from("products").insert({
    salon_id: salon.id,
    name: nombre,
    description: String(formData.get("description") ?? "").trim() || null,
    price_cents: precio,
    // Vacío = no se controla stock. No se descuenta al reservar: una
    // reserva no es una venta.
    stock: stockRaw === "" ? null : Math.max(0, Number(stockRaw)),
    image_path: imagePath,
  });
  if (error) return { error: "No se pudo añadir. Revisa los datos." };
  revalidatePath("/admin/productos");
}

export async function updateProducto(formData: FormData) {
  const { productos } = await features();
  if (!productos) return { error: "Todavía no está activada." };

  const { supabase, user } = await db();
  const precio = Math.round(Number(formData.get("price") ?? 0) * 100);
  const stockRaw = String(formData.get("stock") ?? "").trim();
  if (!Number.isFinite(precio) || precio < 0) return { error: "Revisa el precio." };

  // Foto nueva solo si la manda: guardar sin tocar el campo no debe borrar
  // la que ya tenía.
  const foto = formData.get("foto");
  let imagePath: string | undefined;
  if (foto instanceof File && foto.size > 0) {
    const { data: salon } = await supabase
      .from("salons")
      .select("id")
      .eq("owner_id", user.id)
      .limit(1)
      .maybeSingle();
    if (!salon) return { error: "Primero crea tu peluquería." };
    const r = await subirFoto(foto, salon.id);
    if (r.error) return { error: r.error };
    imagePath = r.path;
  }

  // RLS acota al dueño: un id ajeno actualiza cero filas.
  const { error } = await supabase
    .from("products")
    .update({
      price_cents: precio,
      stock: stockRaw === "" ? null : Math.max(0, Number(stockRaw)),
      ...(imagePath ? { image_path: imagePath } : {}),
    })
    .eq("id", String(formData.get("id")));
  if (error) return { error: "No se pudo guardar. Inténtalo de nuevo." };
  revalidatePath("/admin/productos");
}

export async function deleteProducto(formData: FormData) {
  const { productos } = await features();
  if (!productos) return;

  const { supabase } = await db();
  // Borrado lógico: puede tener reservas históricas (FK restrict) — la
  // misma lección que los servicios.
  await supabase
    .from("products")
    .update({ active: false })
    .eq("id", String(formData.get("id")));
  revalidatePath("/admin/productos");
}
