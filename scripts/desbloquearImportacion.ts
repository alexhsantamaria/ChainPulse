// Script de mantenimiento -- destraba UNA ImportacionCsv confirmada cuyo
// job de pg-boss nunca fue reclamado (bug real documentado en
// src/infra/kpis/cobertura/job.ts, ver el comentario de
// procesarImportacionesCsv(): el disparo inmediato compartia la cola con
// TODAS las importaciones, asi que boss.fetch() podia tomar el job de
// OTRA importacion mas vieja en vez del propio -- corregido en 7a49eef
// con procesarImportacionCsvPropia(), que reclama exclusivamente por
// singleton_key=importId).
//
// Caso real que motiva este script: ImportacionCsv
// 52aed226-1b0f-4550-bd30-fdd497ba0ed3 (job 27f5f447-2b9a-4794-ac66-
// 81e3b6e3f0cc) -- CONFIRMADA, procesadaEn=null, cero observaciones, job
// en pgboss.job state='created' sin reclamar (diagnosticado en modo solo
// lectura contra Neon el 2026-09-29, ver README.md "Estado").
//
// Condiciones explicitas de Alex (2026-09-29) que este script respeta:
//
//   1. MODO DIAGNOSTICO POR DEFECTO -- sin --ejecutar, solo lee y
//      verifica, nunca reclama ni modifica nada. Hace falta pasar
//      --ejecutar de forma explicita para el paso que reclama/procesa.
//
//   2. VERIFICACION CONJUNTA -- antes de reclamar, se lee el job puntual
//      de pgboss.job por su id y se cruza con: la cola (job.name debe
//      ser COLA_IMPORTACION_CSV), la importacion (job.singleton_key y
//      job.data.importId deben ser el importId dado) y la empresa
//      (job.data.empresaId, tomado del propio payload que la app
//      encolo -- nunca adivinado). Si algo no coincide, el script se
//      detiene sin tocar nada. Esta verificacion es DIAGNOSTICA -- la
//      proteccion real esta en el punto 4.
//
//   3. RESPETA RLS -- el empresaId para leer la ImportacionCsv sale del
//      payload del job (pgboss.job, un schema separado sin RLS, con
//      SELECT ya otorgado al rol de runtime por bootstrapPgBoss.ts), NO
//      de un rol que bypasee RLS. La importacion se lee siempre con
//      tenantClient(empresaId) (mismo mecanismo de produccion, RLS
//      activo) -- nunca con SEED_DATABASE_URL/neondb_owner ni con
//      set_config manual fuera de tenantClient.
//
//   4. RECLAMO ATOMICO POR jobId + cola + importId + empresa +
//      elegibilidad -- el reclamo real lo hace
//      reclamarJobImportacionCsvPorId() (src/infra/kpis/cobertura/job.ts),
//      cuyo UPDATE filtra en la MISMA sentencia por: id EXACTO del job,
//      name (cola), singleton_key (importId), data->>'importId'
//      (importId, chequeo independiente ADEMAS de singleton_key),
//      data->>'empresaId' (empresa) y las condiciones de elegibilidad de
//      pg-boss (state < 'active', start_after, NOT blocked) -- si
//      cualquiera de esas condiciones no coincide, el UPDATE afecta CERO
//      filas, nunca reclama "otro" job por error. La verificacion previa
//      (punto 2) y la relectura posterior (mas abajo) son diagnostico y
//      confirmacion para quien corre el script -- la proteccion real es
//      esta sentencia atomica, no esas lecturas antes/despues.
//
//   5. DOS SEÑALES SEPARADAS -- "job reclamado" (reclamarJobImportacionCsvPorId
//      devolvio procesado=true) es distinto de "procesamiento exitoso"
//      (la ImportacionCsv termino con estado=CONFIRMADA y procesadaEn
//      seteado) -- la funcion atrapa cualquier error de
//      procesarUnaImportacionCsv() y llama boss.fail() sin relanzar, asi
//      que un reclamo exitoso NO implica que el procesamiento haya
//      terminado bien. Este script imprime ambas por separado y relee
//      el estado final antes de concluir.
//
//   6. NUNCA procesa otros jobs ni ejecuta purgas -- no hay ningun
//      fetch()/drenado de cola en todo el script.
//
// Codigo de salida (Alex, 2026-09-29 -- "devolver codigo distinto de
// cero ante verificaciones o procesamiento fallidos"):
//   0 -- diagnostico OK sin --ejecutar; la importacion ya estaba
//        procesada (nada que hacer); o --ejecutar termino con
//        "procesamiento exitoso: SI".
//   1 -- cualquier verificacion fallida (job/cola/importId/empresa/
//        elegibilidad no coinciden, importacion no encontrada, estado
//        inesperado o ya en ERROR) o, con --ejecutar, el reclamo no
//        afecto ninguna fila o el procesamiento no termino con exito. Se
//        usa process.exitCode (nunca process.exit() dentro del try) para
//        que el `finally` (cerrarBoss()) siempre corra antes de salir.
//
// Uso:
//   npx tsx scripts/desbloquearImportacion.ts <importId> <jobId>              -- solo diagnostica
//   npx tsx scripts/desbloquearImportacion.ts <importId> <jobId> --ejecutar   -- reclama y procesa, si es elegible
//
// Ejemplo (el caso que motivo este script):
//   npx tsx scripts/desbloquearImportacion.ts 52aed226-1b0f-4550-bd30-fdd497ba0ed3 27f5f447-2b9a-4794-ac66-81e3b6e3f0cc
//   npx tsx scripts/desbloquearImportacion.ts 52aed226-1b0f-4550-bd30-fdd497ba0ed3 27f5f447-2b9a-4794-ac66-81e3b6e3f0cc --ejecutar
import "./_cargarEnv";
import { PgBoss } from "pg-boss";
import { obtenerBoss, cerrarBoss } from "../src/infra/jobs/pgBoss";
import { tenantClient } from "../src/infra/prisma/tenantClient";
import { COLA_IMPORTACION_CSV, reclamarJobImportacionCsvPorId, type PayloadImportacionCsv } from "../src/infra/kpis/cobertura/job";

