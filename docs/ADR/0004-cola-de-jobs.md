# ADR-0004 — Cola de jobs en segundo plano (pg-boss) y dónde corre el worker

Fecha: 2026-09-16
Estado: Aceptado — confirmado por Alex el 2026-09-15 (elección de `pg-boss` sobre Postgres/Neon) y el 2026-09-16 (Opción A del worker, en el plan Hobby por el presupuesto $0/mes, `PLAN-DE-TRABAJO.md` Sección 15/18.1.E). Implementado en el Bloque A del Incremento 2 (Ronda 5, R5-10: este documento formaliza por escrito una decisión ya tomada y ya construida, referenciada desde el código y desde `PLAN-DE-TRABAJO.md` pero sin ADR propio hasta ahora).

## Contexto

`MVP-DEFINITIVO.md` Sección 8 lista una cola de trabajos diferidos como pieza de arquitectura técnica sin atarla a un incremento concreto. `PLAN-DE-TRABAJO.md` (Sección 4) encontró que esa pieza ya tenía una obligación vencida real: el job de purga de `huellaOrigen`/`huellaOrigenPurgadaEn` de `EvaluacionExpres` a las 48-72h (RF15/RF17) no podía posponerse al Incremento 4 como sugería la agrupación original del alcance, porque el propio Incremento 2 (rutas públicas de evaluación exprés) no puede abrir a tráfico real sin ese job funcionando.

Dos decisiones quedaban abiertas, y ninguna es trivial:

1. **Qué motor de cola usar.** Alex confirmó el 2026-09-15 una cola Postgres-nativa (`pg-boss` o `graphile-worker`) sobre la misma base Neon, en vez de un servicio externo tipo Inngest — coherente con ADR-0001 ("un desarrollador solo", sin sumar un proveedor más) y con no introducir infraestructura nueva mientras la existente (Neon) ya la puede sostener.
2. **Dónde corre el worker que consume esa cola.** Este es el punto que `PLAN-DE-TRABAJO.md` dejaba pendiente al decir "cola Postgres-nativa" sin decir quién la consume. El modelo estándar de `pg-boss` (`boss.work(queue, handler)`, una suscripción de larga duración con `LISTEN/NOTIFY`) asume un proceso Node persistente. ChainPulse, desde ADR-0001, es un monolito Next.js desplegado en Vercel: invocaciones por request, sin proceso persistente entre invocaciones, con timeout duro por función (`maxDuration`). Ese modelo estándar de `pg-boss` no puede correr así.

`pg-boss` es JS puro sobre `pg` (sin binario nativo, sin el problema de compatibilidad que ya tiene el motor de Prisma con Rust en Windows ARM64 — ver ADR-0001/README), y ya es dependencia indirecta del proyecto vía `pg`. Necesita su propio schema (`pgboss` por defecto) creado una sola vez con permisos de `CREATE SCHEMA`, igual que las migraciones de Prisma — el rol `chainpulse_app` (restringido, sujeto a RLS, ver `prisma/rls.sql`) no tiene ese privilegio, así que el bootstrap corre con `neondb_owner`, nunca en cada invocación del runtime.

## Opciones consideradas (dónde vive el worker)

**Opción A — Polling por lotes disparado por un Cron externo.** Un Route Handler (`/api/internal/jobs/run`) hace, en cada invocación, `boss.fetch(queue, batchSize)` — nunca `boss.work()` — procesa cada job con margen bajo `maxDuration`, marca `complete()`/`fail()` y retorna. Un disparador externo (Vercel Cron, y/o un workflow de GitHub Actions) invoca esa ruta periódicamente. Mantiene todo en un solo despliegue, coherente con ADR-0001. Latencia de job: desde segundos (si además se dispara el fetch al encolar, ver más abajo) hasta la cadencia del Cron en el peor caso — aceptable para purga de `huellaOrigen`, importación CSV, anonimización o agregados de Market Signals, ninguno de los cuales exige tiempo real.

