# Cierre de Fase 0 — medición real de rendimiento de PR4

**Fecha:** 2026-11-23
**Código medido:** `main` @ `ee515a2c96b97d66dba53e703d911c0704ade593`
**Entorno:** Preview temporal de Vercel conectado exclusivamente a una rama temporal de Neon creada desde `production`.

## 1. Alcance y compuertas

La medición cerró los dos criterios de aceptación que permanecían pendientes en PR4:

- `EXPLAIN ANALYZE` real contra PostgreSQL;
- carga HTTP controlada con p50, p97.5 y p99.

Antes de sembrar o generar carga se verificaron el SHA, la rama Git, el deployment Preview, el host y usuario de Neon, el esquema actualizado y las variables de entorno. No se aplicaron migraciones ni se conectó el Preview a producción.

La ejecución utilizó las escalas 1.000, 10.000 y 50.000 y las concurrencias 1, 5 y 20. Cada conexión emitió exactamente 24 solicitudes, cubriendo las seis consultas determinísticas. Los usuarios fueron independientes entre escenarios para no interferir con el rate limiting.

## 2. Resultados HTTP

| Filas por familia | Concurrencia | Solicitudes | p50 | p97.5 | p99 | Máximo | Resultado |
|---:|---:|---:|---:|---:|---:|---:|---|
| 1.000 | 1 | 24 | 189 ms | 421 ms | 421 ms | 421 ms | válida |
| 1.000 | 5 | 120 | 217 ms | 566 ms | 749 ms | 762 ms | válida |
| 1.000 | 20 | 480 | 283 ms | 580 ms | 895 ms | 1.136 ms | válida |
| 10.000 | 1 | 24 | 184 ms | 508 ms | 508 ms | 508 ms | válida |
| 10.000 | 5 | 120 | 274 ms | 911 ms | 941 ms | 1.093 ms | válida |
| 10.000 | 20 | 480 | 337 ms | 842 ms | 1.100 ms | 1.337 ms | válida |
| 50.000 | 1 | 24 | 196 ms | 1.386 ms | 1.386 ms | 1.386 ms | válida |
| 50.000 | 5 | 120 | 339 ms | 1.730 ms | 1.873 ms | 2.185 ms | válida |
| 50.000 | 20 | 480 | 605 ms | 2.417 ms | 3.036 ms | 3.851 ms | válida |

Las nueve mediciones formales sumaron **1.872/1.872 respuestas HTTP 200**. No hubo errores de transporte, timeouts, respuestas 401/403/429/500/503, corridas incompletas ni activación del temporizador de seguridad.

El peor p97.5 fue **2.417 ms**, por debajo del criterio de aceptación de **5.000 ms**.

## 3. Evidencia de `EXPLAIN ANALYZE`

Las consultas de observaciones OTIF, Fill Rate y OTIF Proveedor utilizaron sus índices únicos existentes. La consulta de dependencia crítica utilizó índices de conexiones y nodos; a 50.000 filas su tiempo de ejecución fue **2,643 ms**.

`HallazgoCadena` mantuvo `Seq Scan` en los tres planes relevantes. A 50.000 filas se observaron:

| Plan | Ejecución |
|---|---:|
| Acción prioritaria por cadena | 0,371 ms |
| Cambios antes del corte | 0,361 ms |
| Cambios desde el corte | 2,703 ms |

Los planes completos y resultados JSON saneados fueron generados por los scripts en `scripts/perf/resultados/`. Ese directorio permanece ignorado por Git y no contiene cookies, secretos, URLs de base de datos ni credenciales.

## 4. Decisión sobre `HallazgoCadena`

**No se crea el índice candidato `(cadenaId, createdAt)` en esta fase.**

Aunque PostgreSQL eligió recorridos secuenciales, el peor plan medido fue 2,703 ms y el endpoint completo permaneció dentro del objetivo incluso con 50.000 filas y concurrencia 20. La evidencia no justifica todavía el costo adicional de escritura, almacenamiento y mantenimiento de un índice.

La decisión debe revisarse únicamente si cambian de forma material el volumen, la selectividad, la consulta o el objetivo de servicio.

## 5. Limpieza y seguridad

Después de cada escala se ejecutó la limpieza selectiva. La comprobación SQL final devolvió:

```json
{"empresas":0,"usuarios":0,"cadenas":0,"retained_jobs":2}
```

Los dos jobs retenidos de `pg-boss` permanecieron intactos. El bypass temporal fue revocado y su valor anterior dejó de funcionar. El Preview y la rama Neon temporales fueron eliminados. Los cinco archivos locales de credenciales temporales y el portapapeles fueron limpiados.

No se modificó Neon `production`, no se aplicaron migraciones, no se usaron datos funcionales y no se desplegó código nuevo.

## 6. Veredicto

Fase 0 queda **cerrada**. La línea base medida permite iniciar PR-A. El avance del pipeline de los diez KPIs continúa en **26/50 = 52%**; esta cifra no representa el avance global del proyecto.
