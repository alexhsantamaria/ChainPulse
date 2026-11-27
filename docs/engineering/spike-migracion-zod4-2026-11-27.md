---
title: Spike de diseño — migración a Zod 4
fecha: 2026-11-27
tipo: spike de solo lectura — ningún código ni dependencia fue modificado
alcance: inventario completo de uso de Zod en el repo + mapeo contra los cambios de ruptura reales de Zod 4, sobre `main @ b250086ddbf7015cafa5c4fef9f8038b5ce72f6d`
---

# Spike — migración de Zod 3.25.76 a Zod 4.6.7

Este documento es un diseño de solo lectura, parte de la Fase 3 del plan integral autorizado el 2026-11-27. No se modificó ningún archivo de código, `package.json` ni `package-lock.json`. Zod 4 queda explícitamente excluido de la PR de vulnerabilidades sin breaking changes (Fase 2) por instrucción expresa.

## 1. Estado actual

- Versión instalada: `zod@3.25.76` (lockfile). Rango declarado en `package.json`: `"zod": "^3.24.0"`.
- Última versión estable publicada: `zod@4.6.7` (`npm view zod version`, verificado hoy).
- Advisory que motiva la migración: `GHSA-mrhx-c7xc-m3w5` ("Zod can exhaust memory while validating oversized constrained collections"), rango vulnerable `<4.6.6`. **No existe ningún parche de esta vulnerabilidad dentro de la rama 3.x** — la única forma de resolverla es saltar a Zod 4, por eso `npm audit fix` (sin `--force`) no la toca y la deja fuera de la PR de Fase 2.
- Import usado en todo el repo: `import { z } from "zod"` (import nombrado clásico, nunca `"zod/v4"` ni `"zod/mini"`). Verificado: en Zod 4 el paquete `"zod"` resuelve directamente a la API v4 — no existe un subpath de compatibilidad v3 dentro del paquete `zod` (la única forma de seguir en v3 es fijar la versión, que es justamente el estado actual).

## 2. Inventario exacto de uso en este repo

31 archivos importan `zod` (todos bajo `src/app/api/**/schema.ts`, `src/app/api/**/route.ts` o `src/infra/auth/restablecerPasswordMantenimiento.ts` — ninguno en `src/engine/` ni en el motor de cálculo de KPIs, que no usa validación de esquema).

Frecuencia de combinadores usados (`grep -rhoE "z\.[a-zA-Z]+\(" src/`):

| Combinador | Usos | Afectado por Zod 4 |
|---|---|---|
| `z.string(` | 73 | Sí (ver 3.3) |
| `z.object(` | 29 | Sí, parcialmente (ver 3.5) |
| `z.enum(` | 24 | Sí (ver 3.2) |
| `z.boolean(` | 23 | No |
| `z.number(` | 6 | Sí (ver 3.6) |
| `z.array(` | 6 | No |
| `z.literal(` | 4 | No (ninguno usa símbolos) |
| `z.unknown(` | 3 | Sí (ver 3.5) |
| `z.union(` | 1 | No |

`.safeParse()`/`.parse()`: 46 sitios (todas las rutas API y `schema.ts` de la plataforma). `z.coerce.date()`: 8 sitios, todos en rutas de KPIs/cadenas. `z.record(`, `z.nativeEnum(`, `.merge(`, `.strict(`/`.passthrough(`, `superRefine`/`ctx.path`: **cero usos** — ninguno de estos cambios de ruptura aplica a este repo.

## 3. Cambios de ruptura de Zod 4 que sí aplican (confirmado contra [el changelog oficial](https://zod.dev/v4/changelog))

### 3.1 — Objetos de error: 5 sitios exactos a revisar

```
src/infra/auth/restablecerPasswordMantenimiento.ts:227 → resultado.error.issues[0]?.message
src/app/api/kpis/cobertura/importaciones/[id]/confirmar/route.ts:135 → parsed.error.flatten()
src/app/api/kpis/acciones/route.ts:72                            → parsed.error.flatten()
src/app/api/kpis/acciones/[id]/route.ts:53                       → parsed.error.flatten()
```
(el 5º hallazgo del grep original, `src/engine/kpis/compartido.ts:35`, es `formatter.format(fecha)` de `Intl.DateTimeFormat` — no tiene relación con Zod, falso positivo del patrón de búsqueda.)

