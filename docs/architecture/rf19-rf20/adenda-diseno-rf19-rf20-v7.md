# Adenda de diseño RF19/RF20

## Autenticación de plataforma y gobernanza de versiones del cuestionario

**Fecha:** 2026-10-29
**Versión:** v7 — sustituye documentalmente a `adenda-diseno-rf19-rf20-v6.md`, que permanece intacta en este mismo directorio como registro histórico (§14 documenta el diff conceptual completo v6→v7).
**Modo de trabajo:** documental. Se preparó este cambio en la rama `codex/docs-rf19-rf20-adenda-v7`; no se modificó código de aplicación, no se modificó `v6`, no se conectó a Neon, no se generó ni aplicó ninguna migración real, no se creó ningún rol ni se solicitó ninguna credencial.
**Alcance:** este documento contiene el diseño completo, cerrado y autosuficiente de RF19 (autenticación separada de plataforma, con MFA obligatorio) y RF20 (gobernanza de versiones del cuestionario de evaluación), verificado identificador por identificador contra una lectura directa de `prisma/schema.prisma` y las migraciones ya aplicadas en el repositorio ChainPulse. No requiere consultar ningún otro documento para entenderse ni para implementarse. El cambio de fondo respecto de v6 se limita a §3 (migración `rf19_rf20_revoke_create_public` y su validación formal) y a la trazabilidad asociada en §9, §10, §11 y §12; el resto del documento es idéntico en contenido técnico a v6 (§14 documenta el diff completo).

---

## 1. Estado real del repositorio sobre el que se diseña

`UsuarioPlataforma`, `RolUsuarioPlataforma`, `CuestionarioVersion`, `PreguntaVersion`, `EstadoVersionContenido` y el índice parcial `uq_cuestionario_version_publicada` ya están migrados (migración `20260916150000_incremento2_evaluacion_expres_v2`). No existe código de aplicación para RF19 ni RF20. No existe ninguna tabla ni modelo de bitácora de versiones. Los modelos relevantes, tal como existen hoy, literalmente:

```prisma
model CuestionarioVersion {
  id          String                 @id @default(cuid())
  codigo      String
  numero      Int
  estado      EstadoVersionContenido @default(BORRADOR)
  publicadaEn DateTime?
  retiradaEn  DateTime?
  curadorId   String?
  curador     UsuarioPlataforma? @relation(fields: [curadorId], references: [id])
  notasCambio String?
  preguntas          PreguntaVersion[]
  evaluacionesExpres EvaluacionExpresV2[]
  @@unique([codigo, numero])
  @@index([curadorId])
  @@map("cuestionario_versiones")
}

model UsuarioPlataforma {
  id            String               @id @default(cuid())
  email         String               @unique
  passwordHash  String
  mfaSecret     String?
  mfaHabilitado Boolean              @default(false)
  rol           RolUsuarioPlataforma
  intentosFallidos Int       @default(0)
  bloqueadoHasta   DateTime?
  createdAt DateTime @default(now())
  cuestionariosPublicados CuestionarioVersion[]
  definicionesKpiCuradas  DefinicionKpi[]
  @@map("usuarios_plataforma")
}

model PreguntaVersion {
  id                    String              @id @default(cuid())
  cuestionarioVersionId String
  cuestionarioVersion   CuestionarioVersion @relation(fields: [cuestionarioVersionId], references: [id], onDelete: Restrict)
  codigo                String
  orden                 Int
  texto                 String
  dimension             DimensionDiagnosticoV2
  opciones              Json
  esNoPuntuable         Boolean             @default(false)
  respuestas Respuesta[]
  @@unique([cuestionarioVersionId, codigo])
  @@map("pregunta_versiones")
}

enum DimensionDiagnosticoV2 { ALINEACION COORDINACION INTEGRACION EVIDENCIA RESILIENCIA }
enum EstadoVersionContenido { BORRADOR PUBLICADA RETIRADA }
enum BucketLimiteTasa { INICIO_EVALUACION DESBLOQUEO_DETALLE SOLICITUD_DERECHOS CONFIRMAR_DERECHOS }

model LimiteTasa {
  id               String            @id @default(cuid())
  huellaOrigenHash String
  bucket           BucketLimiteTasa
  ventanaInicio    DateTime
  contador         Int               @default(0)
  createdAt        DateTime          @default(now())
  @@unique([huellaOrigenHash, bucket, ventanaInicio])
  @@index([ventanaInicio])
  @@map("limite_tasa")
}
```

`CuestionarioVersion` no tiene columnas `createdAt` ni `actualizadaEn`: ningún diseño de esta adenda las usa; `publicadaEn`/`retiradaEn` son las únicas marcas temporales de transición necesarias y suficientes. `UsuarioPlataforma` no tiene, hoy, ni `activo` ni `sessionVersion` ni `mfaUltimoContadorUsado`: los tres se agregan formalmente en esta adenda (§9, migración 3), con semántica completa (§6.4, §6.7).

La infraestructura de límite de tasa ya existente y reutilizada aquí sin modificar su mecánica central:

```typescript
// src/infra/rateLimit/huella.ts (vigente, sin cambios en esta adenda salvo lo indicado en §6.9)
export const LIMITE_INICIO_EVALUACION = 5;
export const LIMITE_DESBLOQUEO_DETALLE = 10;
export const BUCKET_MINUTOS_LIMITE_TASA = 15;
export const VENTANA_MINUTOS_LIMITE_TASA = 60;
export const BUCKETS_POR_VENTANA_LIMITE_TASA = VENTANA_MINUTOS_LIMITE_TASA / BUCKET_MINUTOS_LIMITE_TASA; // 4

export function hashHuellaOrigen(valorCrudo: string): string { /* HMAC-SHA256 con HUELLA_ORIGEN_SALT */ }
export function truncarVentanaBucket(fecha: Date, bucketMinutos: number = BUCKET_MINUTOS_LIMITE_TASA): Date { /* trunca al inicio del bucket de 15 min, UTC */ }
```

```typescript
// src/infra/rateLimit/limiteTasa.ts (vigente; la firma de registrarIntento()
// se amplía en esta adenda, ver 6.9 -- el cambio es aditivo y retrocompatible)
export async function registrarIntento(
  huellaOrigenHash: string, bucket: BucketLimiteTasa, limite: number, ahora: Date, prisma: PrismaClient,
): Promise<{ contador: number; permitido: boolean }> {
  const ventanaInicio = truncarVentanaBucket(ahora);
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "limite_tasa" ("id", "huellaOrigenHash", "bucket", "ventanaInicio", "contador")
    VALUES (${id}, ${huellaOrigenHash}, ${bucket}::"BucketLimiteTasa", ${ventanaInicio}, 1)
    ON CONFLICT ("huellaOrigenHash", "bucket", "ventanaInicio")
    DO UPDATE SET "contador" = "limite_tasa"."contador" + 1
  `;
  const inicioVentanaDeslizante = new Date(
    ventanaInicio.getTime() - (BUCKETS_POR_VENTANA_LIMITE_TASA - 1) * BUCKET_MINUTOS_LIMITE_TASA * 60_000,
  );
  const filas = await prisma.$queryRaw<{ total: bigint | number | null }[]>`
    SELECT COALESCE(SUM("contador"), 0) AS total FROM "limite_tasa"
    WHERE "huellaOrigenHash" = ${huellaOrigenHash} AND "bucket" = ${bucket}::"BucketLimiteTasa"
      AND "ventanaInicio" >= ${inicioVentanaDeslizante} AND "ventanaInicio" <= ${ventanaInicio}
  `;
  const contador = Number(filas[0]?.total ?? 0);
  return { contador, permitido: contador <= limite };
}
```

`extraerHuellaOrigenCruda(headers: Headers): string` (en `src/infra/public/huellaOrigen.ts`) extrae la huella cruda de origen (IP + fingerprint) a partir de las cabeceras de la request; es pura, no depende de nada específico del flujo público, y se reutiliza sin cambios para las rutas de plataforma.

`verifyPassword(hashed: string, password: string): Promise<boolean>` (en `src/infra/auth/password.ts`) verifica con Argon2id vía `@node-rs/argon2`, capturando cualquier excepción y devolviendo `false` en vez de propagarla.

`totp.validate({ token, timestamp, window }): number | null` (instancia de `OTPAuth.TOTP`, paquete `otpauth@9.5.2` ya instalado) devuelve el delta del contador aceptado o `null`; `timestamp` en milisegundos, por defecto `Date.now()`. `PERIOD = 30` (mismo valor que `src/infra/auth/mfa.ts`).

---

## 2. Modelo de confianza

`neondb_owner` es el propietario de toda función `SECURITY DEFINER` de esta adenda — rol ya existente, usado para migraciones, confirmado en `SEGURIDAD-credenciales.md`/`.env.example`, y ya propietario de `login_lookup()` y de las doce funciones `SECURITY DEFINER` de RF24. `chainpulse_app` es el único rol de aplicación, y el único con `EXECUTE` sobre estas funciones. Un rol `NOLOGIN` mínimo dedicado exclusivamente a estas funciones sería preferible en abstracto a reutilizar `neondb_owner` (un rol amplio), pero crear ese rol ahora expandiría el alcance de esta adenda hacia una refactorización transversal de todo el esquema de permisos del proyecto (afectaría también a RF24 y a `login_lookup()`); queda como riesgo residual documentado (§13), no como trabajo de esta adenda.

La bitácora de versiones (§8) registra qué `actorId` ejecutó cada transición, pero no prueba por sí sola que ese valor corresponda al humano autenticado: esa garantía depende enteramente del guard de servidor (§6.2), que resuelve la sesión contra la base antes de invocar cualquier función. Si `chainpulse_app` estuviera comprometido, podría en teoría invocar una función con cualquier `actorId` sintácticamente válido — la base de datos impide la escritura directa de la bitácora fuera de las funciones, pero no puede, por sí sola, probar la identidad de quien controla las credenciales de conexión.

Toda constante de seguridad (umbrales de intentos, ventanas de bloqueo, duración de tokens, períodos TOTP) es un literal `CONSTANT` dentro del cuerpo plpgsql de la función correspondiente, nunca un parámetro recibido del llamador — esto impide que `chainpulse_app`, o un error en el código que lo invoca, pase un valor de seguridad distinto del aprobado.

---

## 3. Permisos de esquema `public` — se aplican antes de crear ninguna función

**Principio de orden, que gobierna toda la lista de migraciones de §9:** ningún `CREATE FUNCTION ... SECURITY DEFINER` de esta adenda se ejecuta antes de que el `REVOKE CREATE ON SCHEMA public` de esta sección se haya aplicado y verificado con éxito. Si la verificación de abajo encuentra un rol no confiable con `CREATE` sobre `public`, el proceso de migración se detiene por completo — ninguna función, tabla ni índice posterior de esta adenda se crea hasta resolver esa anomalía manualmente.

### 3.1 Migración `rf19_rf20_revoke_create_public` — SQL completo (versión final, corregida)

Versión final consolidada de esta migración, corregida en dos rondas de auditoría independiente respecto de sendos borradores intermedios de esta sección:

1. Un borrador intentaba verificar la ausencia de `CREATE` para el pseudo-rol `PUBLIC` con `has_schema_privilege('public', 'public', 'CREATE')` — una consulta incorrecta: el segundo argumento de `has_schema_privilege()` siempre se interpreta como el nombre de un rol real, así que ese segundo `'public'` se resuelve (o falla al resolver) contra un rol literalmente llamado `public`, que no existe, y que en cualquier caso nunca es el pseudo-rol `PUBLIC` de las listas de control de acceso (ACL) de PostgreSQL. `PUBLIC` se representa en una ACL (`pg_namespace.nspacl`, `pg_proc.proacl`, etc.) con `grantee = 0`, nunca con un nombre; la única forma correcta de consultarlo por catálogo es `aclexplode()` filtrando por `grantee = 0`.
2. Un segundo borrador (ya corregido en el punto anterior) carecía de una transacción explícita, comprobaba la precondición de propietario únicamente contra el ejecutor de la sesión (`current_user`) sin confirmar por catálogo el propietario real del esquema, dejaba que las Pruebas C y D2 de §3.2 aceptaran cualquier código de salida distinto de cero como éxito (incluido un error de sintaxis, conexión o codificación ajeno al bloqueo que la prueba dice demostrar), escribía el archivo SQL aislado de D2 con una codificación insegura en Windows PowerShell 5.1, y no garantizaba que D1 revocara `CREATE` de `PUBLIC` si la migración simulada fallaba antes de llegar a su propio `REVOKE`. Las cinco correcciones de esta ronda se documentan en el SQL y en §3.2, y en el diff conceptual de §14.

A diferencia de las veinte funciones `SECURITY DEFINER` de §3.3, que fijan su propietario explícitamente después de crearse (`ALTER FUNCTION ... OWNER TO neondb_owner`, sin depender de qué credencial ejecutó el `CREATE`), esta migración no crea ningún objeto con propietario reasignable — es un `REVOKE` simple sobre un esquema existente — por lo que no tiene una red de seguridad equivalente si se ejecutara con una credencial distinta. Por eso exige, como precondición bloqueante, dos comprobaciones independientes: que la sesión que ejecuta la migración sea literalmente `neondb_owner` (`current_user`), **y**, por separado, que el propietario real del esquema `public` — leído por catálogo, no asumido — sea también `neondb_owner`. La primera comprobación puede eludirse si alguien ejecuta la migración con una credencial que, por error de configuración, ya tiene privilegios equivalentes a `neondb_owner`; la segunda comprobación no depende de quién ejecuta la sesión, sino del estado real del esquema según `pg_namespace.nspowner`, y por tanto detecta además un escenario distinto: que el esquema `public` haya cambiado de propietario por una vía ajena a esta migración.

Esta versión también envuelve el archivo completo en una transacción explícita (`BEGIN;`/`COMMIT;`): no se asume que `prisma migrate deploy`, ni una invocación manual de `psql -f`, envuelvan el archivo en una transacción implícita. Un `RAISE EXCEPTION` sin capturar dentro de cualquiera de los bloques `DO $$ ... $$` de abajo aborta la transacción en curso — Postgres hace `ROLLBACK` automático ante una excepción no capturada — y el `COMMIT` final nunca se alcanza en ese caso; esa garantía de atomicidad es ahora explícita en el propio archivo, no un comportamiento asumido de la herramienta que lo ejecuta.

```sql
-- prisma/migrations/<fecha>_rf19_rf20_revoke_create_public/migration.sql
-- PostgreSQL 18.6 (Neon). Debe ejecutarse con la credencial neondb_owner,
-- nunca con chainpulse_app -- ver precondicion abajo, que lo verifica y
-- aborta si no se cumple.

-- ============================================================
-- Transaccion explicita: no se asume que prisma migrate deploy (ni una
-- invocacion manual de psql -f) envuelva este archivo en una transaccion
-- implicita. Un RAISE EXCEPTION sin capturar, dentro de cualquiera de los
-- bloques DO $$ ... $$ de abajo, aborta esta transaccion -- el COMMIT
-- final nunca se alcanza en ese caso.
-- ============================================================
BEGIN;

-- ============================================================
-- PRECONDICION (bloqueante): dos comprobaciones independientes.
-- 1) El ejecutor de esta sesion debe ser literalmente neondb_owner.
-- 2) El propietario REAL del esquema public, leido por catalogo (nunca
--    asumido), tambien debe ser neondb_owner. A diferencia de las
--    funciones SECURITY DEFINER de 3.3 (que corrigen su propietario
--    despues con ALTER FUNCTION), un REVOKE no tiene mecanismo de
--    correccion posterior -- de ahi que esta migracion exija ambas
--    condiciones por adelantado, nunca solo una.
-- ============================================================
DO $$
DECLARE
  v_propietario_real name;
BEGIN
  IF current_user <> 'neondb_owner' THEN
    RAISE EXCEPTION 'RF19RF20_PRECONDICION_EJECUTOR: esta migracion debe ejecutarse con la credencial neondb_owner, credencial actual: %', current_user;
  END IF;

  SELECT r.rolname
  INTO v_propietario_real
  FROM pg_namespace AS n
  JOIN pg_roles AS r ON r.oid = n.nspowner
  WHERE n.nspname = 'public';

  IF v_propietario_real IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'RF19RF20_PRECONDICION_PROPIETARIO_REAL: el propietario real del esquema public (pg_namespace.nspowner) es %, se esperaba neondb_owner', v_propietario_real;
  END IF;
END;
$$;

-- ============================================================
-- PREAUDITORIA (informativa, nunca bloqueante): enumera, antes de
-- revocar nada, todo rol -- con nombre o PUBLIC -- que hoy conserva
-- CREATE sobre public. Queda en el log de la migracion como
-- evidencia de diagnostico. La decision de abortar es exclusiva de
-- la postcondicion de abajo, nunca de este bloque.
-- ============================================================
DO $$
DECLARE
  v_fila record;
BEGIN
  FOR v_fila IN
    SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END AS nombre_otorgado_a
    FROM pg_namespace n, LATERAL aclexplode(n.nspacl) a
    LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE n.nspname = 'public' AND a.privilege_type = 'CREATE'
  LOOP
    RAISE NOTICE 'RF19RF20_PREAUDITORIA: % conserva CREATE sobre public antes del REVOKE', v_fila.nombre_otorgado_a;
  END LOOP;
END;
$$;

-- ============================================================
-- Los dos REVOKE. Idempotentes: revocar un privilegio no otorgado
-- es un no-op silencioso en PostgreSQL, nunca un error (ver Prueba
-- B, 3.2, que ejecuta este archivo completo, BEGIN/COMMIT incluidos,
-- una segunda vez sobre un estado ya correcto y exige codigo 0).
-- ============================================================
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM chainpulse_app;

-- === INICIO POSTCONDICION RF19RF20 ===
-- ============================================================
-- POSTCONDICION (bloqueante): cuatro comprobaciones independientes.
-- Si cualquiera falla, esta migracion aborta (ROLLBACK de toda la
-- transaccion explicita de arriba) y ninguna migracion posterior de
-- esta adenda se aplica (9, migraciones 5 y 7; 10, PR 2).
-- Los marcadores que envuelven este bloque delimitan exactamente lo
-- que la Prueba D2 (3.2) extrae y ejecuta de forma aislada.
-- ============================================================
DO $$
DECLARE
  v_public_conserva_create boolean;
  v_chainpulse_app_conserva_create boolean;
  v_rol_inesperado record;
  v_hay_rol_inesperado boolean := false;
  v_chainpulse_app_puede_set_neondb_owner boolean;
BEGIN
  -- Comprobacion 1 (sujeto de la Prueba D1, 3.2) -- PUBLIC es un
  -- pseudo-rol representado en la ACL por grantee = 0, nunca por un
  -- nombre: has_schema_privilege('public', 'public', 'CREATE') seria
  -- incorrecto porque el segundo argumento siempre se interpreta
  -- como el nombre de un rol real (uno literalmente llamado
  -- "public", que no existe), nunca como el pseudo-rol PUBLIC.
  SELECT EXISTS (
    SELECT 1 FROM pg_namespace n, LATERAL aclexplode(n.nspacl) a
    WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE'
  ) INTO v_public_conserva_create;
  IF v_public_conserva_create THEN
    RAISE EXCEPTION 'RF19RF20_POSTCONDICION_1_PUBLIC: PUBLIC conserva CREATE sobre public tras el REVOKE';
  END IF;

  -- Comprobacion 2 -- chainpulse_app especificamente. Aqui si es
  -- correcto usar has_schema_privilege: el primer argumento es el
  -- nombre de un rol real, no el pseudo-rol PUBLIC.
  SELECT has_schema_privilege('chainpulse_app', 'public', 'CREATE') INTO v_chainpulse_app_conserva_create;
  IF v_chainpulse_app_conserva_create THEN
    RAISE EXCEPTION 'RF19RF20_POSTCONDICION_2_CHAINPULSE_APP: chainpulse_app conserva CREATE sobre public tras el REVOKE';
  END IF;

  -- Comprobacion 3 (sujeto de la Prueba D2, 3.2) -- ningun rol con
  -- nombre, distinto de neondb_owner, conserva CREATE. neondb_owner
  -- es la unica excepcion esperada: tiene CREATE implicito por ser
  -- propietario del esquema, no por un GRANT revocable.
  FOR v_rol_inesperado IN
    SELECT r.rolname
    FROM pg_namespace n, LATERAL aclexplode(n.nspacl) a
    JOIN pg_roles r ON r.oid = a.grantee
    WHERE n.nspname = 'public' AND a.privilege_type = 'CREATE'
      AND r.rolname NOT IN ('neondb_owner')
  LOOP
    v_hay_rol_inesperado := true;
    RAISE WARNING 'RF19RF20_POSTCONDICION_3_ROL_INESPERADO: el rol % conserva CREATE sobre public', v_rol_inesperado.rolname;
  END LOOP;
  IF v_hay_rol_inesperado THEN
    RAISE EXCEPTION 'RF19RF20_POSTCONDICION_3_ROL_INESPERADO: abortando -- ningun objeto posterior de esta adenda se crea hasta resolver manualmente los roles listados arriba.';
  END IF;

  -- Comprobacion 4 -- defensa adicional contra escalada indirecta:
  -- aunque 1-3 confirmen que CREATE ya no esta otorgado de forma
  -- directa, esta comprobacion confirma que chainpulse_app tampoco
  -- puede recuperar CREATE asumiendo neondb_owner via SET ROLE.
  SELECT pg_has_role('chainpulse_app', 'neondb_owner', 'SET') INTO v_chainpulse_app_puede_set_neondb_owner;
  IF v_chainpulse_app_puede_set_neondb_owner THEN
    RAISE EXCEPTION 'RF19RF20_POSTCONDICION_4_SET_ROLE: chainpulse_app puede ejecutar SET ROLE neondb_owner -- recuperaria CREATE de forma indirecta';
  END IF;