// Duplicado a proposito, igual que en job.ts -- mantener sincronizado.
const PGBOSS_SCHEMA = "pgboss";

// Mismo criterio que el UPDATE de reclamarJobImportacionCsvPorId() y que
// fetchNextJob() de pg-boss: "state < 'active'" en el enum ordenado
// (created < retry < active < completed < cancelled < failed).
const ESTADOS_PGBOSS_ELEGIBLES = new Set(["created", "retry"]);

interface FilaJobPgBoss {
  id: string;
  name: string;
  singleton_key: string | null;
  state: string;
  data: unknown;
  start_after: string;
  blocked: boolean;
  created_on: string;
  started_on: string | null;
  retry_count: number;
}

interface FilaImportacionCsv {
  id: string;
  empresaId: string;
  estado: string;
  procesadaEn: Date | null;
  filasDetectadas: number;
  filasConError: number;
  erroresMuestra: unknown;
}

function parsearArgs(argv: string[]): { importId: string; jobId: string; ejecutar: boolean } {
  const ejecutar = argv.includes("--ejecutar");
  const posicionales = argv.filter((a) => a !== "--ejecutar");
  const [importId, jobId] = posicionales;
  if (!importId || !jobId) {
    console.error(
      "Uso: npx tsx scripts/desbloquearImportacion.ts <importId> <jobId> [--ejecutar]\n" +
        "  Sin --ejecutar: modo diagnostico -- solo lee y verifica, no reclama nada.\n" +
        "  Con --ejecutar: reclama (UPDATE atomico por jobId+cola+importId+empresa+elegibilidad) y procesa.",
    );
    process.exit(1);
  }
  return { importId, jobId, ejecutar };
}

