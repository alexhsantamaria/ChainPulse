# Auditoría de solo lectura y diseño propuesto — RF19 (autenticación de plataforma) y RF20 (gobernanza de versiones del cuestionario)

**Fecha:** 2026-10-29
**Alcance:** Auditoría de solo lectura sobre `main` actualizado (`51f132eada0cb3af911d2fbbdc0928a9fc06e75c`). No se conectó a Neon, no se ejecutaron migraciones, no se modificó código, no se creó rama, no se hizo commit/push/PR. Todo lo que sigue es diagnóstico y propuesta, pendiente de autorización.

---

## 0. Resumen ejecutivo

El hallazgo central de esta auditoría es que **RF19 y RF20 están completamente diseñados y parcialmente migrados, pero no implementados en código de aplicación.** La migración `20260916150000_incremento2_evaluacion_expres_v2` (de mediados de septiembre) ya creó en el esquema — y, según el historial de git, ya llevó a producción — todos los modelos que RF19/RF20 necesitan: `UsuarioPlataforma`, `CuestionarioVersion`, `PreguntaVersion`, además de los enums y el índice único parcial que garantiza que nunca exista más de una versión `PUBLICADA` por código. `PLAN-DE-TRABAJO.md` §18.2.F y §18.3.A documentan, con un nivel de detalle inusual, la arquitectura de seguridad y el patrón de versionado exactos que deben usarse, incluyendo qué módulos de autenticación existentes se reutilizan sin cambios y cuáles necesitan una implementación propia.

Lo que no existe, verificado directamente en el código (no inferido del documento de plan, que en otros puntos del repositorio ya se confirmó desactualizado): no hay ningún directorio `src/infra/auth-plataforma/`, ninguna función `login_lookup_plataforma()`, ningún módulo `src/domain/versionado/`, ninguna ruta `/api/plataforma/*` ni página `/plataforma/*`, y `PreguntaVersion` se puebla hoy exclusivamente mediante `prisma/seedCuestionarioV2.ts` — un script de seed, no un flujo de producto gobernado por un Curador Metodológico real.

Esto cambia la naturaleza del trabajo pendiente: no es "diseñar desde cero", es "implementar contra un diseño ya aprobado y parcialmente migrado, verificando que ese diseño siga siendo válido contra el código real actual (no solo contra el documento de plan) y rellenando los huecos concretos que esta auditoría identifica uno por uno."

---

## 1. Matriz requisito → evidencia actual → brecha

