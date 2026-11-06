# Cobrar a los salones

Cada salón paga una cuota a NeumorStudio con Stripe. Esto no tiene nada que ver con **Cobros** del panel, que es lo que cada salón cobra a sus clientes con Stripe Connect.

| | Cuotas de los salones | Cobros de cada salón |
| --- | --- | --- |
| Cuenta de Stripe | La de NeumorStudio | La conectada de cada salón |
| Webhook | `/api/stripe/suscripciones` | `/api/stripe/webhook` |
| Secreto | `STRIPE_WEBHOOK_SECRET_SUSCRIPCIONES` | `STRIPE_WEBHOOK_SECRET` |
| Pantalla | Tu plan | Cobros |

## Puesta en marcha

Hazlo primero en modo prueba, en la base de dev. Luego repite con la clave real.

1. Aplica la migración `0036_suscripciones` en dev. Hasta entonces, Tu plan dice que no está disponible.
2. Crea los precios y el IVA:

   ```bash
   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-planes.mjs
   ```

   Te dará `STRIPE_IVA_ID`. Ponla en Vercel.
3. En Stripe, Developers, Webhooks, añade `https://<dominio>/api/stripe/suscripciones` con estos eventos:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`

   Pon su secreto en `STRIPE_WEBHOOK_SECRET_SUSCRIPCIONES`.
4. En Stripe, Settings, Billing, Customer portal: activa cancelar suscripción, cambiar de plan y cambiar método de pago. Añade los tres planes.
5. En Stripe, Settings, Payment methods: activa tarjeta y SEPA Direct Debit.
6. En Stripe, Settings, Billing: activa los reintentos de cobro y los correos de pago fallido.

## Probarlo

- Entra en **Tu plan** con un salón de dev y elige uno.
- Tarjeta de prueba: `4242 4242 4242 4242`. Tarjeta que falla al renovar: `4000 0000 0000 0341`.
- Comprueba que aparece el plan, cámbialo desde el portal y date de baja.

## Antes de cobrar de verdad

Estas tres cosas son del gestor, no del código:

- **Factura.** La factura legal sale del programa de facturación adaptado a Verifactu, no de Stripe. El documento que genera Stripe no sirve como factura, así que hay que conectar Stripe con ese programa antes del primer cobro.
- **Retención.** Stripe cobra base más IVA. Si a un cliente empresario hay que aplicarle retención de IRPF, ese importe no cuadra con lo que paga. Hay que confirmar si esta cuota lleva retención y cómo se gestiona.
- **Clientes de otros países de la UE.** Hoy todos llevan el 21 %. Si alguno tuviera NIF intracomunitario, no se le aplicaría automáticamente la exención.

## Precio fundador

No hay código para esto. Crea un cupón en Stripe, con su código promocional, y dáselo al cliente: el pago ya acepta códigos.

## Si un cliente deja de pagar

Stripe reintenta y avisa al cliente. El estado pasa a *Pago pendiente*, y llega un correo a `SUPERADMIN_EMAILS`. El panel del salón no se bloquea solo: bloquearlo es una decisión nuestra, desde `/admin/super`.
