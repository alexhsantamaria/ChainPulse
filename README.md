# ChainPulse

Producto SaaS multi-empresa que detecta dónde existe descoordinación entre áreas, procesos, personas y sistemas de una organización, identifica el eslabón más débil del flujo y recomienda qué mejorar primero, con seguimiento de avance en el tiempo.

## Estado

Fase 4 del prompt maestro de Bigdevelopment — en construcción. `requirements.md`, ADR-0001 y ADR-0002 están aprobados y consistentes entre sí (ver Sección 12 de `requirements.md` para la revisión final de viabilidad, GO para Fase 4). Ya existe el scaffolding inicial: proyecto Next.js + TypeScript + Tailwind + Prisma, el modelo de datos completo (`prisma/schema.prisma`), el motor v1 (`src/engine/`, funcion pura, sin Prisma ni Next — ADR-0002) con **19/19 pruebas unitarias pasando** (salud, criticidad, riesgo, RF7 con desempate determinista, RF16), el middleware de aislamiento multi-tenant (`src/infra/prisma/tenantClient.ts`) y las políticas RLS (`prisma/rls.sql`). `npx tsc --noEmit`, `npx eslint .` y `npx next build` corren limpios.

**Bloqueo de entorno a resolver antes de seguir:** `npx prisma generate` (y por lo tanto `prisma validate`/`prisma migrate`) no pudo ejecutarse en la sesión de Claude que armó este scaffolding — `binaries.prisma.sh` está bloqueado por la política de red de ese entorno (403, `blocked-by-allowlist`), tanto en el contenedor en la nube como en este Mac. Correr `npm run prisma:generate` en una máquina con acceso normal a internet (esta misma Mac fuera de la sesión de Claude, o cualquier CI) debería bastar — el schema en sí no depende de ningún host bloqueado, solo el binario del motor de Prisma.

## Documentos

- [`requirements.md`](./requirements.md) — actores, glosario, requisitos funcionales y no funcionales, criterios de aceptación y alcance explícito del MVP. Aprobado, con cinco rondas de decisiones registradas: Sección 9 (modelo de puntaje y evaluación exprés), Sección 10 (niveles de visualización), Sección 11 (análisis multi-rol del estado acumulado) y Sección 12 (revisión final de viabilidad, cierre de todos los pendientes y valores numéricos de calibración inicial — GO para Fase 4).
- [`docs/ADR/0001-arquitectura-inicial.md`](./docs/ADR/0001-arquitectura-inicial.md) — decisión de stack y arquitectura del MVP. Aceptado, incluidas las precisiones de la quinta ronda (`ruleVersion` único, gate de presentación, campos de tipo de flujo/estado).
- [`chainpulse_end_to_end.md`](./chainpulse_end_to_end.md) — especificación de producto más profunda y de más largo plazo (visión, no literal): recorrido de usuario, motor de diagnóstico, contratos de datos, arquitectura propuesta. Se usa como referencia, reconciliada por ADR-0002.
- [`docs/ADR/0002-alcance-escalonado-end-to-end.md`](./docs/ADR/0002-alcance-escalonado-end-to-end.md) — análisis de viabilidad multi-rol (Producto, CTO, Full-Stack, UX/UI, QA, Seguridad, Negocio), reconciliación de conflictos entre `requirements.md`/ADR-0001 y `chainpulse_end_to_end.md`, y hoja de ruta por incrementos. Aceptado, sincronizado con RF16-RF18 y el teléfono opcional de RF13.

## Cómo levantar el proyecto

```bash
npm install
npm run prisma:generate   # necesita acceso real a binaries.prisma.sh — ver "Estado"
npm run typecheck         # tsc --noEmit
npm run lint               # eslint .
npm run test               # vitest run — 19 pruebas del motor v1
npm run dev                 # Next.js en http://localhost:3000
```

`prisma/schema.prisma` necesita una base PostgreSQL real para `npm run prisma:migrate`; después de esa migración, aplicar `prisma/rls.sql` (ver el comentario al inicio de ese archivo — no se pudo probar en vivo desde esta sesión, sin una base disponible).

## Próximo paso

Con el scaffolding y el motor v1 ya construidos y probados, lo que sigue del Incremento 1: conectar el motor a Prisma real (una vez `prisma generate` corra con red), las rutas de Next.js para RF1-RF10 (cuenta completa) y RF11-RF18 (evaluación exprés con el gate macro/detalle), el formulario de RF3 con la agrupación visual que recomendó UX/UI, y las pruebas de integración de aislamiento multi-tenant (RNF1) con datos reales de las dos empresas piloto — antes de tocar el mapa visual (Incremento 2).