async function leerJobPgBoss(boss: PgBoss, jobId: string): Promise<FilaJobPgBoss | null> {
  const db = boss.getDb();
  const resultado = await db.executeSql(
    `SELECT id, name, singleton_key, state, data, start_after, blocked, created_on, started_on, retry_count
     FROM ${PGBOSS_SCHEMA}.job
     WHERE id = $1`,
    [jobId],
  );
  return (resultado.rows[0] as FilaJobPgBoss | undefined) ?? null;
}

async function main() {
  const { importId, jobId, ejecutar } = parsearArgs(process.argv.slice(2));

  console.log(`Modo: ${ejecutar ? "EJECUCION (--ejecutar)" : "DIAGNOSTICO (solo lectura -- agregar --ejecutar para reclamar)"}`);
  console.log(`importId=${importId}`);
  console.log(`jobId=${jobId}`);
  console.log("");

  const boss = await obtenerBoss();
  try {
    // -- 1. Leer el job puntual de pgboss.job (sin RLS: schema propio de
    //    pg-boss, no de la app) -- SOLO para diagnostico, ver punto 4. --
    const job = await leerJobPgBoss(boss, jobId);
    console.log("Job en pgboss.job:", job);

    if (!job) {
      console.error(`No existe ningun job con id=${jobId} en pgboss.job. No se hace nada.`);
      process.exitCode = 1;
      return;
    }

    // -- 2. Verificacion conjunta (diagnostica): cola + importacion + empresa --
    const problemas: string[] = [];
    if (job.name !== COLA_IMPORTACION_CSV) {
      problemas.push(`cola: name="${job.name}" (esperado "${COLA_IMPORTACION_CSV}")`);
    }
    if (job.singleton_key !== importId) {
      problemas.push(`importacion: singleton_key="${job.singleton_key}" (esperado "${importId}")`);
    }
    const data = job.data as { importId?: string; empresaId?: string } | null;
    if (!data?.importId || data.importId !== importId) {
      problemas.push(`importacion: data.importId="${data?.importId}" (esperado "${importId}")`);
    }
    if (!data?.empresaId) {
      problemas.push("empresa: data.empresaId ausente en el payload del job");
    }
    if (job.blocked) {
      problemas.push("elegibilidad: el job esta blocked=true");
    }
    if (new Date(job.start_after).getTime() > Date.now()) {
      problemas.push(`elegibilidad: start_after="${job.start_after}" todavia no llego`);
    }
    if (!ESTADOS_PGBOSS_ELEGIBLES.has(job.state)) {
      problemas.push(`elegibilidad: state="${job.state}" (elegibles: ${[...ESTADOS_PGBOSS_ELEGIBLES].join(", ")})`);
    }

    if (problemas.length > 0) {
      console.error("Verificacion conjunta (diagnostica) fallida -- no se intenta reclamar:");
      for (const p of problemas) console.error(`  - ${p}`);
      process.exitCode = 1;
      return;
    }

    const empresaId = data!.empresaId!;
    console.log(`Verificacion diagnostica de job/cola/empresa OK. empresaId=${empresaId} (tomado del payload del job).`);
    console.log("");

    // -- 3. Leer la ImportacionCsv CON contexto de tenant (RLS activo,
    //    nunca desactivada) -- el empresaId viene del payload del job,
    //    puesto por la app al encolar, no de una suposicion nuestra --
    const cliente = tenantClient(empresaId);
    const importacionAntes = (await cliente.importacionCsv.findUnique({
      where: { id: importId },
      select: {
        id: true,
        empresaId: true,
        estado: true,
        procesadaEn: true,
        filasDetectadas: true,
        filasConError: true,
        erroresMuestra: true,
      },
    })) as FilaImportacionCsv | null;

    console.log("ImportacionCsv (leida con tenantClient, RLS activo):", importacionAntes);

    if (!importacionAntes) {
      console.error(`tenantClient(${empresaId}) no encontro ninguna ImportacionCsv con id=${importId}. No se hace nada.`);
      process.exitCode = 1;
      return;
    }

    if (importacionAntes.estado === "CONFIRMADA" && importacionAntes.procesadaEn) {
      console.log("La importacion ya quedo procesada (CONFIRMADA + procesadaEn). No se hace nada.");
      return; // Exito -- el objetivo ya estaba alcanzado, no es una falla.
    }
    if (importacionAntes.estado === "ERROR") {
      console.error("La importacion ya termino en ERROR. Revisar erroresMuestra antes de reintentar -- este script no reintenta automaticamente.");
      process.exitCode = 1;
      return;
    }
    if (importacionAntes.estado !== "CONFIRMADA") {
      console.error(`estado="${importacionAntes.estado}": no es un caso de "confirmada pendiente de procesar". No se hace nada.`);
      process.exitCode = 1;
      return;
    }

    console.log("");
    console.log("Verificaciones diagnosticas completas OK.");

    if (!ejecutar) {
      console.log("Modo diagnostico: no se reclama nada. Volver a correr con --ejecutar para reclamar y procesar.");
      return; // Exito -- diagnostico limpio, es exactamente lo que se pidio.
    }

    // -- 4. Reclamar EXCLUSIVAMENTE este job -- el UPDATE de
    //    reclamarJobImportacionCsvPorId() filtra por id+cola+
    //    singleton_key+data.importId+empresa+elegibilidad EN LA MISMA
    //    sentencia atomica: si algo no coincide (por ejemplo otro
    //    proceso ya lo tomo entre la verificacion de arriba y este
    //    punto), afecta 0 filas y no reclama nada -- esa es la
    //    proteccion real, no la verificacion diagnostica de los pasos
    //    1-3. --
    console.log("");
    console.log("--ejecutar: reclamando (UPDATE atomico por jobId+cola+importId+empresa+elegibilidad)...");
    const payload: PayloadImportacionCsv & { jobId: string } = { importId, empresaId, jobId };
    const resultado = await reclamarJobImportacionCsvPorId(boss, payload);

    console.log(`Job reclamado: ${resultado.procesado ? "SI" : "NO"}`);
    if (!resultado.procesado) {
      console.error(
        "El UPDATE atomico no afecto ninguna fila (jobId/cola/importId/empresa/elegibilidad ya no coinciden -- " +
          "por ejemplo, otro proceso lo tomo entre la verificacion y este punto). No se hizo nada mas.",
      );
      process.exitCode = 1;
      return;
    }

    // Confirmacion (no proteccion) -- relee el mismo job por id para
    // mostrar como quedo.
    const jobDespues = await leerJobPgBoss(boss, jobId);
    console.log("Job en pgboss.job despues del reclamo:", jobDespues);

    // -- 5. Verificar el resultado final: "reclamado" no es lo mismo que
    //    "proceso con exito" (reclamarJobImportacionCsvPorId atrapa
    //    errores y llama boss.fail() sin relanzar) --
    const importacionDespues = (await cliente.importacionCsv.findUnique({
      where: { id: importId },
      select: {
        estado: true,
        procesadaEn: true,
        filasDetectadas: true,
        filasConError: true,
        erroresMuestra: true,
      },
    })) as Omit<FilaImportacionCsv, "id" | "empresaId"> | null;

    const exitoso = importacionDespues?.estado === "CONFIRMADA" && importacionDespues?.procesadaEn != null;
    console.log("");
    console.log(`Procesamiento exitoso: ${exitoso ? "SI" : "NO"}`);
    console.log("ImportacionCsv despues:", importacionDespues);

    if (!exitoso) {
      console.error("El job se reclamo pero el procesamiento NO termino con exito -- revisar estado/erroresMuestra arriba.");
      process.exitCode = 1;
    }
  } finally {
    await cerrarBoss();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
