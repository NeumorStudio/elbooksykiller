"use server";

import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Canjea el enlace del correo y guarda la contraseña del trabajador.
 *
 * El canje va aquí, al ENVIAR el formulario, y no al abrir la página: los
 * antivirus de correo visitan los enlaces para inspeccionarlos, y si el
 * token se gastara en la carga, al trabajador le llegaría ya usado.
 */
export async function activarAcceso(formData: FormData) {
  const token = String(formData.get("t") ?? "");
  const pass = String(formData.get("password") ?? "");
  const pass2 = String(formData.get("password2") ?? "");
  if (!token) return { error: "Falta el enlace. Ábrelo otra vez desde el correo." };
  if (pass.length < 8) return { error: "La contraseña tiene que tener al menos 8 caracteres." };
  if (pass !== pass2) return { error: "Las dos contraseñas no coinciden." };

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ token_hash: token, type: "recovery" });
  if (error) {
    return {
      error:
        "Este enlace ya no vale: caduca a la hora y solo sirve una vez. Pide en el salón que te lo reenvíen.",
    };
  }
  const { error: errPass } = await supabase.auth.updateUser({ password: pass });
  if (errPass) {
    console.error("activarAcceso/updateUser:", errPass.message);
    return {
      error: /weak|short|characters/i.test(errPass.message)
        ? "Esa contraseña es demasiado débil. Prueba con una más larga."
        : "No se pudo guardar la contraseña. Inténtalo de nuevo.",
    };
  }
  redirect("/admin");
}
