import { NextResponse } from "next/server";

function origenesPermitidos(): URL[] {
  return (process.env.PLATAFORMA_ORIGENES_PERMITIDOS ?? "")
    .split(",")
    .map((valor) => valor.trim())
    .filter(Boolean)
    .flatMap((valor) => {
      try {
        return [new URL(valor)];
      } catch {
        return [];
      }
    });
}

export function validarSolicitudEscrituraPlataforma(request: Request): NextResponse | null {
  const tipo = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (tipo !== "application/json") {
    return NextResponse.json({ ok: false, error: "TIPO_CONTENIDO_INVALIDO" }, { status: 415 });
  }

  const permitidos = origenesPermitidos();
  if (permitidos.length === 0) {
    return NextResponse.json({ ok: false, error: "ORIGEN_NO_PERMITIDO" }, { status: 403 });
  }

  const origen = request.headers.get("origin");
  if (origen) {
    const coincide = permitidos.some((permitido) => permitido.origin === origen);
    return coincide
      ? null
      : NextResponse.json({ ok: false, error: "ORIGEN_NO_PERMITIDO" }, { status: 403 });
  }

  const host = request.headers.get("host")?.toLowerCase();
  const hostCoincide = host && permitidos.some((permitido) => permitido.host.toLowerCase() === host);
  return hostCoincide
    ? null
    : NextResponse.json({ ok: false, error: "ORIGEN_NO_PERMITIDO" }, { status: 403 });
}