END;
$$;
-- === FIN POSTCONDICION RF19RF20 ===

COMMIT;
```

`neondb_owner` es la única excepción esperada en la Comprobación 3: es propietario del esquema y por tanto tiene `CREATE` implícito, no un `GRANT` adicional revocable (mismo razonamiento que ya aplica, en el repositorio, al `EXECUTE` que el propietario conserva sobre sus propias funciones incluso tras un `REVOKE ALL ... FROM PUBLIC`).

Si la precondición o la postcondición abortan, **ninguna** de las funciones de §6, §7 u §8 se crea en esa misma corrida de migración: todas ellas están en migraciones posteriores (§9, migraciones 5 y 7), y una migración posterior nunca se aplica si una migración anterior abortó.

### 3.2 Validación formal de la migración `rf19_rf20_revoke_create_public` — Pruebas A, B, C, D1, D2

**Advertencia de alcance, aplicable a toda esta subsección:** lo que sigue es la especificación completa de cinco pruebas, para ejecutarse manualmente desde Windows contra Neon real (mismo patrón ya usado por el resto del proyecto para pruebas de integración) cuando se autorice la implementación. Ninguna de ellas se ejecutó para producir este documento: no se conectó a Neon, no se ejecutó `psql` ni `prisma`, y no se creó ningún rol real.

Estas cinco pruebas son exclusivas de la migración `rf19_rf20_revoke_create_public` de §3.1. No deben confundirse con, ni mezclarse con, las pruebas negativas de permisos de tabla de §4.1/§4.2 (que verifican `INSERT`/`UPDATE`/`DELETE`/`SELECT` sobre tablas de aplicación, no `CREATE` sobre el esquema), ni con la prueba de concurrencia de `crear_cuestionario_version()` en §7.3 (que verifica numeración de versiones bajo `pg_advisory_xact_lock`, no permisos de esquema).

**Prueba A — despliegue real:**

```powershell
prisma migrate deploy
# codigo de salida esperado: 0
```

Ejecutada contra Neon real, con la credencial `neondb_owner`, sobre un estado limpio donde la migración todavía no se aplicó. Confirma que las dos comprobaciones de la precondición pasan (ejecutor y propietario real por catálogo), que la preauditoría no bloquea nada (es informativa), que los dos `REVOKE` se aplican dentro de la transacción explícita, y que las cuatro comprobaciones de la postcondición pasan, terminando en `COMMIT`, en un despliegue limpio real.

**Prueba B — repetición idempotente (no es recuperación de una migración parcial):**

```powershell
psql -v ON_ERROR_STOP=1 "$env:DATABASE_URL" -f "prisma\migrations\<TIMESTAMP>_rf19_rf20_revoke_create_public\migration.sql"
# codigo de salida esperado: 0 (segunda ejecucion, sobre un estado ya correcto tras la Prueba A)
```

Se ejecuta el archivo SQL completo una segunda vez, directamente con `psql` (nunca con `prisma migrate deploy`, que no reaplicaría una migración que Prisma ya registró como aplicada en `_prisma_migrations`), **incluyendo sin excepción los delimitadores `BEGIN;`/`COMMIT;`** — la prueba corre el archivo tal cual existe en disco, nunca un fragmento editado para omitirlos. Esto demuestra la idempotencia del archivo completo, no la recuperación de una ejecución parcial o fallida: ese escenario no puede ocurrir en la práctica, porque un `RAISE EXCEPTION` dentro de un bloque `DO $$ ... $$` de Postgres provoca el `ROLLBACK` de la transacción explícita que envuelve todo el archivo — Prisma nunca marca como aplicada una migración que abortó a medias, así que no existe un estado intermedio real desde el cual "recuperarse". Código de salida 0 esperado porque: las dos comprobaciones de la precondición siguen pasando (misma credencial, mismo propietario real), la preauditoría es informativa y no bloquea aunque reporte lo mismo que la primera vez, los dos `REVOKE` son no-op silencioso sobre un privilegio ya revocado, y las cuatro comprobaciones de la postcondición siguen pasando porque el estado de la base no cambió entre la Prueba A y esta repetición.

**Prueba C — rol nominativo inesperado, dinámico, con bloqueo esperado:**

Demuestra que la migración completa se bloquea (Comprobación 3 de la postcondición) si, al momento de ejecutarla, existe un rol con nombre, distinto de `neondb_owner`, que conserva `CREATE` sobre `public` — el escenario que la Comprobación 3 existe para detectar. El procedimiento genera un nombre de rol dinámico (nunca un literal fijo, para no colisionar con una ejecución anterior ni con un rol real del proyecto), verifica por catálogo que ese nombre no existe ya antes de crearlo, y limpia siempre en un bloque `finally` que nunca permite que un fallo de limpieza oculte el resultado original de la prueba.

**Corrección obligatoria respecto de un borrador anterior:** un código de salida distinto de cero, por sí solo, no es evidencia suficiente de que la Comprobación 3 fue la causa — un error de sintaxis, de conexión, de codificación o un archivo de migración faltante producirían el mismo código de salida distinto de cero y la prueba, tal como estaba, lo habría dado como falso positivo. Por eso la prueba captura stdout y stderr juntos, captura `$LASTEXITCODE` inmediatamente después de la ejecución (antes de que cualquier otro comando pueda sobrescribirlo), y exige **las tres condiciones** siguientes a la vez — código distinto de cero, la cadena literal `RF19RF20_POSTCONDICION_3_ROL_INESPERADO` presente en la salida capturada, y el nombre exacto de `$RolPrueba` presente en la salida capturada — antes de aceptar el resultado como el bloqueo esperado; cualquier otro error (la preparación del rol, un código 0 inesperado, o un código distinto de cero sin esas dos cadenas) se trata como fallo de la prueba, nunca como éxito:

```powershell
$Sufijo = [Guid]::NewGuid().ToString('N').Substring(0, 12)
$RolPrueba = "_prueba_rf19rf20_$Sufijo"

if ($RolPrueba -notmatch '^[a-z_][a-z0-9_]{0,62}$') {
    throw "Nombre de rol de prueba invalido: $RolPrueba"
}

$existe = psql -v ON_ERROR_STOP=1 "$env:DATABASE_URL" -t -c "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$RolPrueba');"
if ($existe.Trim() -ne 'f') {
    throw "El rol de prueba generado ya existe por catalogo -- regenerar el sufijo: $RolPrueba"
}

$FalloOriginal = $null
try {
    psql -v ON_ERROR_STOP=1 "$env:DATABASE_URL" -c "CREATE ROLE $RolPrueba; GRANT CREATE ON SCHEMA public TO $RolPrueba;"
    if ($LASTEXITCODE -ne 0) {
        throw "No se pudo preparar el rol de prueba -- codigo $LASTEXITCODE"
    }

    $Salida = & psql -v ON_ERROR_STOP=1 "$env:DATABASE_URL" -f "prisma\migrations\<TIMESTAMP>_rf19_rf20_revoke_create_public\migration.sql" 2>&1 | Out-String
    $Codigo = $LASTEXITCODE

    if ($Codigo -eq 0) {
        throw "Se esperaba fallo bloqueante y la ejecucion termino con codigo 0. Salida: $Salida"
    }
    if ($Salida -notmatch [regex]::Escape('RF19RF20_POSTCONDICION_3_ROL_INESPERADO')) {
        throw "Codigo distinto de cero pero la salida no contiene RF19RF20_POSTCONDICION_3_ROL_INESPERADO -- no se puede distinguir el bloqueo esperado de un error no relacionado (sintaxis, conexion, codificacion, archivo faltante). Salida: $Salida"
    }
    if ($Salida -notmatch [regex]::Escape($RolPrueba)) {
        throw "La salida no menciona el nombre exacto del rol de prueba ($RolPrueba) -- no se puede confirmar que el bloqueo correspondiera a este rol. Salida: $Salida"
    }
} catch {
    $FalloOriginal = $_
} finally {
    psql -v ON_ERROR_STOP=1 "$env:DATABASE_URL" -c "REVOKE CREATE ON SCHEMA public FROM $RolPrueba; DROP ROLE $RolPrueba;"
    $CodigoLimpieza = $LASTEXITCODE

    if ($CodigoLimpieza -ne 0) {
        if ($FalloOriginal) {
            throw "Fallo original de la prueba: $FalloOriginal -- ADEMAS la limpieza fallo con codigo $CodigoLimpieza (rol $RolPrueba puede haber quedado huerfano, revisar manualmente)"
        } else {
            throw "La prueba paso pero la limpieza fallo con codigo $CodigoLimpieza -- rol $RolPrueba puede haber quedado huerfano, revisar manualmente"
        }
    }
}

if ($FalloOriginal) {
    throw $FalloOriginal
}
```

**D1 — ausencia de `CREATE` para `PUBLIC` (Comprobación 1), nunca con `has_schema_privilege`:**

D1 verifica exclusivamente la ausencia de `CREATE` para el pseudo-rol `PUBLIC` — no verifica roles con nombre (eso es D2, abajo) ni tiene relación con la prueba de concurrencia de `crear_cuestionario_version()` (§7.3). La corrección obligatoria respecto de un borrador anterior: la postcondición **nunca** usa `has_schema_privilege('public', 'public', 'CREATE')`, porque el segundo argumento de esa función siempre se interpreta como el nombre de un rol real — ese segundo `'public'` se resolvería (o fallaría al resolver) contra un rol literalmente llamado `public`, que no existe, y que en cualquier caso nunca es el pseudo-rol `PUBLIC` de las ACL. `PUBLIC` se representa en `pg_namespace.nspacl` con `grantee = 0`, y la única consulta correcta es la que ya aparece como Comprobación 1 en §3.1:

```sql
SELECT EXISTS (
  SELECT 1
  FROM pg_namespace AS n,
       LATERAL aclexplode(n.nspacl) AS a
  WHERE n.nspname = 'public'
    AND a.grantee = 0
    AND a.privilege_type = 'CREATE'
);
```

La postcondición pasa únicamente cuando el resultado es `false`. D1 se demuestra en dos pasos: primero, un escenario de *drift* real (alguien, antes de esta adenda, otorgó `CREATE` a `PUBLIC`; la migración completa debe corregirlo); segundo, una confirmación independiente por catálogo de que el drift quedó corregido, repitiendo la consulta exacta de arriba fuera de la migración misma — nunca se confía solo en que la migración "reporte" éxito.

**Corrección obligatoria respecto de un borrador anterior:** si la migración simulada fallara *antes* de alcanzar su propio `REVOKE CREATE ON SCHEMA public FROM PUBLIC` (por ejemplo, por un error de conexión a mitad de archivo), `PUBLIC` quedaría con `CREATE` y ningún paso posterior de la prueba lo corregiría. Por eso la preparación, la ejecución y la verificación se envuelven en `try`/`catch`/`finally`, y el `finally` ejecuta **siempre** — haya tenido éxito o no la migración simulada — un `REVOKE CREATE ON SCHEMA public FROM PUBLIC` de limpieza, comprobando su propio código de salida; si existió un fallo original y la limpieza también falla, se reportan ambos explícitamente, nunca solo uno, y la limpieza nunca oculta el fallo original:

```powershell
$FalloOriginal = $null
try {
    # (a) Simular drift: GRANT CREATE a PUBLIC antes de ejecutar la migracion.
    psql -v ON_ERROR_STOP=1 "$env:DATABASE_URL" -c "GRANT CREATE ON SCHEMA public TO PUBLIC;"
    if ($LASTEXITCODE -ne 0) {
        throw "D1: no se pudo preparar el escenario de drift (GRANT CREATE a PUBLIC) -- codigo $LASTEXITCODE"
    }

    # (b) Ejecutar la migracion completa -- debe corregir el drift y terminar en 0.
    #     Si fallara ANTES de su propio REVOKE, PUBLIC quedaria con CREATE --
    #     de ahi que el REVOKE de limpieza del finally se ejecute siempre,
    #     nunca solo cuando este paso tiene exito.
    psql -v ON_ERROR_STOP=1 "$env:DATABASE_URL" -f "prisma\migrations\<TIMESTAMP>_rf19_rf20_revoke_create_public\migration.sql"
    if ($LASTEXITCODE -ne 0) {
        throw "D1: se esperaba que la migracion corrigiera el drift y terminara en codigo 0 -- codigo real: $LASTEXITCODE"
    }

    # (c) Confirmacion independiente por catalogo, con la consulta exacta de arriba.
    $resultado = psql -v ON_ERROR_STOP=1 "$env:DATABASE_URL" -t -c "SELECT EXISTS (SELECT 1 FROM pg_namespace n, LATERAL aclexplode(n.nspacl) a WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE');"
    if ($resultado.Trim() -ne 'f') {
        throw "D1: PUBLIC no deberia conservar CREATE tras el REVOKE -- resultado: $resultado"
    }
} catch {
    $FalloOriginal = $_
} finally {
    # Limpieza incondicional: deja PUBLIC sin CREATE sin importar en que
    # paso fallo (o no) lo de arriba.
    psql -v ON_ERROR_STOP=1 "$env:DATABASE_URL" -c "REVOKE CREATE ON SCHEMA public FROM PUBLIC;"
    $CodigoLimpieza = $LASTEXITCODE

    if ($CodigoLimpieza -ne 0) {
        if ($FalloOriginal) {
            throw "Fallo original de D1: $FalloOriginal -- ADEMAS la limpieza (REVOKE CREATE ON SCHEMA public FROM PUBLIC) fallo con codigo $CodigoLimpieza -- PUBLIC puede haber quedado con CREATE, revisar manualmente"
        } else {
            throw "D1 paso pero la limpieza (REVOKE CREATE ON SCHEMA public FROM PUBLIC) fallo con codigo $CodigoLimpieza -- PUBLIC puede haber quedado con CREATE, revisar manualmente"
        }
    }
}

if ($FalloOriginal) {
    throw $FalloOriginal
}
```

**D2 — ningún rol nominativo no permitido conserva `CREATE` (Comprobación 3), como control negativo aislado:**

D2 verifica, por separado de D1, que ningún rol con nombre no permitido conserva `CREATE` sobre `public` — el sujeto es la Comprobación 3, nunca la Comprobación 1 (`PUBLIC`). A diferencia de la Prueba C (que ejecuta el archivo de migración **completo**, con sus dos `REVOKE`, contra un rol inesperado, y por tanto prueba el comportamiento de bloqueo de extremo a extremo), D2 extrae **mecánicamente** — nunca copiado o retipeado a mano — solo el bloque de postcondición delimitado por sus marcadores en el archivo final, y lo ejecuta **sin** los dos `REVOKE` previos. El objetivo es demostrar que la propia Comprobación 3, de forma aislada, es un control negativo real y no una condición vacía que nunca podría fallar.

**Dos correcciones obligatorias respecto de un borrador anterior:**

- **Aserciones de salida**, mismo criterio que la Prueba C: código de salida distinto de cero, por sí solo, no basta — se exige además que la salida capturada (stdout y stderr juntos) contenga la cadena `RF19RF20_POSTCONDICION_3_ROL_INESPERADO` y el nombre exacto de `$RolPrueba`.
- **Codificación del archivo temporal:** `Set-Content`, en Windows PowerShell 5.1, escribe por defecto en UTF-16LE. Si `psql -f` fallara por esa codificación (en vez de por la Comprobación 3), la prueba habría interpretado ese fallo de codificación, incorrectamente, como el bloqueo esperado — un falso positivo indistinguible del resultado correcto sin las aserciones de salida del punto anterior. El bloque aislado se escribe, por tanto, explícitamente en UTF-8 sin BOM con `[System.IO.File]::WriteAllLines` y un `System.Text.UTF8Encoding($false)`, nunca con `Set-Content` a secas. Tras `Remove-Item`, se verifica con `Test-Path` que el archivo temporal efectivamente desapareció; si no desapareció, o si la limpieza del rol falla, ambos fallos se reportan junto con el fallo original de la prueba, nunca se reporta solo uno ni se enmascara el original:

```powershell
$Sufijo = [Guid]::NewGuid().ToString('N').Substring(0, 12)
$RolPrueba = "_prueba_rf19rf20_d2_$Sufijo"

if ($RolPrueba -notmatch '^[a-z_][a-z0-9_]{0,62}$') {
    throw "Nombre de rol de prueba invalido: $RolPrueba"
}

$existe = psql -v ON_ERROR_STOP=1 "$env:DATABASE_URL" -t -c "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$RolPrueba');"
if ($existe.Trim() -ne 'f') {
    throw "El rol de prueba generado ya existe por catalogo -- regenerar el sufijo: $RolPrueba"
}

$Archivo = "prisma\migrations\<TIMESTAMP>_rf19_rf20_revoke_create_public\migration.sql"
$Lineas = Get-Content $Archivo
$Inicio = ($Lineas | Select-String -Pattern '-- === INICIO POSTCONDICION RF19RF20 ===').LineNumber
$Fin    = ($Lineas | Select-String -Pattern '-- === FIN POSTCONDICION RF19RF20 ===').LineNumber
if (-not $Inicio -or -not $Fin -or $Fin -le $Inicio) {
    throw "No se pudieron localizar los marcadores de postcondicion en $Archivo"
}
$BloqueAislado = $Lineas[($Inicio - 1)..($Fin - 1)]
$ArchivoTemporal = [System.IO.Path]::GetTempFileName()

# Escritura explicita en UTF-8 sin BOM -- Set-Content en Windows
# PowerShell 5.1 usaria UTF-16LE por defecto, lo que podria hacer fallar
# a psql -f por codificacion y que la prueba interpretara ese fallo,
# incorrectamente, como el bloqueo esperado.
$Utf8SinBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines(
    $ArchivoTemporal,
    [string[]]$BloqueAislado,
    $Utf8SinBom
)

$FalloOriginal = $null
try {
    psql -v ON_ERROR_STOP=1 "$env:DATABASE_URL" -c "CREATE ROLE $RolPrueba; GRANT CREATE ON SCHEMA public TO $RolPrueba;"
    if ($LASTEXITCODE -ne 0) {
        throw "No se pudo preparar el rol de prueba -- codigo $LASTEXITCODE"
    }

    $Salida = & psql -v ON_ERROR_STOP=1 "$env:DATABASE_URL" -f $ArchivoTemporal 2>&1 | Out-String
    $Codigo = $LASTEXITCODE

    if ($Codigo -eq 0) {
        throw "D2: se esperaba que la Comprobacion 3 detectara a $RolPrueba y abortara -- la ejecucion aislada termino con codigo 0. Salida: $Salida"
    }
    if ($Salida -notmatch [regex]::Escape('RF19RF20_POSTCONDICION_3_ROL_INESPERADO')) {
        throw "D2: codigo distinto de cero pero la salida no contiene RF19RF20_POSTCONDICION_3_ROL_INESPERADO -- no se puede distinguir el bloqueo esperado de un error no relacionado (sintaxis, conexion, codificacion, archivo faltante). Salida: $Salida"
    }
    if ($Salida -notmatch [regex]::Escape($RolPrueba)) {
        throw "D2: la salida no menciona el nombre exacto del rol de prueba ($RolPrueba) -- no se puede confirmar que el bloqueo correspondiera a este rol. Salida: $Salida"
    }
} catch {
    $FalloOriginal = $_
} finally {
    psql -v ON_ERROR_STOP=1 "$env:DATABASE_URL" -c "REVOKE CREATE ON SCHEMA public FROM $RolPrueba; DROP ROLE $RolPrueba;"
    $CodigoLimpiezaRol = $LASTEXITCODE

    Remove-Item $ArchivoTemporal -ErrorAction SilentlyContinue
    $ArchivoTemporalSigueExistiendo = Test-Path $ArchivoTemporal

    $HayFalloDeLimpieza = ($CodigoLimpiezaRol -ne 0) -or $ArchivoTemporalSigueExistiendo
    if ($HayFalloDeLimpieza) {
        $DetalleLimpieza = @()
        if ($CodigoLimpiezaRol -ne 0) { $DetalleLimpieza += "REVOKE/DROP ROLE fallo con codigo $CodigoLimpiezaRol" }
        if ($ArchivoTemporalSigueExistiendo) { $DetalleLimpieza += "el archivo temporal $ArchivoTemporal sigue existiendo tras Remove-Item" }
        $DetalleLimpiezaTexto = $DetalleLimpieza -join '; '

        if ($FalloOriginal) {
            throw "Fallo original de D2: $FalloOriginal -- ADEMAS la limpieza fallo ($DetalleLimpiezaTexto) -- rol $RolPrueba y/o archivo temporal pueden haber quedado huerfanos, revisar manualmente"
        } else {
            throw "D2 paso pero la limpieza fallo ($DetalleLimpiezaTexto) -- rol $RolPrueba y/o archivo temporal pueden haber quedado huerfanos, revisar manualmente"
        }
    }
}

if ($FalloOriginal) {
    throw $FalloOriginal
}
```

### 3.3 Convención de `search_path`, calificación y propietario — aplica a las veinte funciones de §6 y §7

```sql
DROP FUNCTION IF EXISTS public.<nombre>(<firma>);  -- nunca CREATE OR REPLACE: un cambio de tipo de retorno falla con 42P13

CREATE FUNCTION public.<nombre>(<parámetros>)
RETURNS <tipo>
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- Todo objeto referenciado, calificado con esquema explicito:
  -- public.usuarios_plataforma, public.cuestionario_versiones, etc. Esta
  -- calificacion es la mitigacion PRIMARIA contra "search_path hijacking";
  -- "public, pg_temp" es documentacion secundaria (impide que una tabla
  -- temporal con el mismo nombre se resuelva antes que la tabla real),
  -- nunca un sustituto de la calificacion.
  ...
END;
$$;

