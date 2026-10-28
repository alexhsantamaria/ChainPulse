# RF24 — Derechos de titulares de datos: despliegue en producción (2026-10-28)

**Estado:** Desplegado y certificado en producción. Este directorio consolida los artefactos finales del despliegue, para referencia y auditoría futura.

## 1. Cronología

| Hora (local, America/Bogota) | Evento | Resultado |
|---|---|---|
| 10:34–10:41 | Wrapper de producción invoca `rf24-produccion-aplicar-migraciones-v8-bloqueado.ps1`. Identidad del script v8 confirmada antes de ejecutarlo. `prisma migrate deploy` aplica las 6 migraciones de RF24. | `RF24_PROD_MIGRACION_EXIT=0` |
| 10:41:21 | Postcheck **integrado** en el mismo script v8 (validación de firma de funciones vía la ruta antigua `pg_get_function_identity_arguments`) se detiene por un **falso positivo conocido** de esa ruta de validación. | `BLOQUEADO` — código de salida global **80** |
| 12:18–12:20 | Verificador **independiente** post-deploy de solo lectura `rf24-post-deploy-verificacion-solo-lectura-v3.ps1` (vía `oidvectortypes`, que no sufre el falso positivo) revalida el esquema completo: migraciones, enums, tablas, privilegios, PK, CHECK, FK, índices, patrón de función corregido, las 12 firmas de función, RLS/políticas. | Código de salida final **0** |
| 12:20 local (17:20 UTC) | Persistencia del JSON crudo de verificación y del reporte final, inmediatamente al concluir la verificación v3. | `"resultado": "TODO_OK"` |

**Puntos clave de esta cronología:**

- La aplicación real de las 6 migraciones a producción (el evento irreversible) ocurrió una sola vez, a las 10:34–10:41, y terminó con éxito (`exit 0` en `prisma migrate deploy`).
- El código de salida **80** del wrapper no indica un fallo de la migración ni de la base de datos: es el propio postcheck integrado de la versión v8 del script, que usaba `pg_get_function_identity_arguments` para comparar firmas — una ruta con un falso positivo ya conocido y corregido en el verificador v3 (que usa `oidvectortypes`). El log de este evento se conserva íntegro y sin alterar; **no se presenta como una corrida global exitosa (exit 0)**, sino como lo que fue: aplicación de migraciones con éxito, seguida de un postcheck interno bloqueado por ese defecto conocido.
- La certificación real y completa del esquema post-deploy proviene de la verificación **independiente** v3 (12:18–12:20), que sí concluyó con código de salida 0 y validó explícitamente las firmas correctas.
- Conteos finales reportados (informativos, nunca bloqueantes): `solicitudes_derechos = 0`, `intentos_solicitud_derechos_descartados = 0`.

## 2. Resultado final

```
TODO_OK
```
(según `reporte-verificacion-post-deploy.json`, persistido 2026-10-28T17:20:20Z)

## 3. Archivos incluidos

### `scripts/operations/rf24/`

| Archivo | Propósito |
|---|---|
| `rf24-produccion-aplicar-migraciones-v8-bloqueado.ps1` | Procedimiento de producción v8 — versión ejecutada realmente para aplicar las 6 migraciones de RF24. Su nombre conserva el sufijo `-bloqueado` por diseño: el script se detiene (bloquea) salvo que se le pasen explícitamente las autorizaciones y confirmaciones requeridas en cada compuerta. |
| `rf24-post-deploy-verificacion-solo-lectura-v3.ps1` | Verificador post-deploy de solo lectura v3 — independiente de v8, nunca modifica datos, usado para la certificación final real del esquema. |
| `rf24-prueba-cardinalidad-v1.ps1` | Prueba de regresión dedicada: cubre cardinalidades 0/1/N de cada colección de riesgo dentro de v3, bajo `Set-StrictMode -Version Latest` (defecto real que motivó v3). |
| `rf24-prueba-firma-oidvectortypes-v1.ps1` | Prueba de regresión dedicada: confirma que v3 usa `oidvectortypes` (correcto) y no `pg_get_function_identity_arguments` (el que produjo el falso positivo del código 80 descrito arriba). |

### `docs/operations/rf24/2026-10-28/`