| Requisito / criterio | Evidencia encontrada en el repositorio | Brecha concreta |
|---|---|---|
| RF19 — sesión de plataforma separada (JWT propio, cookie propia, secreto propio, nunca ampliar `next-auth.d.ts`) | `PLAN-DE-TRABAJO.md` §18.2.F ya prohíbe explícitamente ampliar `next-auth.d.ts` y prescribe `jose` (ya es dependencia del proyecto, `package.json` línea 42, usado hoy en `src/infra/auth/invitacion.ts` y `recuperacion.ts` para tokens de un solo uso). No existe ningún módulo que emita o verifique un JWT de plataforma. | Falta por completo: módulo de emisión/verificación de JWT con `jose`, nombre de cookie propio, variable de entorno de secreto propia (nunca `NEXTAUTH_SECRET`/`AUTH_SECRET`). |
| RF19 — MFA obligatorio desde el primer acceso, para los dos roles, sin excepción | `UsuarioPlataforma.mfaSecret`/`mfaHabilitado` ya están en el esquema (migración de septiembre). `src/infra/auth/mfa.ts` (TOTP, `otpauth`) es una función pura reutilizable tal cual — no depende de `empresaId` ni de NextAuth. El middleware actual (`src/middleware.ts`) ya implementa el patrón "forzar `/activar-mfa` si `mfaHabilitado` es falso", pero solo para `rol === "ADMINISTRADOR"`. | Falta el flujo de enrolamiento/verificación de plataforma que llame a `mfa.ts`, y falta la puerta equivalente (sin excepción por rol, a diferencia del caso actual que exime a `RESPONSABLE`) en el guard de plataforma. |
| RF19 — bloqueo tras intentos fallidos, mismo criterio que `Usuario` | `UsuarioPlataforma.intentosFallidos`/`bloqueadoHasta` ya están en el esquema. `src/infra/auth/rateLimit.ts` tiene el patrón exacto (`UPDATE` atómico, corregido en la Ronda 5 — R5-13 — tras un bug real de condición de carrera), pero está escrito contra `tenantClient()`/`tenantTransaction(empresaId, ...)`, que no aplica: `UsuarioPlataforma` no tiene `empresaId` y está deliberadamente fuera de `TENANT_SCOPED_MODELS`. | Se clona el patrón (UPDATE atómico en una sola sentencia), no el código: módulo nuevo que opere sobre `prisma` directo (sin `tenantClient`), análogo a como `src/infra/rateLimit/limiteTasa.ts` ya opera sin tenant para `LimiteTasa`. |
| RF19 — búsqueda de usuario por email sin exponer existencia (no enumeración) | `login_lookup()` (`prisma/auth_functions.sql` línea 32) es `SECURITY DEFINER`, con `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE` solo a `chainpulse_app`. `PLAN-DE-TRABAJO.md` §18.2.F ya prescribe clonar el patrón como `login_lookup_plataforma(email)`. Verificado: no existe en ningún archivo SQL del repositorio. | Nueva función SQL `login_lookup_plataforma()`, nueva migración, nuevo módulo TS equivalente a `src/infra/auth/loginLookup.ts`. |
| RF19 — revocación de sesión, auditoría | `Usuario.sessionVersion` (default 1) ya está migrado y en uso real: `src/infra/auth/sessionVerification.ts` lo verifica en cada request (fail-closed), `src/infra/auth/session.ts` expone `requireSession()`/`requireAdmin()`/`requireSessionOrRedirect()`/`requireAdminOrRedirect()` como el único punto que arma 401/403 (evita que una ruta repita el chequeo a mano — ya causó una inconsistencia real documentada, R5-9). **`UsuarioPlataforma` no tiene ningún campo `sessionVersion` en el esquema actual.** No hay ningún log de auditoría de acceso de plataforma en ningún modelo. | Falta el campo `sessionVersion` en `UsuarioPlataforma` (migración nueva). Falta decidir el mecanismo de auditoría: Alex no pidió un modelo de log de acceso en el texto de RF19, pero RNF11 exige aislamiento estructural verificable — sin alguna forma de bitácora, "verificable" depende solo de revisión de código. Queda como decisión abierta en la Sección 7, no como algo que esta auditoría pueda asumir. |
| RF19 — aislamiento estructural del tenant (nunca `empresaId?` compartido) | Confirmado: `UsuarioPlataforma` no tiene relación a `Empresa`, no está en `TENANT_SCOPED_MODELS` (verificado contra el comentario del propio modelo en `schema.prisma`), no aparece en `prisma/rls.sql` salvo en el comentario que documenta explícitamente que se excluye. | Ninguna — el aislamiento al nivel de esquema ya está correctamente resuelto; lo que falta es que el código de aplicación respete esa separación (no existe código de aplicación todavía que pudiera violarla). |
| RF20 — aggregate `CuestionarioVersion` (`codigo`+`numero`+`estado`) y filas hijas `PreguntaVersion` inmutables | Ambos modelos están en el esquema desde septiembre, con `@@unique([codigo, numero])` y `@@unique([cuestionarioVersionId, codigo])`. Consumidos activamente por `src/engine/v2/`, `src/infra/public/opciones.ts`, `obtenerIndiceQ1.ts`, `construirRespuestasV2.ts` y las rutas `src/app/api/public/evaluations/*`. | Ninguna a nivel de modelo. |
| RF20 — ninguna versión `PUBLICADA` se modifica (dos capas: aplicación + base de datos) | **Capa de base de datos: ya existe en producción.** `CREATE UNIQUE INDEX uq_cuestionario_version_publicada ON cuestionario_versiones(codigo) WHERE estado = 'PUBLICADA'` está en la migración de septiembre (verificado leyendo el SQL de la migración directamente, no solo el comentario del schema). **Capa de aplicación: no existe.** No hay ningún módulo `src/domain/versionado/`; `PLAN-DE-TRABAJO.md` §18.3.A nombra exactamente el archivo que debería existir (`publicarCuestionario.ts`) y no existe. | Falta por completo el módulo de escritura único que transiciona `BORRADOR → PUBLICADA` y rechaza cualquier intento de editar una versión ya `PUBLICADA`/`RETIRADA`. |
| RF20 — publicación transaccional, segura bajo concurrencia | `tenantTransaction()` (`src/infra/prisma/tenantTransaction.ts`) ya existe y está implementado exactamente como lo describe `PLAN-DE-TRABAJO.md` §18.3.B, pero asume `empresaId` — no aplica directo a `UsuarioPlataforma`/`CuestionarioVersion`, que son tenant-nulo. El patrón de concurrencia real para RF20 es el índice único parcial (ya migrado) actuando como backstop de base de datos ante una carrera entre dos publicaciones simultáneas del mismo código. | Falta el módulo de aplicación que envuelva la transacción (usando `prisma.$transaction` directo, sin pasar por `tenantTransaction()`) y que capture el error de violación de índice único (Postgres código `23505`) como el caso esperado de "alguien más publicó primero", no como un error 500 genérico. |
| RF20 — historial inmutable, series históricas por código de pregunta estable | `PreguntaVersion.codigo` ("Q1".."Q7") ya es estable entre versiones por diseño de esquema; `onDelete: Restrict` en la relación impide borrar una versión con respuestas reales atadas. | Ninguna a nivel de modelo; pendiente de que el módulo de publicación realmente nunca haga `UPDATE` sobre una fila de una versión ya publicada (hoy no hay código que lo haga ni que lo impida, porque no hay código de escritura en absoluto). |
| RF20 — autorización exclusiva del Curador/Administrador | Depende enteramente de que RF19 exista primero: sin sesión de plataforma, no hay manera de autorizar "solo un Curador Metodológico puede publicar". | Bloqueado por RF19 — ver Sección "orden de implementación" más abajo. |
| RF20 — previsualización y validaciones antes de publicar | No hay ningún requisito textual en `requirements.md` ni en `PLAN-DE-TRABAJO.md` que especifique reglas concretas de validación de contenido (p. ej. mínimo de preguntas, dimensiones cubiertas, formato de `opciones` JSON). | Brecha de **requisito**, no solo de código: antes de construir la previsualización hay que decidir qué se valida. Queda en la Sección 7 como decisión pendiente de Alex. |
| RF20 — eliminar la dependencia operativa del seed manual | `prisma/seedCuestionarioV2.ts` es hoy el único origen de datos de `PreguntaVersion` en cualquier entorno, incluido — hay que asumirlo — el dataset real que hoy sirve el motor v2 en producción. | Migrar del seed a un flujo real implica decidir qué pasa con los datos ya sembrados: ¿se re-publican como la "versión 1" real a través del nuevo módulo, o se conservan tal cual y el nuevo módulo solo gobierna la versión 2 en adelante? Esto es una decisión de producto con impacto en producción real (ver Sección 7). |

