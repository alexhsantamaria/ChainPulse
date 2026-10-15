// Pagina -- Incremento 5 (I5-26): interfaz de las 6 preguntas del
// catalogo cerrado de consultas deterministicas. Server Component:
// resuelve las cadenas de la empresa (para el select) y el catalogo ya
// filtrado por rol (misma funcion pura que usa GET /api/consultas/catalogo,
// llamada directo aca para evitar un round-trip de red redundante dentro
// del propio servidor) -- la UNICA llamada de red real de esta pantalla
// es POST /api/consultas/ejecutar, hecha por el componente cliente.
//
// requireSessionOrRedirect() (cualquier rol): una consulta es de solo
// lectura (ver catalogo.ts), sin la restriccion de piloto-solo-admin que
// tienen las paginas de declaracion de OTIF/Fill Rate/Cobertura.
import Link from "next/link";
import { requireSessionOrRedirect } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { listarCatalogoConsultas } from "@/infra/queries/catalogo";
import ConsultasPanel from "./ConsultasPanel";

export default async function ConsultasPage() {
  const sesion = await requireSessionOrRedirect();

  const cliente = tenantClient(sesion.empresaId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de tenantClient.ts
  const cadenas = await (cliente as any).cadena.findMany({ orderBy: { nombre: "asc" }, select: { id: true, nombre: true } });

  const catalogo = listarCatalogoConsultas().filter((metadatos) => metadatos.permisos.includes(sesion.rol));

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-12">
      <div>
        <Link href="/dashboard" className="text-sm text-slate-500 underline">
          ← Volver al panel
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Consultas</h1>
        <p className="text-sm text-slate-600">
          Elegí una de las 6 preguntas del catálogo -- cada una se responde con un cálculo determinista sobre tus datos
          ya cargados, nunca con texto libre ni un modelo de lenguaje.
        </p>
      </div>

      {cadenas.length === 0 ? (
        <p className="text-sm text-slate-500">
          Todavía no declaraste ninguna cadena.{" "}
          <Link href="/dashboard/cadenas" className="underline">
            Declará una cadena primero
          </Link>
          .
        </p>
      ) : (
        <ConsultasPanel cadenas={cadenas} catalogo={catalogo} />
      )}
    </main>
  );
}