| Archivo | Propósito |
|---|---|
| `evidencia-punto-restauracion-rf24-20261028.json` | Evidencia no secreta del punto de restauración / rama de respaldo de Neon creado antes del despliegue (proyecto, región, rama, id del punto, fecha, estado, host — ningún secreto). Clasificación: **DECLARADO**, nunca verificado contra la API de Neon por ningún script de esta serie. |
| `rf24-deploy-v8-migraciones-aplicadas-postcheck-bloqueado-80.log` | Salida completa y sin alterar (salvo el nombre) del evento de las 10:34–10:41 descrito en la cronología: aplicación real de las 6 migraciones (éxito) seguida del postcheck integrado bloqueado (código 80). Ver nota de codificación más abajo. |
| `rf24-post-deploy-v3-verificacion.log` | Salida completa de la verificación independiente v3 (12:18–12:20), código de salida final 0. |
| `verificacion-post-deploy-cruda.json` | JSON crudo que v3 persiste en disco antes de convertirlo (nunca contiene credenciales) — detalle completo de migraciones, enums, tablas, PK/CHECK/FK/índices, funciones y ACL reales verificados. Incluido como respaldo del reporte final. |
| `reporte-verificacion-post-deploy.json` | Reporte final post-deploy. `"resultado": "TODO_OK"`. |
| `SHA256SUMS.txt` | Manifiesto de integridad de todos los archivos de este directorio y de `scripts/operations/rf24/`. |

## 4. Deliberadamente excluido

- Versiones intermedias/fallidas v1–v7 del procedimiento de producción y de los wrappers/arneses de prueba asociados.
- Diffs/parches intermedios entre versiones.
- Informes de auditoría sobre versiones ya superadas.
- La copia duplicada del log del evento de despliegue en otra codificación de texto (ver nota de codificación).
- Cualquier URL de conexión, usuario o contraseña — no se encontró ninguno en los archivos incluidos (barrido de secretos realizado antes de copiar).
- La rama de respaldo de Neon en sí: se documenta su evidencia no secreta, pero no se elimina ni se trata como descartable. Su gestión/retención queda fuera del alcance de este PR.

## 5. Nota de codificación

`rf24-deploy-v8-migraciones-aplicadas-postcheck-bloqueado-80.log` se conserva exactamente como se generó (transcript nativo de PowerShell), en **UTF-16LE con BOM**, con fin de línea CRLF. No se alteró ni transcodificó, para preservar su hash original byte a byte. Herramientas de texto genéricas (`cat`, la vista previa por defecto de GitHub) pueden mostrarlo con espaciado o caracteres incorrectos; para leerlo correctamente:

- PowerShell: `Get-Content -Encoding Unicode .\rf24-deploy-v8-migraciones-aplicadas-postcheck-bloqueado-80.log`
- Linux/Mac: `iconv -f UTF-16LE -t UTF-8 rf24-deploy-v8-migraciones-aplicadas-postcheck-bloqueado-80.log`

## 6. Sobre la verificación de identidad de v8

El script `rf24-produccion-aplicar-migraciones-v8-bloqueado.ps1` incluido en este PR tiene SHA-256 `3f5647f4a8ff0742e49c5272f1ce774f974cd6ebf50c407b208873c2566c1aca` (ver `SHA256SUMS.txt`), idéntico al verificado en rondas anteriores de este mismo trabajo. Esta nota aclara, por precisión: ese hash identifica el **archivo del script**, confirmado de forma independiente en este PR; no es un valor que aparezca impreso textualmente dentro del log de ejecución (`rf24-deploy-v8-migraciones-aplicadas-postcheck-bloqueado-80.log`), que registra la salida del wrapper pero no una línea explícita de verificación de hash del propio script v8.

## 7. Recuperación / rollback

- El punto de restauración / rama de respaldo de Neon declarado en `evidencia-punto-restauracion-rf24-20261028.json` es el mecanismo de recuperación previsto si fuera necesario revertir el esquema. Su existencia real y utilizabilidad deben confirmarse directamente contra la consola o el CLI de Neon — ningún script de esta serie lo verifica de forma independiente.
- Las 6 migraciones aplicadas son aditivas (nuevo enum, nueva tabla, nuevas funciones, revocación de privilegios directos, correcciones de referencia ambigua) — ver los archivos de migración en `prisma/migrations/` en este mismo repositorio para el detalle exacto de cada una.
- El verificador `rf24-post-deploy-verificacion-solo-lectura-v3.ps1` puede re-ejecutarse en cualquier momento contra producción (es de solo lectura) para reconfirmar el estado del esquema sin riesgo.
