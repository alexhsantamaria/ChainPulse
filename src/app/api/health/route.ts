// Ruta API — healthcheck del servicio, confirma que el despliegue esta vivo.
import { NextResponse } from "next/server";

// Endpoint minimo de salud del servicio (no confundir con la "salud" de
// RF6, que es del dominio de negocio). Util para verificar el despliegue
// antes de que exista cualquier otra ruta.
export function GET() {
  return NextResponse.json({ ok: true, servicio: "chainpulse" });
}