ALTER FUNCTION public.<nombre>(<firma>) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.<nombre>(<firma>) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.<nombre>(<firma>) TO chainpulse_app;
```

El `ALTER FUNCTION ... OWNER TO neondb_owner` explícito evita depender de que la migración se ejecute literalmente con la credencial `neondb_owner` para que la función termine siendo de su propiedad — `CREATE FUNCTION ... SECURITY DEFINER` adopta como propietario a quien ejecuta el `CREATE`, silenciosamente, si no se fija después.

### 3.4 Verificación de firma/propietario/`search_path`/grants por catálogo (una instancia por función, usada en las pruebas de §6, §7 y §12)

```sql
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS firma,
  r.rolname AS propietario,
  p.prosecdef AS es_security_definer,
  p.proconfig AS configuracion,
  (SELECT array_agg(DISTINCT grantee::regrole::text)
     FROM aclexplode(p.proacl) WHERE privilege_type = 'EXECUTE') AS execute_otorgado_a
FROM pg_proc p
JOIN pg_roles r ON r.oid = p.proowner
WHERE p.proname = '<nombre_funcion>' AND p.pronamespace = 'public'::regnamespace;
```

Cada función del inventario de §12.3 trae su valor esperado exacto de cada columna; la prueba correspondiente compara por igualdad de conjunto completa (detecta tanto un grant faltante como uno excedente).

---

## 4. Permisos efectivos por tabla

Toda tabla de aplicación de este repositorio recibe, por defecto (patrón ya establecido), `GRANT SELECT, INSERT, UPDATE, DELETE` a `chainpulse_app`. Las tablas de RF19/RF20 que participan en flujos gobernados por función son la excepción deliberada: pierden `INSERT`/`UPDATE`/`DELETE` directo, y en el caso de `usuarios_plataforma`, también `SELECT` directo.

### 4.1 `cuestionario_versiones`, `pregunta_versiones`, `bitacora_version_cuestionario`

```sql
REVOKE INSERT, UPDATE, DELETE ON public.cuestionario_versiones FROM chainpulse_app;
REVOKE INSERT, UPDATE, DELETE ON public.pregunta_versiones FROM chainpulse_app;
REVOKE INSERT, UPDATE, DELETE ON public.bitacora_version_cuestionario FROM chainpulse_app;

GRANT SELECT ON public.cuestionario_versiones TO chainpulse_app;
GRANT SELECT ON public.pregunta_versiones TO chainpulse_app;
GRANT SELECT ON public.bitacora_version_cuestionario TO chainpulse_app;
```

`bitacora_version_cuestionario` recibe estos privilegios en la misma migración que la crea (§9, migración 6): no existe un estado intermedio en el que la tabla exista sin este endurecimiento.

Pruebas negativas obligatorias (deben fallar con `42501` bajo la credencial real de `chainpulse_app`):

```sql
INSERT INTO public.cuestionario_versiones (id, codigo, numero, estado) VALUES ('x', 'EXPRES', 99, 'BORRADOR');
UPDATE public.pregunta_versiones SET texto = 'x' WHERE id = 'cualquiera';
DELETE FROM public.bitacora_version_cuestionario WHERE id = 'cualquiera';
```

### 4.2 `usuarios_plataforma` — sin `GRANT` de tabla, ni para lectura ni para escritura

```sql
REVOKE INSERT, UPDATE, DELETE ON public.usuarios_plataforma FROM chainpulse_app;
REVOKE SELECT ON public.usuarios_plataforma FROM chainpulse_app;
```

Toda lectura y escritura pasa por las funciones de §6.9. Pruebas negativas obligatorias:

```sql
UPDATE public.usuarios_plataforma SET rol = 'ADMINISTRADOR_PLATAFORMA' WHERE id = 'cualquiera';
UPDATE public.usuarios_plataforma SET "passwordHash" = 'x' WHERE id = 'cualquiera';
SELECT "passwordHash" FROM public.usuarios_plataforma LIMIT 1;
```

### 4.3 `limite_tasa`

Sin cambios en sus permisos: ya correctamente otorgados desde antes de esta adenda. Esta adenda solo agrega dos valores al enum `BucketLimiteTasa` (§6.9).

---

## 5. Convención de generación de IDs

Toda fila nueva en `cuestionario_versiones`, `pregunta_versiones` y `bitacora_version_cuestionario` recibe su `id` **generado en TypeScript** (CUID v1, el mismo formato que `@default(cuid())` ya declara para estas tres tablas en `schema.prisma`) y lo pasa como parámetro `p_id text` a la función `SECURITY DEFINER` correspondiente, que lo usa literalmente en el `INSERT`. Ninguna de estas tres tablas usa `gen_random_uuid()` en ningún punto; no se mezclan formatos dentro de la misma tabla.

`@prisma/client` genera CUIDs para `@default(cuid())` mediante una función interna no exportada públicamente (confirmado por inspección directa del bundle de runtime instalado: existen símbolos `cuid`/`isCuid` dentro de `@prisma/client/runtime/client.js`, pero ninguna ruta de `exports` del paquete los expone) — depender de ese detalle interno acoplaría esta adenda a una implementación no versionada que puede cambiar sin aviso. Por eso se agrega una dependencia npm nueva, mínima y explícita: `cuid@^2.1.8` (paquete clásico, formato CUID v1, sin dependencias propias de peso).

```typescript
// src/infra/ids/cuid.ts
import cuid from "cuid";
export function generarCuid(): string {
  return cuid();
}
```

No se agrega una verificación de pre-existencia del `id` antes de cada `INSERT`: la propia restricción de clave primaria es la autoridad final, exactamente el mismo criterio que ya aplica implícitamente cada vez que Prisma ejecuta `@default(cuid())` en cualquier otra tabla del proyecto. Una colisión real tiene probabilidad despreciable; si ocurriera, el `INSERT` fallaría con `23505` sobre la clave primaria, resoluble con un reintento que genera un nuevo CUID.

---

## 6. RF19 — Autenticación de plataforma

### 6.1 Tokens de preautenticación y de sesión

Dos JWT (`jose@^6.2.12`, ya dependencia del proyecto), de audiencias separadas y nunca intercambiables.

| | `plataforma-preauth` | `plataforma-session` |
|---|---|---|
| Emitido cuando | password válida, MFA aún no verificado en esta sesión de login | password + MFA válidos |
| `iss` | `chainpulse-plataforma` | `chainpulse-plataforma` |
| `aud` | `plataforma-preauth` | `plataforma-session` |
| Algoritmo | `HS256` | `HS256` |
| TTL | 10 minutos (`CONSTANT`) | 8 horas (`CONSTANT`) |
| Claims | `sub`, `iat`, `exp`, `iss`, `aud` — nunca `rol` ni `sessionVersion` | `sub`, `rol`, `sessionVersion`, `iat`, `exp`, `iss`, `aud` |
| Cookie | `chainpulse_plataforma_preauth` | `chainpulse_plataforma_session` |
| `httpOnly` / `secure` / `sameSite` | true / true / `strict` | true / true / `strict` |
| `path` | `/activar-mfa`, `/verificar-mfa` (nunca `/`) | `/` dentro del árbol de plataforma |
| Secreto | `AUTH_PLATAFORMA_SECRET` (nunca `AUTH_SECRET` del flujo público) | mismo `AUTH_PLATAFORMA_SECRET` |

El preauth no lleva `rol` ni `sessionVersion`: si llevara `rol`, un preauth robado (aunque de corta vida) ya revelaría el rol del usuario antes de probar MFA; si llevara `sessionVersion`, el guard de sesión normal (§6.2) podría confundirlo con una sesión válida si no discriminara estrictamente por `aud`. El guard de las rutas `/activar-mfa`/`/verificar-mfa` exige `aud = "plataforma-preauth"` exactamente y rechaza cualquier otro valor, incluida una sesión completa válida.

El preauth solo habilita `POST /api/plataforma/mfa/enrolar` y `POST /api/plataforma/mfa/verificar`. Al verificar el primer código TOTP con éxito, la cookie de preauth se borra explícitamente (`Set-Cookie` con `Max-Age=0`) en la misma respuesta que emite la cookie de sesión completa. Un preauth robado que no se usa para completar el enrolamiento permanece criptográficamente válido hasta su `exp` natural de 10 minutos (no existe revocación activa de JWT en este diseño); el límite de daño de ese escenario está acotado por lo que el preauth permite hacer (solo enrolar/verificar MFA) y por el límite de intentos de MFA (§6.9), no por una invalidación temprana.

Flujo de login completo: `POST /api/plataforma/login` con `email`+`password`; si válidos y `mfaHabilitado = false`, emite preauth y redirige a `/activar-mfa`; si válidos y `mfaHabilitado = true`, emite preauth y redirige a `/verificar-mfa`; cualquiera de las dos rutas, al validar el código TOTP, emite la sesión completa e invalida el preauth.

### 6.2 Middleware Edge vs. guard de servidor

`src/middleware.ts` (ampliado) solo valida firma/`exp`/`aud` del JWT con `jose`, sin Prisma ni ninguna API exclusiva de Node — mismo patrón ya usado por `src/auth.config.ts` para el flujo público. El archivo nuevo `src/auth.config.plataforma.ts` sigue exactamente ese mismo patrón de aislamiento edge-safe.

`requireSesionPlataforma()` (servidor, nuevo, en `src/infra/auth/sessionPlataforma.ts`) es la comprobación autoritativa, ejecutada en cada ruta de API y cada Server Component protegido de plataforma:

1. Decodifica el JWT de sesión (ya lo hizo el middleware, pero se repite aquí: el middleware no es la única barrera).
2. Consulta `leer_estado_sesion_plataforma()` (§6.9) con el `sub` del token.
3. Compara `sessionVersion` del token contra el valor real en base — rechaza si no coincide (fail-closed).
4. Rechaza si `activo = false`.
5. Devuelve `{ usuarioId, rol, sessionVersion, activo }` al llamador, que decide autorización fina por rol.

Ninguna ruta de escritura de plataforma se ejecuta sin haber pasado por `requireSesionPlataforma()` en el propio handler del servidor, independientemente de lo que el middleware ya haya filtrado.

### 6.3 `login_lookup_plataforma()`

```sql
DROP FUNCTION IF EXISTS public.login_lookup_plataforma(text);