**Opción B — Proceso worker externo persistente.** Un proceso Node pequeño (`boss.start()` + `boss.work()`) desplegado en un host aparte siempre encendido (Railway, Fly.io, Render) que mantiene la conexión `LISTEN/NOTIFY` y procesa en tiempo real, con latencia sub-segundo. Introduce un segundo despliegue, una segunda superficie de secretos (`DATABASE_URL` expuesta en un entorno más) y un segundo objetivo de observabilidad — contradice el mismo criterio de "bajo mantenimiento para un desarrollador solo" que ya llevó a ADR-0001 a descartar un backend separado para el monolito principal, y sin ningún caso de uso hoy que exija esa latencia.

| Opción | Encaja con ADR-0001 (mono-repo, 1 dev) | Latencia | Costo adicional | Superficie de secretos nueva |
|---|---|---|---|---|
| A — Cron + `boss.fetch()` por lotes | Sí | Segundos a horas, según cadencia y mitigación | Ninguno en Hobby; $20/mes en Vercel Pro si se necesita Cron de 1 min | Ninguna |
| B — Worker externo persistente | No (segundo despliegue) | Sub-segundo | Sí (host aparte) | Sí (`DATABASE_URL` en un segundo entorno) |

## Decisión

Se adopta la **Opción A**, con dos ajustes concretos resueltos el 2026-09-16 bajo la restricción de presupuesto confirmada por Alex ($0/mes, evaluado mes a mes — Sección 15, hallazgo H14):

- **Plan de Vercel: Hobby, no Pro.** El Cron nativo de Vercel en Hobby tiene cadencia diaria (no cada minuto, que requeriría plan Pro a $20/mes). Es suficiente para el único job real de esta etapa (purga de `huellaOrigen` a 48-72h, ventana de tolerancia en horas, no minutos).
- **GitHub Actions como respaldo, no como reemplazo.** Un segundo disparador (`.github/workflows/jobs-cron.yml`), con `on: schedule` cada 15 minutos, hace un `curl` autenticado contra `/api/internal/jobs/run` usando el mismo header `Authorization: Bearer <CRON_SECRET>` que usa el Cron nativo de Vercel. Esto no cuesta nada adicional (reutiliza la misma infraestructura de CI ya agregada para `lint`/`typecheck`/`test`) y evita que futuros jobs con expectativa de turnaround corto (importación de CSV del Incremento 4, recómputo de Market Signals del Incremento 7) queden atados a una cadencia de un día completo. El Cron nativo de Vercel queda como red de seguridad redundante, no como único disparador.

**Mitigación de latencia, sin costo adicional (a aplicar cuando se agregue el primer job además de la purga):** cada punto del código que haga `boss.send()` para encolar un job nuevo debe hacer, en el mismo request, una llamada HTTP *fire-and-forget* a `/api/internal/jobs/run` inmediatamente después de encolar — así el caso normal procesa en segundos, y tanto el Cron diario de Vercel como el workflow de GitHub Actions cada 15 minutos quedan como red de seguridad para jobs huérfanos (una invocación que falló a mitad de camino), no como el disparador esperado. El job de purga de `huellaOrigen` no necesita esto hoy porque `encolarPurgaHuellaOrigen()` y `procesarPurgaHuellaOrigen()` se llaman en la misma invocación de `/api/internal/jobs/run` (`src/app/api/internal/jobs/run/route.ts`) — no hay un `boss.send()` disparado desde otro punto del código todavía. El mecanismo de checkpoint que necesitará la importación de CSV del Incremento 4 (reencolarse ante archivos grandes) debe disparar también su propia llamada fire-and-forget al reencolarse.

**Dónde vive en el código:**