- `error.issues` (el único sitio que lo usa) **sigue existiendo igual en Zod 4** — sin cambio.
- `.flatten()` (los 3 sitios restantes) queda **deprecado, no eliminado**, en Zod 4. Sigue funcionando sin cambios de comportamiento documentados. Migrar a `z.treeifyError()` es opcional, no bloqueante — recomendado por prolijidad, no por necesidad.
- **Riesgo real: bajo.** Ninguno de los 4 sitios requiere cambio de código para seguir funcionando.

### 3.2 — `z.enum()`: 24 usos, revisar acceso a valores

- `z.nativeEnum()` queda deprecado (no eliminado) — **no aplica, cero usos en el repo**.
- Cambia el acceso canónico a los valores de un enum: `Schema.enum.Valor` es ahora la forma soportada; `.Enum` y `.Values` se eliminan. **Hace falta un grep adicional en la implementación real** (no se hizo en este spike, por estar fuera del grep de combinadores) sobre `\.Enum\b` y `\.Values\b` encadenados a un schema `z.enum(...)` antes de implementar, porque si el repo accede a los valores de algún enum vía `.Enum`/`.Values` en vez de `.enum`, esos 2 sitios romperían en compilación (TypeScript) o en runtime.
- Riesgo: **medio, pendiente de un grep final antes de implementar** (no alto, porque 24 usos son todos de validación de entrada, no de iteración de valores, a juzgar por los endpoints involucrados — pero debe confirmarse, no asumirse).

### 3.3 — `z.string()` con formatos encadenados: 6 sitios usan `.email()`

```
src/app/api/plataforma/login/schema.ts:4        → z.string().trim().toLowerCase().email().max(320)
src/app/api/registro/route.ts:9                 → z.string().trim().email()
src/app/api/invitaciones/route.ts:12             → z.string().trim().toLowerCase().email()
src/app/api/recuperar-contrasena/route.ts:10     → z.string().trim().toLowerCase().email()
src/app/api/cadenas/[id]/invitar/route.ts:17     → z.string().trim().toLowerCase().email()
src/app/api/public/evaluations/[id]/unlock/route.ts:27 → z.string().email()
```
- `.email()` encadenado a `z.string()` queda **deprecado, no eliminado** — sigue validando igual. La forma recomendada (`z.email()` de nivel superior) es opcional. **Cero sitios usan `.url()`, `.uuid()`, `.ip()` o `.cidr()`** (los que sí tendrían cambios de comportamiento reales: `.uuid()` pasa a validar RFC 9562 estricto, `.ip()`/`.cidr()` se eliminan).
- Riesgo: **bajo.** Los 6 sitios siguen funcionando sin cambios; migrarlos a `z.email()` es cosmético.

### 3.4 — Mensajes personalizados: 15 sitios usan `message:` en `.refine()`

Todos los `message: "..."` encontrados están dentro de `.refine()`/`.superRefine()` (nunca en una opción de schema base tipo `invalid_type_error`/`required_error`, que son los que realmente se eliminan). El parámetro `message` dentro de `.refine()` **sigue soportado en Zod 4** (deprecado a favor de `error`, no eliminado). `errorMap` tiene 0 usos en el repo.

- Riesgo: **nulo.** Ningún sitio usa la forma que Zod 4 elimina.

### 3.5 — `z.object()` y `z.unknown()`: cambio de comportamiento real, no solo de API

