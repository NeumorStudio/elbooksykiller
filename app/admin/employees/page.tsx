import { supabaseServer } from "@/lib/supabase/server";
import { addEmployee, deactivateEmployee, addHours, deleteHours } from "../actions";

type WH = { id: string; weekday: number; start_min: number; end_min: number };

const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const fmtMin = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export default async function EmployeesPage() {
  const supabase = await supabaseServer();
  const { data: salon } = await supabase
    .from("salons")
    .select("id, employees(*, working_hours(*))")
    .limit(1)
    .maybeSingle();

  if (!salon) return <p>Primero crea tu peluquería en la Agenda.</p>;

  const employees = salon.employees.filter((e) => e.active);

  return (
    <main className="flex flex-col gap-8">
      <h1 className="text-xl font-bold">Equipo y horarios</h1>

      {employees.map((emp) => (
        <section key={emp.id} className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{emp.name}</h2>
            <form action={deactivateEmployee}>
              <input type="hidden" name="id" value={emp.id} />
              <button className="text-sm text-red-600">Dar de baja</button>
            </form>
          </div>

          <ul className="flex flex-col gap-1 text-sm">
            {(emp.working_hours as WH[])
              .sort((a, b) => a.weekday - b.weekday || a.start_min - b.start_min)
              .map((h) => (
                <li key={h.id} className="flex items-center gap-2">
                  <span className="w-24">{DAYS[h.weekday]}</span>
                  <span>{fmtMin(h.start_min)}–{fmtMin(h.end_min)}</span>
                  <form action={deleteHours}>
                    <input type="hidden" name="id" value={h.id} />
                    <button className="text-red-600">×</button>
                  </form>
                </li>
              ))}
            {!emp.working_hours.length && (
              <p className="text-gray-500">Sin horario: no aparecerá en la web de reservas.</p>
            )}
          </ul>

          <form action={addHours} className="flex flex-wrap gap-2 items-center text-sm">
            <input type="hidden" name="employee_id" value={emp.id} />
            <select name="weekday" className="rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent p-2">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <option key={d} value={d}>{DAYS[d]}</option>
              ))}
            </select>
            <input name="start" type="time" required defaultValue="10:00" className="rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent p-2" />
            <span>a</span>
            <input name="end" type="time" required defaultValue="20:00" className="rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent p-2" />
            <button className="rounded-lg bg-black text-white dark:bg-white dark:text-black px-3 py-2">
              Añadir tramo
            </button>
          </form>
        </section>
      ))}

      <form action={addEmployee} className="flex gap-2">
        <input type="hidden" name="salon_id" value={salon.id} />
        <input name="name" required placeholder="Nombre del profesional" className="rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent p-2 flex-1" />
        <button className="rounded-lg bg-black text-white dark:bg-white dark:text-black px-4 py-2">
          Añadir
        </button>
      </form>
    </main>
  );
}
