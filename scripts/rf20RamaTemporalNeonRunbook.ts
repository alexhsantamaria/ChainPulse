// RF19/RF20 -- migraciones y pruebas de concurrencia EXCLUSIVAMENTE en una
// rama temporal de Neon. Este archivo se ejecuta manualmente desde el clon
// Windows. Nunca imprime URLs ni credenciales y se bloquea antes de escribir
// si destino, roles, aislamiento o autorizaciones no coinciden exactamente.
import { Pool } from "pg";
import { generarCuid } from "../src/infra/ids/cuid";
import {
  ROL_ADMIN_ESPERADO,
  ROL_APP_ESPERADO,
  destinoConfirmado,
  evaluarEstadoMigraciones,
  exigirEntornoConfirmado,
  resumenUrl,
  verificarDestinoEfectivo,
  verificarRolConexion,
  verificarRolConexionAdministrativa,
  type ClienteSoloLecturaRol,
  type FilaMigracion,
} from "../src/infra/pruebaRevocacion/destinoPrueba";
import { construirClientePrueba, desconectarClientePrueba } from "../src/infra/pruebaRevocacion/clientePrueba";
import { directorioProyecto, migracionesEnRepo, rutaEsquemaPrisma } from "../src/infra/pruebaRevocacion/archivoProyecto";
import { ejecutarMigrateDeploy } from "../src/infra/pruebaRevocacion/subproceso";

const MIGRACIONES_AUTORIZADAS = new Set([
  "20261030090000_rf19_rf20_revoke_create_public",
  "20261030100000_rf19_enum_bucket_limite_tasa_login_y_mfa",
  "20261030101000_rf19_columnas_usuario_plataforma",
  "20261030102000_rf19_indice_email_normalizado",
  "20261030103000_rf19_funciones_controladas",
  "20261030110000_rf19_leer_mfa_plataforma",
  "20261030120000_rf20_bitacora_version_cuestionario",
  "20261030121000_rf20_funciones_controladas",
]);

type PreguntaFuente = {
  codigo: string; orden: number; texto: string; dimension: string;
  opciones: unknown; esNoPuntuable: boolean;
};

function exigirAislamiento(host: string): void {
  const temporal = process.env.NEON_RAMA_TEMPORAL_HOST_CONFIRMADO;
  const produccion = process.env.NEON_PRODUCCION_HOST_BLOQUEADO;
  if (!temporal || temporal !== host) throw new Error("HOST_TEMPORAL_NO_CONFIRMADO");
  if (!produccion) throw new Error("HOST_PRODUCCION_NO_DECLARADO");
  if (host === produccion) throw new Error("DESTINO_ES_PRODUCCION");
  if (process.env.AUTORIZO_RF20_RAMA_TEMPORAL !== "si") throw new Error("AUTORIZACION_RF20_FALTANTE");
}

async function crearVersion(pool: Pool, codigo: string, actorId: string): Promise<string> {
  const id = generarCuid();
  const r = await pool.query("SELECT numero FROM public.crear_cuestionario_version($1,$2,$3)", [id, codigo, actorId]);
  if (r.rowCount !== 1) throw new Error("CREAR_VERSION_SIN_RESULTADO");
  return id;
}

async function copiarPreguntas(pool: Pool, versionId: string, preguntas: PreguntaFuente[]): Promise<void> {
  for (const p of preguntas) {
    const r = await pool.query(
      "SELECT ok, motivo FROM public.crear_pregunta_version($1,$2,$3,$4,$5,$6,$7::jsonb,$8)",
      [generarCuid(), versionId, p.codigo, p.orden, p.texto, p.dimension, JSON.stringify(p.opciones), p.esNoPuntuable],
    );
    if (r.rows[0]?.ok !== true) throw new Error(`COPIA_PREGUNTA_RECHAZADA:${String(r.rows[0]?.motivo ?? "SIN_RESULTADO")}`);
  }
}