- Desde Zod 4.4.0, `z.unknown()`/`z.any()` **ya no son opcionales por defecto en el tipo inferido** — la clave debe estar presente en tiempo de parseo salvo que se agregue `.optional()` explícitamente. Hay 3 usos de `z.unknown()` en el repo, los 3 en el mismo patrón: `opciones: z.unknown().refine((v) => v !== undefined, { message: "opciones requerido" })` (RF20, preguntas/cuestionarios). Este patrón **ya exige explícitamente que el valor no sea `undefined`** vía `.refine()` — es decir, el comportamiento nuevo de Zod 4 (exigir presencia) coincide exactamente con la intención ya codificada aquí. **No se espera ruptura**, pero sí conviene una prueba de caracterización explícita que fije este comportamiento antes de migrar (ver Sección 5).
- `.strict()`/`.passthrough()`/`.merge()`: 0 usos — no aplica.
- `z.coerce.date()` sobre una clave ausente ahora exige `.default()` o lanza error (antes no). Los 8 usos de `z.coerce.date()` del repo son todos sobre claves declaradas explícitamente en el schema (nunca sobre una clave que pueda faltar sin que el schema la marque `.nullish()`/`.optional()` ya) — 2 de los 8 ya usan `.nullish()`. Riesgo: **bajo-medio**, requiere revisar los 6 sitios sin `.nullish()`/`.optional()` para confirmar que siempre llega un valor (son todos campos obligatorios de fecha en payloads validados por TypeScript también del lado del cliente) — no se descarta sin esa revisión puntual.

### 3.6 — `z.number()`: cambios de rango

`.int()`/`.safe()` ahora solo aceptan enteros seguros (ya era la intención de `.int()`; `.safe()` deja de aceptar floats). 6 usos de `z.number()` en el repo — **no se identificó en este spike cuáles encadenan `.int()`/`.safe()`** (fuera del grep de combinadores de primer nivel); pendiente de confirmación puntual antes de implementar, mismo criterio que 3.2.

## 4. Veredicto de riesgo

**Riesgo global: bajo-medio**, no bajo-cero. El repo no usa ninguno de los patrones de Zod 4 que requieren reescritura obligatoria (nada de `z.record()`, `z.nativeEnum()`, `.merge()`, `superRefine`/`ctx.path`, `z.function()`, símbolos en `z.literal()`, `z.intersection()`). Los 2 puntos que sí exigen una revisión puntual antes de implementar (no solo correr la suite y ver qué falla) son 3.2 (`.Enum`/`.Values` en los 24 usos de `z.enum()`) y 3.6 (`.int()`/`.safe()` en los 6 usos de `z.number()`) — ambos de alcance acotado y verificables con un grep dirigido en minutos, no una auditoría extensa.

## 5. Plan de pruebas propuesto (si se aprueba implementar)

1. Grep dirigido de confirmación (`\.Enum\b`, `\.Values\b` tras `z.enum(`; `\.int\(\)`, `\.safe\(\)` tras `z.number(`) — cierra las 2 incógnitas de la Sección 3.
2. Prueba de caracterización nueva para los 3 usos de `z.unknown().refine(...)` de RF20 (Sección 3.5) que fije el comportamiento actual (ausencia de clave → error) antes de tocar nada, para detectar cualquier cambio real de Zod 4 en ese punto específico.
3. Bump de `zod` a `^4.6.7` en una rama aislada; correr la suite completa (sin integración) y `typecheck`; cualquier error de compilación de TypeScript en los 31 archivos listados en la Sección 2 debe mapear 1 a 1 contra un punto ya identificado en la Sección 3 — un error fuera de esa lista es señal de que el inventario quedó incompleto, no de un bug nuevo.
4. Migrar cosméticamente (opcional, mismo PR o uno posterior): `.flatten()` → `z.treeifyError()` en los 3 sitios de la Sección 3.1; `.email()` encadenado → `z.email()` en los 6 sitios de la Sección 3.3.

## 6. Esfuerzo estimado

**S-M.** El volumen de archivos (31) es manejable y la mayoría de los cambios de Zod 4 identificados como aplicables son no disruptivos (deprecados, no eliminados) o ya coinciden con el comportamiento que el repo ya exige explícitamente. El esfuerzo real está concentrado en las 2 verificaciones puntuales de la Sección 3 (enum/number) y en escribir la prueba de caracterización de la Sección 5.2 — no en reescribir validaciones existentes.
