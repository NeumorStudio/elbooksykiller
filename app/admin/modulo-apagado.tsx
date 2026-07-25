// Lo que ve el dueño si entra por URL directa a un módulo que el superadmin
// le ha apagado (el enlace del menú ya no aparece).
export default function ModuloApagado({ titulo }: { titulo: string }) {
  return (
    <main className="max-w-2xl mx-auto">
      <h1 className="font-display text-3xl font-semibold">{titulo}</h1>
      <p className="panel mt-6 p-6 text-muted text-pretty">
        Este módulo no está incluido en tu plan actual. Si quieres activarlo,
        escríbenos y te lo encendemos.
      </p>
    </main>
  );
}
