// Pagina — mapa visual de una Cadena (RF34, requirements.md Seccion
// 14.3). Server Component: resuelve nodos/conexiones/flujos ya filtrados
// por tenant (RNF1/RNF13) y se los pasa como props iniciales al canvas
// cliente, que a partir de ahi administra su propio estado -- crear un
// nodo o una conexion pasa por las rutas propias del canvas
// (/api/cadenas/:id/nodos, /api/cadenas/:id/conexiones), nunca por esta
// pagina (mismo patron de "Server Component solo resuelve datos
// iniciales" que ciclos/[id]/responder le pasa "asignaciones" al form).
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { tenantClient } from "@/infra/prisma/tenantClient";
import MapaCadenaCanvas from "./MapaCadenaCanvas";

// RF38 -- las 6 dimensiones de comparacion multi-rol, en el mismo orden
// que DimensionComparacionCadena en schema.prisma.
const ETIQUETA_DIMENSION: Record<string, string> = {
  PRIORIDAD_ELEGIDA: "Prioridad elegida",
  CONOCIMIENTO_ENTRADAS_SALIDAS: "Conocimiento de entradas/salidas",
  MOMENTO_INFORMACION: "Momento en que llega la información",
  FUENTE_DATOS: "Fuente de datos",
  NODO_CRITICO: "Nodo crítico",
  ALTERNATIVA_DISPONIBLE: "Alternativa disponible",
};

export default async function CadenaMapaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.empresaId) {
    redirect("/login");
  }

  const { id } = await params;
  const client = tenantClient(session.user.empresaId);

  const cadena = await client.cadena.findUnique({
    where: { id },
    include: {
      nodos: { orderBy: { createdAt: "asc" } },
      conexiones: { include: { flujos: true }, orderBy: { createdAt: "asc" } },
    },
  });

  if (!cadena) {
    notFound();
  }

  // Bloque C Paso 3 (RF38/RF39) -- consulta separada de la de arriba a
  // proposito: mezclar esto en el mismo cadena.findUnique() (una 3ra rama
  // de include, hallazgos -> conexionCadena -> {origenNodo, destinoNodo})
  // disparaba en Windows (adapter-pg, ADR-0003) el warning de pg
  // "Calling client.query() when the client is already executing a
  // query" -- tenantClient() envuelve cada operacion en su propio
  // $transaction(), asi que dos llamadas separadas a traves de `client`
  // usan cada una su propia transaccion/conexion en vej de compartir una
  // sola conexion pineada para un include anidado mas profundo. Solo
  // existen filas en DIFERENCIA (ver el comentario de HallazgoCadena en
  // schema.prisma), asi que no hace falta filtrar por "resultado" aca:
  // todo lo que hay para mostrar es, por diseno, una diferencia de
  // percepcion real.
  const hallazgos = await client.hallazgoCadena.findMany({
    where: { cadenaId: cadena.id },
    include: {
      conexionCadena: { include: { origenNodo: true, destinoNodo: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-12">
      <div>
        <Link
          href="/dashboard/cadenas"
          className="text-sm text-slate-500 underline"
        >
          ← Volver a cadenas
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{cadena.nombre}</h1>
        <p className="text-sm text-slate-600">
          {cadena.productoServicio} — {cadena.tipoOperacion}
        </p>
      </div>

      {hallazgos.length > 0 && (
        <div className="flex flex-col gap-2 rounded border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">
            Diferencias de percepción detectadas ({hallazgos.length})
          </p>
          <p className="text-xs text-amber-700">
            Distintas personas invitadas respondieron distinto sobre lo mismo —
            no indica quién tiene razón, solo que vale la pena conversarlo.
          </p>
          <ul className="flex flex-col gap-1.5 text-sm text-amber-900">
            {hallazgos.map(
              (hallazgo: {
                id: string;
                dimension: string;
                conexionCadena: {
                  origenNodo: { nombre: string };
                  destinoNodo: { nombre: string };
                } | null;
              }) => (
                <li key={hallazgo.id} className="rounded bg-white px-3 py-2">
                  <span className="font-medium">
                    {ETIQUETA_DIMENSION[hallazgo.dimension]}
                  </span>
                  {" — "}
                  {hallazgo.conexionCadena
                    ? `conexión de "${hallazgo.conexionCadena.origenNodo.nombre}" a "${hallazgo.conexionCadena.destinoNodo.nombre}"`
                    : "toda la cadena"}
                </li>
              ),
            )}
          </ul>
        </div>
      )}

      <MapaCadenaCanvas
        cadenaId={cadena.id}
        nodosIniciales={cadena.nodos}
        conexionesIniciales={cadena.conexiones}
      />
    </main>
  );
}