async function carreraPublicacion(pool: Pool, admin: Pool, actorId: string, preguntas: PreguntaFuente[], ronda: number, ids: string[]): Promise<void> {
  const codigo = `rf20-concurrencia-publicacion-${Date.now()}-${ronda}`;
  const a = await crearVersion(pool, codigo, actorId);
  const b = await crearVersion(pool, codigo, actorId);
  ids.push(a, b);
  await copiarPreguntas(pool, a, preguntas);
  await copiarPreguntas(pool, b, preguntas);
  const publicar = (id: string) => pool.query(
    "SELECT publicada, motivo FROM public.publicar_cuestionario_version($1,$2,NULL,$3,$4)",
    [id, actorId, generarCuid(), generarCuid()],
  );
  const resultados = await Promise.allSettled([publicar(a), publicar(b)]);
  const exitos = resultados.filter((x) => x.status === "fulfilled" && x.value.rows[0]?.publicada === true).length;
  const perdedoresValidos = resultados.filter((x) => {
    if (x.status === "fulfilled") return x.value.rows[0]?.motivo === "VERSION_VIGENTE_CAMBIO";
    const e = x.reason as { code?: string; constraint?: string };
    return e?.code === "23505" && e?.constraint === "uq_cuestionario_version_publicada";
  }).length;
  const estado = await admin.query(
    "SELECT count(*)::int AS total FROM public.cuestionario_versiones WHERE codigo=$1 AND estado='PUBLICADA'",
    [codigo],
  );
  if (exitos !== 1 || perdedoresValidos !== 1 || estado.rows[0]?.total !== 1) {
    throw new Error(`CARRERA_PUBLICACION_${ronda}_INVALIDA`);
  }
}

async function carreraReordenamiento(pool: Pool, admin: Pool, actorId: string, preguntas: PreguntaFuente[], ronda: number, ids: string[]): Promise<void> {
  const versionId = await crearVersion(pool, `rf20-concurrencia-reorden-${Date.now()}-${ronda}`, actorId);
  ids.push(versionId);
  await copiarPreguntas(pool, versionId, preguntas);
  const filas = await admin.query<{ id: string }>(
    "SELECT id FROM public.pregunta_versiones WHERE \"cuestionarioVersionId\"=$1 ORDER BY orden",
    [versionId],
  );
  const ordenA = filas.rows.map((p, i) => ({ id: p.id, orden: i + 1 }));
  const ordenB = [...filas.rows].reverse().map((p, i) => ({ id: p.id, orden: i + 1 }));
  const reordenar = (payload: unknown) => pool.query(
    "SELECT reordenado, motivo FROM public.reordenar_preguntas_version($1,$2::jsonb)",
    [versionId, JSON.stringify(payload)],
  );
  const resultados = await Promise.all([reordenar(ordenA), reordenar(ordenB)]);
  if (resultados.some((r) => r.rows[0]?.reordenado !== true)) throw new Error(`CARRERA_REORDEN_${ronda}_RECHAZADA`);
  const final = await admin.query<{ id: string; orden: number }>(
    "SELECT id, orden FROM public.pregunta_versiones WHERE \"cuestionarioVersionId\"=$1 ORDER BY orden",
    [versionId],
  );
  const firma = (x: Array<{ id: string; orden: number }>) => x.map((p) => `${p.id}:${p.orden}`).join("|");
  if (![firma(ordenA), firma(ordenB)].includes(firma(final.rows))) throw new Error(`CARRERA_REORDEN_${ronda}_MEZCLO_ESTADOS`);
}

