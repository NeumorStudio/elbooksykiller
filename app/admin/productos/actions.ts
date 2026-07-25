"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { features } from "@/lib/features";
import { sesionAdmin } from "@/lib/sesion-admin";

// Comprueba sesión y que el salón no esté bloqueado por el superadmin.
const db = sesionAdmin;

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

  const { error } = await supabase.from("products").insert({
    salon_id: salon.id,
    name: nombre,
    description: String(formData.get("description") ?? "").trim() || null,
    price_cents: precio,
    // Vacío = no se controla stock. No se descuenta al reservar: una
    // reserva no es una venta.
    stock: stockRaw === "" ? null : Math.max(0, Number(stockRaw)),
  });
  if (error) return { error: "No se pudo añadir. Revisa los datos." };
  revalidatePath("/admin/productos");
}

export async function updateProducto(formData: FormData) {
  const { productos } = await features();
  if (!productos) return { error: "Todavía no está activada." };

  const { supabase } = await db();
  const precio = Math.round(Number(formData.get("price") ?? 0) * 100);
  const stockRaw = String(formData.get("stock") ?? "").trim();
  if (!Number.isFinite(precio) || precio < 0) return { error: "Revisa el precio." };

  // RLS acota al dueño: un id ajeno actualiza cero filas.
  const { error } = await supabase
    .from("products")
    .update({
      price_cents: precio,
      stock: stockRaw === "" ? null : Math.max(0, Number(stockRaw)),
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
