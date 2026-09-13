# ChainPulse

Producto SaaS multi-empresa que detecta dónde existe descoordinación entre áreas, procesos, personas y sistemas de una organización, identifica el eslabón más débil del flujo y recomienda qué mejorar primero, con seguimiento de avance en el tiempo.

## Estado

Fase 4 del prompt maestro de Bigdevelopment — en construcción. `requirements.md`, ADR-0001, ADR-0002 y ADR-0003 están aprobados y consistentes entre sí (ver Sección 12 de `requirements.md` para la revisión final de viabilidad, GO para Fase 4). Scaffolding completo: proyecto Next.js + TypeScript + Tailwind + Prisma, el modelo de datos completo (`prisma/schema.prisma`), el motor v1 (`src/engine/`, funcion pura, sin Prisma ni Next — ADR-0002) con **19/19 pruebas unitarias pasando** (salud, criticidad, riesgo, RF7 con desempate determinista, RF16), el middleware de aislamiento multi-tenant (`src/infra/prisma/tenantClient.ts`) y las políticas RLS (`prisma/rls.sql`).

Repositorio en GitHub: https://github.com/alexhsantamaria/ChainPulse (rama `main`).

**Bloqueo de entorno resuelto:** `binaries.prisma.sh` estaba bloqueado en los entornos de Claude (cloud y Mac vía sesión) por política de red (403, `blocked-by-allowlist`). Corriendo `npm run prisma:generate` desde una máquina con acceso normal a internet (PC Windows, fuera de cualquier sesión de Claude) funciona sin problema.

**Bug encontrado y corregido al validar el schema por primera vez:** al modelo `Empresa` le faltaba la relación inversa hacia `Conexion` (tenía `usuarios`, `eslabones` y `ciclos`, pero no `conexiones`), lo que rompía `prisma generate` con `P1012`. Corregido agregando `conexiones Conexion[]` a `Empresa` (commit `73942fc`).

Con el fix aplicado, la cadena completa corre limpia en Windows: `npm run prisma:generate`, `npm run typecheck`, `npm run lint`, `npm run test` (19/19) y `npm run build` — todo verde.

**Base de datos: Neon, ya en producción de desarrollo.** Se creó el proyecto en Neon (Postgres gestionado, región São Paulo), se corrió `npm run prisma:migrate` contra esa base (migración inicial aplicada) y se aplicó `prisma/rls.sql` completo desde el SQL Editor de Neon — las 8 políticas RLS de aislamiento multi-tenant están activas y verificadas. Se creó además el rol restringido `chainpulse_app` (sin privilegios de dueño de tabla, por lo tanto sujeto de verdad a RLS — ver nota de seguridad abajo) para las consultas de la app en desarrollo; el rol `neondb_owner` queda reservado solo para migraciones futuras. Con esto se cierra el criterio de "listo" del Incremento 1 que pedía correr RLS con una base real (ADR-0002).

**Autenticación (RF1/RF4): implementada y validada de punta a punta.** Auth.js v5 (Credentials) con hash Argon2id, MFA (TOTP) verificable para `ADMINISTRADOR`, rate limiting con bloqueo temporal y sin enumeración de usuarios — según ADR-0003. `email` es único global (no compuesto con `empresaId`); el login resuelve el tenant vía la función Postgres `login_lookup()` (`prisma/auth_functions.sql`, `SECURITY DEFINER`, única excepción acotada al aislamiento RLS — ver addendum de ADR-0003). Probado en Windows contra Neon: `npm run prisma:seed` crea el usuario de prueba, el login en `/login` autentica y `/api/auth/session` devuelve el JWT con `empresaId`/`rol` correctos.

**RF1 (registro de cuenta) y activación de MFA: implementados y validados de punta a punta.** `/registro` crea la empresa y el administrador en una transacción atómica (`src/infra/auth/registro.ts`) e inicia sesión automáticamente con las mismas credenciales; `/activar-mfa` muestra el código QR (motor ya existente en `src/infra/auth/mfa.ts`) y exige confirmar un código antes de dejar la cuenta operativa, según manda ADR-0003 para `ADMINISTRADOR`. Probado en Windows: registro → sesión automática → escaneo del QR con una app real (Google Authenticator) → código aceptado → `mfaHabilitado` activo. Ver addendum de ADR-0003 para el detalle de cómo se resolvió crear un tenant nuevo bajo RLS (más simple de lo previsto: no hizo falta una función `SECURITY DEFINER`). `src/middleware.ts` protege `/activar-mfa` y `/dashboard/*` (todavía sin construir, pero ya queda cubierto en el matcher) redirigiendo a `/login` sin sesión — corre en el Edge runtime de Next.js sobre la sesión JWT, sin tocar la base de datos. Corregido un bug real detectado al probarlo en Windows: el middleware no puede importar Argon2/Prisma en el Edge runtime, así que la configuración de Auth.js se separó en `src/auth.config.ts` (sin el proveedor `Credentials`, la usa el middleware) y `src/auth.ts` (completo, para las rutas de API) — ver addendum de ADR-0003. Validado en Windows: sin sesión, `/activar-mfa` redirige a `/login`.

**Prisma sin motor Rust (Windows ARM64):** Prisma no publica un motor de consultas nativo para Windows ARM64 (`query_engine-windows.dll.node is not a valid Win32 application` al correr `npm run prisma:seed`; issue de Prisma cerrado como "not planned"). Se cambió a `engineType = "client"` en `prisma/schema.prisma` (modo GA "sin motor Rust" desde Prisma 6.16) con `@prisma/adapter-pg` como driver adapter — ver addendum de ADR-0003. No afecta a `prisma generate`/`prisma migrate dev` (usan el `schema-engine`, un proceso separado que sí corre bien vía emulación); solo cambia cómo el cliente en runtime (`src/infra/prisma/client.ts`, `prisma/seed.ts`) se conecta a Postgres.

