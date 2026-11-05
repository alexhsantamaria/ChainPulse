# RF19/RF20 — Expediente de cierre, v6 (2026-11-05)

**Estado: PREPARADO / NO EJECUTADO.** Dos correcciones de driver/SQL sobre v5, reportadas por Alex después de correr v5 de verdad contra producción en modo de solo lectura (16 confirmaciones, 24 falsos positivos sistemáticos). Ninguna corrección de esta ronda se probó ni se ejecutó contra Neon — se razonaron y se escribieron únicamente a partir del reporte de Alex y del comportamiento documentado del driver `pg` de Node. No hubo conexión a Neon, no hubo commit.

## I. Enums — `json_agg` en vez de `array_agg`

La consulta anterior:

```sql
SELECT t.typname AS nombre, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS valores
FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname IN ('AccionBitacoraVersion', 'BucketLimiteTasa')
GROUP BY t.typname
```

`array_agg(e.enumlabel ...)` produce una columna de tipo `name[]` (o similar), para la que el driver `pg` de Node puede no tener un parser de arreglo registrado — en ese caso la fila llega con `valores` como el literal de texto crudo de PostgreSQL (`"{CORREGIR,PUBLICAR,RETIRAR}"`, una sola cadena), no como una lista. La comparación en PowerShell (`$valoresReales = @($enumAccion.valores) | Sort-Object`, pensada para un arreglo) envolvía esa cadena única en un arreglo de 1 elemento y nunca coincidía contra las 3 etiquetas esperadas por separado — brecha sistemática en ambos enums, consistente con lo que Alex reportó.

Ahora:

```sql
SELECT t.typname AS nombre, json_agg(e.enumlabel ORDER BY e.enumsortorder) AS valores
FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname IN ('AccionBitacoraVersion', 'BucketLimiteTasa')
GROUP BY t.typname
```

`json_agg` produce una columna de tipo `json`, y `pg` **siempre** parsea `json`/`jsonb` llamando a `JSON.parse` internamente — llega como un arreglo JS real, sin ambigüedad de tipo. **La lógica de comparación en PowerShell no cambió**: ya esperaba un arreglo: el problema nunca fue esa lógica, sino lo que la consulta entregaba.

## II. Firmas de función — `oidvectortypes(p.proargtypes)` en vez de `pg_get_function_identity_arguments(p.oid)`

`pg_get_function_identity_arguments(p.oid)` puede incluir el nombre de cada parámetro junto a su tipo, no solo los tipos — rompiendo la comparación directa contra cadenas de solo-tipos como `"text, text"` en el inventario de las 21 funciones. `oidvectortypes(p.proargtypes)` devuelve exclusivamente la lista de tipos, separada por coma y espacio, exactamente en la forma que el script ya esperaba (`"text"`, `"text, text"`, `"text, text, text, integer, text, text, jsonb, boolean"`, etc. — confirmado contra `format_type`, que es lo que `oidvectortypes` usa internamente: `integer` para int4, `boolean` para bool, `jsonb` para jsonb, igual que las cadenas ya codificadas en el inventario).

Se conserva `pg_get_function_identity_arguments(p.oid)` como campo informativo adicional (`firma_con_nombres`), sin usarlo en ninguna comparación — aparece solo dentro del mensaje de brecha de firma, por si ayuda a diagnosticar visualmente una discrepancia real de tipos.

## Nota sobre el origen de los 24 falsos positivos

