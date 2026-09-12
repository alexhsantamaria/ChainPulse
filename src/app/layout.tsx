import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChainPulse",
  description:
    "Detecta donde existe descoordinacion en tu cadena de suministro, identifica el eslabon mas debil y recomienda que mejorar primero.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-white text-slate-900 antialiased">{children}</body>
    </html>
  );
}