---

## 2. Propuesta de arquitectura

Esta propuesta no inventa un diseño nuevo: traduce a módulos concretos lo que `PLAN-DE-TRABAJO.md` §18.2.F y §18.3.A ya decidieron, verificado contra el código real actual, con los ajustes que esa verificación hizo necesarios (el más importante: `UsuarioPlataforma` necesita `sessionVersion`, que el borrador original no incluía).

### 2.1 RF19 — autenticación de plataforma

**Aislamiento estructural, no solo lógico — principio rector de RNF11.** Ningún tipo, cookie, secreto o módulo de resolución de sesión se comparte con el de `Usuario`/NextAuth. Concretamente:

- **Módulo nuevo `src/infra/auth-plataforma/`** (nombre ya anticipado por el comentario del enum `RolUsuarioPlataforma` en `schema.prisma`), con la misma separación edge/node que ya usa el flujo de NextAuth (`auth.config.ts` vs `auth.ts`) pero resuelta con `jose` en vez de Auth.js:
  - `jwt.ts` — `firmarSesionPlataforma()`/`verificarSesionPlataforma()` con `jose` (`SignJWT`/`jwtVerify`), secreto propio leído de una variable de entorno nueva (p. ej. `AUTH_PLATAFORMA_SECRET`, nunca `AUTH_SECRET`), cookie con nombre propio (p. ej. `chainpulse-plataforma-session`, nunca `authjs.session-token`). `jose` es "edge-safe" por diseño, así que esta verificación puede correr en el middleware sin arrastrar `@node-rs/argon2` — mismo motivo por el que hoy existe la separación `auth.config.ts`/`auth.ts`.
  - `password.ts` — no se crea: se **reutiliza sin cambios** `src/infra/auth/password.ts` (`hashPassword`/`verifyPassword`, Argon2id), tal como prescribe §18.2.F.
  - `mfa.ts` — no se crea: se **reutiliza sin cambios** `src/infra/auth/mfa.ts` (TOTP), mismo motivo.
  - `loginLookupPlataforma.ts` — análogo a `src/infra/auth/loginLookup.ts`, pero contra la función SQL nueva `login_lookup_plataforma(email)`.
  - `rateLimitPlataforma.ts` — clona el patrón de UPDATE atómico de `src/infra/auth/rateLimit.ts`, pero sin `tenantClient()`/`tenantTransaction()`: opera con `prisma.usuarioPlataforma.update` + `$executeRaw` directo, igual que `src/infra/rateLimit/limiteTasa.ts` ya opera sin tenant para otro modelo tenant-nulo.
  - `session.ts` — análogo a `src/infra/auth/session.ts`: `requireSesionPlataforma()`, `requireCurador()`, `requireAdministradorPlataforma()`, mismo patrón fail-closed de `verificarSesionVigente()` pero contra `UsuarioPlataforma.sessionVersion` (campo nuevo, ver Sección 5).