**RF2/RF3 (declarar la cadena): implementados.** Un administrador logueado declara los eslabones de su cadena en `/dashboard/eslabones` y las conexiones (dependencias) entre ellos en `/dashboard/conexiones` — grafo dirigido con `origenId`/`destinoId` únicos por par (`Conexion.@@unique([origenId, destinoId])`). Al declarar una conexión, los 5 datos de RF3 (grado de dependencia, impacto sobre la promesa al cliente, si existe alternativa, tiempo tolerable, tiempo de recuperación) se piden agrupados en un solo formulario, pero son opcionales al guardar: una conexión sin los 5 confirmados queda marcada `completa: false` (`src/infra/conexiones/completitud.ts`, con pruebas unitarias propias) y se puede completar después desde `/dashboard/conexiones/[id]/editar` (`PATCH /api/conexiones/[id]`) — igual que exige el criterio de aceptación de RF3. Todas las rutas nuevas pasan por `tenantClient()` (RLS + filtro de tenant) y están protegidas por el middleware (`/dashboard/:path*`). Falta: RF4 (invitar responsables por correo), RF5-RF10 (ciclos de pulso, cuestionario, cálculo real con el motor, recomendaciones, dashboard completo con los 4 valores).

**Seguridad de credenciales:** ver [`SEGURIDAD-credenciales.md`](./SEGURIDAD-credenciales.md) — checklist de contraseñas/tokens que se compartieron durante la configuración del entorno y quedan pendientes de rotar.

## Documentos

- [`requirements.md`](./requirements.md) — actores, glosario, requisitos funcionales y no funcionales, criterios de aceptación y alcance explícito del MVP. Aprobado, con cinco rondas de decisiones registradas: Sección 9 (modelo de puntaje y evaluación exprés), Sección 10 (niveles de visualización), Sección 11 (análisis multi-rol del estado acumulado) y Sección 12 (revisión final de viabilidad, cierre de todos los pendientes y valores numéricos de calibración inicial — GO para Fase 4).
- [`docs/ADR/0001-arquitectura-inicial.md`](./docs/ADR/0001-arquitectura-inicial.md) — decisión de stack y arquitectura del MVP. Aceptado, incluidas las precisiones de la quinta ronda (`ruleVersion` único, gate de presentación, campos de tipo de flujo/estado).
- [`chainpulse_end_to_end.md`](./chainpulse_end_to_end.md) — especificación de producto más profunda y de más largo plazo (visión, no literal): recorrido de usuario, motor de diagnóstico, contratos de datos, arquitectura propuesta. Se usa como referencia, reconciliada por ADR-0002.
- [`docs/ADR/0002-alcance-escalonado-end-to-end.md`](./docs/ADR/0002-alcance-escalonado-end-to-end.md) — análisis de viabilidad multi-rol (Producto, CTO, Full-Stack, UX/UI, QA, Seguridad, Negocio), reconciliación de conflictos entre `requirements.md`/ADR-0001 y `chainpulse_end_to_end.md`, y hoja de ruta por incrementos. Aceptado, sincronizado con RF16-RF18 y el teléfono opcional de RF13.
- [`docs/ADR/0003-autenticacion.md`](./docs/ADR/0003-autenticacion.md) — decisión de mecanismo de autenticación para RF1/RF4: Auth.js (NextAuth), hash Argon2id, MFA para administradores, sourced en los apuntes del módulo de Seguridad. Aceptado.
- [`SEGURIDAD-credenciales.md`](./SEGURIDAD-credenciales.md) — checklist de credenciales expuestas durante la configuración del entorno y pendientes de rotar (no contiene secretos reales).

## Cómo levantar el proyecto

```bash
git clone https://github.com/alexhsantamaria/ChainPulse.git
cd ChainPulse
npm install
npm run prisma:generate
npm run typecheck         # tsc --noEmit
npm run lint               # eslint .
npm run test               # vitest run — 19 pruebas del motor v1
npm run dev                 # Next.js en http://localhost:3000
```

`prisma/schema.prisma` usa una base PostgreSQL real en Neon (`DATABASE_URL` en `.env`, no versionado). Para migraciones nuevas, cambiar temporalmente `DATABASE_URL` al rol `neondb_owner` (dueño de las tablas); para desarrollo normal, usar el rol restringido `chainpulse_app` (sujeto a las políticas RLS de `prisma/rls.sql`, ya aplicadas en la base).

## Próximo paso

Con RF1-RF3 (cuenta, MFA, middleware, declarar eslabones y conexiones) implementados y RF2/RF3 pendientes de probar en Windows con datos reales: RF4 (invitar responsables de eslabón por correo — requiere elegir un proveedor de email, todavía no decidido), RF5-RF7 (activar un ciclo de pulso, cuestionario Likert 1-5 para cada responsable, conectar el motor `src/engine/` ya probado con 25/25 tests al cálculo real por ciclo), RF8 (recomendaciones por reglas), RF9-RF10 (dashboard completo con los 4 valores, eslabón más débil, índice de integración e histórico), y las pruebas de integración de aislamiento multi-tenant (RNF1) con datos reales de las dos empresas piloto — antes de tocar el mapa visual (Incremento 2). RF11-RF18 (evaluación exprés anónima) queda como una rama de trabajo aparte, de menor prioridad que cerrar la cuenta completa.