No puedo confirmar con certeza absoluta, sin haber corrido yo mismo el script contra producción, qué proporción exacta de los 24 falsos positivos vino de cada una de las dos causas — pero la aritmética es consistente: 2 enums (cada uno generando al menos 1 brecha de "valores distintos de los esperados", más la pérdida de su confirmación correspondiente) explican una fracción pequeña; si una buena parte de las 21 funciones tenían nombres de parámetro en su firma real (cosa plausible si todas siguen la convención `p_algo` vista en las funciones que sí pude leer directamente, como `leer_mfa_plataforma(p_usuario_id text)`), el resto de los 24 falsos positivos es coherente con brechas de firma repetidas across varias de las 21 funciones. Esto es una inferencia razonable sobre la causa, no una cifra verificada — el expediente de resultado real que escriba la próxima corrida de v6 confirmará si ambas correcciones fueron suficientes para volver a 0 brechas (asumiendo que el resto del estado de producción sigue siendo correcto).

## 4. Escritura atómica del expediente real

El script ya escribía el expediente de resultado real (`expediente-cierre-rf19-rf20-resultado-real.md`) solo **después** de completar todas las comparaciones (Sección 4), nunca durante — un aborto en cualquier punto anterior salta directo al `catch`, sin llegar a la Sección 5. Eso ya garantizaba "sobrescribe solo después de completar la auditoría" en el sentido de *secuencia*.

v6 refuerza esa garantía en el sentido de *atomicidad de la escritura en disco*: el contenido nuevo se escribe primero en un archivo temporal con nombre único, en la misma carpeta, y solo se reemplaza el expediente real anterior mediante `Move-Item -Force` — un renombrado, que en el mismo volumen es una operación atómica a nivel de sistema de archivos. Si algo fallara durante la escritura del archivo temporal (disco lleno, permisos, etc.), el expediente real anterior queda completamente intacto; nunca se sobrescribe parcialmente. El archivo temporal se registra en la misma lista de limpieza (`$RutasTemporales`) que ya usa el `.cjs` de verificación, así que el `finally` lo recoge igual si algo fallara entre la escritura y el renombrado.

## Lo que NO cambió en esta ronda (por instrucción explícita de Alex)

Ninguna otra comprobación, ni las garantías de solo lectura (`SET default_transaction_read_only = on`), validación de `sslmode` (v5), restauración/limpieza verificada en el `finally`, ni las precondiciones de git (rama `main`, árbol limpio, `HEAD == origin/main` vía `git fetch --prune`) — todo exactamente igual que en v5.

## Verificación mecánica del script entregado (de su contenido, no de su ejecución)

- 1279 líneas, 71388 bytes.
- Sin BOM, 0 bytes `\r`, cero bytes no-ASCII.
- Balance de `{}`/`()`/`[]` correcto (216/216, 635/635, 78/78).
- El bloque de código Node embebido (16688 caracteres, 20 llamadas a `client.query`) pasó `node --check`. `json_agg` aparece 2 veces en la consulta real de enums; las 2 apariciones de la cadena "array_agg" que quedan en el archivo están dentro de un comentario explicativo, nunca en SQL real — confirmado leyendo el contexto de cada una. `oidvectortypes` aparece exactamente una vez, en la consulta real de metadata de funciones. Cero `INSERT INTO`/`UPDATE `/`DELETE FROM`/`DROP `/`CREATE `/`ALTER `/`GRANT `/`REVOKE `/`TRUNCATE` como sentencia SQL enviada por `client.query`.
- `node -e` aparece una sola vez, en el comentario del encabezado; `npx` no aparece en absoluto.
- Exactamente una invocación real de `node <ruta>` y una de `git fetch`.

## Qué sigue

1. Alex revisa v6 (script + este expediente).
2. Sigue sin ejecutarse ni conectarse a Neon desde aquí. Cuando Alex decida correrlo, lo hace él mismo en su clon de Windows, desde `main`, árbol limpio y sincronizado con `origin/main`, con la URL incluyendo `sslmode=require` o `sslmode=verify-full`.
3. El resultado real (`expediente-cierre-rf19-rf20-resultado-real.md`) se genera, de forma atómica, en ese clon — reemplazando al anterior solo si la auditoría completa terminó y el archivo nuevo se escribió por completo. La incorporación a GitHub la hace Alex por su propio flujo.
