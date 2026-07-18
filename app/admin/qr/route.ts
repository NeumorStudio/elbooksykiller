import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { ownerBookingUrl } from "../booking-url";

// PNG grande del QR de reservas, listo para compartir o imprimir.
export async function GET() {
  const res = await ownerBookingUrl();
  if (!res) return new NextResponse(null, { status: 404 });

  const png = await QRCode.toBuffer(res.url, {
    type: "png",
    width: 1024,
    margin: 2,
    errorCorrectionLevel: "M",
  });

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="qr-${res.salon.slug}.png"`,
      "Cache-Control": "no-store",
    },
  });
}