- **`src/middleware.ts` no se modifica.** Se agrega una segunda instancia de middleware o un segundo bloque dentro del mismo archivo que decodifica el JWT de plataforma con `jose` directamente (sin pasar por `NextAuth()`), con su propio `matcher` (p. ej. `/plataforma/:path*`). Next.js permite un único `middleware.ts` con lógica condicional por ruta; dado que ya hay un comentario explícito en el archivo actual sobre no arrastrar dependencias no-edge, cualquier cambio aquí debe revisarse con cuidado para no romper esa separación.
- **Login de plataforma:** una ruta nueva, fuera del árbol `/api/auth/[...nextauth]` (que es exclusivamente de NextAuth), p. ej. `/api/plataforma/auth/login`, que llama a `loginLookupPlataforma` → `verifyPassword` → verifica `mfaHabilitado` (si es `false`, fuerza el flujo de enrolamiento antes de conceder cualquier sesión, sin excepción de rol — a diferencia del middleware actual que sí exime a `RESPONSABLE`) → `verificarCodigoMfa` → firma el JWT propio → responde con la cookie propia.

### 2.2 RF20 — gobernanza de versiones del cuestionario

- **Módulo nuevo `src/domain/versionado/`**, con un único archivo de escritura por aggregate, tal como exige §18.3.A:
  - `publicarCuestionario.ts` — única función que transiciona `BORRADOR → PUBLICADA`. Recibe el `cuestionarioVersionId` en `BORRADOR`, abre una transacción (`prisma.$transaction`, directo, sin `tenantTransaction()` porque este aggregate es tenant-nulo), hace `UPDATE ... WHERE estado = 'BORRADOR'` (nunca un `UPDATE` incondicional — el `WHERE` sobre el estado actual es la primera defensa en aplicación) y confía en el índice único parcial como backstop final ante una carrera real. Captura específicamente el código de error de Postgres `23505` sobre `uq_cuestionario_version_publicada` y lo traduce a un error de dominio legible ("ya existe una versión publicada para este código") en vez de dejarlo subir como una excepción no controlada de Prisma.
  - `corregirCuestionario.ts` (o una función dentro del mismo módulo) — ante cualquier intento de modificar una versión `PUBLICADA`/`RETIRADA`, **nunca permite un `UPDATE`**: crea una fila `CuestionarioVersion` nueva con `numero + 1` en `BORRADOR`, copiando las `PreguntaVersion` necesarias como filas nuevas también (las filas hijas son inmutables por diseño — no se reescriben, se recrean en el nuevo aggregate).
  - `retirarCuestionario.ts` — transición `PUBLICADA → RETIRADA`; análogo al patrón tri-estado que `PLAN-DE-TRABAJO.md` §18.3.C ya usa para `SegmentoMercadoAgregado` (nunca un booleano: un estado no distingue "nunca publicada" de "publicada y luego retirada").