CREATE FUNCTION public.login_lookup_plataforma(p_email text)
RETURNS TABLE(
  id text, "passwordHash" text, "mfaSecret" text, "mfaHabilitado" boolean,
  rol text, "intentosFallidos" integer, "bloqueadoHasta" timestamp,
  "sessionVersion" integer, activo boolean
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT id, "passwordHash", "mfaSecret", "mfaHabilitado", rol::text,
         "intentosFallidos", "bloqueadoHasta", "sessionVersion", activo
  FROM public.usuarios_plataforma
  WHERE lower(btrim(email)) = lower(btrim(p_email));
$$;

ALTER FUNCTION public.login_lookup_plataforma(text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.login_lookup_plataforma(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.login_lookup_plataforma(text) TO chainpulse_app;
```

La función devuelve la fila de una cuenta con `activo = false` o con `bloqueadoHasta` vigente en vez de omitirla: mantiene el mismo costo de consulta sin importar el estado de la cuenta, evitando un canal lateral de timing a este nivel. La decisión de rechazar el login de una cuenta inactiva o bloqueada se toma en la ruta de aplicación (§6.5), con la misma respuesta uniforme descrita ahí.

**Prueba:** firma exacta, propietario `neondb_owner`, `SECURITY DEFINER`, `search_path = public, pg_temp`, `EXECUTE` exactamente a `{chainpulse_app}` (vía la consulta de §3.4), caso funcional con email en mayúsculas/espacios, y un caso con `activo = false` que confirme que la función sigue devolviendo la fila.

### 6.4 Semántica completa de `activo`

| | `activo = true` | `activo = false` |
|---|---|---|
| Login | Procede si password/MFA correctos y la cuenta no está bloqueada | Rechazado con la misma respuesta uniforme de §6.5, tras verificar la contraseña igualmente |
| Sesión ya emitida | Procede | Rechazada en la siguiente request, por `requireSesionPlataforma()` |
| Transición `true → false` | — | Vía `desactivar_usuario_plataforma()` (§6.9): en la misma sentencia `UPDATE`, `activo = false` **y** `sessionVersion = sessionVersion + 1` — nunca dos pasos separados, para que la desactivación sea efectiva de inmediato sin depender de qué campo revise cada guard |
| Transición `false → true` | Vía `reactivar_usuario_plataforma()` (§6.9) | — (no incrementa `sessionVersion`: no había sesión válida que invalidar) |

Una cuenta `activo = false` no se borra ni pierde su historial de versiones curadas (`curadorId` sigue apuntando a ella, protegido por `onDelete: Restrict`): desactivar es reversible y auditable, borrar no lo es.

### 6.5 Resistencia a enumeración de cuentas

**Invariante:** la respuesta de `POST /api/plataforma/login` es exactamente la misma —mismo código de estado `401`, mismo cuerpo, mismo mensaje— para los cuatro casos en los que el login no procede: cuenta inexistente, contraseña incorrecta, cuenta inactiva con contraseña correcta, y cuenta bloqueada temporalmente (con contraseña correcta o incorrecta). Las cuatro ramas ejecutan una verificación Argon2id de costo equivalente antes de responder. Una cuenta bloqueada nunca emite un token de preautenticación, incluso si la contraseña es correcta. El hecho de que una cuenta esté bloqueada solo existe en el registro interno de `usuarios_plataforma` (`intentosFallidos`/`bloqueadoHasta`, escrito por `registrar_intento_fallido_plataforma()` en §6.6 al alcanzar el quinto fallo) — nunca se refleja en un código de estado, cuerpo ni tiempo de respuesta distinto. Ningún atacante puede distinguir, por la respuesta ni por el tiempo de respuesta, cuál de los cuatro casos ocurrió.

```typescript
// src/app/api/plataforma/login/route.ts
import { NextResponse } from "next/server";
import { verifyPassword } from "@/infra/auth/password";
import { loginLookupPlataforma } from "@/infra/auth/loginLookupPlataforma";
import {
  registrarIntentoFallidoPlataforma, restablecerIntentosPlataforma,
} from "@/infra/auth/sessionPlataforma";
import { extraerHuellaOrigenCruda } from "@/infra/public/huellaOrigen";
import { hashHuellaOrigen, registrarIntento } from "@/infra/rateLimit/limiteTasa";
import { LIMITE_LOGIN_PLATAFORMA_POR_HUELLA, calcularRetryAfterSegundos } from "@/infra/rateLimit/limitesPlataforma";
import { loginPlataformaSchema } from "./schema";
import { prisma } from "@/infra/prisma/client";

const RESPUESTA_CREDENCIALES_INVALIDAS = { ok: false, error: "CREDENCIALES_INVALIDAS" } as const;

// Generado UNA SOLA VEZ, fuera de esta sesion de diseño, ejecutando
// `await hashPassword(randomUUID())` sobre un valor aleatorio que no es
// la contraseña de ninguna cuenta real, y pegado aqui como literal.
// Nunca se regenera en caliente por request (eso variaria el timing de
// forma no controlada) ni se deriva de ningun dato de la request.
const HASH_SENUELO_LOGIN_PLATAFORMA = "<<GENERAR_UNA_VEZ_CON_hashPassword_Y_PEGAR_EL_RESULTADO_AQUI>>";

export async function POST(request: Request) {
  const ahora = new Date();
  const huellaHash = hashHuellaOrigen(extraerHuellaOrigenCruda(request.headers));

  const limiteHuella = await registrarIntento(
    huellaHash, "LOGIN_PLATAFORMA", LIMITE_LOGIN_PLATAFORMA_POR_HUELLA, ahora, prisma, 1,
  );
  if (!limiteHuella.permitido) {
    return NextResponse.json(
      { ok: false, error: "LIMITE_TASA_EXCEDIDO" },
      { status: 429, headers: { "Retry-After": String(calcularRetryAfterSegundos(ahora)) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = loginPlataformaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(RESPUESTA_CREDENCIALES_INVALIDAS, { status: 401 });
  }
  const { email, password } = parsed.data;

  const fila = await loginLookupPlataforma(email);

  if (!fila) {
    // Cuenta inexistente: se ejecuta IGUAL el computo de verificacion de
    // password, contra el hash senuelo (mismo costo de Argon2id que una
    // verificacion real), para que esta rama sea indistinguible por
    // tiempo de las otras tres. No existe ningun usuarioId real contra
    // el cual registrar el intento -- nunca se llama a
    // registrarIntentoFallidoPlataforma() aqui.
    await verifyPassword(HASH_SENUELO_LOGIN_PLATAFORMA, password);
    return NextResponse.json(RESPUESTA_CREDENCIALES_INVALIDAS, { status: 401 });
  }

  // La verificacion de password se ejecuta SIEMPRE, incluso si la cuenta
  // ya esta bloqueada: ninguna rama responde sin haber pagado el mismo
  // costo de Argon2id que la rama "cuenta inexistente". Omitir este
  // computo cuando bloqueadoHasta esta vigente -- "para ahorrar computo"
  // -- es exactamente el error que esta seccion corrige: esa
  // optimizacion revela, por tiempo de respuesta y por codigo de estado,
  // que la cuenta existe y esta bloqueada.
  const passwordOk = await verifyPassword(fila.passwordHash, password);

  const bloqueada = fila.bloqueadoHasta !== null && fila.bloqueadoHasta > ahora;
  if (bloqueada) {
    // Una cuenta bloqueada NUNCA emite preauth, sin importar si
    // passwordOk es true o false -- ni la respuesta ni el tiempo de
    // respuesta distinguen esta rama de las otras tres. El bloqueo ya
    // quedo registrado internamente (intentosFallidos/bloqueadoHasta)
    // cuando se alcanzo el quinto fallo, vía
    // registrar_intento_fallido_plataforma() (§6.6); esta rama no
    // vuelve a escribir nada -- ni extiende bloqueadoHasta ni cuenta un
    // intento mas -- precisamente para mantener el mismo costo (lookup +
    // 1 verificacion Argon2id, sin escritura) que la rama de cuenta
    // inexistente.
    return NextResponse.json(RESPUESTA_CREDENCIALES_INVALIDAS, { status: 401 });
  }

  if (!passwordOk) {
    await registrarIntentoFallidoPlataforma(fila.id);
    return NextResponse.json(RESPUESTA_CREDENCIALES_INVALIDAS, { status: 401 });
  }

  if (!fila.activo) {
    // Password SI era correcta, pero la respuesta es identica a las
    // demas ramas -- nunca se revela el estado administrativo de la
    // cuenta a quien ya conocia la contraseña correcta. No se registra
    // como intento fallido: la contraseña no fallo, esto es un bloqueo
    // administrativo, no un intento de fuerza bruta.
    return NextResponse.json(RESPUESTA_CREDENCIALES_INVALIDAS, { status: 401 });
  }

  await restablecerIntentosPlataforma(fila.id);
  // ... continua: emision del token de preauth, redireccion a
  // /activar-mfa o /verificar-mfa segun fila.mfaHabilitado ...
}
```

**Pruebas obligatorias de esta sección:**
1. Las cuatro ramas (`fila` ausente; contraseña incorrecta sin bloqueo; `activo = false` con contraseña correcta; cuenta bloqueada, tanto con contraseña correcta como incorrecta) devuelven exactamente `{ ok: false, error: "CREDENCIALES_INVALIDAS" }` con estado `401` — comparación byte a byte del cuerpo de la respuesta entre todas ellas.
2. El tiempo de respuesta de la rama "cuenta inexistente" no es estadísticamente distinguible (dentro de un margen razonable de varianza de entorno) del tiempo de respuesta de cada una de las otras tres ramas, medido sobre un número suficiente de repeticiones.
3. Ninguna fila de `usuarios_plataforma` recibe un incremento de `intentosFallidos` cuando la cuenta no existe (verificado indirectamente: no hay ninguna fila que pudiera haberlo recibido), cuando la cuenta está inactiva con password correcta, ni cuando la cuenta ya está bloqueada (verificado directamente en estos dos últimos casos: `intentosFallidos`/`bloqueadoHasta` de esa cuenta permanecen sin cambios tras el intento).
4. **Prueba de extremo a extremo de resistencia a enumeración tras bloqueo real:** contra una cuenta existente se envían cinco intentos de login con contraseña incorrecta (alcanzando el bloqueo en el quinto, vía `registrar_intento_fallido_plataforma()`), intercalados uno a uno con cinco intentos de login contra un correo inexistente. Se confirma que: (a) las diez respuestas son byte-idénticas entre sí; (b) los tiempos de respuesta de los cinco intentos contra la cuenta existente y los cinco contra la cuenta inexistente no son estadísticamente distinguibles entre sí, incluidos el cuarto y el quinto intento contra la cuenta existente (ya bloqueada en ese punto); (c) un sexto intento contra la cuenta existente, esta vez con la contraseña correcta, también devuelve `401` idéntico a los anteriores, sin emitir preauth, y `bloqueadoHasta` no se modifica respecto del valor fijado en el quinto intento.

### 6.6 Inventario completo de funciones sobre `usuarios_plataforma`

```sql
DROP FUNCTION IF EXISTS public.registrar_intento_fallido_plataforma(text);

CREATE FUNCTION public.registrar_intento_fallido_plataforma(p_usuario_id text)
RETURNS TABLE("intentosFallidos" integer, "bloqueadoHasta" timestamp)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_max_intentos CONSTANT integer := 5;
  v_minutos_bloqueo CONSTANT integer := 15;
BEGIN
  RETURN QUERY
  UPDATE public.usuarios_plataforma
  SET "intentosFallidos" = "intentosFallidos" + 1,
      "bloqueadoHasta" = CASE
        WHEN "intentosFallidos" + 1 >= v_max_intentos
          THEN now() + (v_minutos_bloqueo || ' minutes')::interval
        ELSE "bloqueadoHasta"
      END
  WHERE id = p_usuario_id
  RETURNING "intentosFallidos", "bloqueadoHasta";
END;
$$;

ALTER FUNCTION public.registrar_intento_fallido_plataforma(text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.registrar_intento_fallido_plataforma(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_intento_fallido_plataforma(text) TO chainpulse_app;


DROP FUNCTION IF EXISTS public.restablecer_intentos_plataforma(text);

CREATE FUNCTION public.restablecer_intentos_plataforma(p_usuario_id text)
RETURNS TABLE(restablecido boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.usuarios_plataforma
  SET "intentosFallidos" = 0, "bloqueadoHasta" = NULL
  WHERE id = p_usuario_id;
  IF FOUND THEN RETURN QUERY SELECT true; ELSE RETURN QUERY SELECT false; END IF;
END;
$$;

ALTER FUNCTION public.restablecer_intentos_plataforma(text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.restablecer_intentos_plataforma(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restablecer_intentos_plataforma(text) TO chainpulse_app;


DROP FUNCTION IF EXISTS public.leer_estado_sesion_plataforma(text);

CREATE FUNCTION public.leer_estado_sesion_plataforma(p_usuario_id text)
RETURNS TABLE(activo boolean, rol text, "sessionVersion" integer)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT activo, rol::text, "sessionVersion"
  FROM public.usuarios_plataforma WHERE id = p_usuario_id;
$$;

ALTER FUNCTION public.leer_estado_sesion_plataforma(text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.leer_estado_sesion_plataforma(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leer_estado_sesion_plataforma(text) TO chainpulse_app;


DROP FUNCTION IF EXISTS public.incrementar_version_sesion_plataforma(text);

CREATE FUNCTION public.incrementar_version_sesion_plataforma(p_usuario_id text)
RETURNS TABLE("sessionVersion" integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_nueva_version integer;
BEGIN
  UPDATE public.usuarios_plataforma
  SET "sessionVersion" = "sessionVersion" + 1
  WHERE id = p_usuario_id
  RETURNING "sessionVersion" INTO v_nueva_version;
  RETURN QUERY SELECT v_nueva_version;
END;
$$;

ALTER FUNCTION public.incrementar_version_sesion_plataforma(text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.incrementar_version_sesion_plataforma(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.incrementar_version_sesion_plataforma(text) TO chainpulse_app;


DROP FUNCTION IF EXISTS public.desactivar_usuario_plataforma(text, text);

CREATE FUNCTION public.desactivar_usuario_plataforma(p_usuario_id text, p_actor_id text)
RETURNS TABLE(desactivado boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.usuarios_plataforma
  SET activo = false, "sessionVersion" = "sessionVersion" + 1
  WHERE id = p_usuario_id AND activo = true;
  IF FOUND THEN RETURN QUERY SELECT true; ELSE RETURN QUERY SELECT false; END IF;
END;
$$;

ALTER FUNCTION public.desactivar_usuario_plataforma(text, text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.desactivar_usuario_plataforma(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.desactivar_usuario_plataforma(text, text) TO chainpulse_app;


DROP FUNCTION IF EXISTS public.reactivar_usuario_plataforma(text, text);

CREATE FUNCTION public.reactivar_usuario_plataforma(p_usuario_id text, p_actor_id text)
RETURNS TABLE(reactivado boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.usuarios_plataforma SET activo = true WHERE id = p_usuario_id AND activo = false;
  IF FOUND THEN RETURN QUERY SELECT true; ELSE RETURN QUERY SELECT false; END IF;
END;
$$;

ALTER FUNCTION public.reactivar_usuario_plataforma(text, text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.reactivar_usuario_plataforma(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reactivar_usuario_plataforma(text, text) TO chainpulse_app;
```

`p_actor_id` en `desactivar_usuario_plataforma`/`reactivar_usuario_plataforma` queda disponible para que la ruta de aplicación lo registre en sus propios logs de auditoría de acceso administrativo — esta adenda no diseña una tabla de auditoría de altas/bajas de `UsuarioPlataforma` nueva porque no fue pedida.

**Contrato de invocación de `registrar_intento_fallido_plataforma()` desde la ruta de login (§6.5):** se invoca únicamente cuando la contraseña es incorrecta y la cuenta todavía no está bloqueada. Una vez que `bloqueadoHasta` queda vigente (al quinto fallo), ningún intento posterior —correcto o incorrecto— vuelve a invocar esta función mientras el bloqueo siga vigente: ni lo extiende ni vuelve a incrementar `intentosFallidos`. El bloqueo se levanta únicamente por el paso natural del tiempo (`bloqueadoHasta` queda en el pasado) seguido de un login con contraseña correcta, que invoca `restablecer_intentos_plataforma()`.

**Pruebas obligatorias, una por función:** firma/propietario/grants por catálogo (§3.4); caso de éxito; caso de fallo (usuario inexistente o estado de partida incorrecto, según corresponda) devolviendo el booleano `false` sin lanzar excepción ni modificar ninguna fila. Para `desactivar_usuario_plataforma`: prueba de integración dedicada que confirma que, tras la llamada, una sesión emitida antes es rechazada en la siguiente request por `requireSesionPlataforma()`.

### 6.7 MFA — enrolamiento idempotente, contador absoluto, verificación

**Enrolamiento (`enrolar_mfa_plataforma`) — idempotente:**

```sql
DROP FUNCTION IF EXISTS public.enrolar_mfa_plataforma(text, text);

CREATE FUNCTION public.enrolar_mfa_plataforma(p_usuario_id text, p_secreto_candidato text)
RETURNS TABLE(ok boolean, motivo text, "secretoEfectivo" text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_habilitado boolean;
  v_secreto_actual text;
BEGIN
  SELECT "mfaHabilitado", "mfaSecret" INTO v_habilitado, v_secreto_actual
  FROM public.usuarios_plataforma WHERE id = p_usuario_id FOR UPDATE;

  IF v_habilitado IS NULL THEN
    RETURN QUERY SELECT false, 'USUARIO_INEXISTENTE', NULL::text; RETURN;
  END IF;
  IF v_habilitado THEN
    RETURN QUERY SELECT false, 'MFA_YA_ACTIVO', NULL::text; RETURN;
  END IF;

  IF v_secreto_actual IS NOT NULL THEN
    -- Idempotencia: ya hay un enrolamiento pendiente -- se devuelve el
    -- MISMO secreto, nunca se sobreescribe uno ya entregado al usuario
    -- (evita invalidar silenciosamente un QR ya escaneado).
    RETURN QUERY SELECT true, 'PENDIENTE_EXISTENTE', v_secreto_actual; RETURN;
  END IF;

  UPDATE public.usuarios_plataforma SET "mfaSecret" = p_secreto_candidato WHERE id = p_usuario_id;
  RETURN QUERY SELECT true, 'NUEVO_SECRETO_REGISTRADO', p_secreto_candidato;
END;
$$;

ALTER FUNCTION public.enrolar_mfa_plataforma(text, text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.enrolar_mfa_plataforma(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enrolar_mfa_plataforma(text, text) TO chainpulse_app;
```

El llamador en TypeScript siempre renderiza el QR/URL a partir de `secretoEfectivo` (nunca de `p_secreto_candidato`): si la llamada devuelve `PENDIENTE_EXISTENTE`, la pantalla sigue mostrando el QR correcto para el secreto que el usuario ya pudo haber escaneado.

**Prueba de idempotencia:** dos llamadas consecutivas con `p_secreto_candidato` distinto en cada una, sobre la misma cuenta con `mfaHabilitado = false`, deben devolver el mismo `secretoEfectivo` en ambas (el de la primera).

**Activación = primera verificación, atómica (`activar_mfa_plataforma`):**

```sql
DROP FUNCTION IF EXISTS public.activar_mfa_plataforma(text, integer);

CREATE FUNCTION public.activar_mfa_plataforma(p_usuario_id text, p_contador integer)
RETURNS TABLE(activado boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.usuarios_plataforma
  SET "mfaHabilitado" = true, "mfaUltimoContadorUsado" = p_contador
  WHERE id = p_usuario_id AND "mfaHabilitado" = false AND "mfaSecret" IS NOT NULL
    AND (p_contador > "mfaUltimoContadorUsado" OR "mfaUltimoContadorUsado" IS NULL);
  IF FOUND THEN RETURN QUERY SELECT true; ELSE RETURN QUERY SELECT false; END IF;
END;
$$;

ALTER FUNCTION public.activar_mfa_plataforma(text, integer) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.activar_mfa_plataforma(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activar_mfa_plataforma(text, integer) TO chainpulse_app;
```

**Verificación en cada login (`consumir_contador_totp_plataforma`):**

```sql
DROP FUNCTION IF EXISTS public.consumir_contador_totp_plataforma(text, integer);

CREATE FUNCTION public.consumir_contador_totp_plataforma(p_usuario_id text, p_contador integer)
RETURNS TABLE(consumido boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.usuarios_plataforma
  SET "mfaUltimoContadorUsado" = p_contador
  WHERE id = p_usuario_id AND "mfaHabilitado" = true
    AND (p_contador > "mfaUltimoContadorUsado" OR "mfaUltimoContadorUsado" IS NULL);
  IF FOUND THEN RETURN QUERY SELECT true; ELSE RETURN QUERY SELECT false; END IF;
END;
$$;

ALTER FUNCTION public.consumir_contador_totp_plataforma(text, integer) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.consumir_contador_totp_plataforma(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consumir_contador_totp_plataforma(text, integer) TO chainpulse_app;
```

**Cálculo del contador absoluto en TypeScript** (`p_contador` siempre recibe este valor, nunca el delta crudo de `validate()`):

```typescript
// src/infra/auth/mfaPlataforma.ts
import * as OTPAuth from "otpauth";

const PERIOD = 30; // igual que src/infra/auth/mfa.ts

export function verificarYCalcularContador(
  secretoBase32: string, codigo: string,
): { valido: boolean; contadorAceptado: number | null } {
  const timestamp = Date.now(); // mismo valor para validate() y para el calculo de abajo
  const totp = new OTPAuth.TOTP({
    issuer: "ChainPulse", algorithm: "SHA1", digits: 6, period: PERIOD,
    secret: OTPAuth.Secret.fromBase32(secretoBase32),
  });
  const delta = totp.validate({ token: codigo, timestamp, window: 1 }); // number | null
  if (delta === null) return { valido: false, contadorAceptado: null };

  // Contador ABSOLUTO -- "numero de periodos de 30s desde el timestamp
  // 0", la misma definicion que usa internamente TOTP.counter() de
  // otpauth -- no el delta relativo a "ahora", que no es comparable de
  // una llamada a la siguiente.
  const contadorAceptado = Math.floor(timestamp / 1000 / PERIOD) + delta;
  return { valido: true, contadorAceptado };
}
```

El contador absoluto es monótonamente creciente en el tiempo real; el `delta` crudo no lo es (es relativo al instante de cada llamada, y dos verificaciones en períodos de 30 segundos distintos pueden recibir el mismo `delta`). Pasar el `delta` crudo a `consumir_contador_totp_plataforma()` rompería la comparación `p_contador > "mfaUltimoContadorUsado"`, que exige un identificador estable de período real.

**Prueba de concurrencia obligatoria:** dos llamadas simultáneas a `consumir_contador_totp_plataforma()` con idéntico `p_contador` deben resultar en exactamente una `true` y una `false` — nunca dos `true`, nunca dos `false`.

### 6.8 CSRF, Origin/Host

Toda ruta de escritura de plataforma exige `Content-Type: application/json` (rechaza `multipart/form-data` y `application/x-www-form-urlencoded`) y cookies `sameSite=strict`. Adicionalmente, se valida la cabecera `Origin` contra una lista explícita de hosts permitidos (`PLATAFORMA_ORIGENES_PERMITIDOS`, variable de entorno) — si `Origin` está presente y no coincide, rechazo `403`. Si `Origin` está ausente (ocurre legítimamente en algunas configuraciones same-origin), se exige en su lugar que `Host` coincida con el host esperado de despliegue; si ninguna de las dos cabeceras es verificable, la request se rechaza.

### 6.9 Límites de tasa — valores cerrados

**Capas independientes, cada una con su propio mecanismo y umbral, nunca compartidas entre sí:**

| Capa | Mecanismo | Alcance | Umbral |
|---|---|---|---|
| Por cuenta | `intentosFallidos`/`bloqueadoHasta` en `usuarios_plataforma`, vía `registrar_intento_fallido_plataforma()` (§6.6) | Un `email` específico, sin importar la huella de origen | **5 intentos fallidos → bloqueo de 15 minutos** |
| Por huella, login | `BucketLimiteTasa.LOGIN_PLATAFORMA` | Una huella de origen, a través de cualquier cantidad de emails distintos | **10 intentos por huella en una ventana de 15 minutos** |
| Por huella, verificación MFA | `BucketLimiteTasa.VERIFICACION_MFA_PLATAFORMA` | Una huella de origen, intentos de código TOTP | **5 intentos por huella en una ventana de 15 minutos** |

Ambos buckets nuevos usan una ventana de **exactamente un bucket de 15 minutos** (no la ventana deslizante de 60 minutos/4 buckets que usan `INICIO_EVALUACION`/`DESBLOQUEO_DETALLE`): el umbral pedido es "en 15 minutos", que coincide exactamente con `BUCKET_MINUTOS_LIMITE_TASA`, así que el bucket vigente ES la ventana completa, sin necesidad de sumar varios.

**Extensión aditiva y retrocompatible de `registrarIntento()`** (el parámetro nuevo tiene un valor por defecto que preserva el comportamiento ya existente para `INICIO_EVALUACION`/`DESBLOQUEO_DETALLE`):

```typescript
// src/infra/rateLimit/limiteTasa.ts — firma ampliada
export async function registrarIntento(
  huellaOrigenHash: string,
  bucket: BucketLimiteTasa,
  limite: number,
  ahora: Date,
  prisma: PrismaClient,
  ventanaEnBuckets: number = BUCKETS_POR_VENTANA_LIMITE_TASA, // nuevo, default = 4 (comportamiento previo intacto)
): Promise<{ contador: number; permitido: boolean }> {
  const ventanaInicio = truncarVentanaBucket(ahora);
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "limite_tasa" ("id", "huellaOrigenHash", "bucket", "ventanaInicio", "contador")
    VALUES (${id}, ${huellaOrigenHash}, ${bucket}::"BucketLimiteTasa", ${ventanaInicio}, 1)
    ON CONFLICT ("huellaOrigenHash", "bucket", "ventanaInicio")
    DO UPDATE SET "contador" = "limite_tasa"."contador" + 1
  `;
  const inicioVentanaDeslizante = new Date(
    ventanaInicio.getTime() - (ventanaEnBuckets - 1) * BUCKET_MINUTOS_LIMITE_TASA * 60_000,
  );
  const filas = await prisma.$queryRaw<{ total: bigint | number | null }[]>`
    SELECT COALESCE(SUM("contador"), 0) AS total FROM "limite_tasa"
    WHERE "huellaOrigenHash" = ${huellaOrigenHash} AND "bucket" = ${bucket}::"BucketLimiteTasa"
      AND "ventanaInicio" >= ${inicioVentanaDeslizante} AND "ventanaInicio" <= ${ventanaInicio}
  `;
  const contador = Number(filas[0]?.total ?? 0);
  return { contador, permitido: contador <= limite };
}
```

**Tipo TypeScript `BucketLimiteTasa` ampliado** (debe incluir los dos valores nuevos; ya estaba incompleto respecto del enum real de Prisma antes de esta adenda, que agrega exactamente estos dos):

```typescript
export type BucketLimiteTasa = "INICIO_EVALUACION" | "DESBLOQUEO_DETALLE" | "LOGIN_PLATAFORMA" | "VERIFICACION_MFA_PLATAFORMA";
```

**Constantes y cálculo de `Retry-After`:**

```typescript
// src/infra/rateLimit/limitesPlataforma.ts
import { truncarVentanaBucket, BUCKET_MINUTOS_LIMITE_TASA } from "./huella";

export const LIMITE_LOGIN_PLATAFORMA_POR_HUELLA = 10;
export const LIMITE_VERIFICACION_MFA_PLATAFORMA_POR_HUELLA = 5;

/**
 * Como ambos buckets de plataforma usan ventana = 1 bucket de 15 min, el
 * fin de la ventana vigente es, exactamente, el fin del bucket actual --
 * nunca depende de cual de varios buckets sumados "se vencera primero"
 * (ese caso solo existiria con una ventana deslizante de varios buckets,
 * que estos dos NO usan).
 */
export function calcularRetryAfterSegundos(ahora: Date): number {
  const ventanaInicio = truncarVentanaBucket(ahora);
  const finVentana = new Date(ventanaInicio.getTime() + BUCKET_MINUTOS_LIMITE_TASA * 60_000);
  return Math.max(1, Math.ceil((finVentana.getTime() - ahora.getTime()) / 1000));
}
```

**Respuesta uniforme de límite excedido, en ambas rutas (login y verificación MFA):**

```typescript
return NextResponse.json(
  { ok: false, error: "LIMITE_TASA_EXCEDIDO" },
  { status: 429, headers: { "Retry-After": String(calcularRetryAfterSegundos(ahora)) } },
);
```

**Punto de llamada en la ruta de verificación de MFA** (mismo patrón que §6.5 para login, bucket distinto):

```typescript
// src/app/api/plataforma/mfa/verificar/route.ts (extracto relevante)
const limiteHuellaMfa = await registrarIntento(
  huellaHash, "VERIFICACION_MFA_PLATAFORMA", LIMITE_VERIFICACION_MFA_PLATAFORMA_POR_HUELLA, ahora, prisma, 1,
);
if (!limiteHuellaMfa.permitido) {
  return NextResponse.json(
    { ok: false, error: "LIMITE_TASA_EXCEDIDO" },
    { status: 429, headers: { "Retry-After": String(calcularRetryAfterSegundos(ahora)) } },
  );
}
```

**Pruebas obligatorias:**
1. **Umbral exacto, login:** 10 llamadas a `registrarIntento(huella, "LOGIN_PLATAFORMA", 10, ahora, prisma, 1)` con la misma huella y el mismo bucket de 15 minutos devuelven `permitido = true`; la 11.ª devuelve `permitido = false`.
2. **Umbral exacto, MFA:** idéntica prueba con `"VERIFICACION_MFA_PLATAFORMA"` y límite `5` — la 6.ª llamada devuelve `permitido = false`.
3. **Aislamiento entre buckets (obligatoria, nueva):** para una misma huella, agotar completamente el bucket `LOGIN_PLATAFORMA` (10 llamadas) y a continuación hacer una llamada a `registrarIntento` con `"VERIFICACION_MFA_PLATAFORMA"` sobre la misma huella — debe devolver `contador = 1, permitido = true`, nunca arrastrar ni verse afectada por el conteo de `LOGIN_PLATAFORMA`. Prueba simétrica en el sentido inverso (agotar `VERIFICACION_MFA_PLATAFORMA`, confirmar que `LOGIN_PLATAFORMA` sigue en `contador = 0` para esa huella). Esto es una consecuencia directa de que cada fila de `limite_tasa` se identifica por la clave `(huellaOrigenHash, bucket, ventanaInicio)` — bucket distinto es, por construcción, fila distinta — pero se prueba explícitamente en vez de asumirse.
4. **`Retry-After` correcto:** con `ahora` fijado a un instante conocido dentro de un bucket de 15 minutos (p. ej. 3 minutos después del inicio del bucket), `calcularRetryAfterSegundos(ahora)` debe devolver `12 * 60 = 720` segundos (los 12 minutos restantes del bucket), con un margen de redondeo hacia arriba de como mucho 1 segundo.
5. **Independencia del límite por cuenta:** agotar el bucket `LOGIN_PLATAFORMA` para una huella no afecta `intentosFallidos` de ninguna cuenta, y agotar `intentosFallidos` de una cuenta (bloqueo por cuenta) no afecta el contador de `LOGIN_PLATAFORMA` de ninguna huella.

---

## 7. RF20 — Gobernanza de versiones del cuestionario

### 7.1 Ciclo de vida

```
(no existe) --crear_cuestionario_version()--> BORRADOR
BORRADOR --corregir_cuestionario_version(origen) + N x crear_pregunta_version()--> (nueva fila) BORRADOR
BORRADOR --[crear/editar/reordenar/eliminar pregunta]--> BORRADOR  [nunca cambia de estado]
BORRADOR --publicar_cuestionario_version()--> PUBLICADA  [la PUBLICADA anterior, si existía, pasa a RETIRADA en la misma transacción]
PUBLICADA --[retiro implícito al publicar la siguiente, o retiro manual]--> RETIRADA
```

### 7.2 Campos editables por estado

| Campo | `BORRADOR` | `PUBLICADA` | `RETIRADA` |
|---|---|---|---|
| `CuestionarioVersion.notasCambio` | editable vía `editar_metadata_cuestionario_version` | no editable | no editable |
| `CuestionarioVersion.estado` | solo avanza vía `publicar_cuestionario_version` | solo avanza vía retiro | terminal |
| `CuestionarioVersion.codigo`/`numero` | fijados al crear | — | — |
| `PreguntaVersion` (cualquier campo) | editable vía §7.3.2 | no editable | no editable |
| `PreguntaVersion.orden` (todas a la vez) | editable vía `reordenar_preguntas_version` | — | — |

### 7.3 `crear_cuestionario_version()`

```sql
DROP FUNCTION IF EXISTS public.crear_cuestionario_version(text, text, text);

CREATE FUNCTION public.crear_cuestionario_version(p_id text, p_codigo text, p_curador_id text)
RETURNS TABLE(numero integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_siguiente_numero integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_codigo));

  SELECT COALESCE(max(numero), 0) + 1 INTO v_siguiente_numero
  FROM public.cuestionario_versiones WHERE codigo = p_codigo;

  INSERT INTO public.cuestionario_versiones (id, codigo, numero, estado, "curadorId")
  VALUES (p_id, p_codigo, v_siguiente_numero, 'BORRADOR', p_curador_id);

  RETURN QUERY SELECT v_siguiente_numero;
END;
$$;

ALTER FUNCTION public.crear_cuestionario_version(text, text, text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.crear_cuestionario_version(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crear_cuestionario_version(text, text, text) TO chainpulse_app;
```

**Prueba:** dos llamadas concurrentes con el mismo `p_codigo` (y `p_id` distinto, generado por TypeScript antes de cada llamada) deben producir `numero = 1` y `numero = 2`, nunca dos filas con `numero = 1` — garantizado por `pg_advisory_xact_lock(hashtext(p_codigo))`, que serializa ambas transacciones sobre el mismo código.

### 7.4 `corregir_cuestionario_version()` — crea el borrador derivado; las preguntas se copian con `crear_pregunta_version()`

```sql
DROP FUNCTION IF EXISTS public.corregir_cuestionario_version(text, text, text, text);

CREATE FUNCTION public.corregir_cuestionario_version(
  p_id_nueva_version text, p_id_evento_correccion text,
  p_version_origen_id text, p_curador_id text
)
RETURNS TABLE(numero integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_codigo text;
  v_siguiente_numero integer;
BEGIN
  SELECT codigo INTO v_codigo FROM public.cuestionario_versiones
  WHERE id = p_version_origen_id FOR UPDATE;

  IF v_codigo IS NULL THEN
    RAISE EXCEPTION 'RF20_ORIGEN_INEXISTENTE: version origen % no existe', p_version_origen_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_codigo));

  SELECT COALESCE(max(numero), 0) + 1 INTO v_siguiente_numero
  FROM public.cuestionario_versiones WHERE codigo = v_codigo;

  INSERT INTO public.cuestionario_versiones (id, codigo, numero, estado, "curadorId")
  VALUES (p_id_nueva_version, v_codigo, v_siguiente_numero, 'BORRADOR', p_curador_id);

  INSERT INTO public.bitacora_version_cuestionario
    (id, "cuestionarioVersionId", "actorId", accion, "versionOrigenId", "createdAt")
  VALUES (p_id_evento_correccion, p_id_nueva_version, p_curador_id, 'CORREGIR', p_version_origen_id, now());

  RETURN QUERY SELECT v_siguiente_numero;
END;
$$;

ALTER FUNCTION public.corregir_cuestionario_version(text, text, text, text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.corregir_cuestionario_version(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.corregir_cuestionario_version(text, text, text, text) TO chainpulse_app;
```

Esta función crea únicamente la fila de versión nueva (vacía) y el evento `CORREGIR`. La copia de las preguntas del origen se hace en TypeScript, dentro de la misma transacción interactiva de Prisma, reutilizando `crear_pregunta_version()` (§7.5) en un bucle — así ambas rutas de inserción de pregunta (crear directamente, o copiar desde un origen) comparten exactamente la misma función y las mismas validaciones, sin duplicar lógica:

```typescript
// src/infra/rf20/corregirVersion.ts
export async function corregirCuestionarioVersion(
  prisma: PrismaClient, versionOrigenId: string, curadorId: string,
): Promise<{ id: string; numero: number }> {
  return prisma.$transaction(async (tx) => {
    const idNuevaVersion = generarCuid();
    const idEvento = generarCuid();

    const [{ numero }] = await tx.$queryRaw<{ numero: number }[]>`
      SELECT * FROM corregir_cuestionario_version(${idNuevaVersion}, ${idEvento}, ${versionOrigenId}, ${curadorId})
    `;

    const preguntasOrigen = await tx.preguntaVersion.findMany({
      where: { cuestionarioVersionId: versionOrigenId },
    });

    for (const p of preguntasOrigen) {
      const idPregunta = generarCuid();
      await tx.$queryRaw`
        SELECT * FROM crear_pregunta_version(
          ${idPregunta}, ${idNuevaVersion}, ${p.codigo}, ${p.orden}, ${p.texto},
          ${p.dimension}, ${p.opciones}::jsonb, ${p.esNoPuntuable}
        )
      `;
    }

    return { id: idNuevaVersion, numero };
  });
}
```

La nueva versión queda en `BORRADOR` — nunca se autopublica.

**Prueba:** tras `corregirCuestionarioVersion()` sobre un origen con N preguntas, la nueva versión tiene exactamente N preguntas, cada una con un `id` distinto del de su pregunta origen (formato CUID en ambos casos, nunca UUID), y existe exactamente un evento `CORREGIR` en la bitácora para la nueva versión, con `versionOrigenId` igual al origen.

### 7.5 Funciones de edición de contenido en `BORRADOR`

```sql
DROP FUNCTION IF EXISTS public.crear_pregunta_version(text, text, text, integer, text, text, jsonb, boolean);

CREATE FUNCTION public.crear_pregunta_version(
  p_id text, p_version_id text, p_codigo text, p_orden integer, p_texto text,
  p_dimension text, p_opciones jsonb, p_es_no_puntuable boolean
)
RETURNS TABLE(ok boolean, motivo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_estado text;
  v_dimension_valida public."DimensionDiagnosticoV2";
BEGIN
  SELECT estado INTO v_estado FROM public.cuestionario_versiones WHERE id = p_version_id FOR UPDATE;
  IF v_estado IS NULL OR v_estado <> 'BORRADOR' THEN
    RETURN QUERY SELECT false, 'VERSION_NO_ES_BORRADOR'; RETURN;
  END IF;

  -- Conversion EXPLICITA y VALIDADA del texto recibido al enum real --
  -- nunca se asume que p_dimension ya es un valor valido: un texto que
  -- no coincide con ningun valor de DimensionDiagnosticoV2 produce un
  -- error de aplicacion identificable, nunca una excepcion cruda de
  -- Postgres propagada sin clasificar.
  BEGIN
    v_dimension_valida := p_dimension::public."DimensionDiagnosticoV2";
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN QUERY SELECT false, 'DIMENSION_INVALIDA'; RETURN;
  END;

  INSERT INTO public.pregunta_versiones
    (id, "cuestionarioVersionId", codigo, orden, texto, dimension, opciones, "esNoPuntuable")
  VALUES (p_id, p_version_id, p_codigo, p_orden, p_texto, v_dimension_valida, p_opciones, p_es_no_puntuable);

  RETURN QUERY SELECT true, 'OK';
END;
$$;

ALTER FUNCTION public.crear_pregunta_version(text, text, text, integer, text, text, jsonb, boolean) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.crear_pregunta_version(text, text, text, integer, text, text, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crear_pregunta_version(text, text, text, integer, text, text, jsonb, boolean) TO chainpulse_app;


DROP FUNCTION IF EXISTS public.editar_pregunta_version(text, text, text, jsonb, boolean);

CREATE FUNCTION public.editar_pregunta_version(
  p_pregunta_id text, p_texto text, p_dimension text, p_opciones jsonb, p_es_no_puntuable boolean
)
RETURNS TABLE(ok boolean, motivo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_version_id text;
  v_estado text;
  v_dimension_valida public."DimensionDiagnosticoV2";
BEGIN
  SELECT "cuestionarioVersionId" INTO v_version_id FROM public.pregunta_versiones WHERE id = p_pregunta_id;
  IF v_version_id IS NULL THEN RETURN QUERY SELECT false, 'PREGUNTA_INEXISTENTE'; RETURN; END IF;

  SELECT estado INTO v_estado FROM public.cuestionario_versiones WHERE id = v_version_id FOR UPDATE;
  IF v_estado IS NULL OR v_estado <> 'BORRADOR' THEN
    RETURN QUERY SELECT false, 'VERSION_NO_ES_BORRADOR'; RETURN;
  END IF;

  BEGIN
    v_dimension_valida := p_dimension::public."DimensionDiagnosticoV2";
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN QUERY SELECT false, 'DIMENSION_INVALIDA'; RETURN;
  END;

  UPDATE public.pregunta_versiones
  SET texto = p_texto, dimension = v_dimension_valida, opciones = p_opciones, "esNoPuntuable" = p_es_no_puntuable
  WHERE id = p_pregunta_id;

  RETURN QUERY SELECT true, 'OK';
END;
$$;

ALTER FUNCTION public.editar_pregunta_version(text, text, text, jsonb, boolean) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.editar_pregunta_version(text, text, text, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.editar_pregunta_version(text, text, text, jsonb, boolean) TO chainpulse_app;


DROP FUNCTION IF EXISTS public.eliminar_pregunta_version(text);

CREATE FUNCTION public.eliminar_pregunta_version(p_pregunta_id text)
RETURNS TABLE(ok boolean, motivo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_version_id text;
  v_estado text;
BEGIN
  SELECT "cuestionarioVersionId" INTO v_version_id FROM public.pregunta_versiones WHERE id = p_pregunta_id;
  IF v_version_id IS NULL THEN RETURN QUERY SELECT false, 'PREGUNTA_INEXISTENTE'; RETURN; END IF;

  SELECT estado INTO v_estado FROM public.cuestionario_versiones WHERE id = v_version_id FOR UPDATE;
  IF v_estado IS NULL OR v_estado <> 'BORRADOR' THEN
    RETURN QUERY SELECT false, 'VERSION_NO_ES_BORRADOR'; RETURN;
  END IF;

  DELETE FROM public.pregunta_versiones WHERE id = p_pregunta_id;
  RETURN QUERY SELECT true, 'OK';
END;
$$;

ALTER FUNCTION public.eliminar_pregunta_version(text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.eliminar_pregunta_version(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eliminar_pregunta_version(text) TO chainpulse_app;


DROP FUNCTION IF EXISTS public.editar_metadata_cuestionario_version(text, text);

CREATE FUNCTION public.editar_metadata_cuestionario_version(p_version_id text, p_notas_cambio text)
RETURNS TABLE(ok boolean, motivo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_estado text;
BEGIN
  SELECT estado INTO v_estado FROM public.cuestionario_versiones WHERE id = p_version_id FOR UPDATE;
  IF v_estado IS NULL THEN RETURN QUERY SELECT false, 'VERSION_INEXISTENTE'; RETURN; END IF;
  IF v_estado <> 'BORRADOR' THEN RETURN QUERY SELECT false, 'VERSION_NO_ES_BORRADOR'; RETURN; END IF;
  UPDATE public.cuestionario_versiones SET "notasCambio" = p_notas_cambio WHERE id = p_version_id;
  RETURN QUERY SELECT true, 'OK';
END;
$$;

ALTER FUNCTION public.editar_metadata_cuestionario_version(text, text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.editar_metadata_cuestionario_version(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.editar_metadata_cuestionario_version(text, text) TO chainpulse_app;
```

Ninguna de estas cuatro funciones escribe en `bitacora_version_cuestionario`: la bitácora registra transiciones de gobernanza de la versión como un todo (creación derivada, publicación, retiro), no el historial de edición línea por línea de un borrador todavía no publicado. Si en el futuro se quisiera auditoría granular por edición de pregunta, eso requeriría una entidad y unas acciones distintas, fuera del alcance de RF19/RF20 tal como fueron pedidos.

**Pruebas, una por función:** caso de éxito en `BORRADOR`; caso de rechazo con `VERSION_NO_ES_BORRADOR` sobre una versión `PUBLICADA` o `RETIRADA`, confirmando que ninguna fila cambió; para `crear_pregunta_version`/`editar_pregunta_version`, un caso adicional con `p_dimension` inválido (p. ej. `'NO_EXISTE'`) que confirme `motivo = 'DIMENSION_INVALIDA'` sin excepción propagada ni fila escrita/modificada.

### 7.6 `reordenar_preguntas_version()`

```sql
DROP FUNCTION IF EXISTS public.reordenar_preguntas_version(text, jsonb);

CREATE FUNCTION public.reordenar_preguntas_version(p_version_id text, p_ordenes jsonb)
RETURNS TABLE(reordenado boolean, motivo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_estado text;
  v_ids_recibidos text[];
  v_ids_esperados text[];
  v_ordenes_recibidos integer[];
  v_entrada jsonb;
BEGIN
  SELECT estado INTO v_estado FROM public.cuestionario_versiones WHERE id = p_version_id FOR UPDATE;
  IF v_estado IS NULL OR v_estado <> 'BORRADOR' THEN
    RETURN QUERY SELECT false, 'VERSION_NO_ES_BORRADOR'; RETURN;
  END IF;

  IF p_ordenes IS NULL OR jsonb_typeof(p_ordenes) <> 'array' OR jsonb_array_length(p_ordenes) = 0 THEN
    RETURN QUERY SELECT false, 'PAYLOAD_VACIO_O_INVALIDO'; RETURN;
  END IF;

  SELECT array_agg(e->>'id'), array_agg((e->>'orden')::integer)
  INTO v_ids_recibidos, v_ordenes_recibidos
  FROM jsonb_array_elements(p_ordenes) e;

  -- Sin IDs duplicados en el payload recibido.
  IF (SELECT count(DISTINCT x) FROM unnest(v_ids_recibidos) x) <> array_length(v_ids_recibidos, 1) THEN
    RETURN QUERY SELECT false, 'IDS_DUPLICADOS_EN_PAYLOAD'; RETURN;
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_ids_esperados
  FROM public.pregunta_versiones WHERE "cuestionarioVersionId" = p_version_id;

  -- El conjunto recibido debe ser EXACTAMENTE el conjunto de preguntas de
  -- esta version: ni IDs desconocidos, ni preguntas faltantes. Ningun ID
  -- desconocido se ignora silenciosamente: cualquier discrepancia aborta
  -- antes de escribir nada.
  IF (SELECT array_agg(x ORDER BY x) FROM unnest(v_ids_recibidos) x) IS DISTINCT FROM v_ids_esperados THEN
    RETURN QUERY SELECT false, 'CONJUNTO_DE_PREGUNTAS_NO_COINCIDE'; RETURN;
  END IF;

  -- Ordenes: enteros positivos, secuencia exacta 1..N sin huecos ni duplicados.
  IF EXISTS (SELECT 1 FROM unnest(v_ordenes_recibidos) o WHERE o IS NULL OR o < 1) THEN
    RETURN QUERY SELECT false, 'ORDEN_NO_POSITIVO'; RETURN;
  END IF;
  IF (SELECT array_agg(o ORDER BY o) FROM unnest(v_ordenes_recibidos) o)
     <> (SELECT array_agg(g) FROM generate_series(1, array_length(v_ordenes_recibidos, 1)) g) THEN
    RETURN QUERY SELECT false, 'SECUENCIA_CON_HUECOS_O_DUPLICADOS'; RETURN;
  END IF;

  FOR v_entrada IN SELECT * FROM jsonb_array_elements(p_ordenes) LOOP
    UPDATE public.pregunta_versiones
    SET orden = (v_entrada->>'orden')::integer
    WHERE id = (v_entrada->>'id') AND "cuestionarioVersionId" = p_version_id;
  END LOOP;

  RETURN QUERY SELECT true, 'OK';
END;
$$;

ALTER FUNCTION public.reordenar_preguntas_version(text, jsonb) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.reordenar_preguntas_version(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reordenar_preguntas_version(text, jsonb) TO chainpulse_app;
```

**Invariantes verificados, en orden, antes de escribir cualquier fila:** (1) la versión existe y está en `BORRADOR`; (2) el payload es un array JSON no vacío; (3) ningún `id` está duplicado dentro del payload; (4) el conjunto de `id` recibidos es exactamente igual —ni más, ni menos— al conjunto real de preguntas de la versión; (5) todo `orden` recibido es un entero positivo; (6) la secuencia completa de órdenes recibidos, ordenada, es exactamente `1..N` sin huecos ni duplicados, donde `N` es la cantidad de preguntas. Solo si las seis se cumplen se ejecuta el bucle de `UPDATE`.

**Pruebas obligatorias:** caso de éxito con un reordenamiento válido; payload vacío; payload con un `id` duplicado; payload con un `id` que no pertenece a la versión; payload que omite una pregunta real de la versión; payload con un `orden` repetido; payload con un hueco en la secuencia (p. ej. `1, 2, 4` para 3 preguntas); en cada caso de rechazo, confirmar que ningún `orden` de ninguna pregunta de la versión cambió.

### 7.7 Bitácora — modelo, tabla y semántica

**Tabla nueva, de punta a punta** (no existe hoy en ninguna forma):

```prisma
model BitacoraVersionCuestionario {
  id                    String               @id
  cuestionarioVersionId String
  cuestionarioVersion   CuestionarioVersion  @relation("BitacoraDeVersion", fields: [cuestionarioVersionId], references: [id], onDelete: Restrict)
  versionOrigenId       String?
  versionOrigen         CuestionarioVersion? @relation("BitacoraOrigenDeVersion", fields: [versionOrigenId], references: [id], onDelete: Restrict)
  actorId               String
  actor                 UsuarioPlataforma    @relation(fields: [actorId], references: [id], onDelete: Restrict)
  accion                AccionBitacoraVersion
  createdAt             DateTime             @default(now())

  @@index([cuestionarioVersionId])
  @@index([actorId])
  @@map("bitacora_version_cuestionario")
}

enum AccionBitacoraVersion {
  CORREGIR
  PUBLICAR
  RETIRAR
}

model CuestionarioVersion {
  // ...campos ya existentes, sin cambios...
  bitacoraComoVersion BitacoraVersionCuestionario[] @relation("BitacoraDeVersion")
  bitacoraComoOrigen  BitacoraVersionCuestionario[] @relation("BitacoraOrigenDeVersion")
}

model UsuarioPlataforma {
  // ...campos ya existentes, mas activo/sessionVersion/mfaUltimoContadorUsado (§9.2)...
  bitacorasVersion BitacoraVersionCuestionario[]
}
```

`id` sin `@default(cuid())`: esta tabla solo se escribe desde las funciones `SECURITY DEFINER` (§4.1 revoca `INSERT` directo a `chainpulse_app`), así que un default de Prisma nunca se activaría de todas formas. `onDelete: Restrict` en las tres relaciones: la bitácora es un registro histórico que nunca debe quedar huérfano por un borrado en cascada accidental.

**Semántica cerrada de los tres eventos:**
- **`CORREGIR`**: exactamente una vez por llamada exitosa a `corregir_cuestionario_version()`. `versionOrigenId` siempre presente.
- **`PUBLICAR`**: exactamente una vez por llamada exitosa a `publicar_cuestionario_version()`. `versionOrigenId` siempre `NULL`.
- **`RETIRAR`**: exactamente una vez por versión que deja de estar `PUBLICADA` (implícito al publicar la siguiente, o manual vía `retirar_cuestionario_version()`). `versionOrigenId` siempre `NULL`.
- **Versión sembrada** (la cargada por el seed inicial, posiblemente ya usada en producción): nunca recibe `PUBLICAR` (nunca pasó por el flujo gobernado). Recibe exactamente un `RETIRAR` cuando la primera versión gobernada se publique por primera vez — generado genéricamente por `publicar_cuestionario_version()`, sin caso especial para "si la anterior era la sembrada": la función simplemente retira la que esté vigente, sea cual sea su origen. Ese evento documenta solo la transición de estado, con el `actorId` de quien ejecutó la publicación nueva — nunca implica que ese actor haya creado el contenido original de la versión sembrada.

**Pruebas:** la tabla existe con el `@@map` y las tres FKs exactas (verificado por consulta a `information_schema`); un ciclo completo crear→corregir→publicar→(publicar siguiente) produce exactamente los eventos descritos arriba, en el orden descrito, sin eventos adicionales ni faltantes; ninguna de las cuatro funciones de §7.5 escribe ninguna fila en esta tabla bajo ninguna circunstancia.

### 7.8 `publicar_cuestionario_version()` — con validación JSON autoritativa previa y el bloque de validación Q1–Q7 completo, inline

Cada opción de `PreguntaVersion.opciones` es, en el cuestionario real (`prisma/seedCuestionarioV2.ts`, `interface OpcionPregunta { valor: string; texto: string; orden: number }`), un objeto con exactamente tres campos: `valor` (código estable), `texto` (etiqueta visible) y `orden` (posición 0-based). `RespuestaPreguntaV2.indiceOpcion` —lo único que el motor v2 realmente consume— se toma del campo `orden` de la opción elegida, nunca de la posición cruda del arreglo JSON (ver comentario de `prisma/seedCuestionarioV2.ts`: "cualquier reordenamiento aca sin el mismo cambio alla desalinea silenciosamente el motor"). No existe, en el esquema real ni en el motor, ningún campo `esGatilloAlineacion`: ese campo booleano no está en `OpcionPregunta`, no lo escribe el seed, y ninguna función del motor lo lee. El marcador estable y real de la pregunta `Q1` ("promesa no claramente definida") es la opción con `orden = 7` cuyo `valor` es literalmente `'no_definida'` ("No está claramente definido") — la misma opción que `src/engine/v2/alineacion.ts` dispara vía `esQ1Gatillo(q1) = q1.noSabe || q1.indiceOpcion === Q1_INDICE_PROMESA_NO_DEFINIDA`, con `Q1_INDICE_PROMESA_NO_DEFINIDA = 7` en `src/engine/v2/constantes.ts`. `Q2`/`Q3` requieren exactamente 5 opciones (`ESTADOS_POR_DIMENSION.ALINEACION` tiene 5 estados cerrados; `Q3` solo afecta `missingEvidence` vía `UMBRAL_BRECHA_CONTRADICCION_ALINEACION = 2` sobre `|Q3.indiceOpcion − Q2.indiceOpcion|`, nunca cambia el estado calculado). `Q4`/`Q6`/`Q7` (dimensiones Coordinación/Evidencia/Resiliencia, vía `calcularDimensionSimple()`) y la parte puntuable de `Q5` (Integración) requieren, cada una, exactamente 5 opciones. `Q5-fuente` (subpregunta contextual de Q5, marcada `esNoPuntuable = true` y nunca usada por el motor) **no es una subpregunta de texto libre**: tiene, en el seed real, exactamente 6 opciones estructuradas cerradas (`sap_erp`, `excel`, `wms_tms_aps`, `correo_mensajeria`, `varios_sistemas`, `sin_fuente_definida`), con la misma forma `{valor, texto, orden}` que cualquier otra pregunta.

Antes de que cualquier regla anterior pueda evaluarse con `jsonb_array_length`, `jsonb_array_elements` o un cast sobre `opciones`, cada pregunta de la versión pasa por una validación JSON autoritativa de su estructura, en una función dedicada y reutilizable:

```sql
DROP FUNCTION IF EXISTS public.validar_estructura_opciones_pregunta(jsonb);

CREATE FUNCTION public.validar_estructura_opciones_pregunta(p_opciones jsonb)
RETURNS TABLE(valido boolean, motivo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_elemento jsonb;
  v_valores text[] := '{}';
  v_ordenes integer[] := '{}';
  v_orden_num numeric;
  v_n integer;
BEGIN
  -- 1. Tipo raiz: debe ser un array JSON. jsonb_typeof() nunca lanza
  -- excepcion sobre ningun valor jsonb (ni sobre NULL de SQL, donde
  -- devuelve NULL de SQL) -- es la unica comprobacion de esta funcion
  -- que se ejecuta ANTES de saber que p_opciones es efectivamente un
  -- array; ninguna otra funcion de jsonb (length, elements) se llama
  -- todavia en este punto.
  IF p_opciones IS NULL OR jsonb_typeof(p_opciones) <> 'array' THEN
    RETURN QUERY SELECT false, 'OPCIONES_NO_ES_ARRAY'; RETURN;
  END IF;

  -- A partir de aqui jsonb_array_length/jsonb_array_elements son
  -- seguras: el tipo raiz ya quedo confirmado como 'array'.
  IF jsonb_array_length(p_opciones) = 0 THEN
    RETURN QUERY SELECT false, 'OPCIONES_VACIO'; RETURN;
  END IF;

  -- 2. Cada elemento: objeto, con valor/texto (string no vacio) y orden
  -- (entero >= 0). Ningun campo se castea sin haber comprobado antes su
  -- tipo real con jsonb_typeof -- incluido cualquier campo booleano
  -- adicional que un futuro cambio pudiera agregar a OpcionPregunta
  -- (hoy, ninguno: valor/texto/orden son los tres unicos campos reales).
  -- Un futuro campo booleano deberia comprobarse asi, nunca con un cast
  -- directo "(x->>'campo')::boolean":
  --   IF v_elemento ? 'campoNuevo' AND jsonb_typeof(v_elemento->'campoNuevo') <> 'boolean' THEN
  --     RETURN QUERY SELECT false, 'OPCIONES_CAMPO_BOOLEANO_TIPO_INVALIDO'; RETURN;
  --   END IF;
  FOR v_elemento IN SELECT value FROM jsonb_array_elements(p_opciones)
  LOOP
    IF jsonb_typeof(v_elemento) <> 'object' THEN
      RETURN QUERY SELECT false, 'OPCIONES_ELEMENTO_NO_ES_OBJETO'; RETURN;
    END IF;

    IF jsonb_typeof(v_elemento->'valor') <> 'string' OR btrim(v_elemento->>'valor') = '' THEN
      RETURN QUERY SELECT false, 'OPCIONES_VALOR_INVALIDO'; RETURN;
    END IF;

    IF jsonb_typeof(v_elemento->'texto') <> 'string' OR btrim(v_elemento->>'texto') = '' THEN
      RETURN QUERY SELECT false, 'OPCIONES_TEXTO_INVALIDO'; RETURN;
    END IF;

    IF jsonb_typeof(v_elemento->'orden') <> 'number' THEN
      RETURN QUERY SELECT false, 'OPCIONES_ORDEN_NO_ENTERO'; RETURN;
    END IF;
    -- jsonb_typeof ya confirmo 'number' para "orden": el cast a numeric
    -- que sigue es seguro y nunca lanza invalid_text_representation.
    v_orden_num := (v_elemento->>'orden')::numeric;
    IF v_orden_num <> trunc(v_orden_num) OR v_orden_num < 0 THEN
      RETURN QUERY SELECT false, 'OPCIONES_ORDEN_NO_ENTERO'; RETURN;
    END IF;

    v_valores := v_valores || (v_elemento->>'valor');
    v_ordenes := v_ordenes || v_orden_num::integer;
  END LOOP;

  -- 3. Sin "valor" duplicados.
  v_n := array_length(v_valores, 1);
  IF (SELECT count(DISTINCT x) FROM unnest(v_valores) x) <> v_n THEN
    RETURN QUERY SELECT false, 'OPCIONES_VALOR_DUPLICADO'; RETURN;
  END IF;

  -- 4. Sin "orden" duplicados.
  IF (SELECT count(DISTINCT x) FROM unnest(v_ordenes) x) <> v_n THEN
    RETURN QUERY SELECT false, 'OPCIONES_ORDEN_DUPLICADO'; RETURN;
  END IF;

  -- 5. "orden" forma exactamente el conjunto 0..N-1, sin huecos.
  IF (SELECT array_agg(x ORDER BY x) FROM unnest(v_ordenes) x)
     <> (SELECT array_agg(g) FROM generate_series(0, v_n - 1) g) THEN
    RETURN QUERY SELECT false, 'OPCIONES_ORDEN_NO_CONTIGUO'; RETURN;
  END IF;

  RETURN QUERY SELECT true, 'OK';
END;
$$;

ALTER FUNCTION public.validar_estructura_opciones_pregunta(jsonb) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.validar_estructura_opciones_pregunta(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validar_estructura_opciones_pregunta(jsonb) TO chainpulse_app;
```

**Pruebas obligatorias de `validar_estructura_opciones_pregunta()`, una por motivo de rechazo:** `OPCIONES_NO_ES_ARRAY` (objeto, string, número, `NULL` de SQL, y el jsonb literal `null`); `OPCIONES_VACIO` (`'[]'::jsonb`); `OPCIONES_ELEMENTO_NO_ES_OBJETO` (array de strings); `OPCIONES_VALOR_INVALIDO` (campo ausente, número, string vacío o solo espacios); `OPCIONES_TEXTO_INVALIDO` (análogo); `OPCIONES_ORDEN_NO_ENTERO` (campo ausente, string, booleano, y número no entero como `1.5`); `OPCIONES_VALOR_DUPLICADO`; `OPCIONES_ORDEN_DUPLICADO`; `OPCIONES_ORDEN_NO_CONTIGUO` (con hueco, p. ej. `[0,1,3]`, y sin empezar en 0, p. ej. `[1,2,3]`); y un caso de éxito con la forma exacta de `Q1` sembrada en `prisma/seedCuestionarioV2.ts` (8 opciones, `orden` 0..7). Cada caso confirma que `jsonb_array_length`/`jsonb_array_elements` solo se invocan después de que `jsonb_typeof(p_opciones) = 'array'` se confirmó explícitamente — verificable leyendo el cuerpo de la función: ninguna de esas dos llamadas aparece antes del primer `IF`.

```sql
DROP FUNCTION IF EXISTS public.publicar_cuestionario_version(text, text, text, text, text);

CREATE FUNCTION public.publicar_cuestionario_version(
  p_version_id text, p_actor_id text, p_version_vigente_esperada_id text,
  p_id_evento_publicar text, p_id_evento_retiro text
)
RETURNS TABLE(publicada boolean, motivo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_estado text;
  v_codigo text;
  v_vigente_actual_id text;
  v_conteo_preguntas integer;
  v_conteo_codigos_distintos integer;
  v_ordenes integer[];
  v_cobertura_dimensiones integer;
  v_pregunta record;
  v_opciones_validas boolean;
  v_motivo_opciones text;
  v_valor_marcador_q1 text;
BEGIN
  -- 1. La version a publicar debe existir y estar en BORRADOR.
  SELECT estado, codigo INTO v_estado, v_codigo
  FROM public.cuestionario_versiones WHERE id = p_version_id FOR UPDATE;

  IF v_estado IS NULL THEN RETURN QUERY SELECT false, 'VERSION_INEXISTENTE'; RETURN; END IF;
  IF v_estado <> 'BORRADOR' THEN RETURN QUERY SELECT false, 'VERSION_NO_ES_BORRADOR'; RETURN; END IF;

  -- 2. Determinar la version vigente ACTUAL (puede no existir ninguna).
  SELECT id INTO v_vigente_actual_id
  FROM public.cuestionario_versiones
  WHERE codigo = v_codigo AND estado = 'PUBLICADA'
  FOR UPDATE;

  -- 3. Comparacion NULL-segura: "<>" con NULL nunca es verdadero en
  -- Postgres, asi que dejaria pasar sin detectar el caso "yo esperaba
  -- NULL pero ahora hay una version X". IS DISTINCT FROM si lo detecta.
  IF v_vigente_actual_id IS DISTINCT FROM p_version_vigente_esperada_id THEN
    RETURN QUERY SELECT false, 'VERSION_VIGENTE_CAMBIO'; RETURN;
  END IF;

  -- 4. Preguntas: deben existir, codigos unicos, orden completo 1..N sin
  -- huecos ni duplicados, texto no vacio, cobertura de las 5 dimensiones.
  SELECT count(*) INTO v_conteo_preguntas
  FROM public.pregunta_versiones WHERE "cuestionarioVersionId" = p_version_id;
  IF v_conteo_preguntas = 0 THEN RETURN QUERY SELECT false, 'SIN_PREGUNTAS'; RETURN; END IF;

  SELECT count(DISTINCT codigo) INTO v_conteo_codigos_distintos
  FROM public.pregunta_versiones WHERE "cuestionarioVersionId" = p_version_id;
  IF v_conteo_codigos_distintos <> v_conteo_preguntas THEN
    RETURN QUERY SELECT false, 'CODIGOS_DUPLICADOS'; RETURN;
  END IF;

  SELECT array_agg(orden ORDER BY orden) INTO v_ordenes
  FROM public.pregunta_versiones WHERE "cuestionarioVersionId" = p_version_id;
  IF v_ordenes <> (SELECT array_agg(g) FROM generate_series(1, v_conteo_preguntas) g) THEN
    RETURN QUERY SELECT false, 'ORDEN_INVALIDO'; RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pregunta_versiones
    WHERE "cuestionarioVersionId" = p_version_id AND (texto IS NULL OR btrim(texto) = '')
  ) THEN
    RETURN QUERY SELECT false, 'TEXTO_VACIO'; RETURN;
  END IF;

  SELECT count(DISTINCT dimension) INTO v_cobertura_dimensiones
  FROM public.pregunta_versiones
  WHERE "cuestionarioVersionId" = p_version_id AND "esNoPuntuable" = false;
  IF v_cobertura_dimensiones <> 5 THEN RETURN QUERY SELECT false, 'DIMENSIONES_INCOMPLETAS'; RETURN; END IF;

  -- 4.5. Validacion JSON autoritativa de "opciones" para CADA pregunta
  -- de la version, ANTES de que el paso 5 llame a
  -- jsonb_array_length/jsonb_array_elements o haga ningun cast
  -- especifico del motor v2 sobre "opciones". Ninguna pregunta con
  -- opciones mal formadas llega a los chequeos de negocio de abajo.
  FOR v_pregunta IN SELECT codigo, opciones FROM public.pregunta_versiones
    WHERE "cuestionarioVersionId" = p_version_id
  LOOP
    SELECT valido, motivo INTO v_opciones_validas, v_motivo_opciones
    FROM public.validar_estructura_opciones_pregunta(v_pregunta.opciones);
    IF NOT v_opciones_validas THEN
      RETURN QUERY SELECT false, v_motivo_opciones || '_EN_' || v_pregunta.codigo; RETURN;
    END IF;
  END LOOP;

  -- 5. Validaciones especificas del motor V2 por cada pregunta Q1..Q7,
  -- derivadas de src/engine/v2/alineacion.ts, dimensionSimple.ts e
  -- integracion.ts -- bloque completo, sin omisiones. A partir de aqui
  -- jsonb_array_length/jsonb_array_elements y los cast de "orden"/"valor"
  -- ya son seguros: el paso 4.5 garantizo, para CADA pregunta de esta
  -- version, que "opciones" es un array de objetos con valor/texto
  -- (string no vacio) y orden (entero 0..N-1 sin huecos ni duplicados).

  -- Q1: exactamente 8 opciones, y la opcion de orden=7 debe tener
  -- valor='no_definida' -- el marcador real y ya existente en el
  -- cuestionario sembrado (prisma/seedCuestionarioV2.ts), consumido por
  -- esQ1Gatillo() en src/engine/v2/alineacion.ts via
  -- Q1_INDICE_PROMESA_NO_DEFINIDA=7. No existe ningun campo booleano
  -- "esGatilloAlineacion": esta adenda no introduce ninguno. La busqueda
  -- es por el campo "orden" (no por la posicion cruda del arreglo
  -- "->7"): el paso 4.5 garantiza que el conjunto de "orden" es 0..7 sin
  -- huecos, pero no que esten almacenados en ese mismo orden posicional
  -- dentro del arreglo JSON.
  FOR v_pregunta IN SELECT codigo, opciones FROM public.pregunta_versiones
    WHERE "cuestionarioVersionId" = p_version_id AND codigo = 'Q1'
  LOOP
    IF jsonb_array_length(v_pregunta.opciones) <> 8 THEN
      RETURN QUERY SELECT false, 'Q1_CANTIDAD_OPCIONES_INVALIDA'; RETURN;
    END IF;

    SELECT elem->>'valor' INTO v_valor_marcador_q1
    FROM jsonb_array_elements(v_pregunta.opciones) elem
    WHERE (elem->>'orden')::int = 7;

    IF v_valor_marcador_q1 IS DISTINCT FROM 'no_definida' THEN
      RETURN QUERY SELECT false, 'Q1_MARCADOR_NO_DEFINIDA_AUSENTE_O_INCORRECTO'; RETURN;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM public.pregunta_versiones WHERE "cuestionarioVersionId" = p_version_id AND codigo = 'Q1'
  ) THEN
    RETURN QUERY SELECT false, 'Q1_AUSENTE'; RETURN;
  END IF;

  -- Q2 y Q3: exactamente 5 opciones cada una.
  IF (SELECT count(*) FROM public.pregunta_versiones
      WHERE "cuestionarioVersionId" = p_version_id AND codigo IN ('Q2','Q3')
        AND jsonb_array_length(opciones) <> 5) > 0 THEN
    RETURN QUERY SELECT false, 'Q2_O_Q3_CANTIDAD_OPCIONES_INVALIDA'; RETURN;
  END IF;
  IF (SELECT count(DISTINCT codigo) FROM public.pregunta_versiones
      WHERE "cuestionarioVersionId" = p_version_id AND codigo IN ('Q2','Q3')) <> 2 THEN
    RETURN QUERY SELECT false, 'Q2_O_Q3_AUSENTE'; RETURN;
  END IF;

  -- Q4, Q6, Q7 y la parte puntuable de Q5: exactamente 5 opciones cada una.
  IF (SELECT count(*) FROM public.pregunta_versiones
      WHERE "cuestionarioVersionId" = p_version_id AND codigo IN ('Q4','Q5','Q6','Q7')
        AND "esNoPuntuable" = false AND jsonb_array_length(opciones) <> 5) > 0 THEN
    RETURN QUERY SELECT false, 'Q4_A_Q7_CANTIDAD_OPCIONES_INVALIDA'; RETURN;
  END IF;
  IF (SELECT count(DISTINCT codigo) FROM public.pregunta_versiones
      WHERE "cuestionarioVersionId" = p_version_id AND codigo IN ('Q4','Q5','Q6','Q7')
        AND "esNoPuntuable" = false) <> 4 THEN
    RETURN QUERY SELECT false, 'Q4_A_Q7_AUSENTE'; RETURN;
  END IF;

  -- Q5-fuente: debe existir, marcada esNoPuntuable = true (ya excluida de
  -- la cobertura de dimensiones del paso 4 por el filtro
  -- esNoPuntuable=false), y con exactamente 6 opciones estructuradas --
  -- no es una subpregunta de texto libre: tiene la misma forma
  -- {valor, texto, orden} que cualquier otra pregunta (sap_erp, excel,
  -- wms_tms_aps, correo_mensajeria, varios_sistemas, sin_fuente_definida
  -- en prisma/seedCuestionarioV2.ts).
  FOR v_pregunta IN SELECT codigo, opciones FROM public.pregunta_versiones
    WHERE "cuestionarioVersionId" = p_version_id AND codigo = 'Q5-fuente' AND "esNoPuntuable" = true
  LOOP
    IF jsonb_array_length(v_pregunta.opciones) <> 6 THEN
      RETURN QUERY SELECT false, 'Q5_FUENTE_CANTIDAD_OPCIONES_INVALIDA'; RETURN;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM public.pregunta_versiones
    WHERE "cuestionarioVersionId" = p_version_id AND codigo = 'Q5-fuente' AND "esNoPuntuable" = true
  ) THEN
    RETURN QUERY SELECT false, 'Q5_FUENTE_AUSENTE_O_MAL_MARCADA'; RETURN;
  END IF;

  -- 6. Transicion: retirar la vigente anterior (si existia) y publicar
  -- la nueva, con sus eventos de bitacora, en la misma transaccion que
  -- ya tiene ambas filas bloqueadas desde el paso 1 y el paso 2.
  IF v_vigente_actual_id IS NOT NULL THEN
    UPDATE public.cuestionario_versiones SET estado = 'RETIRADA', "retiradaEn" = now()
    WHERE id = v_vigente_actual_id;

    INSERT INTO public.bitacora_version_cuestionario (id, "cuestionarioVersionId", "actorId", accion, "createdAt")
    VALUES (p_id_evento_retiro, v_vigente_actual_id, p_actor_id, 'RETIRAR', now());
  END IF;

  UPDATE public.cuestionario_versiones
  SET estado = 'PUBLICADA', "publicadaEn" = now(), "curadorId" = p_actor_id
  WHERE id = p_version_id;

  INSERT INTO public.bitacora_version_cuestionario (id, "cuestionarioVersionId", "actorId", accion, "createdAt")
  VALUES (p_id_evento_publicar, p_version_id, p_actor_id, 'PUBLICAR', now());

  -- 7. Red de seguridad final: si, pese a los locks FOR UPDATE de los
  -- pasos 1-2, el indice parcial uq_cuestionario_version_publicada
  -- detectara una segunda fila PUBLICADA con el mismo codigo, el UPDATE
  -- de este mismo paso ya habria lanzado 23505 y abortado la transaccion
  -- completa antes de llegar aqui -- no se necesita chequeo adicional.

  RETURN QUERY SELECT true, 'OK';
END;
$$;

ALTER FUNCTION public.publicar_cuestionario_version(text, text, text, text, text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.publicar_cuestionario_version(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publicar_cuestionario_version(text, text, text, text, text) TO chainpulse_app;
```

`p_id_evento_retiro` se genera siempre en TypeScript antes de llamar, incluso cuando no hay vigente que retirar — se descarta sin usar en ese caso, evitando lógica condicional de generación de IDs en el llamador.

**Función de retiro manual, análoga, sin publicar una nueva versión:**

```sql
DROP FUNCTION IF EXISTS public.retirar_cuestionario_version(text, text, text);

CREATE FUNCTION public.retirar_cuestionario_version(p_version_id text, p_actor_id text, p_id_evento_retiro text)
RETURNS TABLE(retirada boolean, motivo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_estado text;
BEGIN
  SELECT estado INTO v_estado FROM public.cuestionario_versiones WHERE id = p_version_id FOR UPDATE;
  IF v_estado IS NULL THEN RETURN QUERY SELECT false, 'VERSION_INEXISTENTE'; RETURN; END IF;
  IF v_estado <> 'PUBLICADA' THEN RETURN QUERY SELECT false, 'VERSION_NO_ESTA_PUBLICADA'; RETURN; END IF;

  UPDATE public.cuestionario_versiones SET estado = 'RETIRADA', "retiradaEn" = now() WHERE id = p_version_id;

  INSERT INTO public.bitacora_version_cuestionario (id, "cuestionarioVersionId", "actorId", accion, "createdAt")
  VALUES (p_id_evento_retiro, p_version_id, p_actor_id, 'RETIRAR', now());

  RETURN QUERY SELECT true, 'OK';
END;
$$;

ALTER FUNCTION public.retirar_cuestionario_version(text, text, text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.retirar_cuestionario_version(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retirar_cuestionario_version(text, text, text) TO chainpulse_app;
```

**Pruebas obligatorias de `publicar_cuestionario_version()`:**
1. **Carrera con vigente existente:** dos transacciones publican dos borradores distintos del mismo `codigo`, ambas con el mismo `p_version_vigente_esperada_id` real. Exactamente una gana; la perdedora recibe `VERSION_VIGENTE_CAMBIO` o una excepción `23505` (según en qué punto exacto pierda la carrera frente al lock de la fila vigente y frente al índice parcial), y el código de aplicación trata ambos resultados como la misma categoría de error de cara al usuario.
2. **Carrera sin vigente existente:** dos transacciones publican dos borradores distintos del mismo `codigo` cuando no existe ninguna `PUBLICADA` previa, ambas con `p_version_vigente_esperada_id = NULL`. Exactamente una transacción confirma; la otra recibe `23505` sobre el índice parcial y hace rollback completo, incluido el `INSERT` de bitácora que había intentado — se verifica con una consulta posterior que el conteo de filas `PUBLICADA` para ese código es exactamente 1 y que la bitácora tiene exactamente un evento `PUBLICAR` para ese código en esa ronda.
3. **Cada motivo de rechazo del paso 4.5** (`OPCIONES_NO_ES_ARRAY`, `OPCIONES_VACIO`, `OPCIONES_ELEMENTO_NO_ES_OBJETO`, `OPCIONES_VALOR_INVALIDO`, `OPCIONES_TEXTO_INVALIDO`, `OPCIONES_ORDEN_NO_ENTERO`, `OPCIONES_VALOR_DUPLICADO`, `OPCIONES_ORDEN_DUPLICADO`, `OPCIONES_ORDEN_NO_CONTIGUO`, cada uno sufijado `_EN_<codigo>`) y **cada motivo de rechazo del bloque Q1–Q7** (`Q1_CANTIDAD_OPCIONES_INVALIDA`, `Q1_MARCADOR_NO_DEFINIDA_AUSENTE_O_INCORRECTO`, `Q1_AUSENTE`, `Q2_O_Q3_CANTIDAD_OPCIONES_INVALIDA`, `Q2_O_Q3_AUSENTE`, `Q4_A_Q7_CANTIDAD_OPCIONES_INVALIDA`, `Q4_A_Q7_AUSENTE`, `Q5_FUENTE_CANTIDAD_OPCIONES_INVALIDA`, `Q5_FUENTE_AUSENTE_O_MAL_MARCADA`) tiene al menos un caso de prueba dedicado que lo dispara deliberadamente y confirma que la versión permanece en `BORRADOR` tras el rechazo, sin ninguna excepción de Postgres propagada sin clasificar (en particular, sin `22P02`/`22023` por un cast directo sobre JSON mal formado).
4. **Caso de éxito completo:** un borrador con las 8 preguntas correctamente formadas (`Q1`..`Q7` más `Q5-fuente`, con la forma real de opciones de `prisma/seedCuestionarioV2.ts`: 8 opciones en `Q1`, 5 en `Q2`/`Q3`/`Q4`/`Q5`/`Q6`/`Q7`, 6 en `Q5-fuente`) se publica con éxito, queda en `PUBLICADA`, y genera exactamente un evento `PUBLICAR`.

### 7.9 Extracción verificada del error `23505`

Verificado contra el código fuente instalado de `@prisma/adapter-pg@6.19.3` y `@prisma/client@6.19.3` (las versiones reales declaradas en `package.json`, confirmadas también en el comentario ya existente de `src/infra/auth/restablecerPasswordMantenimiento.ts`, que cita exactamente esa versión del adaptador):

1. Cualquier error que el driver `pg` reporte durante un `$queryRaw`/`$executeRaw` —incluido uno producido dentro de una función plpgsql invocada mediante `SELECT * FROM public.publicar_cuestionario_version(...)`, porque la intercepción ocurre a nivel del driver de conexión, no por análisis del texto SQL— pasa por `convertDriverError()` → `mapDriverError()` dentro de `@prisma/adapter-pg`.
2. Para `error.code === '23505'`, el adaptador devuelve `{ kind: "UniqueConstraintViolation", constraint: { fields: [...] } }`, donde `fields` se extrae con una expresión regular sobre `error.detail` (el mensaje `DETAIL` que Postgres genera automáticamente, con forma `Key (columna1, columna2)=(valor1, valor2) already exists.`) — nunca de `error.constraint` (el nombre catalogado de la restricción), que el adaptador solo usa para `23503`. El nombre del índice (`uq_cuestionario_version_publicada`) nunca llega a TypeScript — solo los nombres de columna involucrados.
3. `kind: "UniqueConstraintViolation"` se traduce al código Prisma `P2002` dentro del runtime de `@prisma/client`.
4. El error final que recibe TypeScript tiene `err.code === "P2002"` y `err.meta.constraint.fields` como array de nombres de columna.

**Extractor:**

```typescript
// src/infra/rf20/erroresPublicacion.ts
const CAMPOS_INDICE_PARCIAL_PUBLICACION = ["codigo"]; // uq_cuestionario_version_publicada: UNIQUE (codigo) WHERE estado = 'PUBLICADA'
const CAMPOS_UNIQUE_CODIGO_NUMERO = ["codigo", "numero"]; // @@unique([codigo, numero]), restriccion DISTINTA

export function esViolacionIndiceParcialPublicacion(err: unknown): boolean {
  const codigo = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
  if (codigo !== "P2002") return false;
  const campos = (err as { meta?: { constraint?: { fields?: string[] } } }).meta?.constraint?.fields;
  if (!campos) return false;
  const ordenado = [...campos].sort();
  return JSON.stringify(ordenado) === JSON.stringify([...CAMPOS_INDICE_PARCIAL_PUBLICACION].sort());
}
```

`cuestionario_versiones` tiene dos restricciones únicas con conjuntos de columnas distintos (`(codigo)` parcial vs. `(codigo, numero)` completa), así que `fields` por sí solo basta para distinguirlas sin ambigüedad.

**Prueba de integración real, contra Neon real, ejecutada por quien implemente (no simulada en este documento):** provocar deliberadamente ambas colisiones (publicar dos borradores concurrentes del mismo código; y, por separado, intentar crear dos versiones con el mismo `(codigo, numero)` — ver §7.10 para cómo se ejecuta esto sin privilegios que `chainpulse_app` no tiene) y capturar el objeto de error real completo para confirmar que `err.meta.constraint.fields` tiene exactamente la forma documentada arriba antes de confiar en el extractor en producción. Cualquier otro `23505` se propaga sin reinterpretar.

### 7.10 Calibración del extractor — nunca requiere un privilegio que `chainpulse_app` no tiene

La prueba de colisión `(codigo, numero)` necesita insertar directamente en `cuestionario_versiones` sin pasar por `crear_cuestionario_version()` — pero `chainpulse_app` no tiene `INSERT` sobre esa tabla (§4.1). Esta calibración se ejecuta exclusivamente con el rol `neondb_owner`, contra una **rama temporal de Neon** (nunca la rama principal), bajo **doble autorización explícita**, nunca con la credencial de aplicación:

```
scripts/rf20/calibrarExtractor23505RamaTemporal.ts -- PENDIENTE DE
  AUTORIZACION, no se ejecuta como parte de esta adenda.

Pasos, en orden, cada uno bloqueante si falla:
  1. Verifica que la variable de conexion con privilegio elevado
     (neondb_owner, nunca la credencial de chainpulse_app) y la credencial
     de aplicacion apuntan al mismo destino (host/puerto/base), y que ese
     destino es una rama temporal de Neon, nunca la rama principal.
  2. Exige una variable de entorno que confirme explicitamente el destino
     exacto de la rama temporal.
  3. Exige una segunda variable de entorno, distinta de la anterior, que
     autorice especificamente esta accion de calibracion.
  4. Conecta con la credencial de neondb_owner -- nunca con la de
     chainpulse_app, que de todas formas no podria insertar.
  5. Inserta directamente (INSERT crudo, sin pasar por ninguna funcion
     SECURITY DEFINER) dos filas en cuestionario_versiones con el mismo
     (codigo, numero), captura el error 23505 real completo, y por
     separado, dos filas con el mismo codigo y estado='PUBLICADA' (viola
     el indice parcial), captura ese segundo error real.
  6. Compara ambos err.meta.constraint.fields contra lo documentado en
     7.9 -- si alguno no coincide, el extractor debe corregirse antes de
     confiar en el, y el script lo reporta explicitamente.
  7. Nunca modifica la rama principal.
```

Esta calibración queda como un paso pendiente de autorización explícita y separada antes de ejecutarse; no se ejecuta ni se asume ya ejecutada como parte de este documento.

### 7.11 Drift del índice parcial frente a Prisma

`uq_cuestionario_version_publicada` no es representable en `schema.prisma` (Prisma no soporta índices parciales). Protección: un comentario de documentación en el modelo `CuestionarioVersion` que apunte a la migración exacta que lo crea, para que un futuro `prisma migrate dev` no lo interprete como drift a eliminar. No existe detección automática de drift en CI (no hay `prisma migrate diff --shadow-database-url` configurado); esta adenda no introduce una, por exceder su alcance.

---

## 8. Normalización de email y aprovisionamiento de cuentas

### 8.1 Normalización única

`lower(btrim(email))` en todos los puntos: `login_lookup_plataforma()`, el índice único funcional, las funciones de aprovisionamiento.

### 8.2 Índice único funcional + detección previa de duplicados

```sql
-- PASO 1 (revisar el resultado antes de aplicar el PASO 3).
SELECT lower(btrim(email)) AS email_normalizado, array_agg(id) AS ids, count(*)
FROM public.usuarios_plataforma
GROUP BY lower(btrim(email))
HAVING count(*) > 1;

-- PASO 2 (bloqueante).
DO $$
DECLARE v_duplicados integer;
BEGIN
  SELECT count(*) INTO v_duplicados FROM (
    SELECT lower(btrim(email)) FROM public.usuarios_plataforma
    GROUP BY lower(btrim(email)) HAVING count(*) > 1
  ) t;
  IF v_duplicados > 0 THEN
    RAISE EXCEPTION 'RF19_EMAIL_DUPLICADO: existen % grupos duplicados -- resolver manualmente.', v_duplicados;
  END IF;
END;
$$;

-- PASO 3.
CREATE UNIQUE INDEX uq_usuarios_plataforma_email_normalizado
  ON public.usuarios_plataforma (lower(btrim(email)));
```

No hay filas todavía en `usuarios_plataforma`, así que se espera que el PASO 1 devuelva cero filas; el chequeo se conserva como salvaguarda bloqueante, no como formalidad.

### 8.3 Aprovisionamiento de cuentas

Exclusivamente administrativo, nunca vía migración ni endpoint público. Script `scripts/rf19/aprovisionar-usuario-plataforma.ts`, ejecutado manualmente con credencial `neondb_owner`:

1. Recibe `email`, `rol`, contraseña temporal (generada si no se provee).
2. Normaliza con `lower(btrim(email))` en JavaScript, verifica unicidad.
3. Hashea con `hashPassword()` (Argon2id, ya existente).
4. Inserta con `prisma.usuarioPlataforma.create()` (ruta Prisma normal, `@default(cuid())` normal; los defaults de `activo`, `sessionVersion`, `mfaUltimoContadorUsado` se aplican automáticamente).
5. Deja `mfaHabilitado = false`, `mfaSecret = null`: el usuario enrola MFA en su primer login real.

**Restablecimiento de MFA** (dispositivo perdido): script administrativo separado, `restablecerMfaPlataformaMantenimiento.ts`, que verifica el rol efectivo de conexión antes de leer o escribir, confirma que el `UPDATE` afecta exactamente una fila, y pone `mfaHabilitado = false, mfaSecret = NULL`.

---

## 9. Migraciones — lista cerrada y orden

**El orden siguiente es normativo: ninguna función `SECURITY DEFINER` se crea antes de que la migración 1 (REVOKE CREATE + verificación bloqueante) se haya aplicado con éxito.**

1. **`rf19_rf20_revoke_create_public`**: migración consolidada de §3.1 (precondición de propietario, preauditoría informativa, los dos `REVOKE`, postcondición bloqueante de cuatro comprobaciones), validada formalmente por las Pruebas A, B, C, D1 y D2 de §3.2. Si la postcondición aborta, ninguna migración posterior se aplica.
2. **`rf19_enum_bucket_limite_tasa_login_y_mfa`**: `ALTER TYPE "BucketLimiteTasa" ADD VALUE 'LOGIN_PLATAFORMA'; ALTER TYPE "BucketLimiteTasa" ADD VALUE 'VERIFICACION_MFA_PLATAFORMA';` — aislada en su propia migración (restricción de `ALTER TYPE ... ADD VALUE` dentro de una transacción).
3. **`rf19_columnas_usuario_plataforma`**: `ALTER TABLE usuarios_plataforma ADD COLUMN activo boolean NOT NULL DEFAULT true; ALTER TABLE usuarios_plataforma ADD COLUMN "sessionVersion" integer NOT NULL DEFAULT 1; ALTER TABLE usuarios_plataforma ADD COLUMN "mfaUltimoContadorUsado" integer;` — tres columnas aditivas, sin impacto en filas existentes.
4. **`rf19_indice_email_normalizado`**: PASO 1/2/3 de §8.2.
5. **`rf19_funciones_controladas`**: las diez funciones de §6 (`login_lookup_plataforma`, `registrar_intento_fallido_plataforma`, `restablecer_intentos_plataforma`, `leer_estado_sesion_plataforma`, `incrementar_version_sesion_plataforma`, `desactivar_usuario_plataforma`, `reactivar_usuario_plataforma`, `enrolar_mfa_plataforma`, `activar_mfa_plataforma`, `consumir_contador_totp_plataforma`) + los `REVOKE`/`GRANT` de §4.2 sobre `usuarios_plataforma`. Se aplica solo después de que la migración 1 verificó que no queda ningún rol no confiable con `CREATE` sobre `public`.
6. **`rf20_bitacora_version_cuestionario`**: `CREATE TABLE` completa de `bitacora_version_cuestionario` (§7.7) + el enum `AccionBitacoraVersion` + las tres `FOREIGN KEY ... ON DELETE RESTRICT` + los `REVOKE`/`GRANT` de §4.1 para esta tabla — nace ya con sus permisos correctos, sin estado intermedio.
7. **`rf20_funciones_controladas`**: las diez funciones de §7 (`crear_cuestionario_version`, `corregir_cuestionario_version`, `crear_pregunta_version`, `editar_pregunta_version`, `eliminar_pregunta_version`, `editar_metadata_cuestionario_version`, `reordenar_preguntas_version`, `validar_estructura_opciones_pregunta`, `publicar_cuestionario_version`, `retirar_cuestionario_version`) + los `REVOKE`/`GRANT` de §4.1 para `cuestionario_versiones`/`pregunta_versiones`.

**Cambio no-SQL que acompaña estas migraciones:** agregar la dependencia `cuid@^2.1.8` a `package.json` y el archivo `src/infra/ids/cuid.ts` (§5); ampliar la firma de `registrarIntento()` y el tipo `BucketLimiteTasa` en `src/infra/rateLimit/limiteTasa.ts` (§6.9); agregar `src/infra/rateLimit/limitesPlataforma.ts` (§6.9).

Ninguna migración modifica destructivamente la versión sembrada, incluye secretos, se conecta a producción por su cuenta, ni asume ausencia de datos sin verificarlo explícitamente.

---

## 10. Plan de PRs

| PR | Contenido | Depende de | Migraciones | Pruebas | Gate de merge |
|---|---|---|---|---|---|
| 1 | Documentación: esta adenda, en `docs/architecture/rf19-rf20/` | — | ninguna | — | Revisión de Alex |
| 2 | Migración 1 (`REVOKE CREATE` + postcondición) aislada, en su propio PR, antes de cualquier otra | PR 1 | 1 | Pruebas A, B, C, D1 y D2 de §3.2 ejecutadas y en verde | Las cinco pruebas pasan: `PUBLIC` sin `CREATE` (D1), ningún rol nominativo no permitido con `CREATE` (D2), despliegue limpio e idempotente (A, B), bloqueo real ante un rol inesperado (C) |
| 3 | Migraciones 2-5 (RF19: enum, columnas, índice de email, funciones) + dependencia `cuid` + `src/infra/ids/cuid.ts` | PR 2 | 2-5 | pruebas de catálogo (§3.4) + pruebas negativas de tabla (§4.2) + prueba de idempotencia de `enrolar_mfa_plataforma` | Pruebas de catálogo en verde |
| 4 | RF19 infraestructura: `sessionPlataforma.ts`, `mfaPlataforma.ts`, `auth.config.plataforma.ts`, ampliación de `registrarIntento()`/`BucketLimiteTasa`, `limitesPlataforma.ts` | PR 3 | ninguna | unitarias con mocks; fórmula de contador absoluto contra vectores conocidos de `otpauth`; aislamiento entre `LOGIN_PLATAFORMA` y `VERIFICACION_MFA_PLATAFORMA` (§6.9) | Cobertura de los wrappers |
| 5 | RF19 rutas/middleware: login (con resistencia a enumeración, §6.5), enrolar/verificar MFA, `activo` | PR 4 | ninguna | integración manual (Neon real): login completo con MFA, bloqueo por cuenta, bloqueo por huella (login y MFA, independientes), rechazo uniforme de las cuatro ramas de §6.5 (incluida la de cuenta bloqueada), `429`+`Retry-After` exactos | Pruebas de integración documentadas |
| 6 | Migraciones 6-7 (RF20: bitácora, funciones de gobernanza) | PR 2 | 6-7 | pruebas de catálogo + negativas de tabla + prueba de captura de `23505` (§7.9) | Prueba de captura ejecutada contra Neon real al menos una vez |
| 7 | RF20 dominio: wrappers TypeScript de todas las funciones de §7, incluida `corregirCuestionarioVersion()` (§7.4) | PR 6 | ninguna | unitarias + concurrencia de publicación (§7.8) + concurrencia de reordenamiento (§7.6) | Pruebas de concurrencia en verde, repetidas al menos 2 veces |
| 8 | RF20 API/UI + aprovisionamiento (§8.3) + script de calibración de §7.10 (pendiente de autorización separada para ejecutarse) + integración end-to-end completa | PR 5, PR 7 | ninguna | integración manual completa, documentada | Ejecución exitosa documentada antes de considerar RF19/RF20 cerrados |

Ningún PR combina implementación con aplicación en producción bajo la misma autorización.

---

## 11. Autoauditoría textual

Antes de entregar este documento se verificaron, contra el texto completo del propio documento, los seis criterios siguientes:

| Criterio | Resultado |
|---|---|
| Cero apariciones normativas de "sin cambios respecto de" (o variantes que remitan a una versión anterior del documento) dentro del diseño mismo (§1-§13) | **Cumplido**, con una excepción declarada: §14 es un apéndice de trazabilidad explícitamente comparativo (diff conceptual v6→v7), fuera del cuerpo normativo de diseño; dentro de §1-§13 no se usa framing comparativo y todo diseño está reproducido íntegramente, una sola vez, en su sección correspondiente |
| Cero "a definir", "a confirmar" o placeholders de decisión pendiente | **Cumplido**, con una excepción declarada y deliberada: el literal `HASH_SENUELO_LOGIN_PLATAFORMA` en §6.5 no es una decisión pendiente, es un valor que debe generarse mecánicamente (ejecutando una función ya existente del propio repositorio sobre un dato aleatorio) en el momento de implementar — no se fabrica un hash falso aquí porque eso violaría la prohibición de inventar valores; se documenta el mecanismo exacto para generarlo, no una decisión de diseño abierta |
| Cero cuerpos SQL con lógica omitida (sin comentarios tipo "se insertará en la migración real") | **Cumplido** — el bloque de validación Q1–Q7 está escrito completo e inline dentro de `publicar_cuestionario_version()` (§7.8); `validar_estructura_opciones_pregunta()` está completa, sin omisiones (§7.8); `reordenar_preguntas_version()` está completa con sus seis invariantes (§7.6); las veinte funciones del inventario de §12.3 tienen cuerpo completo en §6.6, §6.7, §7.3, §7.4, §7.5, §7.6 u §7.8 |
| Todos los umbrales numéricos cerrados | **Cumplido**: bloqueo por cuenta 5 intentos/15 min (§6.9); `LOGIN_PLATAFORMA` 10 intentos/huella/15 min (§6.9); `VERIFICACION_MFA_PLATAFORMA` 5 intentos/huella/15 min (§6.9); TTL preauth 10 min, TTL sesión 8h (§6.1); `PERIOD` TOTP 30s, `window` 1 (§6.7); dependencia `cuid@^2.1.8` (§5); `Q1` 8 opciones, `Q2`/`Q3`/`Q4`/`Q5`/`Q6`/`Q7` 5 opciones, `Q5-fuente` 6 opciones (§7.8) |
| Toda función del inventario aparece con diseño completo, permisos y prueba | **Cumplido** — ver §12.3, que referencia la sección exacta de cada una de las veinte funciones, todas con cuerpo SQL completo, `ALTER FUNCTION ... OWNER TO`, `REVOKE ALL`, `GRANT EXECUTE`, y al menos una prueba descrita en la misma sección |
| Orden de migraciones consistente con el modelo de seguridad | **Cumplido** — §9 migración 1 es `REVOKE CREATE ON SCHEMA public` + verificación bloqueante; ninguna función `SECURITY DEFINER` (migraciones 5 y 7) se crea antes; el texto de §9 lo declara explícitamente como normativo |
| Ninguna respuesta de login permite distinguir cuenta inexistente, contraseña incorrecta, cuenta inactiva o cuenta bloqueada | **Cumplido** — las cuatro ramas de §6.5 devuelven `401` con cuerpo byte-idéntico, todas ejecutan una verificación Argon2id de costo equivalente, y una cuenta bloqueada nunca emite preauth ni extiende su propio bloqueo; el código de estado `423` (que sí distinguía la rama de cuenta bloqueada en un diseño anterior) ya no aparece en ninguna parte de esta sección |
| Ningún operador ni cast jsonb se evalúa sobre `opciones` antes de validar su tipo correspondiente | **Cumplido** — `validar_estructura_opciones_pregunta()` (§7.8) llama `jsonb_typeof(p_opciones)` antes de cualquier `jsonb_array_length`/`jsonb_array_elements`, y dentro del bucle llama `jsonb_typeof()` sobre cada campo (`valor`, `texto`, `orden`) antes de cualquier `->>`/cast; `publicar_cuestionario_version()` invoca esta función para cada pregunta en el paso 4.5, antes de que el paso 5 llame a `jsonb_array_length`/`jsonb_array_elements` o acceda a `orden`/`valor` del bloque Q1–Q7 |

---

## 12. Entregables consolidados

### 12.1 Resumen ejecutivo de decisiones

1. `neondb_owner` como propietario de toda función; riesgo residual de rol mínimo documentado en §13, no actuado.
2. `REVOKE CREATE ON SCHEMA public` **primero**, con precondición de propietario, preauditoría informativa y postcondición bloqueante de cuatro comprobaciones (§3.1), validada formalmente por las Pruebas A, B, C, D1 y D2 (§3.2), antes de crear ninguna función — reordenamiento normativo de §9.
3. `usuarios_plataforma`, `cuestionario_versiones`, `pregunta_versiones`, `bitacora_version_cuestionario`: sin `GRANT` de escritura de tabla; todo vía funciones con grants exactos.
4. IDs de `cuestionario_versiones`, `pregunta_versiones` y `bitacora_version_cuestionario`: CUID generado en TypeScript (`cuid@^2.1.8`), recibido como parámetro `p_id`.
5. `bitacora_version_cuestionario` es una tabla nueva de punta a punta.
6. `UsuarioPlataforma.activo` y `.sessionVersion` son campos nuevos formalmente migrados, con semántica completa.
7. Publicación con revalidación autoritativa completa en base de datos: validación JSON de estructura de `opciones` para cada pregunta (§7.8, `validar_estructura_opciones_pregunta()`) antes de cualquier operador o cast jsonb específico del motor, bloque Q1–Q7 inline, `IS DISTINCT FROM`, y conversión validada del enum `DimensionDiagnosticoV2`.
8. TOTP: contador absoluto `floor(timestamp/1000/PERIOD) + delta`; enrolamiento idempotente.
9. **Límites de tasa cerrados:** `LOGIN_PLATAFORMA` 10/huella/15min, `VERIFICACION_MFA_PLATAFORMA` 5/huella/15min, ambos `429` + `Retry-After` exacto, aislados entre sí y del límite por cuenta (5 fallos/15min, sin cambios).
10. **Resistencia a enumeración:** respuesta uniforme (`401`, mismo cuerpo) para cuenta inexistente, contraseña incorrecta, cuenta inactiva y cuenta bloqueada, con verificación Argon2id de costo equivalente en las cuatro ramas (incluida la bloqueada, que nunca emite preauth), verificación contra hash señuelo cuando la cuenta no existe, y sin registro ni extensión de intentos fallidos cuando la cuenta ya está bloqueada o no existe.
11. Calibración del extractor de `23505` sobre rama temporal Neon + `neondb_owner` + doble autorización, nunca con un privilegio que `chainpulse_app` no tiene.
12. `Q1` usa el marcador real y ya existente del cuestionario (opción `orden=7`, `valor='no_definida'`), nunca un campo booleano sintético; `Q5-fuente` tiene 6 opciones estructuradas, no es texto libre.

### 12.2 Matriz requisito → implementación → prueba → criterio de aceptación

| Requisito | Implementación | Prueba | Criterio de aceptación |
|---|---|---|---|
| RF19/RF20 `CREATE` revocado sobre `public` antes de crear cualquier función `SECURITY DEFINER` | §3.1 | Pruebas A, B, C, D1, D2 (§3.2) | **RF19RF20-A0**: tras la migración, `PUBLIC` no conserva `CREATE` sobre `public` (confirmado por catálogo vía `aclexplode(nspacl)` con `grantee=0`, nunca `has_schema_privilege('public','public',...)`), `chainpulse_app` tampoco lo conserva, ningún otro rol nominativo no permitido lo conserva, y `chainpulse_app` no puede `SET ROLE neondb_owner` |
| RF19 MFA obligatorio desde el primer acceso | §6.1, §6.7 | Integración: login sin MFA habilitado fuerza `/activar-mfa` | **RF19-A1**: ningún `UsuarioPlataforma` con `mfaHabilitado=false` obtiene una cookie de sesión completa |
| RF19 separación de audiencias JWT | §6.1 | Unitaria: decodificar un preauth y confirmar rechazo por una ruta de sesión | **RF19-A2**: un token con `aud="plataforma-preauth"` siempre es rechazado donde se exige `aud="plataforma-session"` |
| RF19 revocación de sesión | §6.2, §6.6 | Integración: incrementar `sessionVersion` y confirmar rechazo en la siguiente request | **RF19-A3**: tras incrementar `sessionVersion`, toda request posterior con el token viejo es rechazada, fail-closed |
| RF19 bloqueo por cuenta tras intentos fallidos | §6.5, §6.6 | Unitaria + integración: 5 fallos consecutivos bloquean 15 min | **RF19-A4**: al 5.º fallo, `bloqueadoHasta` queda en `now()+15min`; el 6.º intento (correcto o incorrecto) es rechazado con `401` idéntico a las demás ramas de §6.5, verificando la contraseña igualmente y sin emitir preauth |
| RF19 sin acceso directo a credenciales por `chainpulse_app` | §4.2 | Negativa: `UPDATE`/`SELECT` directos fallan con `42501` | **RF19-A5**: ninguna sentencia SQL como `chainpulse_app` lee `passwordHash`/`mfaSecret` ni escribe `rol`/`email`/`passwordHash` fuera de las funciones |
| RF19 replay TOTP | §6.7 | Concurrencia: dos verificaciones simultáneas con el mismo contador | **RF19-A6**: exactamente una de las dos tiene éxito |
| RF19 desactivación con revocación inmediata | §6.4, §6.6 | Integración: desactivar una cuenta con sesión activa | **RF19-A7**: toda request posterior con el token previo es rechazada |
| RF19 enrolamiento MFA idempotente | §6.7 | Dos llamadas con secretos candidatos distintos | **RF19-A8**: ambas devuelven el mismo `secretoEfectivo` (el de la primera) |
| RF19 contador TOTP absoluto | §6.7 | Unitaria: dos verificaciones en períodos de 30s distintos con el mismo delta relativo | **RF19-A9**: `contadorAceptado` es monótonamente creciente entre verificaciones reales sucesivas |
| RF19 límites de tasa cerrados y separados | §6.9 | Umbral exacto (10 y 5), aislamiento entre buckets, `Retry-After` exacto | **RF19-A10**: la 11.ª request de login y la 6.ª de verificación MFA, por huella, reciben `429` con `Retry-After` correcto; ningún bucket afecta al otro |
| RF19 resistencia a enumeración | §6.5 | Comparación byte a byte de las cuatro ramas; medición de tiempo de respuesta; prueba de extremo a extremo tras bloqueo real (§6.5, prueba 4) | **RF19-A11**: las cuatro ramas (inexistente, incorrecta, inactiva, bloqueada) son indistinguibles por respuesta y por tiempo, incluso tras un bloqueo real alcanzado en producción de prueba |
| RF20 borrador → publicada → retirada | §7.1, §7.3, §7.8 | Integración: ciclo completo | **RF20-A1**: una versión `BORRADOR` nunca se publica sin pasar por `publicar_cuestionario_version`; una vez `PUBLICADA`, ninguna función permite modificar su contenido |
| RF20 una única versión publicada por código | §7.8 | Las dos pruebas de concurrencia de §7.8 | **RF20-A2**: `count(*) FROM cuestionario_versiones WHERE codigo=X AND estado='PUBLICADA'` es 0 o 1, nunca más |
| RF20 historial inmutable | §4.1, §7.2 | Negativa: `UPDATE` directo sobre una fila `PUBLICADA` | **RF20-A3**: ninguna función permite modificar contenido de una versión cuyo padre no esté en `BORRADOR` |
| RF20 compatibilidad con el motor V2 | §7.8 | Cada motivo de rechazo del bloque Q1–Q7, probado individualmente, incluido el marcador real de `Q1` (`orden=7`, `valor='no_definida'`) y las 6 opciones de `Q5-fuente` | **RF20-A4**: `publicar_cuestionario_version` rechaza con el motivo correcto cada violación estructural, sin depender de ningún campo que no exista en `OpcionPregunta` |
| RF20 validación JSON autoritativa previa a cualquier operador/cast jsonb | §7.8 | Cada motivo de rechazo de `validar_estructura_opciones_pregunta()`, probado individualmente (§7.8) | **RF20-A11**: ninguna pregunta con `opciones` mal formadas permite publicación; `jsonb_array_length`/`jsonb_array_elements`/cast sobre `orden` o `valor` nunca se ejecutan antes de que `jsonb_typeof()` confirme el tipo correspondiente |
| RF20 bitácora con semántica cerrada | §7.7 | Integración: eventos exactos tras un ciclo crear→corregir→publicar | **RF20-A5**: la versión sembrada tiene cero eventos `PUBLICAR` y exactamente un `RETIRAR` tras la primera publicación real sobre su código |
| RF20 bitácora como tabla verificable | §7.7 | Prueba de catálogo: tabla, `@@map`, tres FKs | **RF20-A6**: `bitacora_version_cuestionario` existe con `onDelete: Restrict` en sus tres relaciones |
| RF20 enum de dimensión validado | §7.5 | Unitaria: `p_dimension` inválido | **RF20-A7**: la función devuelve `DIMENSION_INVALIDA`, nunca propaga la excepción cruda |
| RF20 corrección de versión sin mezcla de formato de ID | §7.4 | Integración: todos los IDs tras `corregirCuestionarioVersion()` | **RF20-A8**: ningún `id` tiene formato UUID |
| RF20 calibración sin privilegio prohibido | §7.10 | Revisión manual del script | **RF20-A9**: el script se niega a ejecutar si la credencial activa no es `neondb_owner` sobre una rama temporal confirmada |
| RF20 `reordenar_preguntas_version` sin ignorar IDs inválidos | §7.6 | Los seis casos de rechazo descritos | **RF20-A10**: cada payload inválido es rechazado con el motivo correcto, sin modificar ningún `orden` |

### 12.3 Inventario cerrado de funciones

| Función | Firma | Propietario | `EXECUTE` otorgado a | Diseño completo en |
|---|---|---|---|---|
| `login_lookup_plataforma` | `(text)` | `neondb_owner` | `chainpulse_app` | §6.3 |
| `registrar_intento_fallido_plataforma` | `(text)` | `neondb_owner` | `chainpulse_app` | §6.6 |
| `restablecer_intentos_plataforma` | `(text)` | `neondb_owner` | `chainpulse_app` | §6.6 |
| `leer_estado_sesion_plataforma` | `(text)` | `neondb_owner` | `chainpulse_app` | §6.6 |
| `incrementar_version_sesion_plataforma` | `(text)` | `neondb_owner` | `chainpulse_app` | §6.6 |
| `desactivar_usuario_plataforma` | `(text, text)` | `neondb_owner` | `chainpulse_app` | §6.6 |
| `reactivar_usuario_plataforma` | `(text, text)` | `neondb_owner` | `chainpulse_app` | §6.6 |
| `enrolar_mfa_plataforma` | `(text, text)` | `neondb_owner` | `chainpulse_app` | §6.7 |
| `activar_mfa_plataforma` | `(text, integer)` | `neondb_owner` | `chainpulse_app` | §6.7 |
| `consumir_contador_totp_plataforma` | `(text, integer)` | `neondb_owner` | `chainpulse_app` | §6.7 |
| `crear_cuestionario_version` | `(text, text, text)` | `neondb_owner` | `chainpulse_app` | §7.3 |
| `corregir_cuestionario_version` | `(text, text, text, text)` | `neondb_owner` | `chainpulse_app` | §7.4 |
| `crear_pregunta_version` | `(text, text, text, integer, text, text, jsonb, boolean)` | `neondb_owner` | `chainpulse_app` | §7.5 |
| `editar_pregunta_version` | `(text, text, text, jsonb, boolean)` | `neondb_owner` | `chainpulse_app` | §7.5 |
| `eliminar_pregunta_version` | `(text)` | `neondb_owner` | `chainpulse_app` | §7.5 |
| `editar_metadata_cuestionario_version` | `(text, text)` | `neondb_owner` | `chainpulse_app` | §7.5 |
| `reordenar_preguntas_version` | `(text, jsonb)` | `neondb_owner` | `chainpulse_app` | §7.6 |
| `validar_estructura_opciones_pregunta` | `(jsonb)` | `neondb_owner` | `chainpulse_app` | §7.8 |
| `publicar_cuestionario_version` | `(text, text, text, text, text)` | `neondb_owner` | `chainpulse_app` | §7.8 |
| `retirar_cuestionario_version` | `(text, text, text)` | `neondb_owner` | `chainpulse_app` | §7.8 |

### 12.4 Matriz de permisos

| Tabla | `SELECT` directo | `INSERT`/`UPDATE`/`DELETE` directo | Vía función |
|---|---|---|---|
| `usuarios_plataforma` | Revocado | Revocado | §6.6, §6.7 |
| `cuestionario_versiones` | `chainpulse_app` | Revocado | §7.3, §7.4, §7.5, §7.8 |
| `pregunta_versiones` | `chainpulse_app` | Revocado | §7.5 |
| `bitacora_version_cuestionario` (tabla nueva) | `chainpulse_app` | Revocado desde su creación | Solo escrita internamente por §7.4, §7.8 |

---

## 13. Riesgos residuales

- `neondb_owner` como propietario de funciones (rol amplio; un rol `NOLOGIN` mínimo dedicado sería preferible, pero crearlo excede el alcance de esta adenda).
- Atribución de `actorId` en la bitácora depende enteramente del guard de aplicación (§2), no de una garantía que la base de datos pueda dar por sí sola.
- Un token de preauth robado permanece criptográficamente válido hasta su `exp` natural de 10 minutos si no se usa para completar el enrolamiento (§6.1) — mitigado por el límite de intentos de MFA, no por revocación activa de JWT.
- No existe detección automática de drift de índices parciales en CI (§7.11).
- La dependencia `cuid` (§5) es un paquete npm de terceros estable y ampliamente usado, pero sin desarrollo activo reciente — riesgo bajo, aceptado porque el formato CUID v1 ya es el que `schema.prisma` declara como default en decenas de modelos del proyecto.
- El literal `HASH_SENUELO_LOGIN_PLATAFORMA` (§6.5) debe generarse una única vez, fuera de este documento, y nunca debe coincidir con el hash de ninguna cuenta real ni derivarse de una contraseña reutilizada en ningún otro lugar del sistema.
- `validar_estructura_opciones_pregunta()` (§7.8) se invoca únicamente desde `publicar_cuestionario_version()`, por alcance explícito de esta adenda: `crear_pregunta_version()`/`editar_pregunta_version()` (§7.5) siguen aceptando cualquier `jsonb` en `p_opciones` sin validar su estructura al momento de escribir, de modo que un `BORRADOR` puede contener temporalmente preguntas con `opciones` mal formadas — el rechazo solo ocurre al intentar publicar. Extender la misma validación a la escritura, para dar retroalimentación más temprana en la UI de curaduría, queda fuera del alcance de esta corrección.
---

## 14. Diff conceptual v6 → v7

Este apéndice es, deliberadamente, el único lugar de todo el documento con framing comparativo respecto de una versión anterior (ver la excepción declarada en §11) — su función es exclusivamente de trazabilidad, no de diseño: §1-§13 son autosuficientes y no requieren leer este apéndice para implementarse.

1. **Alcance del cambio:** el cambio de fondo entre v6 y v7 se limita a §3 (la migración `rf19_rf20_revoke_create_public` y su validación) y a las referencias de trazabilidad que apuntaban a ella (§9 migración 1, §10 PR 2, §11, §12.1 punto 2, §12.2). Ningún otro contenido técnico cambia de significado: §1-§2, §4-§8, §9 (migraciones 2-7), §10 (PR 1 y PR 3-8), §12.3, §12.4 y §13 son idénticas en contenido técnico a v6.
2. **Qué tenía v6 en §3.1/§3.2:** un `REVOKE` incondicional (`REVOKE CREATE ON SCHEMA public FROM PUBLIC/chainpulse_app`), sin transacción explícita, seguido de una única verificación bloqueante que recorría `pg_namespace`/`aclexplode()` con un `JOIN` contra `pg_roles` para listar roles con nombre que conservaran `CREATE` — ese `JOIN` ya excluía naturalmente a `PUBLIC` (que no tiene fila en `pg_roles`), pero v6 nunca verificaba la ausencia de `CREATE` para `PUBLIC` como una comprobación explícita y aislada por catálogo, no tenía precondición de propietario (ni de ejecutor ni de catálogo), no tenía preauditoría informativa previa al `REVOKE`, no tenía la comprobación de `pg_has_role(...)` contra escalada vía `SET ROLE`, no tenía marcadores que delimitaran un bloque extraíble, y no tenía un plan de pruebas formal con nombres asignados (A, B, C, D1, D2) — solo la descripción de "la verificación".
3. **Qué reemplaza v7:** §3.1 consolida la migración completa en una transacción explícita (`BEGIN;`/`COMMIT;`) con cuatro partes internas, en este orden — precondición de dos comprobaciones (ejecutor `current_user` y propietario real del esquema por catálogo, `pg_namespace.nspowner`), preauditoría informativa (nunca bloqueante), los dos `REVOKE` (sin cambios respecto de v6), y una postcondición bloqueante de cuatro comprobaciones independientes (PUBLIC vía `aclexplode`/`grantee=0`; `chainpulse_app` vía `has_schema_privilege`; roles nominativos inesperados vía el mismo `JOIN` que ya usaba v6; y `pg_has_role('chainpulse_app', 'neondb_owner', 'SET')`), envuelta en marcadores `-- === INICIO/FIN POSTCONDICION RF19RF20 ===`. §3.2 añade el plan de pruebas formal: Prueba A (despliegue real), Prueba B (repetición idempotente, incluidos `BEGIN`/`COMMIT`), Prueba C (rol nominativo dinámico con bloqueo esperado, verificado por marcador y nombre de rol en la salida), D1 (ausencia de `CREATE` para `PUBLIC`, con limpieza incondicional en `finally`) y D2 (control negativo aislado de la comprobación nominativa, con archivo temporal UTF-8 sin BOM y verificación de su borrado).
4. **Corrección específica de D1 (primera ronda):** se documenta explícitamente por qué `has_schema_privilege('public', 'public', 'CREATE')` sería incorrecta — el segundo argumento de esa función siempre se interpreta como el nombre de un rol real, nunca como el pseudo-rol `PUBLIC` — y se fija como única consulta válida la que usa `aclexplode(n.nspacl)` filtrando por `grantee = 0`, exigiendo `false` como único resultado aceptable.
5. **Corrección específica de la Prueba C (primera ronda):** v7 formaliza un procedimiento con un nombre de rol de prueba generado dinámicamente (nunca un literal fijo), con verificación previa de no-existencia contra `pg_roles` antes de crearlo, y con una limpieza en bloque `finally` que nunca permite que un fallo de limpieza oculte el resultado original de la aserción.
6. **D2 es una incorporación nueva (primera ronda):** v6 no tenía ningún control negativo aislado sobre la comprobación nominativa. D2 lo añade extrayendo mecánicamente, entre los marcadores del archivo final, solo el bloque de postcondición, y ejecutándolo sin los `REVOKE` previos, para demostrar que esa comprobación por sí sola —no el `REVOKE`— es lo que detecta a un rol inesperado.
7. **Transacción explícita (segunda ronda):** un borrador de §3.1 posterior a la primera ronda carecía de `BEGIN;`/`COMMIT;` explícitos, dejando la atomicidad "una excepción revierte todo el archivo" como una suposición sobre el comportamiento de `prisma migrate deploy`/`psql -f`, nunca verificada en el propio archivo. v7 envuelve todo el archivo en `BEGIN;`/`COMMIT;`, y la Prueba B se ejecuta explícitamente sobre el archivo completo, delimitadores incluidos.
8. **Precondición de propietario reforzada (segunda ronda):** el mismo borrador comprobaba únicamente el ejecutor de la sesión (`current_user = 'neondb_owner'`), sin confirmar por catálogo quién es el propietario real del esquema `public`. v7 añade una segunda comprobación, independiente de la primera, contra `pg_namespace.nspowner` vía `pg_roles` — ambas deben pasar.
9. **Aserciones de salida en C y D2 (segunda ronda):** ese mismo borrador aceptaba cualquier código de salida de `psql` distinto de cero como el bloqueo esperado, sin distinguirlo de un error de sintaxis, conexión, codificación o archivo faltante. v7 exige además que la salida capturada (stdout y stderr) contenga la cadena `RF19RF20_POSTCONDICION_3_ROL_INESPERADO` y el nombre exacto del rol de prueba antes de aceptar el resultado.
10. **Codificación del archivo temporal de D2 (segunda ronda):** ese borrador escribía el bloque aislado con `Set-Content`, que en Windows PowerShell 5.1 usa UTF-16LE por defecto y podía hacer fallar a `psql -f` por codificación, no por la Comprobación 3. v7 escribe el archivo en UTF-8 sin BOM (`[System.IO.File]::WriteAllLines` con `System.Text.UTF8Encoding($false)`) y verifica con `Test-Path`, tras `Remove-Item`, que el archivo temporal efectivamente desapareció.
11. **Limpieza incondicional en D1 (segunda ronda):** ese borrador no garantizaba que `PUBLIC` quedara sin `CREATE` si la migración simulada fallaba antes de alcanzar su propio `REVOKE`. v7 envuelve D1 en `try`/`catch`/`finally`, y el `finally` ejecuta siempre un `REVOKE CREATE ON SCHEMA public FROM PUBLIC` de limpieza, reportando ambos fallos (original y de limpieza) si ambos ocurren.
12. **Trazabilidad actualizada:** §9 (migración 1), §10 (PR 2), §11 (excepción declarada para este apéndice), §12.1 (punto 2) y §12.2 (nueva fila RF19RF20-A0) nombran explícitamente las cinco pruebas de §3.2 en lugar de referirse genéricamente a "la verificación" de v6.
13. **Lo que v7 no toca:** ninguna migración de §9 distinta de la migración 1 cambia; ninguna de las veinte funciones `SECURITY DEFINER` de §6/§7 cambia; §4 (permisos de tabla), §5 (IDs), §6 (RF19), §7 (RF20), §8 (normalización de email) y §13 (riesgos residuales) son idénticos en contenido técnico a v6. `adenda-diseno-rf19-rf20-v6.md` permanece intacta en este mismo directorio como registro histórico; `v7` la sustituye documentalmente como documento autoritativo vigente (ver `README.md`).