async function main(): Promise<void> {
  const appUrl = process.env.DATABASE_URL;
  const adminUrl = process.env.SEED_DATABASE_URL;
  const destinoApp = resumenUrl("DATABASE_URL", appUrl);
  const destinoAdmin = resumenUrl("SEED_DATABASE_URL", adminUrl);
  if (destinoConfirmado(destinoApp) !== destinoConfirmado(destinoAdmin)) throw new Error("DESTINOS_APP_ADMIN_DISTINTOS");
  exigirEntornoConfirmado(destinoApp);
  exigirAislamiento(destinoApp.host);

  const prismaApp = construirClientePrueba(appUrl as string, "rf20-temporal:app");
  const prismaAdmin = construirClientePrueba(adminUrl as string, "rf20-temporal:admin");
  const poolApp = new Pool({ connectionString: appUrl, max: 4 });
  const poolAdmin = new Pool({ connectionString: adminUrl, max: 2 });
  const actorId = generarCuid();
  const versiones: string[] = [];
  try {
    const rolApp = await verificarRolConexion(prismaApp as ClienteSoloLecturaRol, "rf20-temporal:app", ROL_APP_ESPERADO);
    verificarDestinoEfectivo(rolApp, destinoApp, "rf20-temporal:app");
    const rolAdmin = await verificarRolConexionAdministrativa(prismaAdmin as ClienteSoloLecturaRol, "rf20-temporal:admin", ROL_ADMIN_ESPERADO);
    verificarDestinoEfectivo(rolAdmin, destinoAdmin, "rf20-temporal:admin");

    const filas = await prismaAdmin.$queryRaw<FilaMigracion[]>`SELECT migration_name, started_at, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at`;
    const estado = evaluarEstadoMigraciones(filas, migracionesEnRepo("rf20-temporal:migraciones"));
    if (estado.fallidasOInconclusas.length) throw new Error("MIGRACIONES_FALLIDAS_O_INCONCLUSAS");
    const ajenas = estado.pendientes.filter((m) => !MIGRACIONES_AUTORIZADAS.has(m));
    if (ajenas.length) throw new Error("MIGRACIONES_PENDIENTES_AJENAS_A_RF19_RF20");

    if (estado.pendientes.length) {
      const anterior = process.env.DATABASE_URL;
      try {
        process.env.DATABASE_URL = adminUrl;
        ejecutarMigrateDeploy({ directorioProyecto: directorioProyecto(), rutaEsquema: rutaEsquemaPrisma() }, "rf20-temporal:migrate");
      } finally {
        process.env.DATABASE_URL = anterior;
      }
    }

    const post = await prismaAdmin.$queryRaw<FilaMigracion[]>`SELECT migration_name, started_at, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at`;
    const estadoPost = evaluarEstadoMigraciones(post, migracionesEnRepo("rf20-temporal:migraciones-post"));
    if (estadoPost.pendientes.length || estadoPost.fallidasOInconclusas.length) throw new Error("POSTCONDICION_MIGRACIONES_INVALIDA");

    await poolAdmin.query(
      "INSERT INTO public.usuarios_plataforma (id,email,\"passwordHash\",rol,activo,\"sessionVersion\",\"mfaHabilitado\",\"intentosFallidos\",\"createdAt\") VALUES ($1,$2,'NO_USAR','CURADOR_METODOLOGICO',true,1,false,0,now())",
      [actorId, `rf20-${actorId}@invalid.example`],
    );
    const fuente = await poolAdmin.query<PreguntaFuente>(
      "SELECT p.codigo,p.orden,p.texto,p.dimension::text AS dimension,p.opciones,p.\"esNoPuntuable\" FROM public.pregunta_versiones p JOIN public.cuestionario_versiones v ON v.id=p.\"cuestionarioVersionId\" WHERE v.estado='PUBLICADA' ORDER BY v.\"publicadaEn\" DESC NULLS LAST,p.orden LIMIT 8",
    );
    if (fuente.rows.length !== 8) throw new Error("CUESTIONARIO_FUENTE_INCOMPLETO");
    for (let ronda = 1; ronda <= 2; ronda++) await carreraPublicacion(poolApp, poolAdmin, actorId, fuente.rows, ronda, versiones);
    for (let ronda = 1; ronda <= 2; ronda++) await carreraReordenamiento(poolApp, poolAdmin, actorId, fuente.rows, ronda, versiones);
    console.log("RF20_RAMA_TEMPORAL_RESULTADO=TODO_OK");
  } finally {
    if (versiones.length) {
      await poolAdmin.query("DELETE FROM public.bitacora_version_cuestionario WHERE \"cuestionarioVersionId\" = ANY($1::text[])", [versiones]);
      await poolAdmin.query("DELETE FROM public.pregunta_versiones WHERE \"cuestionarioVersionId\" = ANY($1::text[])", [versiones]);
      await poolAdmin.query("DELETE FROM public.cuestionario_versiones WHERE id = ANY($1::text[])", [versiones]);
    }
    await poolAdmin.query("DELETE FROM public.usuarios_plataforma WHERE id=$1", [actorId]).catch(() => undefined);
    await poolApp.end(); await poolAdmin.end();
    await desconectarClientePrueba(prismaApp, "rf20-temporal:app-fin");
    await desconectarClientePrueba(prismaAdmin, "rf20-temporal:admin-fin");
  }
}

main().catch((error: unknown) => {
  console.error(`RF20_RAMA_TEMPORAL_ABORTADA=${error instanceof Error ? error.message : "ERROR_DESCONOCIDO"}`);
  process.exitCode = 1;
});