- `src/infra/jobs/pgBoss.ts` — instancia singleton de `PgBoss` reutilizada entre invocaciones warm (mismo patrón `globalForPrisma` de `src/infra/prisma/client.ts`), con `supervise: false` y `schedule: false` (sin temporizadores de mantenimiento ni scheduler interno — el disparo es siempre externo) y `createSchema: false`/`migrate: false` (el schema `pgboss` se crea una sola vez con `neondb_owner` vía `npm run jobs:bootstrap`, nunca en cada invocación con el rol restringido `chainpulse_app`).
- `src/infra/jobs/purgaHuellaOrigenJob.ts` — `encolarPurgaHuellaOrigen()` (`boss.send()` con `singletonSeconds` para evitar duplicados si el Cron y el workflow de respaldo se solapan) y `procesarPurgaHuellaOrigen()` (`boss.fetch()` por lotes + `complete()`/`fail()` por job, delegando la lógica real a `purgarHuellasOrigen()` de `src/infra/retencion.ts`).
- `src/app/api/internal/jobs/run/route.ts` — el único punto de entrada HTTP: `runtime = "nodejs"` (pg-boss necesita el pool `pg`, módulo `node:net`, no corre en Edge), `maxDuration = 60`, autenticado con `CRON_SECRET` vía comparación de tiempo constante (`timingSafeEqual`).
- `vercel.json` — el `cron` nativo apuntando a esa ruta con cadencia diaria.
- `.github/workflows/jobs-cron.yml` — el respaldo cada 15 minutos, con los secretos `APP_BASE_URL`/`CRON_SECRET` documentados en `SEGURIDAD-credenciales.md`.

## Consecuencias

**Positivas:** un solo despliegue, sin superficie de secretos nueva, sin costo adicional mientras el volumen de tráfico lo permita — coherente con el presupuesto $0/mes y con ADR-0001. La purga de `huellaOrigen` (la obligación vencida que motivó esta decisión) queda resuelta con un peor caso de ~96h (cadencia diaria de Vercel Hobby + margen), corrección de redacción ya aplicada sobre el rango original de 48-72h documentado en `requirements.md`, y muy por debajo del límite duro de 90 días.

**Negativas / riesgos, con mitigación:** sin la llamada fire-and-forget al encolar, cualquier job nuevo que no sea la purga (importación de CSV, recómputo de Market Signals) quedaría atado a una cadencia de hasta 24 horas en el peor caso — un usuario que sube un CSV vería "procesando" durante un día. La mitigación (llamada fire-and-forget en el mismo `boss.send()`, más el respaldo de GitHub Actions cada 15 minutos) ya está decidida y documentada arriba; falta aplicarla recién cuando se agregue el primer job además de la purga (Incremento 4).

**Reversibilidad:** alta. Pasar a Vercel Pro (Cron de 1 minuto, `maxDuration` extendido) es un cambio de configuración, no de arquitectura — se revisa este ADR y se sube de plan cuando (a) un job futuro necesite latencia menor a un día que la mitigación fire-and-forget no alcance a cubrir, o (b) el volumen de tráfico lo justifique económicamente, evaluado mes a mes según ya confirmó Alex (H14). Migrar de la Opción A a la Opción B (worker externo persistente) tampoco exige rediseñar los jobs ya escritos: `purgarHuellasOrigen()` y el resto de los handlers son funciones puras sobre un cliente de Prisma/PgBoss pasado por parámetro, desacopladas de cómo se disparan.

## Estado de aprobación

Aceptado por Alex: elección de `pg-boss` sobre Postgres/Neon el 2026-09-15; Opción A del worker (Vercel Cron + `boss.fetch()` por lotes), en plan Hobby con respaldo de GitHub Actions cada 15 minutos, el 2026-09-16, dentro de la restricción de presupuesto $0/mes evaluada mes a mes. Ya implementado y validado contra Neon real (`PLAN-DE-TRABAJO.md`, Bloque A del Incremento 2, incluyendo despliegue real en Vercel el 2026-09-16); este documento formaliza por escrito una decisión que faltaba como ADR propio (R5-10, Ronda 5).
