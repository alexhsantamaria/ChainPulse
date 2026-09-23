-- RF34 extension post-lanzamiento -- persistencia del punto de conexion
-- (Handle de React Flow: "top"/"right"/"bottom"/"left") usado en cada
-- extremo de una ConexionCadena. Alex probo conectar nodos por los 4
-- lados del mapa (commits 8173f6c/3407a29/3b16062) y encontro que, aunque
-- el arrastre funcionaba, la linea se dibujaba siempre arriba y volvia a
-- "arriba" en cada recarga: sin sourceHandle/targetHandle explicitos en
-- el Edge, React Flow usa el primer handle declarado del nodo (ver
-- comentario de cabecera de MapaCadenaCanvas.tsx, 2026-09-23). Columnas
-- nullable: toda conexion existente hoy se creo antes de este fix y no
-- tiene esta informacion -- sin backfill, cae al comportamiento anterior.

-- AlterTable
ALTER TABLE "conexiones_cadena" ADD COLUMN "origenHandleId" TEXT,
ADD COLUMN "destinoHandleId" TEXT;
