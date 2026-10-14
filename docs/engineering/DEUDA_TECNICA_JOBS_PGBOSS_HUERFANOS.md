# Deuda técnica — dos jobs de pg-boss en estado `active` en `procesar-importacion-csv`

**Estado:** verificado de solo lectura. Conservados deliberadamente sin intervención por decisión explícita de Alex (2026-10-13/14). No son trabajo pendiente de recuperar — son evidencia retenida.

## Alcance y entorno de verificación

Esta verificación se hizo exclusivamente contra la rama temporal de Neon `cobertura-cierre-validacion-20261010`. No se consultó producción. Lo que sigue describe el estado observado en esa rama temporal en el momento de la verificación (2026-10-13), no el estado de producción.

## Qué son

Dos jobs de pg-boss en la cola `procesar-importacion-csv`, verificados en esa rama temporal:

| | Job 1 | Job 2 |
|---|---|---|
| `id` | `f4e8e587-fb2d-4d82-b447-3f9f81f910e5` | `b19d88e4-4b67-4739-9eff-838acebe3c9b` |
| `state` | `active` | `active` |
| `singleton_key` / `data.importId` | `cmugznxrz00030gufcfcmtz5i` | `cmukrvoi800033ouf50vvpgvn` |
| `data.empresaId` | `abf6b9a7-9b3c-4bbf-ac21-24b06284068c` | `e7af5351-a5a7-4e03-b684-e8f1a3840e22` |
| `created_on` | 2026-09-25 | 2026-09-28 |
| `keep_until` (vencido) | 2026-10-09 | 2026-10-12 |
| `retry_count` / `retry_limit` | 0 / 3 | 1 / 3 |

### Por qué permanecen `active` bajo la configuración observada

Con `supervise: false` en `src/infra/jobs/pgBoss.ts` (deliberado para el runtime serverless — ver `docs/ADR/0004-cola-de-jobs.md`) y sin un mecanismo de mantenimiento o recuperación ejecutado por ChainPulse, estos jobs no volvieron a ser elegibles durante el período observado y permanecieron `active`.

## Hechos verificados, inferencia técnica y desconocidos

**Hechos verificados (solo lectura, rama temporal, con `ROLLBACK` explícito):**

- existen exactamente dos jobs en la cola `procesar-importacion-csv` en esa rama;
- ambos continúan en estado `active`;
- sus `keep_until` ya vencieron;
- en cada job, `singleton_key` coincide con `data.importId`;
- las filas de `importaciones_csv` correspondientes a ambos `data.importId` no existen en esa rama;
- la verificación completa terminó con `ROLLBACK`, sin ningún `COMMIT`, `INSERT`, `UPDATE` ni `DELETE`.

**Inferencia técnica (no verificada directamente, pero consistente con el código y la configuración observados):**

- la combinación de `supervise: false` y la ausencia de un mecanismo de mantenimiento ejecutado explícitamente por ChainPulse explica probablemente por qué estos dos jobs permanecieron `active` durante el período observado.

**Desconocido:**

- no se determinó qué interrupción concreta dejó cada job en `active` (por ejemplo, si el proceso se cerró a mitad de `procesarUnaImportacionCsv`, un timeout, u otro evento).

## Por qué no son trabajo recuperable

Las filas correspondientes de `importaciones_csv` (una por cada `data.importId`) no existen en la rama temporal verificada. Sin la fila de origen, un reintento, un `retry()` o `recuperarJobActivoVencidoPorId()` no podría completar el trabajo original — solo produciría un fallo adicional o un ciclo inútil contra una importación inexistente.

## Decisión vigente del propietario (2026-10-13/14)

- conservar ambos jobs, en su estado actual, como evidencia;
- no recuperarlos;
- no reintentarlos;
- no eliminarlos;
- no cambiar su estado de ninguna otra forma;
- cualquier intervención futura sobre estos jobs requiere su propia autorización explícita y separada — nunca un `DELETE`/`UPDATE` genérico por nombre de cola o por antigüedad, y, si llegara a autorizarse una limpieza puntual, con predicado defensivo exacto (los dos `id`, `name`, `state='active'`, `singleton_key` y `data.importId`/`data.empresaId` exactos, confirmación repetida de que las importaciones siguen ausentes, conteo antes/después = 2, `ROLLBACK` ante cualquier discrepancia).

## Backlog para una futura v6 del preflight (no construida en esta ronda)

Registrado como trabajo futuro, pendiente de autorización explícita y de su propia ronda de pruebas offline — nada de esto se construye ni se aplica en esta ronda:

- eliminar la dependencia de `System.Web` (reemplazar `[System.Web.HttpUtility]::ParseQueryString` por un parseo manual de la query string, extendiendo la técnica que v5 ya usa para usuario/contraseña con `[System.Uri]::UnescapeDataString`);
- evaluar y probar `BEGIN READ ONLY` como alternativa a `BEGIN TRANSACTION ISOLATION LEVEL READ ONLY` (v5 falló con la segunda forma en Windows PowerShell real; la causa exacta no se determinó porque v5 oculta el detalle crudo del error a propósito);
- no fijar todavía `NODE_NO_WARNINGS=1` de forma permanente en el script;
- capturar stdout y stderr por separado, en vez de combinarlos;
- reconocer explícitamente solo la advertencia ya conocida de `pg` sobre `sslmode=require`;
- tratar como fallo cualquier otro contenido de stderr, la ausencia de la línea `NODE_GATE_RESULT`, un error de conexión, una identidad (base/rol) incorrecta, o la falta de confirmación de `ROLLBACK`;
- conservar diagnósticos sanitizados por etapa (incluyendo SQLSTATE y severidad cuando estén disponibles), sin credenciales, URLs completas ni mensajes crudos.

## Evidencia completa

La investigación y la cadena de verificación completas de este hallazgo viven en el Project externo "Bigdevelopment" (Claude), no en este repositorio — no son archivos versionados de ChainPulse, por eso no se enlazan aquí como enlaces Markdown:

- `chainpulse/cierre-verificacion-jobs-pgboss-rama-temporal-2026-10-13.md`
- `chainpulse/auditoria-jobs-pgboss-active-chainpulse-2026-10-13.md`
