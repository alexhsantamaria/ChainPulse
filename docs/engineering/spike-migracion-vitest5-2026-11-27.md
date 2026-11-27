---
title: Spike de diseño — migración a Vitest 5
fecha: 2026-11-27
tipo: spike de solo lectura — ningún código, configuración ni dependencia fue modificado
alcance: inventario completo de configuración y uso de mocks en la suite + mapeo contra los cambios de ruptura reales de Vitest 5, sobre `main @ b250086ddbf7015cafa5c4fef9f8038b5ce72f6d`
---

# Spike — migración de Vitest 3.2.7 a Vitest 5.1.2

Spike de solo lectura, Fase 3 del plan integral autorizado el 2026-11-27. No se modificó `vitest.config.ts`, `vitest.integration.config.ts`, ningún archivo de prueba, `package.json` ni `package-lock.json`. Vitest 5 queda explícitamente excluido de la PR de vulnerabilidades sin breaking changes (Fase 2) por instrucción expresa — el salto 3→5 es, además, de dos versiones mayores completas (Vitest 4 se salta por completo).

## 1. Por qué está atado a una cadena de 3 vulnerabilidades, no es solo "una mejora opcional"

`npm audit fix --dry-run` (sin `--force`) deja sin resolver, todos atados a esta misma migración:
- `@vitest/mocker` (moderada) — Path Traversal / Code injection, fix solo vía `vitest@5.1.2`.
- `tinypool` (crítica) — Prototype Pollution → RCE, fix solo vía `vitest@5.1.2`.
- `glob`/`minimatch` (moderadas, 2 advisories) — fix solo vía `@vitest/coverage-v8@5.1.2`, que a su vez exige `vitest@5.1.2`.

Es decir: **4 de las 8 vulnerabilidades no resueltas en la Fase 2** dependen exclusivamente de esta migración. No es deuda cosmética.

## 2. Requisitos previos (confirmados, no deducidos)

- Vitest 5 exige Vite `>=6.4.0` y Node.js `>=22.12.0`. Vite instalado tras la Fase 2 queda en `7.3.8` — cumple de sobra. Node del bridge Mac es `v22.23.5` — cumple. **Pendiente de confirmar, no verificado en este spike:** la versión de Node del entorno de CI/Vercel y del clon nativo de Windows — si alguno fija Node `<22.12.0`, bloquea la migración antes de llegar siquiera a los tests.
- `vite` pasa a ser **peerDependency obligatoria** de Vitest 5 (antes era dependencia directa transitiva). Con npm (no yarn) esto no debería requerir acción explícita, pero conviene confirmarlo en el `npm ci` de validación.

## 3. El cambio de mayor impacto real: `clearMocks` pasa a `true` por defecto

- Ni `vitest.config.ts` ni `vitest.integration.config.ts` configuran `clearMocks`, `mockReset` ni `restoreMocks` explícitamente (confirmado por grep sobre ambos archivos y sobre todo `src/`) — la suite completa corre hoy bajo el default **anterior** (`clearMocks: false`). Vitest 5 cambia ese default a `true`: antes de cada test se llama automáticamente a `vi.clearAllMocks()` (se limpia el historial de llamadas; las implementaciones de `mockImplementation`/`mockResolvedValue` **se conservan**, solo se borra el historial de invocaciones).
- Inventario real de exposición:
  - **90 archivos** usan `vi.fn(`/`vi.spyOn(`.
  - **74 archivos** usan `vi.mock(`/`vi.hoisted(` (ninguno los llama dentro de un `describe`/`test`/callback — los 74 son top-level, que es el único lugar permitido en Vitest 5; **cero migraciones forzadas por esta regla**).
  - De esos 90, **65 ya llaman explícitamente** `vi.clearAllMocks()`/`vi.resetAllMocks()`/`vi.restoreAllMocks()` (verificado por grep de esas 3 llamadas) — ya sea en un `beforeEach`/`afterEach` propio del archivo. Estos **65 no deberían verse afectados**: ya limpian el historial manualmente en cada test, el nuevo default es redundante, no conflictivo, para ellos.
  - Quedan **25 archivos** que usan mocks pero no llaman a ninguna de esas 3 funciones en ningún punto del archivo — estos son el **riesgo real**: si alguno de ellos tiene una aserción de tipo `.toHaveBeenCalledTimes(N)` o `.toHaveBeenCalledWith(...)` que depende de que una llamada hecha en `beforeAll`, en código de setup a nivel de módulo, o en un test anterior del mismo archivo, siga contando, esa aserción puede romper bajo Vitest 5 (porque el historial se limpia antes de cada test, no solo una vez al inicio del archivo).
- **Lo que este spike NO hizo** (correspondería a la implementación, no al diseño): abrir los 25 archivos uno por uno y confirmar si alguna aserción de conteo de llamadas cruza la frontera de un test a otro. Es un trabajo acotado (25 archivos) pero manual — no se puede inferir de forma segura por grep.

## 4. Otros cambios de ruptura de Vitest 5 revisados contra este repo

