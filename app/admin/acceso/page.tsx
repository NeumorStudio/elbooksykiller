import ActionForm from "../action-form";
import SubmitButton from "../submit-button";
import { activarAcceso } from "./actions";

/**
 * Donde aterriza un trabajador desde el correo de acceso: elige su
 * contraseña y entra a su agenda. Es pública (el proxy la deja pasar sin
 * sesión) porque quien llega todavía no tiene cuenta con la que entrar.
 *
 * Abrirla no gasta nada: el token solo se canjea al enviar.
 */
export default async function AccesoPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/marca/salonio.svg"
          alt=""
          width={48}
          height={95}
          className="mx-auto h-14 w-auto"
        />
        <h1 className="font-display text-3xl font-semibold text-center text-brand mt-3">
          Tu agenda
        </h1>
        <p className="text-center text-muted mt-2 mb-8 text-pretty">
          Elige tu contraseña. Con ella y tu correo entrarás desde el móvil.
        </p>
        {t ? (
          <ActionForm action={activarAcceso} className="panel p-6 flex flex-col gap-4">
            <input type="hidden" name="t" value={t} />
            <div>
              <label htmlFor="password" className="label">Contraseña nueva</label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className="field"
              />
            </div>
            <div>
              <label htmlFor="password2" className="label">Repítela</label>
              <input
                id="password2"
                name="password2"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className="field"
              />
            </div>
            <SubmitButton className="btn-primary" pendingText="Un momento…">
              Guardar y entrar
            </SubmitButton>
          </ActionForm>
        ) : (
          <div className="panel p-6 text-pretty">
            Este enlace está incompleto. Ábrelo otra vez desde el correo, o pide
            en el salón que te lo reenvíen.
          </div>
        )}
        <p className="text-center text-sm text-muted mt-4 text-pretty">
          ¿Ya tienes contraseña?{" "}
          <a href="/admin/login" className="underline underline-offset-4 hover:text-ink">
            Entra aquí
          </a>
          .
        </p>
      </div>
    </main>
  );
}
