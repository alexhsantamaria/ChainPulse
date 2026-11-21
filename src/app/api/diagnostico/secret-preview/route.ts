import { NextResponse } from "next/server";
import { leerCuerpoJsonLimitado } from "@/infra/http/leerCuerpoJsonLimitado";
import {
  compararPruebaSecretPreview,
  entornoAutorizaDiagnosticoSecretPreview,
  esEntradaDiagnosticoSecretPreview,
} from "@/infra/queries/rendimiento/diagnosticoSecretPreview";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 512;

export async function POST(request: Request): Promise<NextResponse> {
  if (!entornoAutorizaDiagnosticoSecretPreview(process.env)) {
    return NextResponse.json({ ok: false, error: "NO_ENCONTRADO" }, { status: 404 });
  }
  const secretEfectivo = process.env.NEXTAUTH_SECRET;
  if (!secretEfectivo) {
    return NextResponse.json({ ok: false, error: "CONFIGURACION_NO_DISPONIBLE" }, { status: 503 });
  }
  const cuerpo = await leerCuerpoJsonLimitado(request, MAX_BODY_BYTES);
  if (!cuerpo.ok || !esEntradaDiagnosticoSecretPreview(cuerpo.datos)) {
    return NextResponse.json({ ok: false, error: "SOLICITUD_INVALIDA" }, { status: 400 });
  }
  const coincide = compararPruebaSecretPreview(secretEfectivo, cuerpo.datos);
  return NextResponse.json(
    { ok: true, coincide },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
