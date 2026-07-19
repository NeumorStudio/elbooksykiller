import QRCode from "qrcode";
import { ownerBookingUrl } from "../booking-url";
import PrintButton from "./print-button";

// Cartel imprimible para el mostrador: escanea → reserva → instala.
export default async function PosterPage() {
  const res = await ownerBookingUrl();
  if (!res) return <p className="text-muted p-8">Primero crea tu peluquería en la Agenda.</p>;

  // Igual que el PNG descargable: el cartel vive en el local, así que su
  // QR salta el escaparate y va directo a reservar.
  const svg = await QRCode.toString(res.urlLocal, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#1b1712", light: "#ffffff" },
  });

  return (
    <main className="min-h-screen bg-white text-[#1b1712] flex flex-col items-center px-8 py-12 print:py-6">
      <div className="w-full max-w-md flex flex-col items-center text-center gap-6">
        {res.salon.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={res.salon.logo_url}
            alt=""
            className="h-24 w-24 object-contain"
          />
        )}
        <h1 className="font-display text-5xl font-semibold" style={{ letterSpacing: "-0.02em" }}>
          {res.salon.name}
        </h1>
        <p className="text-2xl font-medium">Reserva tu cita aquí</p>
        <div
          className="w-72 h-72 [&_svg]:w-full [&_svg]:h-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <p className="text-lg">
          Escanea con la cámara del móvil
          <br />
          <span className="text-[#8d857a] text-base break-all">{res.url.replace(/^https?:\/\//, "")}</span>
        </p>
      </div>
      <PrintButton />
    </main>
  );
}
