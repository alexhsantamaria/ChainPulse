// Pagina publica — quien recibe una invitacion de RF36 responde sobre una
// Cadena completa o una ConexionCadena puntual, sin crear cuenta (decision
// explicita de Alex, 2026-09-24, ver PLAN-DE-TRABAJO.md "Bloque C"). No
// pasa por el middleware (mismo motivo que invitacion/aceptar/page.tsx:
// quien la abre no tiene sesion).
import { tenantClient } from "@/infra/prisma/tenantClient";
import { verificarTokenInvitacionCadena } from "@/infra/auth/invitacion";
import ResponderCadenaForm from "./ResponderCadenaForm";

function InvitacionInvalida({ detalle }: { detalle: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">Invitación inválida o vencida</h1>
      <p className="text-sm text-slate-600">{detalle}</p>
    </main>
  );
}

export default async function ResponderCadenaPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const payload = token ? await verificarTokenInvitacionCadena(token) : null;

  if (!payload) {
    return <InvitacionInvalida detalle="Pedile a quien te invitó que te mande un enlace nuevo." />;
  }

  // tenantClient() con el empresaId del propio token, ya verificado --
  // mismo criterio que invitacion/aceptar/page.tsx: el id no lo elige
  // quien visita la pagina, viene firmado.
  const client = tenantClient(payload.empresaId);
  const [cadena, empresa] = await Promise.all([
    client.cadena.findUnique({ where: { id: payload.cadenaId } }),
    client.empresa.findUnique({ where: { id: payload.empresaId } }),
  ]);

  if (!cadena || !empresa) {
    return <InvitacionInvalida detalle="La cadena o la empresa ya no existen." />;
  }

  // "cinturon y tirantes" -- mismo criterio de la ruta que emite el token
  // (api/cadenas/[id]/invitar): si el token trae conexionCadenaId,
  // confirmar que existe Y pertenece a esta cadena antes de mostrar nada.
  const conexionCadena = payload.conexionCadenaId
    ? await client.conexionCadena.findUnique({
        where: { id: payload.conexionCadenaId },
        include: { origenNodo: true, destinoNodo: true },
      })
    : null;

  if (payload.conexionCadenaId && (!conexionCadena || conexionCadena.cadenaId !== payload.cadenaId)) {
    return <InvitacionInvalida detalle="La conexión ya no existe." />;
  }

  // Alcance "cadena completa": hace falta la lista de nodos para elegir
  // el "nodo critico" (RF38). Alcance "conexion puntual": no hace falta,
  // RF37 ya limita las preguntas a esa conexion especifica.
  const nodos = conexionCadena
    ? []
    : await client.nodo.findMany({ where: { cadenaId: payload.cadenaId }, orderBy: { nombre: "asc" } });

  // Reabrir el mismo link actualiza en vez de duplicar (comentario de
  // RespuestaCadena en schema.prisma) -- se precarga lo ya respondido, si
  // ya habia una respuesta previa de este mismo email en este mismo
  // alcance.
  const respuestaExistente = await client.respuestaCadena.findFirst({
    where: payload.conexionCadenaId
      ? { conexionCadenaId: payload.conexionCadenaId, email: payload.email }
      : { cadenaId: payload.cadenaId, email: payload.email, conexionCadenaId: null },
  });

  const alcanceTexto = conexionCadena
    ? `la conexión de "${conexionCadena.origenNodo.nombre}" a "${conexionCadena.destinoNodo.nombre}"`
    : "toda la cadena";

  return (
    <ResponderCadenaForm
      token={token as string}
      empresaNombre={empresa.nombre}
      cadenaNombre={cadena.nombre}
      alcanceTexto={alcanceTexto}
      nodos={nodos.map((n: { id: string; nombre: string }) => ({ id: n.id, nombre: n.nombre }))}
      esCadenaCompleta={!conexionCadena}
      respuestaExistente={
        respuestaExistente
          ? {
              prioridadElegida: respuestaExistente.prioridadElegida,
              nodoCriticoId: respuestaExistente.nodoCriticoId,
              conocimientoEntradasSalidas: respuestaExistente.conocimientoEntradasSalidas,
              momentoInformacion: respuestaExistente.momentoInformacion,
              fuenteDatos: respuestaExistente.fuenteDatos,
              tieneAlternativa: respuestaExistente.tieneAlternativa,
              alternativaProbada: respuestaExistente.alternativaProbada,
            }
          : null
      }
    />
  );
}