| Cambio | ¿Aplica a este repo? | Evidencia |
|---|---|---|
| `test.sequential`/`describe.sequential` eliminados (usar `concurrent: false`) | **No** | 0 usos (grep sobre `src/` y ambos configs) |
| `vi.mock`/`vi.hoisted` dentro de un bloque ahora lanza error (antes solo advertía) | **No** | Los 74 usos son top-level |
| `fileParallelism`/`pool`/`poolOptions`/aislamiento por defecto | **No hay cambios documentados** | `vitest.integration.config.ts` usa `fileParallelism: false` por una razón de contención con Neon ya documentada en el propio archivo — la guía de migración no menciona cambios a esta opción |
| Config ya no se busca en directorios padre | **No afecta** | Ambos `vitest.config.ts`/`vitest.integration.config.ts` ya están en la raíz del repo (= cwd de `npm run test`/`test:integration`), y `test:integration` ya pasa `--config` explícito |
| `coverage.include`/`exclude`: coincidencia ahora es contra ruta relativa al proyecto, sin "contains" implícito | **Riesgo bajo, revisar** | El `include`/`exclude` actual de `vitest.config.ts` ya usa globs completos (`"src/**/*.ts"`, `"src/**/__tests__/**"`), no nombres de directorio sueltos — el patrón que cambia de comportamiento (`'src'` a secas) no está presente, pero conviene correr `test:coverage` tras el bump y comparar el listado de archivos cubiertos contra el actual antes de dar por sentado que no cambia nada |
| `vitest/coverage` entrypoint eliminado (usar `vitest/node`) | **Sin evidencia de uso** | 0 imports de `"vitest/coverage"` encontrados en `src/`, `scripts/` ni configs — pendiente de confirmar con un grep final antes de implementar, no se hizo en este spike por estar fuera del foco de mocks/config |
| Clases mockeadas (`vi.fn(Clase)`, `vi.spyOn` sobre prototipo) ahora encadenan el prototipo real | **No evaluado en este spike** | Requeriría identificar, de los 90 archivos con `vi.fn`/`vi.spyOn`, cuáles mockean una clase completa en vez de una función/método suelto — no se hizo la distinción en este spike; bajo riesgo esperado porque el patrón dominante visible en los nombres de archivo es mock de funciones de Prisma/servicios, no de clases, pero queda como pendiente de confirmación antes de implementar |
| Tipos de `expect`: `Assertion<R, T>` ahora toma 2 parámetros; matchers custom deben extender `Matchers<R, T>` | **Revisar si hay matchers custom** | No se encontró ningún archivo de setup de matchers custom (`expect.extend(`) en el grep de esta sesión — si no existe, este punto no aplica; confirmar con `grep -rn "expect.extend("` antes de implementar |
| `toThrow('')` deja de exigir mensaje vacío exacto (ahora matchea cualquier mensaje) | **No evaluado** | Requeriría grep de `toThrow\(['"]{2}\)` — no se hizo en este spike, riesgo esperado bajo (patrón de uso poco común) |

## 5. Veredicto de riesgo

**Riesgo global: medio**, concentrado casi por completo en un solo punto: los **25 archivos de test que usan mocks sin limpieza explícita propia** (Sección 3). Todo lo demás revisado (`sequential`, hoisting de `vi.mock`, parallelism, config discovery, coverage include/exclude) da **riesgo nulo o bajo** para este repo específico, con evidencia concreta (greps) en vez de inferencia genérica del changelog.

## 6. Plan de pruebas propuesto (si se aprueba implementar)

1. Grep final de cierre de las 4 incógnitas menores de la Sección 4 (`vitest/coverage`, `expect.extend(`, `toThrow\(['"]{2}\)`, mocks de clase) — todas acotadas, minutos de trabajo.
2. Revisión manual, uno por uno, de los 25 archivos identificados en la Sección 3 — confirmar si alguna aserción de conteo/llamada cruza la frontera entre tests o depende de una llamada hecha en `beforeAll`/nivel de módulo.
3. Bump de `vitest`/`@vitest/coverage-v8` a `5.1.2` en una rama aislada; correr primero la suite unitaria completa (`npm run test`) y comparar fallos contra la lista de 25 archivos de la Sección 3 — cualquier fallo fuera de esa lista es señal de que el inventario quedó incompleto.
4. Correr `npm run test:coverage` y comparar el listado de archivos cubiertos contra el reporte actual, por el cambio de matching de `coverage.include`/`exclude` (Sección 4).
5. Correr la suite de integración (`npm run test:integration`, requiere Windows/Neon, fuera del alcance de este bridge) por separado, dado que depende de `fileParallelism: false` y una base real — no se espera impacto, pero no se valida en el Mac.

## 7. Esfuerzo estimado

**M.** Más alto que el spike de Zod 4: aunque la mayoría de los cambios de Vitest 5 no aplican a este repo (tabla de la Sección 4, casi todo "No"/riesgo nulo), el único punto que sí aplica (Sección 3) exige revisión manual de 25 archivos de prueba uno por uno — no es automatizable con grep ni se puede descartar sin abrir cada archivo, a diferencia de los puntos acotados del spike de Zod.
