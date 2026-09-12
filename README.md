# ChainPulse

Producto SaaS multi-empresa que detecta dónde existe descoordinación entre áreas, procesos, personas y sistemas de una organización, identifica el eslabón más débil del flujo y recomienda qué mejorar primero, con seguimiento de avance en el tiempo.

## Estado

Fase 4 del prompt maestro de Bigdevelopment — en construcción. `requirements.md`, ADR-0001, ADR-0002 y ADR-0003 están aprobados y consistentes entre sí (ver Sección 12 de `requirements.md` para la revisión final de viabilidad, GO para Fase 4). Scaffolding completo: proyecto Next.js + TypeScript + Tailwind + Prisma, el modelo de datos completo (`prisma/schema.prisma`), el motor v1 (`src/engine/`, funcion pura, sin Prisma ni Next — ADR-0002) con **19/19 pruebas unitarias pasando** (salud, criticidad, riesgo, RF7 con desempate determinista, RF16), el middleware de aislamiento multi-tenant (`src/infra/prisma/tenantClient.ts`) y las políticas RLS (`prisma/rls.sql`).

Repositorio en GitHub: https://github.com/alexhsantamaria/ChainPulse (rama `main`).

**Bloqueo de entorno resuelto:** `binaries.prisma.sh` estaba bloqueado en los entornos de Claude (cloud y Mac vía sesión) por política de red (403, `blocked-by-allowlist`). Corriendo `npm run prisma:generate` desde una máquina con acceso normal a internet (PC Windows, fuera de cualquier sesión de Claude) funciona sin problema.

**Bug encontrado y corregido al validar el schema por primera vez:** al modelo `Empresa` le faltaba la relación inversa hacia `Conexion` (tenía `usuarios`, `eslabones` y `ciclos`, pero no `conexiones`), lo que rompía `prisma generate` con `P1012`. Corregido agregando `conexiones Conexion[]` a `Empresa` (commit `73942fc`).

Con el fix aplicado, la cadena completa corre limpia en Windows: `npm run prisma:generate`, `npm run typecheck`, `npm run lint`, `npm run test` (19/19) y `npm run build` — todo verde.

**Base de datos: Neon, ya en producción de desarrollo.** Se creó el proyecto en Neon (Postgres gestionado, región São Paulo), se corrió `npm run prisma:migrate` contra esa base (migración inicial aplicada) y se aplicó `prisma/rls.sql` completo desde el SQL Editor de Neon — las 8 políticas RLS de aislamiento multi-tenant están activas y verificadas. Se creó además el rol restringido `chainpulse_app` (sin privilegios de dueño de tabla, por lo tanto sujeto de verdad a RLS — ver nota de seguridad abajo) para las consultas de la app en desarrollo; el rol `neondb_owner` queda reservado solo para migraciones futuras. Con esto se cierra el criterio de "listo" del Incremento 1 que pedía correr RLS con una base real (ADR-0002).

**Autenticación (RF1/RF4): implementada y validada de punta a punta.** Auth.js v5 (Credentials) con hash Argon2id, MFA (TOTP) verificable para `ADMINISTRADOR`, rate limiting con bloqueo temporal y sin enumeración de usuarios — según ADR-0003. `email` es único global (no compuesto con `empresaId`); el login resuelve el tenant vía la función Postgres `login_lookup()` (`prisma/auth_functions.sql`, `SECURITY DEFINER`, única excepción acotada al aislamiento RLS — ver addendum de ADR-0003). Probado en Windows contra Neon: `npm run prisma:seed` crea el usuario de prueba, el login en `/login` autentica y `/api/auth/session` devuelve el JWT con `empresaId`/`rol` correctos. Falta la UI de alta de MFA / registro (RF1) — el motor ya existe, la pantalla no — y el middleware que proteja rutas (todavía no hay dashboard que proteger).

**Prisma sin motor Rust (Windows ARM64):** Prisma no publica un motor de consultas nativo para Windows ARM64 (`query_engine-windows.dll.node is not a valid Win32 application` al correr `npm run prisma:seed`; issue de Prisma cerrado como "not planned"). Se cambió a `engineType = "client"` en `prisma/schema.prisma` (modo GA "sin motor Rust" desde Prisma 6.16) con `@prisma/adapter-pg` como driver adapter — ver addendum de ADR-0003. No afecta a `prisma generate`/`prisma migrate dev` (usan el `schema-engine`, un proceso separado que sí corre bien vía emulación); solo cambia cómo el cliente en runtime (`src/infra/prisma/client.ts`, `prisma/seed.ts`) se conecta a Postgres.

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

Con Auth.js implementado y validado de punta a punta (ADR-0003) y el fix del motor de Prisma aplicado (`npm install`, `npm run prisma:generate`, `npm run prisma:seed` con `SEED_DATABASE_URL` en `.env` — ver `.env.example`): construir la UI de alta de MFA (escanear QR) y el registro de cuenta (RF1), y el middleware de protección de rutas. Después: conectar el motor a Prisma real, las rutas de Next.js para RF1-RF10 (cuenta completa) y RF11-RF18 (evaluación exprés con el gate macro/detalle), el formulario de RF3 con la agrupación visual que recomendó UX/UI, middleware de protección de rutas, y las pruebas de integración de aislamiento multi-tenant (RNF1) con datos reales de las dos empresas piloto — antes de tocar el mapa visual (Incremento 2).
