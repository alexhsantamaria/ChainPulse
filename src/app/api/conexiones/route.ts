// Ruta API — declara conexiones (dependencias) entre eslabones (RF2/RF3).
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { calcularCompletitud } from "@/infra/conexiones/completitud";

// RF3: los 4 datos de criticidad son opcionales al crear -- una conexion
// se puede declarar solo con origen/destino (y opcionalmente el grado de
// dependencia) y quedar "incompleta" hasta completarse despues (ver
// PATCH en [id]/route.ts). calcularCompletitud() decide si ya califica.
const conexionSchema = z
  .object({
    origenId: z.string().min(1),
    destinoId: z.string().min(1),
    gradoDependencia: z.enum(["BAJA", "MEDIA", "ALTA", "CRITICA"]).optional().nullable(),
    impactoPromesaCliente: z.enum(["BAJO", "MEDIO", "ALTO", "CRITICO"]).optional().nullable(),
    tieneAlternativa: z.boolean().optional().nullable(),
    tiempoTolerable: z.enum(["CORTO", "MEDIO", "LARGO"]).optional().nullable(),
    tiempoRecuperacion: z.enum(["CORTO", "MEDIO", "LARGO"]).optional().nullable(),
  })
  .refine((datos) => datos.origenId !== datos.destinoId, {
    message: "origenId y destinoId no pueden ser el mismo eslabon",
    path: ["destinoId"],
  });

export async function GET() {
  const session = await auth();
  if (!session?.user?.empresaId) {
    return NextResponse.json({ ok: false, error: "NO_SESION" }, { status: 401 });
  }

  const conexiones = await tenantClient(session.user.empresaId).conexion.findMany({
    orderBy: { createdAt: "asc" },
    include: { origen: true, destino: true },
  });

  return NextResponse.json({ ok: true, conexiones });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.empresaId) {
    return NextResponse.json({ ok: false, error: "NO_SESION" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = conexionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  const client = tenantClient(session.user.empresaId);
  const datos = parsed.data;

  // Confirma que ambos eslabones existen Y pertenecen a este tenant --
  // tenantClient ya inyecta el filtro de empresaId, asi que un id de otro
  // tenant simplemente no aparece (RNF1).
  const [origen, destino] = await Promise.all([
    client.eslabon.findUnique({ where: { id: datos.origenId } }),
    client.eslabon.findUnique({ where: { id: datos.destinoId } }),
  ]);
  if (!origen || !destino) {
    return NextResponse.json({ ok: false, error: "ESLABON_INEXISTENTE" }, { status: 400 });
  }

  const completa = calcularCompletitud(datos);

  try {
    const conexion = await client.conexion.create({
      data: {
        empresaId: session.user.empresaId,
        origenId: datos.origenId,
        destinoId: datos.destinoId,
        gradoDependencia: datos.gradoDependencia ?? undefined,
        impactoPromesaCliente: datos.impactoPromesaCliente ?? undefined,
        tieneAlternativa: datos.tieneAlternativa ?? undefined,
        tiempoTolerable: datos.tiempoTolerable ?? undefined,
        tiempoRecuperacion: datos.tiempoRecuperacion ?? undefined,
        completa,
        criticidadConfirmadaEn: completa ? new Date() : undefined,
      },
    });
    return NextResponse.json({ ok: true, conexion });
  } catch (err) {
    // Duck-typing en vez de instanceof: engineType="client" no reexporta
    // PrismaClientKnownRequestError (ver ADR-0003, addendum de RF1/MFA).
    const codigo = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
    if (codigo === "P2002") {
      return NextResponse.json({ ok: false, error: "CONEXION_YA_EXISTE" }, { status: 409 });
    }
    console.error(err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
