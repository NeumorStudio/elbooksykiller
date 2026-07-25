import { supabaseServer } from "@/lib/supabase/server";
import { features } from "@/lib/features";
import { enviarNewsletter } from "./actions";
import ActionForm from "../action-form";
import SubmitButton from "../submit-button";
import Ayuda from "../ayuda";
import ModuloApagado from "../modulo-apagado";
import { estadoSalon, moduloActivo } from "@/lib/modulos";

/**
 * Newsletter del salón: promos, días flojos, novedades.
 *
 * El dueño escribe texto plano (se escapa al montar el HTML) y elige
 * segmento. El envío real lo hace el cron por tandas — aquí solo se encola.
 */
export default async function NewsletterPage() {
  const f = await features();
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: salon } = await supabase
    .from("salons")
    .select("id")
    .eq("owner_id", user!.id)
    .limit(1)
    .maybeSingle();

  if (!salon) return <p className="text-muted">Primero crea tu peluquería en la Agenda.</p>;
  if (!moduloActivo(await estadoSalon(salon.id), "newsletter"))
    return <ModuloApagado titulo="Newsletter" />;

  if (!f.newsletter) {
    return (
      <main className="max-w-2xl">
        <h1 className="font-display text-3xl font-semibold">Newsletter</h1>
        <p className="panel mt-6 p-6 text-muted text-pretty">
          Muy pronto. Podrás avisar a tus clientes de promos y días flojos por
          email, con un clic y por segmentos. Estamos terminando de encenderlo.
        </p>
      </main>
    );
  }

  const [{ count: audiencia }, { data: campanas }] = await Promise.all([
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("salon_id", salon.id)
      .eq("marketing_opt_in", true)
      .not("email", "is", null),
    supabase
      .from("newsletter_campaigns")
      .select("id, subject, segment, status, created_at, sent_at, recipients_count")
      .eq("salon_id", salon.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const estados: Record<string, string> = {
    draft: "Borrador",
    sending: "Enviando…",
    sent: "Enviada",
    failed: "Falló",
  };
  const segmentos: Record<string, string> = {
    todos: "Todos",
    racha: "En racha",
    enfriandose: "Enfriándose",
    nuevos: "Nuevos",
  };

  return (
    <main className="flex flex-col gap-8 max-w-2xl">
      <div>
        <span className="flex items-center gap-2.5">
          <h1 className="font-display text-3xl font-semibold">Newsletter</h1>
          <Ayuda titulo="Newsletter">
            <p>
              Un email a tus clientes: promos, huecos en días flojos,
              novedades. Solo lo reciben quienes marcaron la casilla de
              «quiero recibir novedades» al reservar — la lista crece sola.
            </p>
            <p>
              <b>Escribe como hablas.</b> Pon un asunto corto y el mensaje en
              texto normal, separando párrafos con una línea en blanco. El
              enlace para darse de baja se añade solo al final (es
              obligatorio por ley).
            </p>
            <p>
              <b>«Enviar a»</b> elige quién lo recibe. Para llenar un día
              flojo, el grupo «enfriándose» funciona mejor que enviar a
              todos: son clientes que venían a menudo y han dejado de venir —
              un empujoncito y vuelven.
            </p>
            <p>
              El envío no es inmediato: se hace por tandas en unos minutos.
              Abajo queda el historial con cuántos lo recibieron.
            </p>
          </Ayuda>
        </span>
        <p className="text-muted mt-1">
          {audiencia ?? 0}{" "}
          {(audiencia ?? 0) === 1 ? "cliente ha aceptado" : "clientes han aceptado"}{" "}
          recibir novedades. La lista crece sola con la casilla de la reserva.
        </p>
      </div>

      <ActionForm action={enviarNewsletter} className="panel p-6 flex flex-col gap-4">
        <div>
          <label htmlFor="nl-subject" className="label">Asunto</label>
          <input
            id="nl-subject"
            name="subject"
            required
            minLength={3}
            maxLength={120}
            placeholder="Esta semana: huecos el jueves por la tarde"
            className="field"
          />
        </div>
        <div>
          <label htmlFor="nl-body" className="label">Mensaje</label>
          <textarea
            id="nl-body"
            name="body"
            required
            minLength={20}
            rows={7}
            placeholder={
              "Escribe como hablas. Separa párrafos con una línea en blanco.\n\nEl enlace de baja se añade solo al final."
            }
            className="field h-auto py-3"
          />
        </div>
        <div>
          <label htmlFor="nl-segment" className="label">Enviar a</label>
          <select id="nl-segment" name="segment" className="field">
            <option value="todos">Todos los que aceptaron</option>
            <option value="enfriandose">
              Enfriándose — venían con ritmo y lo han perdido
            </option>
            <option value="racha">En racha — los habituales</option>
            <option value="nuevos">Nuevos — una o dos visitas</option>
          </select>
          <p className="text-xs text-muted mt-1.5 text-pretty">
            Para llenar un día flojo, «enfriándose» vale más que un envío a
            todos: son los que ya venían y han dejado de venir.
          </p>
        </div>
        <SubmitButton className="btn-primary" pendingText="Encolando…">
          Enviar
        </SubmitButton>
      </ActionForm>

      {(campanas?.length ?? 0) > 0 && (
        <section>
          <h2 className="font-semibold mb-3">Enviadas</h2>
          <ul className="tarjeta divide-y divide-line-subtle overflow-hidden">
            {campanas!.map((c) => (
              <li key={c.id} className="flex items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{c.subject}</p>
                  <p className="text-sm text-muted">
                    {new Date(c.sent_at ?? c.created_at).toLocaleDateString("es-ES", {
                      day: "numeric",
                      month: "long",
                    })}
                    {" · "}
                    {segmentos[c.segment] ?? c.segment}
                    {c.recipients_count != null && ` · ${c.recipients_count} destinatarios`}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-sm ${
                    c.status === "sent"
                      ? "text-ok"
                      : c.status === "failed"
                        ? "text-danger"
                        : "text-muted"
                  }`}
                >
                  {estados[c.status] ?? c.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