- **API de plataforma** (protegida por `requireCurador()`): `POST /api/plataforma/cuestionarios` (crear borrador), `PATCH /api/plataforma/cuestionarios/:id/preguntas` (editar mientras es borrador), `POST /api/plataforma/cuestionarios/:id/publicar`, `POST /api/plataforma/cuestionarios/:id/retirar`.
- **UI de plataforma**: una sección nueva `src/app/plataforma/` (paralela a `src/app/dashboard/`, nunca anidada dentro de ella — la separación estructural de RNF11 debería ser visible también en la estructura de carpetas, no solo en el backend), con un listado de versiones por código, un editor de borrador, y una previsualización antes de publicar (reglas de validación concretas: pendiente de decisión, Sección 7).

### 2.3 Lo que esta propuesta deja explícitamente fuera

No se propone ningún cambio a `src/infra/prisma/tenantClient.ts`, `tenantTransaction.ts`, `prisma/rls.sql` (más allá de lo que ya documenta el comentario existente) ni a ningún modelo de Empresa/Usuario — todo el trabajo de RF19/RF20 es aditivo sobre un actor y un aggregate que ya están fuera del régimen multi-tenant por diseño.

---

## 3. División en PRs pequeños y revisables

Se propone seguir el mismo patrón que ya usó RF24: **un PR de esquema/funciones SQL primero, después PRs de aplicación separados por capa**, en vez de un único PR grande que mezcle migración, lógica de dominio, API y UI.

1. **PR 1 — Esquema: `sessionVersion` en `UsuarioPlataforma` + función `login_lookup_plataforma()`.** Solo migración SQL y el cambio mínimo de `schema.prisma`. Sin código de aplicación. Revisable en minutos, igual que el patrón de RF24.
2. **PR 2 — RF19, infraestructura de sesión de plataforma.** `src/infra/auth-plataforma/{jwt,loginLookupPlataforma,rateLimitPlataforma,session}.ts`, reexportando `password.ts`/`mfa.ts` existentes sin tocarlos. Sin rutas HTTP todavía — solo los módulos puros/testables y sus pruebas unitarias.
3. **PR 3 — RF19, rutas y middleware.** `/api/plataforma/auth/login`, `/api/plataforma/auth/mfa/enrolar`, el ajuste al middleware para el `matcher` nuevo. Este es el PR con más riesgo de interferir con el middleware actual — se beneficia de ir solo, después de que el PR 2 ya esté probado en aislamiento.
4. **PR 4 — RF20, módulo de dominio `publicarCuestionario.ts`/`corregirCuestionario.ts`/`retirarCuestionario.ts`.** Depende de RF19 solo para las pruebas de integración (necesita un `UsuarioPlataforma` autenticable para probar "solo el Curador puede publicar"); el módulo de dominio en sí puede probarse con un `curadorId` inyectado directamente, sin pasar por HTTP.
5. **PR 5 — RF20, API y UI de plataforma.** Las rutas `/api/plataforma/cuestionarios/*` y `src/app/plataforma/*`. Depende de los PR 2/3 (sesión) y PR 4 (dominio) ya fusionados.
6. **PR 6 (separado, discutido en la Sección 7) — migración del contenido ya sembrado por `prisma/seedCuestionarioV2.ts` al flujo real.** Se mantiene aparte porque toca datos que hoy sirven producción real, a diferencia de los PR 1-5, que son puramente aditivos.

Cada PR, como en RF24, se entrega con su propio SHA256SUMS/evidencia de pruebas antes de fusionar, y ninguno se fusiona sin que `npm run lint`/`npm run typecheck`/`npm run test` pasen en CI — una vez que la corrección de typecheck pendiente (ver el otro hilo de trabajo) esté efectivamente cerrada en el entorno que CI usa.

---

## 4. Lista prevista de archivos

**Nuevos:**

