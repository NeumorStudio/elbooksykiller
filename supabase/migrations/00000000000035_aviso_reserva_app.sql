-- Aviso al dueño de las reservas que entran por la app móvil.
--
-- La web pública avisa desde la server action `bookAppointment`. La app móvil
-- reserva llamando a `create_booking_v2` directamente con la clave anónima, así
-- que nadie dispara `notifyBookingConfirmed`. El endpoint `/api/reserva/avisar`
-- lo hace por ella, y esta función es su cerrojo: reclama el aviso una sola vez.
--
-- Por qué una marca y no confiar solo en Resend: la clave de idempotencia de
-- Resend cubre el correo y caduca a las 24 h, pero el push no tiene nada
-- parecido. Sin marca, repetir la llamada repetiría el aviso al móvil del dueño.
--
-- El reclamo es atómico (un único UPDATE ... WHERE notified_at IS NULL): dos
-- llamadas a la vez no pueden ganar las dos.
--
-- Solo la ejecuta `service_role` (el endpoint, tras validar la entrada). No se
-- da a `anon`: el token de una cita es de quien reservó, y no queremos que
-- cualquiera pueda gastar la cuota de correo del salón desde fuera del endpoint.

alter table bookings add column if not exists notified_at timestamptz;

comment on column bookings.notified_at is
  'Cuándo se reclamó el aviso al dueño desde /api/reserva/avisar (reservas de la app). '
  'NULL en las demás: la web y los pagos avisan por su propio camino.';

create or replace function reclamar_aviso_reserva(p_token uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  update bookings
     set notified_at = now()
   where public_token = p_token
     and notified_at is null
     and status = 'confirmed'
     -- Ventana corta: es un aviso de «acaba de reservar», no un reenvío. Un
     -- token viejo no sirve para volver a avisar de una cita de la semana pasada.
     and created_at > now() - interval '10 minutes'
  returning id into v_id;
  return v_id; -- NULL: token desconocido, ya avisado, pagando o fuera de ventana
end $$;

revoke all on function reclamar_aviso_reserva(uuid) from public, anon, authenticated;
grant execute on function reclamar_aviso_reserva(uuid) to service_role;
