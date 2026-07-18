"use client";

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="mt-10 rounded-lg bg-[#1b1712] text-white px-8 py-3 font-medium print:hidden
        cursor-pointer hover:opacity-90 transition-opacity"
    >
      Imprimir cartel
    </button>
  );
}