- `prisma/migrations/<fecha>_rf19_session_version_plataforma/migration.sql`
- `prisma/auth_functions_plataforma.sql` (o una sección nueva dentro de `prisma/auth_functions.sql`, a decidir por convención del repo — ambos archivos conviven hoy con un solo `auth_functions.sql`)
- `src/infra/auth-plataforma/jwt.ts`
- `src/infra/auth-plataforma/loginLookupPlataforma.ts`
- `src/infra/auth-plataforma/rateLimitPlataforma.ts`
- `src/infra/auth-plataforma/session.ts`
- `src/infra/auth-plataforma/__tests__/*.test.ts`
- `src/app/api/plataforma/auth/login/route.ts`
- `src/app/api/plataforma/auth/mfa/enrolar/route.ts`
- `src/domain/versionado/publicarCuestionario.ts`
- `src/domain/versionado/corregirCuestionario.ts`
- `src/domain/versionado/retirarCuestionario.ts`
- `src/domain/versionado/__tests__/*.test.ts`
- `src/app/api/plataforma/cuestionarios/route.ts` (+ `[id]/publicar/route.ts`, `[id]/retirar/route.ts`, `[id]/preguntas/route.ts`)
- `src/app/plataforma/login/page.tsx`
- `src/app/plataforma/cuestionarios/page.tsx` (+ páginas de detalle/edición/previsualización)
- `src/infra/rf19-rf20/__tests__/entornoPruebasIntegracionPlataforma.ts` (siguiendo el patrón ya usado por RF24: `src/infra/rf24/__tests__/entornoPruebasIntegracionRf24.ts`)

**Modificados:**

- `prisma/schema.prisma` (campo `sessionVersion` en `UsuarioPlataforma`)
- `src/middleware.ts` (matcher/lógica nueva para `/plataforma/:path*`, sin tocar la rama existente de `/dashboard`)
- `.env.example` (nueva variable `AUTH_PLATAFORMA_SECRET`, documentada con el mismo criterio que el resto del archivo)
- `docs/PATRONES.md` (si corresponde documentar el patrón de autenticación dual, siguiendo cómo ese archivo ya documenta otros patrones transversales)

**No se toca:** `src/auth.ts`, `src/auth.config.ts`, `src/infra/auth/next-auth.d.ts`, `src/infra/prisma/tenantClient.ts`, `src/infra/prisma/tenantTransaction.ts`, ningún modelo de `Usuario`/`Empresa`.

---

## 5. Migraciones propuestas

Dos migraciones aditivas, ninguna destructiva, ninguna requiere backfill de datos reales (ver la salvedad de la Sección 7 sobre el seed):

1. **`sessionVersion` en `UsuarioPlataforma`:**
   ```sql
   ALTER TABLE "usuarios_plataforma" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 1;
   ```
   Mismo criterio que la migración original de `Usuario.sessionVersion`: un `DEFAULT` explícito para que ningún dato existente (hoy no hay ningún `UsuarioPlataforma` real, pero la migración debe ser correcta igual) quede en un estado inconsistente.

2. **`login_lookup_plataforma()`:**
   ```sql
   CREATE FUNCTION login_lookup_plataforma(p_email text)
   RETURNS TABLE (
     id text, email text, "passwordHash" text, rol text,
     "mfaSecret" text, "mfaHabilitado" boolean,
     "intentosFallidos" integer, "bloqueadoHasta" timestamp
   )
   SECURITY DEFINER
   LANGUAGE sql
   AS $$ SELECT id, email, "passwordHash", rol::text, "mfaSecret", "mfaHabilitado", "intentosFallidos", "bloqueadoHasta"
          FROM "usuarios_plataforma" WHERE email = p_email $$;

   REVOKE ALL ON FUNCTION login_lookup_plataforma(text) FROM PUBLIC;
   GRANT EXECUTE ON FUNCTION login_lookup_plataforma(text) TO chainpulse_app;
   ```
   Firma exacta a ajustar una vez que el campo `sessionVersion` ya esté migrado (debería incluirse en el `RETURNS TABLE`, igual que `login_lookup()` original ya devuelve todo lo que el módulo de sesión de `Usuario` necesita en una sola llamada).

Ninguna de las dos migraciones requiere tocar `prisma/rls.sql` (el comentario ya existente cubre `usuarios_plataforma`) ni ninguna tabla del Incremento 1. Antes de aplicar cualquiera de las dos contra Neon, Alex debería confirmar con `prisma migrate status` (desde su entorno real, nunca desde este puente) que la migración de septiembre efectivamente ya está aplicada en producción — esta auditoría no puede confirmarlo sin conectarse a Neon, lo que las reglas de esta auditoría prohíben expresamente.

---

## 6. Plan de pruebas

Siguiendo el patrón ya establecido por RF24 y por el resto del repositorio (unitarias sin red en CI, integración manual contra Neon real en Windows, sin framework end-to-end en este proyecto todavía — confirmado: no hay Playwright/Cypress instalado, y `vitest.config.ts` excluye explícitamente `*.integration.test.ts` del comando que corre en `.github/workflows/ci.yml`):

- **Unitarias (CI, sin red):**
  - `rateLimitPlataforma`: el mismo caso que ya motivó la corrección R5-13 en `rateLimit.ts` (dos intentos fallidos casi simultáneos no deben "perderse" un incremento) — se prueba con mocks del cliente Prisma, igual que ya se prueba hoy el módulo original.
  - `jwt.ts`: emisión/verificación válida, token expirado, token firmado con un secreto distinto (debe rechazarse), ausencia de claim `sessionVersion` en un JWT antiguo (mismo caso ya cubierto para `Usuario`, por si en algún punto se emite un JWT de plataforma antes de que `sessionVersion` exista en el claim).
  - `publicarCuestionario.ts`/`corregirCuestionario.ts`/`retirarCuestionario.ts`: transición válida, intento de publicar una versión que no está en `BORRADOR` (debe rechazarse en aplicación, antes de llegar a la base), intento de "corregir" una versión `PUBLICADA` (debe crear `numero+1`, nunca `UPDATE`).
- **Integración (manual, Windows, Neon real — mismo patrón que `src/infra/rf24/__tests__/entornoPruebasIntegracionRf24.ts`):**
  - Dos publicaciones concurrentes del mismo `codigo` (dos llamadas a `publicarCuestionario()` en paralelo contra la base real) — el objetivo específico es confirmar que el índice único parcial efectivamente rechaza la segunda, y que el módulo de aplicación traduce ese rechazo en un error de dominio, no en un 500 sin contexto.
  - `login_lookup_plataforma()` ejecutada contra Neon real, confirmando que `chainpulse_app` puede ejecutarla pero no puede hacer `SELECT` directo sobre `usuarios_plataforma` fuera de la función (mismo patrón de prueba que ya existe, presumiblemente, para `login_lookup()` — a verificar contra el archivo de pruebas de integración existente de `Usuario`, no leído en esta auditoría).
  - MFA obligatorio sin excepción: intento de acceder a cualquier ruta de `/plataforma/*` con una cuenta de `UsuarioPlataforma` cuyo `mfaHabilitado` es `false` — debe bloquear sin excepción para ambos roles (a diferencia del middleware actual, que sí exime a `RESPONSABLE`).
- **Dedicada a RNF11 (aislamiento estructural):** una prueba explícita (unitaria o de integración, a decidir según se pueda simular sin Neon) que confirme que ningún código de `src/infra/auth-plataforma/` importa o es importado por `src/infra/auth/` ni por `src/auth.ts`/`auth.config.ts` — análoga en espíritu a la prueba que RNF10 ya exige para la separación `HallazgoExpres`/`HallazgoExpresTraza`.
- **End-to-end:** no se propone introducir un framework nuevo (Playwright/Cypress) solo para RF19/RF20 — sería la primera vez que el proyecto lo usa, y es una decisión de alcance mayor que esta auditoría no puede tomar por su cuenta (ver Sección 7).

---

## 7. Riesgos y decisiones que requieren aprobación

1. **El seed manual ya sirve datos reales — decidir qué pasa con ellos al introducir el flujo gobernado.** `prisma/seedCuestionarioV2.ts` es hoy la única fuente de `PreguntaVersion` en cualquier entorno. Antes de construir PR 6 (Sección 3), Alex debe decidir: (a) los datos ya sembrados se re-publican como una versión "oficial" a través del nuevo módulo (requiere escribir ese registro inicial con un `curadorId` real o nulo explícitamente marcado como migración histórica), o (b) se documentan como "datos de arranque fuera del flujo gobernado, nunca más reescribibles" y el flujo nuevo solo aplica a partir de la próxima versión. Esto tiene impacto en producción real si el motor v2 ya está activo para visitantes públicos.
2. **No hay reglas de validación de contenido definidas para la previsualización de RF20.** Ni `requirements.md` ni `PLAN-DE-TRABAJO.md` fijan un mínimo de preguntas, cobertura de dimensiones, o formato exigido del JSON de `opciones`. Construir la previsualización sin esto significa o bien inventar reglas (fuera del alcance de "no fabricar"/"no asumir" de esta auditoría) o bien dejarla sin validación real en la primera versión — decisión de producto, no técnica.
3. **Mecanismo de auditoría/bitácora de acceso de plataforma — no especificado en el texto de RF19.** RNF11 exige aislamiento "verificable", pero ni RF19 ni RNF11 piden explícitamente un log de accesos. Sin uno, la verificación depende de revisión de código, no de evidencia en tiempo de ejecución. Si Alex quiere una bitácora real (quién publicó qué versión y cuándo, quién inició sesión de plataforma y desde dónde), es un modelo nuevo no contemplado en el esquema actual — a decidir antes de PR 2/PR 4, porque cambia la migración del PR 1.
4. **Nombre y ubicación exactos de la función/archivo SQL de plataforma.** El repositorio hoy tiene un único `prisma/auth_functions.sql` para `Usuario`. Esta auditoría propone mantener esa convención (una función nueva en el mismo archivo) en vez de crear un archivo paralelo, pero es una preferencia, no un hecho verificado — a confirmar con Alex antes de redactar la migración.
5. **End-to-end real para el flujo de plataforma.** Dado que es el primer actor con MFA sin excepción y con impacto cross-tenant potencial, podría justificar una prueba end-to-end real (navegador) aunque el resto del proyecto no las use — decisión de alcance e inversión de tooling, no algo que esta auditoría deba decidir unilateralmente.
6. **Confirmación de que la migración de septiembre ya está aplicada en Neon producción.** Esta auditoría trabajó solo con el código versionado; no puede confirmar el estado real de la base de datos de producción sin conectarse a Neon, lo que las reglas vigentes prohíben. Antes de escribir las dos migraciones nuevas de la Sección 5, Alex debería confirmar `prisma migrate status` contra producción desde su propio entorno.
7. **Riesgo técnico más alto de todo el diseño: el middleware.** `src/middleware.ts` corre en el Edge runtime y hoy tiene un comentario explícito advirtiendo que arrastrar la dependencia equivocada rompe el build. Agregar el segundo flujo de decodificación JWT (plataforma) en el mismo archivo es donde más fácilmente se podría repetir ese error si no se usa `jose` puro, sin ningún import que arrastre Node nativo. Se recomienda que el PR 3 (Sección 3) incluya explícitamente una verificación de que el build de Next.js sigue pasando en el runtime Edge antes de fusionar.

---

## Orden de implementación — resumen

RF19 bloquea RF20 en la práctica, aunque el modelo de datos de RF20 no dependa técnicamente de RF19: sin sesión de plataforma, "autorización exclusiva del Curador/Administrador" (un criterio explícito de RF20) no se puede construir ni probar de forma significativa. El orden PR 1 → PR 2 → PR 3 → PR 4 → PR 5 (Sección 3) refleja esta dependencia real, no solo una preferencia de tamaño de PR.

## Estimación relativa (cualitativa, sin horas — no hay datos históricos de velocidad del equipo para calibrar una estimación numérica con algún rigor)

PR 1 (migración) y PR 4 (dominio de versionado) son los más acotados — lógica pura, ya con un patrón casi idéntico para copiar (`tenantTransaction`, el propio índice parcial ya migrado). PR 2 y PR 3 (infraestructura de sesión + rutas + middleware) son el núcleo de esfuerzo real, por la cantidad de módulos nuevos y por el riesgo del Edge runtime señalado en el punto 7 de riesgos. PR 5 (API/UI de plataforma) depende de cuánto UX mínimo se exija para la previsualización — señalado como decisión abierta en el punto 2.
