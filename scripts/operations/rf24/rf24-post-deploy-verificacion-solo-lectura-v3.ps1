<#
ChainPulse -- RF24 (derechos/retiro). Procedimiento NUEVO, INDEPENDIENTE y
de SOLO LECTURA v3: verificacion POST-DEPLOY de las 6 migraciones de RF24,
ya aplicadas con exito en produccion por 'rf24-produccion-aplicar-
migraciones-v8-bloqueado.ps1' ('migrate deploy' termino con codigo 0,
confirmado por Alex). v8 NO se modifica -- queda intacta, ya autenticada,
sin tocar. Este archivo es una entrega NUEVA y SEPARADA, nunca una version
de v8.

------------------------------------------------------------------------
CAMBIO DE v1 A v2 (contradiccion real encontrada por 'rf24-prueba-firma-
oidvectortypes-v1.ps1', ejecutada por Alex en PowerShell 5.1 real contra
v1 -- NUNCA simulada):
------------------------------------------------------------------------

FALLO REAL OBSERVADO: la prueba dedicada reporto "RF24_PRUEBA_FIRMA_
OIDVECTORTYPES_RESULTADO=FALLOS(1)" -- uno de los 3 bloques here-string
embebidos de v1 todavia contenia, literalmente, la subcadena
'pg_get_function_identity_arguments'. La consulta REAL que v1 enviaba a
Postgres para la firma YA usaba, correctamente, 'oidvectortypes(p.
proargtypes) AS firma' (el defecto de fondo seguia corregido) -- la
subcadena prohibida sobrevivia unicamente dentro de un comentario '//'
de una sola linea, DENTRO del mismo bloque here-string (justo antes de
esa misma consulta), escrito para explicar la correccion citando la
funcion de catalogo que esta remplaza. Como un comentario '//' de
JavaScript sigue siendo TEXTO LITERAL del here-string de PowerShell que
lo contiene (un here-string no tiene noción de "comentario de
PowerShell" en su interior -- todo su contenido es una sola cadena), la
prueba (que inspecciona el VALOR REAL de cada here-string, nunca
distingue comentario de codigo dentro de el, a proposito -- ver su
propia cabecera) detecto correctamente la subcadena prohibida.

CORRECCION, minima (una sola linea reformulada, ningun cambio de
comportamiento ni de SQL real): el comentario se reescribe para seguir
explicando la correccion (citando 'oidvectortypes(p.proargtypes)' y
remitiendo a la cabecera del .ps1 para el detalle de que funcion de
catalogo reemplaza) sin citar, el mismo, la subcadena prohibida. La
consulta SQL real que sigue esa linea NO se modifico -- unicamente el
comentario que la precede dentro del mismo here-string.

Round-trip confirmado: el diff entre v1 y v2 ('diff-post-deploy-v1-a-
v2.patch') contiene EXCLUSIVAMENTE ese comentario reformulado -- ninguna
otra linea cambia. v1 se conserva, intacta, como entrega anterior (ya
delivered con su propio SHA-256 ya registrado) -- v2 es un archivo
NUEVO, nunca v1 editado en el sentido de "reemplazado silenciosamente".

------------------------------------------------------------------------
CAMBIO DE v2 A v3 (fallo real nuevo, observado por Alex ejecutando v2 EN
PRODUCCION real, en PowerShell 5.1 real -- NUNCA simulado):
------------------------------------------------------------------------

FALLO REAL OBSERVADO: v2 se ejecuto de verdad contra produccion bajo
'SET default_transaction_read_only = on'. Paso correctamente
'_prisma_migrations', los 5 enums, las 2 tablas, los privilegios directos,
las 2 PRIMARY KEY, los 8 CHECK, las 2 FOREIGN KEY, los 7 indices y el
patron corregido -- y fallo, de inmediato al entrar en la seccion de
validacion de las 12 funciones, con codigo de salida 99
("EXCEPCION NO CONTROLADA") y el mensaje real de PowerShell 5.1:
"No se encuentra la propiedad 'Count' en este objeto.".

CAUSA RAIZ CONFIRMADA: 'ConvertFrom-Json', en Windows PowerShell 5.1, NO
envuelve en un array un resultado JSON que tiene EXACTAMENTE 1 elemento --
devuelve el objeto suelto (un solo PSCustomObject), nunca un array de 1.
Ese objeto suelto no tiene miembro '.Count' (a diferencia de PowerShell
7+, que SI expone '.Count'/'.Length' automaticamente sobre cualquier
objeto escalar via su sistema de tipos extendido -- diferencia real de
runtime, no un descuido de v2). Bajo 'Set-StrictMode -Version Latest'
(ya activo desde la primera version de este archivo), leer '.Count' sobre
ese objeto suelto lanza una excepcion real -- nunca silenciosa -- que el
'catch' global, al no coincidir con los patrones 'RF24_RO_FAIL:'/
'RF24_RO_DETENER_SIN_ERROR:', clasifica como "EXCEPCION NO CONTROLADA" y
fija en el sentinel generico 99. Un array JSON de 0 elementos SI se
preserva como array vacio (por eso 'tablasPresentes', 'privilegiosDirec-
tosIndebidos', etc. no fallaron en esta ejecucion real: resultaron 0 o
2+, nunca exactamente 1) -- el defecto es especificamente la cardinalidad
1, no cualquier cardinalidad.

CORRECCION, integral (auditado el archivo COMPLETO, no solo el punto
exacto donde fallo esta vez -- requisito explicito de esta ronda):

  - Se envuelve con '@(...)' CADA coleccion de este archivo que proviene
    de 'ConvertFrom-Json' (via la propiedad '$verif.xxx') o de una
    tuberia de PowerShell ('|', por ejemplo 'Where-Object'), ANTES de
    leer '.Count' sobre ella o de volver a pasarla por otra tuberia --
    nunca solo en el punto que fallo en la ejecucion real de Alex
    ('funcionesFueraDePublic'), sino en TODOS: 'enumsEsperados.$nombre'
    (valor esperado de cada enum), 'tablasPresentes',
    'privilegiosDirectosIndebidos', 'duplicados', 'funcionesTodos
    Esquemas' filtrado a 'public' ('funcionesPublic'), el ACL filtrado
    por funcion ('concesionesIndebidas'), 'rls' y 'politicasRls'. Ninguna
    de estas envolturas CAMBIA el resultado de ninguna comparacion ya
    existente (una coleccion ya-array sigue siendo la misma coleccion;
    '@(...)' sobre un array es un no-operacion) -- unicamente hace que
    la cardinalidad 1 deje de colapsar a un objeto suelto.
  - Toda la logica que procesa el resultado de la verificacion principal
    (antes inline, entre convertir el JSON y el mensaje final de esa
    seccion) se extrae a una funcion propia,
    'Validar-ResultadoVerificacionPrincipal', definida junto al resto de
    funciones auxiliares (antes del bloque principal 'try'), con el
    MISMO comportamiento exacto (mismos sentinels, mismos mensajes,
    ninguna validacion debilitada) -- unico motivo del cambio: poder
    probarla de forma REAL y aislada, con datos sinteticos, sin
    conectarse a Neon (ver prueba dedicada mas abajo).
  - El JSON crudo devuelto por la verificacion principal se persiste en
    disco ANTES de convertirlo con 'ConvertFrom-Json' (archivo
    'verificacion-post-deploy-cruda.json' en el directorio de trabajo) --
    nunca contiene credenciales (ninguno de sus campos es la cadena de
    conexion; ver la forma completa de 'r' en el validador embebido) --
    para poder diagnosticar, sin volver a conectarse a nada, cualquier
    fallo futuro de la conversion o de la validacion posterior.
  - El 'catch' global registra ahora, para cualquier excepcion NO
    controlada futura (sentinel 99), el numero de linea real
    ('ScriptLineNumber') y el texto exacto de esa linea -- antes solo se
    registraba el mensaje de la excepcion, lo que obligaba a adivinar el
    punto real de fallo, exactamente como ocurrio esta vez.

PRUEBA REAL DEDICADA DE ESTA RONDA ('rf24-prueba-cardinalidad-v1.ps1',
entregada por separado): carga (via 'dot-sourcing', SIN '-AutorizarLectura'
-- la compuerta de la linea existente detiene el archivo objetivo ANTES
de 'Read-Host' y ANTES de cualquier conexion, dejando definidas todas sus
funciones) la version objetivo de este archivo, y llama DIRECTAMENTE a
'Validar-ResultadoVerificacionPrincipal' con payloads SINTETICOS
construidos via 'ConvertFrom-Json' real (para reproducir el mismo
comportamiento real de colapso que causo el defecto, nunca un mock a
mano) de cardinalidad 0, 1 y 2+ para cada coleccion de riesgo, bajo
'Set-StrictMode -Version Latest'. Confirma que ninguna de esas 3
cardinalidades lanza una excepcion de miembro no encontrado (el defecto
real de esta ronda), y que los casos deliberadamente incorrectos siguen
siendo rechazados por el sentinel correcto ('RF24_RO_FAIL:N'), nunca
por una excepcion generica.

Round-trip confirmado: el diff entre v2 y v3 ('diff-post-deploy-v2-a-
v3.patch') se entrega junto con esta version. v2 se conserva, intacta,
como entrega anterior (ya delivered con su propio SHA-256 ya registrado).

------------------------------------------------------------------------
POR QUE ESTE ARCHIVO EXISTE -- EL DEFECTO REAL OBSERVADO EN v8 (codigo 80):
------------------------------------------------------------------------

FALLO REAL OBSERVADO: tras aplicar con exito las 6 migraciones ('migrate
deploy' en codigo 0), la verificacion posterior AMPLIADA de v8 se detuvo
en el sentinel 80 ("Firma inesperada en '...'") para funciones de RF24
cuyo codigo fuente (citado literalmente mas abajo) nunca cambio entre
rondas.

CAUSA RAIZ CONFIRMADA (reportada por Alex contra la ejecucion REAL en
produccion): la consulta de v8 usaba

    pg_get_function_identity_arguments(p.oid) AS firma

contra la expectativa almacenada en 'funcionesEsperadas', que contiene
UNICAMENTE los TIPOS de los argumentos de entrada (p.ej. "text, text,
text, text, text" para 'crear_solicitud_derechos'). En la ejecucion real
contra Neon, 'pg_get_function_identity_arguments' devolvio NOMBRE Y TIPO
de cada argumento (p.ej. "p_evaluacion_id text, p_correo_hash_entrante
text, ..."), nunca solo el tipo -- un desacuerdo de FORMATO entre lo que
la consulta devuelve y lo que la expectativa asume, nunca una migracion
mal aplicada ni una funcion con una firma real distinta.

CORRECCION, integral y unica (una sola consulta cambiada, nunca una
reparacion puntual por funcion): se remplaza

    pg_get_function_identity_arguments(p.oid) AS firma

por

    oidvectortypes(p.proargtypes) AS firma

'oidvectortypes' es una funcion NATIVA de PostgreSQL (siempre disponible,
sin privilegio especial, estable desde version 9.x) que reconstruye la
lista de tipos directamente desde 'pg_proc.proargtypes' (un 'oidvector'
que, por DEFINICION del catalogo de PostgreSQL, SOLO contiene OIDs de
TIPOS -- nunca nombres de parametro, estructuralmente, no por convencion
de formato) -- a diferencia de 'pg_get_function_identity_arguments', que
reconstruye SINTAXIS (pensada para 'ALTER FUNCTION') y cuyo formato
exacto (incluir o no nombres) no es la garantia que esta verificacion
necesita. Con 'oidvectortypes', el resultado es, por construccion,
SIEMPRE y UNICAMENTE una lista de tipos separados por ", " -- exactamente
la forma que 'funcionesEsperadas' ya asume desde la primera version de
esta verificacion (v4), sin reescribir ningun valor esperado.

AUDITORIA DE LAS 12 FUNCIONES (no solo 'aplicar_efecto_solicitud_
derechos' -- requisito explicito de esta ronda), releidas literalmente
desde las 3 migraciones de codigo fuente que las declaran
('20261022100000_rf24_funciones_controladas', y las 2 correcciones
posteriores que remplazan 2 de ellas via 'CREATE OR REPLACE',
'20261023160000_...' y '20261023170000_...'):

  - Las 12 declaran EXCLUSIVAMENTE parametros de entrada con modo IN
    implicito (nunca OUT, INOUT ni VARIADIC) -- confirmado leyendo cada
    'CREATE FUNCTION'/'CREATE OR REPLACE FUNCTION' literal. 'proargtypes'
    (y por tanto 'oidvectortypes') SOLO incluye argumentos IN/INOUT/
    VARIADIC -- para las 12, coincide exactamente con la lista de tipos
    de entrada declarada, sin ambiguedad posible.
  - 4 de las 12 ('procesar_solicitud_derechos', 'resolver_solicitud_por_
    soporte' no -- estas 2 SI declaran parametros de entrada; las que NO
    reciben ningun parametro son 'reclamar_solicitudes_derechos_para_
    envio', 'reconciliar_solicitudes_derechos_agotadas',
    'expirar_solicitudes_derechos_vencidas',
    'purgar_solicitudes_derechos_segun_retencion') usan
    'RETURNS TABLE(...)' -- esto crea columnas de salida OUT IMPLICITAS,
    que por definicion de PostgreSQL NUNCA se agregan a 'proargtypes'
    (solo a 'proallargtypes'/'proargmodes', usados para OTRA cosa:
    reconstruir la firma completa de salida, no la de entrada) -- por
    tanto 'RETURNS TABLE(...)' nunca afecta a 'oidvectortypes(p.
    proargtypes)', exactamente igual que nunca afecto a la comparacion ya
    usada desde v4 (que SIEMPRE asumio solo-tipos-de-entrada).
  - Los 2 'CREATE OR REPLACE FUNCTION' de las migraciones 5 y 6
    ('crear_solicitud_derechos', 'aplicar_efecto_solicitud_derechos')
    preservan, literalmente, la misma lista de parametros (mismo nombre,
    mismo tipo, mismo orden) en las 3 versiones sucesivas del cuerpo --
    confirmado leyendo las 3 declaraciones 'CREATE [OR REPLACE] FUNCTION'
    una junto a la otra.

CONCLUSION DE LA AUDITORIA: la correccion (una sola consulta cambiada) es
segura para las 12 funciones, no solo para la que disparo el sentinel 80
en la ejecucion real -- ninguna de las 12 usa OUT/INOUT/VARIADIC en sus
parametros de ENTRADA, por lo que 'oidvectortypes(p.proargtypes)' nunca
puede devolver, para ninguna de ellas, algo distinto de la lista de tipos
ya almacenada en 'funcionesEsperadas' (sin cambios en esos valores
esperados -- el error estaba en la consulta, nunca en la expectativa).

Se anade una prueba real dedicada (ver 'rf24-prueba-firma-oidvectortypes-
v1.ps1', entregada por separado en esta misma ronda) que ejercita, via
AST real extraido de ESTE archivo, el fragmento que construye la
consulta de firma, confirmando que usa 'oidvectortypes(p.proargtypes)' y
NUNCA 'pg_get_function_identity_arguments'.

------------------------------------------------------------------------
QUE ES ESTE ARCHIVO (alcance, deliberadamente mas angosto que v8):
------------------------------------------------------------------------

Un procedimiento de SOLO LECTURA, independiente de v8, pensado para
ejecutarse DESPUES de que las migraciones ya fueron aplicadas (por v8 o
por cualquier aplicacion futura equivalente) -- NUNCA aplica ninguna
migracion por si mismo, nunca invoca el CLI de Prisma en absoluto (ni
'migrate status', ni 'migrate deploy', ni 'migrate resolve', ni
'migrate reset', ni 'db push', ni 'db execute'), y por tanto el defecto 2
de v8 (SEED_DATABASE_URL/directUrl cayendo al endpoint pooled de '.env')
NO PUEDE OCURRIR AQUI de ningun modo: ese defecto dependia por completo de
que Prisma leyera '.env' al invocarse, y este archivo nunca invoca
Prisma. El UNICO proceso externo que este archivo ejecuta, en toda su
extension, es 'node' sobre sus propios validadores embebidos (nunca sobre
ningun archivo del repositorio) -- verificado por autoauditoria, ver mas
abajo.

Verifica, todo por SELECT/WITH puros, en una SOLA sesion reforzada a
'READ ONLY' a nivel de MOTOR (ver "GARANTIAS ESTRUCTURALES" abajo):

  1.  '_prisma_migrations' -- las 6 migraciones de RF24 presentes
      exactamente una vez cada una, completas ('finished_at' no nulo),
      sin rollback ('rolled_back_at' nulo), con 'checksum' no vacio y
      'applied_steps_count' > 0.
  2.  Los 5 enums de RF24 (incluido 'BucketLimiteTasa' completo),
      EXACTOS valor por valor y en orden -- heredado de v8, sin cambios.
  3.  Las 2 tablas de RF24 presentes en 'public' -- heredado de v8, sin
      cambios.
  4.  Privilegios DIRECTOS de 'chainpulse_app'/PUBLIC sobre las 2 tablas
      -- deben ser CERO -- heredado de v8, sin cambios.
  5.  PRIMARY KEY de cada una de las 2 tablas -- NUEVO en esta ronda.
  6.  Los 8 CHECK constraints de 'solicitudes_derechos' (releidos
      literalmente de '20261022090000_rf24_tabla_solicitud_derechos') --
      NUEVO en esta ronda.
  7.  Las 2 FOREIGN KEY de 'solicitudes_derechos' (hacia
      'evaluaciones_expres_v2' y hacia 'usuarios'), por nombre Y por
      definicion real (tabla referenciada, 'ON DELETE RESTRICT',
      'ON UPDATE CASCADE') -- NUEVO en esta ronda.
  8.  Los 7 indices sobre las 2 tablas (incluidas las 2 PRIMARY KEY) --
      NUEVO en esta ronda.
  9.  El patron corregido de 'crear_solicitud_derechos' (alias real 'AS
      ev'/'ev.id', migracion 6) presente, y el patron viejo ausente --
      heredado de v8, sin cambios.
  10. Las 12 funciones de RF24: ninguna fuera de 'public' (shadowing),
      ninguna duplicada, exactamente 12 en 'public' -- heredado de v8,
      sin cambios.
  11. Las 12 funciones: propietario exacto, firma exacta (CORREGIDA --
      via 'oidvectortypes', ver arriba), 'SECURITY DEFINER' exacto por
      funcion, 'proconfig' (incluye 'search_path=public, pg_temp') como
      CONJUNTO exacto, y ACL real (via 'proacl'/'aclexplode' por OID)
      exactamente donde corresponde -- heredado de v8 salvo la firma
      (CORREGIDA).
  12. RLS desactivado en las 2 tablas, cero politicas -- heredado de v8,
      sin cambios.
  13. Residuos (conteo de filas en las 2 tablas) -- ver nota especial
      mas abajo: INFORMATIVO por defecto, nunca bloqueante salvo opt-in
      explicito.

NOTA SOBRE "RESIDUOS" -- POR QUE ES INFORMATIVO POR DEFECTO (correccion
de diseno deliberada frente a v8, para no repetir la MISMA CLASE de
fallo que motiva este archivo): la "auditoria de residuos" de v8 asume
que, en el instante exacto en que se ejecuta, CERO filas es lo unico
correcto -- una suposicion VALIDA solo en la ventana estrecha
inmediatamente posterior al primer deploy, antes de que exista ningun
trafico real. Este archivo, pensado para poder volver a ejecutarse mas
adelante como chequeo de salud general (no solo una vez), NO asume eso
por defecto: reporta los conteos reales siempre, y los trata como un
FALLO solo si se pasa explicitamente '-ExigirCeroResiduosInmediatamente
TrasDeploy' (pensado exclusivamente para la primera ejecucion, en la
misma ventana en que v8 ya lo exigia). Sin ese interruptor, encontrar
solicitudes reales de usuarios en una ejecucion posterior es exactamente
lo esperado -- nunca un residuo de prueba -- y NUNCA bloquea.

------------------------------------------------------------------------
GARANTIAS ESTRUCTURALES DE SOLO LECTURA (nunca solo documentadas -- cada
una se demuestra o se autoaudita en tiempo de ejecucion, antes de
conectarse a nada):
------------------------------------------------------------------------

  A. Este archivo NUNCA invoca el CLI de Prisma, 'git', ni ningun
     ejecutor de paquetes bajo demanda -- el UNICO ejecutable externo
     invocado, en TODA su extension, es 'node', siempre sobre un
     validador embebido escrito por este mismo archivo, nunca sobre un
     archivo del repositorio. Autoauditado (sentinel 1): se extraen
     TODAS las invocaciones reales (via el mismo patron '-Ejecutable
     <...>' que usa el wrapper de ejecucion) y se exige que el conjunto
     resultante sea exactamente {'node'}.
  B. CADA sentencia SQL que este archivo envia a Postgres, sin
     excepcion, se extrae de su propio codigo fuente en tiempo de
     ejecucion (antes de conectarse a nada) y se exige que empiece por
     'SELECT' o 'WITH', O que sea EXACTAMENTE una de las 3 sentencias de
     control de sesion/transaccion ya enumeradas en (D) ('SET
     default_transaction_read_only = on', 'BEGIN', 'ROLLBACK' -- nunca
     DML/DDL, solo delimitan la transaccion de solo lectura que (D)
     establece) -- y que, en cualquier caso, no contenga ninguna palabra
     clave de mutacion/DDL ('INSERT', 'UPDATE', 'DELETE', 'DROP',
     'TRUNCATE', 'ALTER', 'CREATE', 'GRANT', 'REVOKE', 'COPY', 'VACUUM',
     'CALL', 'MERGE') como palabra independiente. Autoauditado
     (sentinel 2).
  C. El codigo EJECUTABLE de este archivo (cabeceras y comentarios
     aparte -- donde esta prosa SI nombra, deliberadamente, "migrate
     deploy"/"migrate resolve" para explicar por que nunca se invocan)
     nunca contiene, el mismo, ninguna de esas frases ni 'npx'.
     Autoauditado (sentinel 3), mismo patron de extraccion de comentarios
     ya usado por el autoauditor de v8 (los bloques de comentario de
     bloque de PowerShell, y las lineas de comentario de una sola linea).
  D. Ademas de (A)-(C) -- defensa en PROFUNDIDAD, no el unico mecanismo:
     cada una de las 3 conexiones que este archivo abre fija
     'SET default_transaction_read_only = on' INMEDIATAMENTE tras
     conectar, antes de 'BEGIN' y antes de cualquier consulta -- esto
     hace que el MOTOR de PostgreSQL, no solo este script, rechace
     cualquier sentencia mutante que pudiera ejecutarse en esa sesion,
     sin importar que SQL se construya en el futuro o por error. Cada
     sesion se cierra siempre con 'ROLLBACK' -- un cierre NORMAL de una
     transaccion que nunca escribio nada (nunca puede escribir nada, por
     (D) mismo), NUNCA el "rollback" de una migracion: este archivo
     jamas invoca el CLI de Prisma, por lo que 'prisma migrate resolve
     --rolled-back' (la unica forma real de "deshacer" una migracion en
     este proyecto) no tiene ningun codigo que pueda alcanzarla.
  E. Nunca crea, modifica ni elimina ninguna rama ni punto de
     restauracion de Neon, ni los consulta -- no necesita hacerlo: no
     ejecuta ninguna operacion irreversible que requiera un punto de
     restauracion previo. La rama/punto de respaldo ya usado por v8
     queda intacta por ABSTENCION TOTAL -- este archivo nunca toca
     'git' en absoluto (ver (A)), nunca lee ni escribe nada relacionado
     con ramas.
  F. Nunca ejecuta ningun 'fixture' ni script de siembra de datos de
     prueba -- el UNICO codigo que ejecuta es el que este mismo archivo
     escribe en el momento (ver (A)), nunca un archivo externo del
     repositorio.
  G. La URL administrativa se lee oculta ('Read-Host -AsSecureString'),
     nunca se registra ni se muestra en pantalla, y se limpia de las
     variables de entorno en 'finally' (y en el manejador de
     cancelacion Ctrl+C) sin importar como termine la ejecucion --
     misma disciplina ya validada en v7/v8.

PROHIBIDO, de forma permanente y por CONSTRUCCION (no solo por politica)
en este archivo: cualquier variante de 'migrate deploy'/'migrate
resolve'/'migrate reset'/'db push'/'db execute'; cualquier INSERT/UPDATE/
DELETE/DROP/TRUNCATE/ALTER/CREATE/GRANT/REVOKE/COPY/VACUUM/CALL/MERGE
sobre cualquier tabla u objeto; cualquier fixture o purga; cualquier
creacion, modificacion o consulta de puntos de restauracion o ramas de
Neon; imprimir o registrar la cadena de conexion, usuario o contraseña
reales en ningun punto. Las secciones (A)-(F) arriba demuestran POR QUE
cada una de estas acciones es estructuralmente inalcanzable desde este
archivo, nunca solo prometida.

ESTADO DE ESTE ARCHIVO: preparado, NUNCA ejecutado.
#>

[CmdletBinding()]
param(
    [switch]$AutorizarLectura,
    [string]$RutaRepositorio = (Get-Location).Path,
    [switch]$ExigirCeroResiduosInmediatamenteTrasDeploy
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ============================================================================
# CONSTANTES CANONICAS -- idénticas a las ya validadas y en uso en
# 'rf24-produccion-aplicar-migraciones-v8-bloqueado.ps1'; nunca redefinidas
# de forma distinta aqui.
# ============================================================================
$HostProduccionEsperado      = 'ep-steep-firefly-ac5drua5.sa-east-1.aws.neon.tech'
$BaseDatosProduccionEsperada = 'neondb'
$RolAdministrativoEsperado   = 'neondb_owner'
$SslModesFuertesPermitidos   = @('require', 'verify-ca', 'verify-full')
$MigracionesRf24EnOrden = @(
    '20261022080000_rf24_enum_bucket_limite_tasa',
    '20261022090000_rf24_tabla_solicitud_derechos',
    '20261022100000_rf24_funciones_controladas',
    '20261023053758_rf24_revocar_privilegios_directos_tablas_derechos',
    '20261023160000_rf24_correccion_ambiguedad_id_y_consentimiento_sin_id',
    '20261023170000_rf24_correccion_referencia_ambigua_id_verificacion_correo'
)
$ConfigEsperadoFunciones = @('search_path=public, pg_temp')

$script:DirTrabajo = Join-Path $env:TEMP ("rf24-post-deploy-ro-v3-" + [guid]::NewGuid().ToString('N'))
$script:ArchivoLog = Join-Path $script:DirTrabajo 'verificacion.log'
$script:CodigoSalidaFinal = 1
$script:ManejadorCancelacion = $null
$script:UrlAdminTexto = $null

function Registrar {
    param([string]$Mensaje)
    $seguro = [regex]::Replace($Mensaje, 'postgres(ql)?://[^\s"]+', 'postgres://[REDACTADO]')
    $linea = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $seguro
    Write-Host $linea
    if (Test-Path $script:DirTrabajo) { Add-Content -Path $script:ArchivoLog -Value $linea }
}

# Idéntica a la de v7/v8 -- resumen de stderr redactado, para incluir
# dentro del mensaje de 'Fail' si uno de los validadores embebidos no
# arranca.
function Resumen-StderrParaError {
    param([string]$TextoStderr, [int]$MaxLargo = 500)
    if ([string]::IsNullOrWhiteSpace($TextoStderr)) { return '' }
    $plano = ($TextoStderr -replace '\s+', ' ').Trim()
    $plano = [regex]::Replace($plano, 'postgres(ql)?://[^\s"]+', 'postgres://[REDACTADO]')
    if ($plano.Length -gt $MaxLargo) { $plano = $plano.Substring(0, $MaxLargo) + ' [...TRUNCADO...]' }
    return " Stderr de Node (redactado): $plano"
}

# Idéntica a la de v8.
function Extraer-HostDeUrlPostgres {
    param([string]$Url)
    if ([string]::IsNullOrWhiteSpace($Url)) { return $null }
    $m = [regex]::Match($Url, '^postgres(?:ql)?://[^@/]*@([^/:?]+)')
    if ($m.Success) { return $m.Groups[1].Value } else { return $null }
}

# Compara 2 conjuntos de nombres (SIN importar orden) y bloquea si no son
# EXACTAMENTE iguales -- extraida a funcion propia para no repetir el
# mismo 'Compare-Object' 4 veces en este archivo (constraints, indices,
# etc.), cada una con su propio sentinel.
function Comparar-ConjuntoExacto {
    param([string]$Etiqueta, [string[]]$Esperado, [string[]]$Real, [int]$Sentinel)
    $esperadoOrdenado = @($Esperado | Sort-Object)
    $realOrdenado = @($Real | Sort-Object)
    $diferencia = Compare-Object -ReferenceObject $esperadoOrdenado -DifferenceObject $realOrdenado -SyncWindow 0
    if ($diferencia -or ($esperadoOrdenado.Count -ne $realOrdenado.Count)) {
        Fail "$Etiqueta no coincide EXACTO (conjunto, sin importar orden). Esperado: [$($esperadoOrdenado -join ' | ')]; real: [$($realOrdenado -join ' | ')]." $Sentinel
    }
}

# NUEVO EN ESTA RONDA (v2 -> v3) -- ver cabecera "CAMBIO DE v2 A v3". Toda
# la validacion del resultado de la verificacion principal (antes inline
# en el cuerpo del script), extraida a esta funcion propia: MISMO
# comportamiento exacto (mismos sentinels, mismos mensajes, ninguna
# validacion debilitada); unico motivo del cambio: poder probarla de
# forma REAL y aislada, con datos sinteticos de cardinalidad 0/1/N, sin
# conectarse a Neon -- ver 'rf24-prueba-cardinalidad-v1.ps1'. CADA
# coleccion que proviene de 'ConvertFrom-Json' (via '$Verif.xxx') o de
# una tuberia de PowerShell se envuelve ahora con '@(...)' ANTES de leer
# '.Count' sobre ella -- ese envolvimiento es, literalmente, el fix de
# esta ronda (ver DEFECTO en la cabecera).
function Validar-ResultadoVerificacionPrincipal {
    param([Parameter(Mandatory)]$Verif)

    # ---- _prisma_migrations ----
    $migracionesReales = @($Verif.migracionesReales)
    if ($migracionesReales.Count -ne $MigracionesRf24EnOrden.Count) {
        Fail "'_prisma_migrations' no tiene exactamente $($MigracionesRf24EnOrden.Count) filas para las migraciones de RF24 (se encontraron $($migracionesReales.Count))." 19
    }
    foreach ($m in $migracionesReales) {
        if ($null -ne $m.rolled_back_at) { Fail "'_prisma_migrations': la migracion '$($m.migration_name)' tiene 'rolled_back_at' NO nulo ($($m.rolled_back_at)) -- indicaria un rollback real, nunca esperado." 20 }
        if ($null -eq $m.finished_at) { Fail "'_prisma_migrations': la migracion '$($m.migration_name)' tiene 'finished_at' NULO -- no quedo completa." 21 }
        if ([string]::IsNullOrWhiteSpace([string]$m.checksum)) { Fail "'_prisma_migrations': la migracion '$($m.migration_name)' tiene 'checksum' vacio o nulo." 22 }
        if ([int]$m.applied_steps_count -le 0) { Fail "'_prisma_migrations': la migracion '$($m.migration_name)' tiene 'applied_steps_count' <= 0 ($($m.applied_steps_count))." 23 }
    }
    Exito "'_prisma_migrations': las $($MigracionesRf24EnOrden.Count) migraciones de RF24 estan presentes exactamente una vez cada una, completas (finished_at no nulo), sin rollback (rolled_back_at nulo), con checksum no vacio y applied_steps_count > 0."

    # ---- enums ----
    foreach ($nombreEnum in $Verif.enumsEsperados.PSObject.Properties.Name) {
        $esperado = @($Verif.enumsEsperados.$nombreEnum)
        $real = @($Verif.enumsReales.$nombreEnum)
        $diffEnum = Compare-Object -ReferenceObject $esperado -DifferenceObject $real -SyncWindow 0
        if ($diffEnum -or ($esperado.Count -ne $real.Count)) {
            Fail "El enum '$nombreEnum' no coincide EXACTO (orden y valores) con lo esperado. Esperado: $($esperado -join ','); real: $($real -join ',')." 24
        }
    }
    Exito "Los 5 enums de RF24 (incluido 'BucketLimiteTasa' completo) coinciden EXACTO, valor por valor y en orden, con lo esperado."

    # ---- tablas + privilegios directos ----
    # FIX DE ESTA RONDA: '$Verif.tablasPresentes'/'$Verif.privilegios
    # DirectosIndebidos' se envuelven ANTES de leer '.Count' -- si
    # cualquiera de las 2 tuviera, alguna vez, EXACTAMENTE 1 elemento,
    # 'ConvertFrom-Json' (PowerShell 5.1 real) lo entrega como un objeto
    # suelto, sin '.Count' -- exactamente la clase de fallo real de esta
    # ronda (aunque en la ejecucion real de Alex no ocurrio en este punto
    # concreto, sino mas abajo).
    $tablasPresentesReales = @($Verif.tablasPresentes)
    if ($tablasPresentesReales.Count -ne 2) { Fail "Se esperaban exactamente las 2 tablas de RF24 en 'public'; se encontraron $($tablasPresentesReales.Count)." 25 }
    $privilegiosIndebidosReales = @($Verif.privilegiosDirectosIndebidos)
    if ($privilegiosIndebidosReales.Count -gt 0) {
        Fail "Privilegios directos indebidos (chainpulse_app o PUBLIC) sobre las tablas de RF24: $($privilegiosIndebidosReales | ConvertTo-Json -Compress)" 26
    }
    Exito "Las 2 tablas de RF24 presentes en 'public', y cero privilegios directos de chainpulse_app/PUBLIC sobre ninguna de las 2."

    # ---- PRIMARY KEY (NUEVO en v2) ----
    $pkEsperados = @(
        [PSCustomObject]@{ tabla = 'solicitudes_derechos'; conname = 'solicitudes_derechos_pkey' },
        [PSCustomObject]@{ tabla = 'intentos_solicitud_derechos_descartados'; conname = 'intentos_solicitud_derechos_descartados_pkey' }
    )
    $pksReales = @($Verif.primaryKeys)
    if ($pksReales.Count -ne 2) { Fail "Numero de PRIMARY KEY sobre las 2 tablas de RF24 distinto de 2 (real: $($pksReales.Count))." 27 }
    foreach ($pk in $pkEsperados) {
        $real = $pksReales | Where-Object { $_.tabla -eq $pk.tabla }
        if (-not $real -or $real.conname -ne $pk.conname) {
            Fail "PRIMARY KEY de '$($pk.tabla)' no es exactamente '$($pk.conname)' (real: '$($real.conname)')." 27
        }
    }
    Exito "Las 2 PRIMARY KEY (una por tabla) coinciden exactamente con lo esperado (NUEVO en v2)."

    # ---- CHECK constraints (NUEVO en v2) ----
    $checksEsperados = @(
        'alcance_retiro_coherente', 'token_hash_formato', 'resuelto_canal_administrador_coherente',
        'token_hash_version_pareja', 'envio_confirmado_requiere_token', 'reclamo_lease_pareja',
        'intentos_envio_no_negativo', 'token_key_version_positivo'
    )
    $checksReales = @($Verif.checkConstraints | ForEach-Object { $_.conname })
    Comparar-ConjuntoExacto -Etiqueta "Los 8 CHECK constraints de 'solicitudes_derechos'" -Esperado $checksEsperados -Real $checksReales -Sentinel 28
    Exito "Los 8 CHECK constraints de 'solicitudes_derechos' coinciden exactamente (por nombre) con lo esperado, releido literalmente de la migracion que los crea (NUEVO en v2)."

    # ---- FOREIGN KEY (NUEVO en v2) ----
    $fksReales = @($Verif.foreignKeys)
    if ($fksReales.Count -ne 2) { Fail "Numero de FOREIGN KEY sobre 'solicitudes_derechos' distinto de 2 (real: $($fksReales.Count))." 29 }
    $fkEval = $fksReales | Where-Object { $_.conname -eq 'solicitudes_derechos_evaluacionExpresV2Id_fkey' }
    $fkUsuario = $fksReales | Where-Object { $_.conname -eq 'solicitudes_derechos_resueltoPorUsuarioId_fkey' }
    if (-not $fkEval -or -not $fkUsuario) {
        Fail "Los nombres de las 2 FOREIGN KEY no son exactamente los esperados ('solicitudes_derechos_evaluacionExpresV2Id_fkey', 'solicitudes_derechos_resueltoPorUsuarioId_fkey'). Reales: $($fksReales.conname -join ', ')." 29
    }
    if ($fkEval.definicion -notmatch '(?i)REFERENCES\s+"?evaluaciones_expres_v2"?\s*\(\s*"?id"?\s*\)' -or
        $fkEval.definicion -notmatch '(?i)ON DELETE RESTRICT' -or $fkEval.definicion -notmatch '(?i)ON UPDATE CASCADE') {
        Fail "La definicion real de 'solicitudes_derechos_evaluacionExpresV2Id_fkey' no coincide con lo esperado (REFERENCES evaluaciones_expres_v2(id), ON DELETE RESTRICT, ON UPDATE CASCADE). Real: $($fkEval.definicion)" 30
    }
    if ($fkUsuario.definicion -notmatch '(?i)REFERENCES\s+"?usuarios"?\s*\(\s*"?id"?\s*\)' -or
        $fkUsuario.definicion -notmatch '(?i)ON DELETE RESTRICT' -or $fkUsuario.definicion -notmatch '(?i)ON UPDATE CASCADE') {
        Fail "La definicion real de 'solicitudes_derechos_resueltoPorUsuarioId_fkey' no coincide con lo esperado (REFERENCES usuarios(id), ON DELETE RESTRICT, ON UPDATE CASCADE). Real: $($fkUsuario.definicion)" 30
    }
    Exito "Las 2 FOREIGN KEY de 'solicitudes_derechos' coinciden exactamente por nombre y por definicion real (tabla referenciada, ON DELETE RESTRICT, ON UPDATE CASCADE) (NUEVO en v2)."

    # ---- indices (NUEVO en v2) ----
    $indicesEsperados = @(
        'solicitudes_derechos_pkey', 'solicitudes_derechos_tokenHash_key',
        'solicitudes_derechos_evaluacionExpresV2Id_createdAt_idx', 'solicitudes_derechos_estado_expiraEn_idx',
        'solicitudes_derechos_estado_envioConfirmadoEn_idx', 'solicitudes_derechos_resueltoPorUsuarioId_idx',
        'intentos_solicitud_derechos_descartados_pkey'
    )
    $indicesReales = @($Verif.indices | ForEach-Object { $_.indexname })
    Comparar-ConjuntoExacto -Etiqueta "Los 7 indices sobre las 2 tablas de RF24 (incluidas las 2 PRIMARY KEY)" -Esperado $indicesEsperados -Real $indicesReales -Sentinel 31
    Exito "Los 7 indices sobre las 2 tablas de RF24 coinciden exactamente (por nombre) con lo esperado (NUEVO en v2)."

    # ---- patron corregido (heredado de v8) ----
    if (-not $Verif.patronCorregidoPresente -or -not $Verif.patronViejoAusente) {
        Fail "El cuerpo real de 'crear_solicitud_derechos' no refleja el patron corregido de la migracion 6 (alias real 'AS ev'/'ev.id')." 32
    }
    Exito "El cuerpo real de 'crear_solicitud_derechos' refleja el patron corregido de la migracion 6, y el patron viejo esta ausente."

    # ---- funciones fuera de public / duplicadas / cardinalidad (heredado de v8) ----
    # FIX DE ESTA RONDA: este es, exactamente, el punto donde fallo la
    # ejecucion real de Alex contra v2 -- 'funcionesFueraDePublic' (y,
    # por el mismo motivo, 'duplicados') se leian sin envolver.
    $funcionesFueraDePublicReales = @($Verif.funcionesFueraDePublic)
    if ($funcionesFueraDePublicReales.Count -gt 0) { Fail "Funciones RF24 FUERA de 'public' (shadowing): $($funcionesFueraDePublicReales | ConvertTo-Json -Compress)" 33 }
    $duplicadosReales = @($Verif.duplicados)
    if ($duplicadosReales.Count -gt 0) { Fail "Funciones RF24 duplicadas (mas de una firma con el mismo nombre): $($duplicadosReales | ConvertTo-Json -Compress)" 34 }

    $funcionesPublic = @($Verif.funcionesTodosEsquemas | Where-Object { $_.esquema -eq 'public' })
    if ($funcionesPublic.Count -ne 12) { Fail "Se esperaban exactamente 12 funciones RF24 en 'public'; se encontraron $($funcionesPublic.Count)." 35 }

    $aclPorOid = @{}
    foreach ($fila in @($Verif.aclPorFuncion)) {
        $clave = [string]$fila.oid
        if (-not $aclPorOid.ContainsKey($clave)) { $aclPorOid[$clave] = New-Object System.Collections.Generic.List[object] }
        $aclPorOid[$clave].Add($fila)
    }

    # ---- las 12 funciones: propietario, firma (CORREGIDA en esta serie
    # via 'oidvectortypes'), SECURITY DEFINER, proconfig, ACL (heredado
    # de v8 salvo la firma) ----
    foreach ($f in $funcionesPublic) {
        $esperadaFuncion = $Verif.funcionesEsperadas.$($f.proname)
        if ($f.propietario -ne $RolAdministrativoEsperado) { Fail "'$($f.proname)' no es propiedad de '$RolAdministrativoEsperado' (es de '$($f.propietario)')." 36 }
        if ($f.firma -ne $esperadaFuncion.firma) {
            Fail "Firma inesperada en '$($f.proname)': esperada '$($esperadaFuncion.firma)', real '$($f.firma)' (via 'oidvectortypes', CORREGIDO -- ver cabecera)." 37
        }
        if ([bool]$f.security_definer -ne [bool]$esperadaFuncion.securityDefiner) {
            Fail "'SECURITY DEFINER' de '$($f.proname)' es '$($f.security_definer)', se esperaba '$($esperadaFuncion.securityDefiner)'." 38
        }

        $configReal = @($f.config)
        $diffConfig = Compare-Object -ReferenceObject $ConfigEsperadoFunciones -DifferenceObject $configReal -SyncWindow 0
        if ($diffConfig -or ($ConfigEsperadoFunciones.Count -ne $configReal.Count)) {
            Fail "'$($f.proname)': 'proconfig' NO coincide EXACTO con lo esperado (conjunto, no substring). Esperado: [$($ConfigEsperadoFunciones -join ' | ')]; real: [$($configReal -join ' | ')]." 39
        }

        $claveOid = [string]$f.oid
        $aclFuncion = if ($aclPorOid.ContainsKey($claveOid)) { $aclPorOid[$claveOid] } else { @() }
        # FIX DE ESTA RONDA: 'Where-Object' sobre '$aclFuncion' colapsa a
        # un objeto suelto si encuentra EXACTAMENTE 1 concesion indebida
        # -- envuelto con '@(...)' antes de leer '.Count'.
        $concesionesIndebidas = @($aclFuncion | Where-Object { $_.grantee -ne 'chainpulse_app' -and $_.grantee -ne $RolAdministrativoEsperado })
        if ($concesionesIndebidas.Count -gt 0) { Fail "'$($f.proname)': grantees NO autorizados en el ACL real (proacl/aclexplode): $($concesionesIndebidas | ConvertTo-Json -Compress)." 40 }
        $tieneEjecucionChainpulse = [bool]($aclFuncion | Where-Object { $_.grantee -eq 'chainpulse_app' -and $_.privilegio -eq 'EXECUTE' })
        if ($tieneEjecucionChainpulse -ne [bool]$esperadaFuncion.concedeEjecucionChainpulse) {
            Fail "'$($f.proname)': concesion de ejecucion para chainpulse_app (via proacl/aclexplode) es '$tieneEjecucionChainpulse', se esperaba '$($esperadaFuncion.concedeEjecucionChainpulse)'." 41
        }
        $tienePublic = [bool]($aclFuncion | Where-Object { $_.grantee -eq 'PUBLIC' })
        if ($tienePublic) { Fail "'$($f.proname)': PUBLIC tiene algun privilegio en el ACL real -- nunca deberia." 42 }
    }
    Exito "Las 12 funciones RF24: firma EXACTA (CORREGIDA -- via 'oidvectortypes', nunca 'pg_get_function_identity_arguments'), propietario exacto, 'SECURITY DEFINER' exacto por funcion, 'proconfig' como conjunto EXACTO (incluye 'search_path=public, pg_temp'), y ACL real exactamente donde corresponde."

    # ---- RLS + politicas (heredado de v8) ----
    $rlsReales = @($Verif.rls)
    if ($rlsReales.Count -ne 2) { Fail "Se esperaban exactamente las 2 tablas RF24 en la consulta de RLS; se encontraron $($rlsReales.Count)." 43 }
    foreach ($f in $rlsReales) { if ($f.relrowsecurity) { Fail "La tabla '$($f.relname)' (esquema public) tiene RLS activado -- se esperaba que NO." 44 } }
    $politicasRlsReales = @($Verif.politicasRls)
    if ($politicasRlsReales.Count -gt 0) { Fail "Politicas RLS sobre tablas RF24 en 'public' (deberia ser cero): $($politicasRlsReales | ConvertTo-Json -Compress)" 45 }
    Exito "RLS desactivado en las 2 tablas de RF24, cero politicas."
}

function Fail {
    param([string]$Mensaje, [int]$Sentinel)
    Registrar "BLOQUEADO: $Mensaje"
    $script:CodigoSalidaFinal = $Sentinel
    throw "RF24_RO_FAIL:$Sentinel"
}

function Detener {
    param([string]$Mensaje, [int]$Sentinel)
    Registrar $Mensaje
    $script:CodigoSalidaFinal = $Sentinel
    throw "RF24_RO_DETENER_SIN_ERROR:$Sentinel"
}

function Exito { param([string]$Mensaje) Registrar "OK: $Mensaje" }

# Idéntica en comportamiento a la de v6/v7/v8 (stdout/stderr por streams
# separados, el ejecutable debe existir, nunca contamina '$LASTEXITCODE'
# con una invocacion anterior). En ESTE archivo, el UNICO ejecutable con
# el que se llama, en toda su extension, es 'node' -- verificado por
# autoauditoria mas abajo (sentinel 1), nunca solo por convencion.
function Invoke-ComandoExterno {
    param(
        [Parameter(Mandatory)][string]$Ejecutable,
        [Parameter(Mandatory)][string[]]$Argumentos
    )

    $comandoResuelto = Get-Command -Name $Ejecutable -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $comandoResuelto) {
        return [PSCustomObject]@{
            CodigoSalida           = -1
            LineasStdout           = @()
            TextoStdout            = ''
            LineasStderr           = @()
            TextoStderr            = ''
            LineasCombinadas       = @()
            TextoCombinado         = ''
            DetalleFalloInvocacion = "Ejecutable '$Ejecutable' no encontrado como aplicacion nativa en PATH (Get-Command -CommandType Application)."
        }
    }

    $archivoTemporalStderr = $null
    try {
        $archivoTemporalStderr = [System.IO.Path]::GetTempFileName()
    } catch {
        return [PSCustomObject]@{
            CodigoSalida           = -1
            LineasStdout           = @()
            TextoStdout            = ''
            LineasStderr           = @()
            TextoStderr            = ''
            LineasCombinadas       = @()
            TextoCombinado         = ''
            DetalleFalloInvocacion = "No se pudo crear el archivo temporal para capturar stderr de '$Ejecutable': $($_.Exception.Message)"
        }
    }

    $codigo = -1
    $detalleFallo = $null
    $salidaStdoutCruda = @()
    $preferenciaAnterior = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        try {
            $salidaStdoutCruda = & $comandoResuelto.Source @Argumentos 2>$archivoTemporalStderr
            $codigo = $LASTEXITCODE
        } catch {
            $codigo = -1
            $detalleFallo = "Fallo al invocar '$Ejecutable': $($_.Exception.Message)"
            $salidaStdoutCruda = @()
        }
    } finally {
        $ErrorActionPreference = $preferenciaAnterior
    }

    $lineasStdout = @($salidaStdoutCruda | ForEach-Object {
        if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.ToString() } else { [string]$_ }
    })

    $lineasStderr = @()
    if (Test-Path $archivoTemporalStderr) {
        $lineasStderr = @(Get-Content -Path $archivoTemporalStderr -ErrorAction SilentlyContinue)
        Remove-Item -Path $archivoTemporalStderr -ErrorAction SilentlyContinue
    }

    $lineasCombinadas = @($lineasStdout) + @($lineasStderr)

    [PSCustomObject]@{
        CodigoSalida           = $codigo
        LineasStdout           = $lineasStdout
        TextoStdout            = ($lineasStdout -join "`n")
        LineasStderr           = $lineasStderr
        TextoStderr            = ($lineasStderr -join "`n")
        LineasCombinadas       = $lineasCombinadas
        TextoCombinado         = ($lineasCombinadas -join "`n")
        DetalleFalloInvocacion = $detalleFallo
    }
}

function LimpiarCredenciales {
    # Mucho mas simple que la de v8 -- POR DISEÑO, no por descuido: este
    # archivo nunca fija 'DATABASE_URL' ni 'SEED_DATABASE_URL' (esas son
    # variables que Prisma lee; este archivo nunca invoca Prisma), nunca
    # crea ningun worktree de git, y nunca tiene nada que restaurar mas
    # alla de sus propias 2 variables temporales.
    if (Test-Path Env:\DATABASE_URL_ADMIN_PROD) { Remove-Item Env:\DATABASE_URL_ADMIN_PROD -ErrorAction SilentlyContinue }
    if (Test-Path Env:\RF24_PACKAGE_JSON_PATH) { Remove-Item Env:\RF24_PACKAGE_JSON_PATH -ErrorAction SilentlyContinue }
    if (Test-Path Env:\RF24_HOST_ESPERADO) { Remove-Item Env:\RF24_HOST_ESPERADO -ErrorAction SilentlyContinue }
    if (Test-Path Env:\RF24_DB_ESPERADA) { Remove-Item Env:\RF24_DB_ESPERADA -ErrorAction SilentlyContinue }
    if (Test-Path Env:\RF24_ROL_ESPERADO) { Remove-Item Env:\RF24_ROL_ESPERADO -ErrorAction SilentlyContinue }
    if (Get-Variable -Name UrlAdminTexto -Scope Script -ErrorAction SilentlyContinue) { $script:UrlAdminTexto = $null }
    if ($script:ManejadorCancelacion) {
        try { Unregister-Event -SourceIdentifier $script:ManejadorCancelacion.Name -ErrorAction SilentlyContinue } catch {}
    }
    [System.GC]::Collect()
}

New-Item -ItemType Directory -Path $script:DirTrabajo -Force | Out-Null
Registrar "=== RF24 -- verificacion POST-DEPLOY de SOLO LECTURA v3 (independiente de v8; v8 no se modifica) ==="
Registrar "Directorio de trabajo: $script:DirTrabajo"

$script:ManejadorCancelacion = Register-ObjectEvent -InputObject ([Console]) -EventName CancelKeyPress -Action {
    Write-Host "Cancelacion detectada (Ctrl+C) -- limpiando variables temporales antes de salir. Nada mutante que deshacer: este archivo nunca escribio nada en la base de datos."
    if (Test-Path Env:\DATABASE_URL_ADMIN_PROD) { Remove-Item Env:\DATABASE_URL_ADMIN_PROD -ErrorAction SilentlyContinue }
    if (Test-Path Env:\RF24_PACKAGE_JSON_PATH) { Remove-Item Env:\RF24_PACKAGE_JSON_PATH -ErrorAction SilentlyContinue }
    if (Test-Path Env:\RF24_HOST_ESPERADO) { Remove-Item Env:\RF24_HOST_ESPERADO -ErrorAction SilentlyContinue }
    if (Test-Path Env:\RF24_DB_ESPERADA) { Remove-Item Env:\RF24_DB_ESPERADA -ErrorAction SilentlyContinue }
    if (Test-Path Env:\RF24_ROL_ESPERADO) { Remove-Item Env:\RF24_ROL_ESPERADO -ErrorAction SilentlyContinue }
}

# ============================================================================
# CUERPO PRINCIPAL -- try/catch/finally GLOBAL UNICO (mismo patron que
# v8: TODO corre dentro de este bloque, para que 'finally' se ejecute sin
# excepcion sin importar en que punto se bloquee).
# ============================================================================
try {

    # ------------------------------------------------------------------
    # AUTO-AUDITORIA (sentinels 1-3) -- este mismo archivo, ANTES de
    # conectarse a nada. Ver "GARANTIAS ESTRUCTURALES" en la cabecera
    # para el razonamiento completo de cada una.
    # ------------------------------------------------------------------
    $textoCompletoCrudo = Get-Content -Raw -Path $PSCommandPath

    # (1) El UNICO ejecutable externo invocado, en toda la extension de
    # este archivo, es 'node'.
    $ejecutablesInvocados = @(([regex]::Matches($textoCompletoCrudo, "-Ejecutable\s+'([^']+)'")) | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
    $ejecutablesNoPermitidos = @($ejecutablesInvocados | Where-Object { $_ -ne 'node' })
    if ($ejecutablesNoPermitidos.Count -gt 0 -or $ejecutablesInvocados.Count -eq 0) {
        Fail "Autoauditoria: se esperaba que el UNICO ejecutable externo invocado en este archivo fuera 'node' -- se encontraron: [$($ejecutablesInvocados -join ', ')]." 1
    }
    Exito "Autoauditoria (1/3): el UNICO ejecutable externo invocado en todo este archivo es 'node' -- nunca 'git', nunca el CLI de Prisma, nunca ningun ejecutor de paquetes bajo demanda."

    # (2) CADA sentencia SQL realmente enviada a Postgres (el primer
    # argumento, entre backticks, de cada 'client.query(') empieza por
    # SELECT/WITH y no contiene ninguna palabra de mutacion/DDL. Se
    # aplica sobre el TEXTO CRUDO completo (los backticks viven dentro de
    # bloques '@'...'@', que nunca son comentarios de PowerShell) --
    # nunca sobre texto ya filtrado, para no dejar pasar nada.
    $coincidenciasQuery = [regex]::Matches($textoCompletoCrudo, '\.query\(\s*`([^`]*)`')
    if ($coincidenciasQuery.Count -eq 0) {
        Fail "Autoauditoria: no se encontro ninguna sentencia SQL via '.query(\`...\`)' en este archivo -- inesperado para un procedimiento de verificacion, bloqueando por seguridad." 2
    }
    $sentenciasControlSesionPermitidas = @('BEGIN', 'ROLLBACK', 'SET default_transaction_read_only = on')
    foreach ($m in $coincidenciasQuery) {
        $sqlTexto = $m.Groups[1].Value.Trim()
        $esControlSesion = $sentenciasControlSesionPermitidas -icontains $sqlTexto
        if (-not $esControlSesion -and $sqlTexto -notmatch '(?i)^(SELECT|WITH)\b') {
            Fail "Autoauditoria: una sentencia SQL embebida no comienza por SELECT/WITH, y no es ninguna de las 3 sentencias de control de sesion permitidas (BEGIN/ROLLBACK/SET default_transaction_read_only=on). Fragmento: '$($sqlTexto.Substring(0, [Math]::Min(80, $sqlTexto.Length)))'" 2
        }
        if ($sqlTexto -match '(?i)\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|COPY|VACUUM|CALL|MERGE)\b') {
            Fail "Autoauditoria: una sentencia SQL embebida contiene una palabra clave de mutacion/DDL como palabra independiente. Fragmento: '$($sqlTexto.Substring(0, [Math]::Min(80, $sqlTexto.Length)))'" 2
        }
    }
    Exito "Autoauditoria (2/3): las $($coincidenciasQuery.Count) sentencias SQL embebidas en este archivo son TODAS SELECT/WITH o control de sesion de solo lectura (BEGIN/ROLLBACK/SET default_transaction_read_only=on), y ninguna contiene una palabra clave de mutacion/DDL."

    # (3) El codigo EJECUTABLE (comentarios aparte -- la cabecera SI
    # nombra, a proposito, 'migrate deploy'/'migrate resolve'/'npx' para
    # EXPLICAR por que nunca se invocan) no contiene ninguna de esas
    # frases. Mismo patron de extraccion de comentarios que el
    # autoauditor ya validado de v8 (los bloques de comentario de bloque
    # de PowerShell, y las lineas de comentario de una sola linea).
    $sinBloquesComentario = [regex]::Replace($textoCompletoCrudo, '(?s)<#.*?#>', '')
    $lineasSinComentarioInline = ($sinBloquesComentario -split "`n") | ForEach-Object {
        $idx = $_.IndexOf('#')
        if ($idx -ge 0) { $_.Substring(0, $idx) } else { $_ }
    }
    $textoEjecutable = ($lineasSinComentarioInline -join "`n")
    $patronesProhibidos = @('migrate\s+deploy', 'migrate\s+resolve', 'migrate\s+reset', 'db\s+push', 'db\s+execute', '\bn\s*p\s*x\b')
    foreach ($patron in $patronesProhibidos) {
        if ($textoEjecutable -match "(?i)$patron") {
            Fail "Autoauditoria: se detecto la frase prohibida '$patron' en codigo EJECUTABLE (fuera de comentarios) de este archivo." 3
        }
    }
    Exito "Autoauditoria (3/3): confirmado, fuera de comentarios, que este archivo nunca invoca ningun subcomando de aplicacion de migraciones de Prisma ni ningun ejecutor de paquetes bajo demanda."

    if (-not $AutorizarLectura) {
        Detener "Compuerta de lectura NO autorizada -- pasa -AutorizarLectura para ejecutar esta verificacion de SOLO LECTURA. (Esta compuerta no protege ninguna operacion irreversible -- este archivo no tiene ninguna -- es, igual que el resto de este paquete, una confirmacion explicita de intencion antes de conectarse a produccion.)" 4
    }

    # ------------------------------------------------------------------
    # Resolver 'pg' desde el repositorio real -- mismo patron
    # 'createRequire'/'RF24_PACKAGE_JSON_PATH' ya validado en v7/v8.
    # ------------------------------------------------------------------
    $rutaPackageJsonRepo = Join-Path $RutaRepositorio 'package.json'
    if (-not (Test-Path $rutaPackageJsonRepo)) {
        Fail "No se encontro 'package.json' en el repositorio real ('$RutaRepositorio')." 5
    }
    $rutaPgNodeModules = Join-Path $RutaRepositorio 'node_modules/pg/package.json'
    if (-not (Test-Path $rutaPgNodeModules)) {
        Fail "No se encontro 'pg' instalado en 'node_modules' del repositorio real ('$rutaPgNodeModules' ausente)." 6
    }
    $script:RutaPackageJsonRepoResuelta = (Resolve-Path $rutaPackageJsonRepo).ProviderPath
    $env:RF24_PACKAGE_JSON_PATH = $script:RutaPackageJsonRepoResuelta
    Exito "'package.json' y 'node_modules/pg' confirmados en el repositorio real -- los validadores embebidos resolveran 'pg' anclados a '$($script:RutaPackageJsonRepoResuelta)' (via 'createRequire')."

    # ------------------------------------------------------------------
    # Lectura oculta de la URL administrativa de produccion (SOLO
    # LECTURA desde este punto en adelante -- ver GARANTIAS
    # ESTRUCTURALES (D) en la cabecera).
    # ------------------------------------------------------------------
    Registrar "Introduce la URL de conexion ADMINISTRATIVA (neondb_owner) de PRODUCCION. No se mostrara en pantalla. Esta ejecucion es de SOLO LECTURA -- no se aplicara ningun cambio."
    $urlSegura = Read-Host -AsSecureString -Prompt 'DATABASE_URL (admin, produccion, solo lectura)'
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($urlSegura)
    try { $script:UrlAdminTexto = [System.Runtime.InteropServices.Marshal]::PtrToStringUni($bstr) }
    finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    if ([string]::IsNullOrWhiteSpace($script:UrlAdminTexto)) { Fail "No se recibio ninguna URL." 7 }

    # Autochequeo previo (defensa en profundidad) sobre el propio valor
    # recibido, ANTES de usarlo para nada -- mismo criterio que el
    # sentinel 36 de v8.
    $hostUrlAdminPrevio = Extraer-HostDeUrlPostgres $script:UrlAdminTexto
    if ([string]::IsNullOrWhiteSpace($hostUrlAdminPrevio) -or $hostUrlAdminPrevio -ine $HostProduccionEsperado -or $hostUrlAdminPrevio -imatch '-pooler') {
        Fail "La URL recibida no tiene exactamente el host directo esperado, o contiene '-pooler' -- no se continua." 8
    }

    # ------------------------------------------------------------------
    # VALIDACION DE DESTINO -- conexion de SOLO LECTURA (host, base URL
    # Y 'current_database()', rol, no-pooled, TLS fuerte,
    # channel_binding). Adaptada de 'BLOQUE D' de v8: identica en
    # significado, sin ninguna de las variables de entorno que Prisma
    # usaria (este archivo nunca invoca Prisma).
    # ------------------------------------------------------------------
    $cjsValidarDestino = @'
const { createRequire } = require("module");
const requireDesdeRepo = createRequire(process.env.RF24_PACKAGE_JSON_PATH);
const { Client } = requireDesdeRepo("pg");
const url = process.env.DATABASE_URL_ADMIN_PROD;
if (!url) { console.error(JSON.stringify({ error: "sin DATABASE_URL_ADMIN_PROD" })); process.exit(1); }
let parsed;
try { parsed = new URL(url); } catch (e) { console.error(JSON.stringify({ error: "URL invalida" })); process.exit(1); }

const hostEsperado = process.env.RF24_HOST_ESPERADO;
const dbEsperada = process.env.RF24_DB_ESPERADA;
const rolEsperado = process.env.RF24_ROL_ESPERADO;

const resultado = {
  hostCoincide: parsed.hostname === hostEsperado,
  esPooled: parsed.hostname.includes("-pooler"),
  dbCoincideUrl: parsed.pathname.replace(/^\//, "") === dbEsperada,
  sslmode: parsed.searchParams.get("sslmode"),
  channelBinding: parsed.searchParams.get("channel_binding"),
};

(async () => {
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    await client.query(`SET default_transaction_read_only = on`);
    await client.query(`BEGIN`);
    const r = await client.query(`SELECT current_user AS usuario, current_database() AS basedatos`);
    resultado.conectado = true;
    resultado.usuarioActual = r.rows[0].usuario;
    resultado.baseActual = r.rows[0].basedatos;
    resultado.rolCoincide = r.rows[0].usuario === rolEsperado;
    resultado.baseActualCoincide = r.rows[0].basedatos === dbEsperada;
    await client.query(`ROLLBACK`);
  } catch (e) {
    try { await client.query(`ROLLBACK`); } catch (e2) {}
    resultado.conectado = false;
    resultado.errorConexion = String(e.message || e);
  } finally {
    await client.end().catch(() => {});
  }
  console.log(JSON.stringify(resultado));
})();
'@
    $rutaCjsValidar = Join-Path $script:DirTrabajo 'validar-destino-solo-lectura.cjs'
    Set-Content -Path $rutaCjsValidar -Value $cjsValidarDestino -Encoding UTF8 -NoNewline
    $env:DATABASE_URL_ADMIN_PROD = $script:UrlAdminTexto
    $env:RF24_HOST_ESPERADO = $HostProduccionEsperado
    $env:RF24_DB_ESPERADA = $BaseDatosProduccionEsperada
    $env:RF24_ROL_ESPERADO = $RolAdministrativoEsperado
    $resultadoValidacion = Invoke-ComandoExterno -Ejecutable 'node' -Argumentos @($rutaCjsValidar)
    if ($resultadoValidacion.TextoStderr) {
        Set-Content -Path (Join-Path $script:DirTrabajo 'validar-destino.stderr.log') -Value $resultadoValidacion.TextoStderr -Encoding UTF8
    }
    $codigoValidacion = $resultadoValidacion.CodigoSalida
    $salidaValidacion = $resultadoValidacion.TextoStdout
    Remove-Item Env:\RF24_HOST_ESPERADO, Env:\RF24_DB_ESPERADA, Env:\RF24_ROL_ESPERADO -ErrorAction SilentlyContinue

    if ($codigoValidacion -ne 0 -or -not $salidaValidacion) {
        Fail "El validador de destino no pudo ejecutarse o no conecto (codigo $codigoValidacion).$(Resumen-StderrParaError $resultadoValidacion.TextoStderr)" 8
    }
    $destino = $salidaValidacion | ConvertFrom-Json
    Registrar ("Destino -- hostCoincide={0} esPooled={1} dbCoincideUrl={2} baseActualCoincide={3} conectado={4} rolCoincide={5} sslmode={6} channelBinding={7}" -f `
        $destino.hostCoincide, $destino.esPooled, $destino.dbCoincideUrl, $destino.baseActualCoincide, $destino.conectado, $destino.rolCoincide, $destino.sslmode, $destino.channelBinding)

    if (-not $destino.hostCoincide) { Fail "El host resuelto NO coincide con el de produccion esperado." 9 }
    if ($destino.esPooled) { Fail "La URL es del endpoint POOLED. Usar la conexion DIRECTA." 10 }
    if (-not $destino.dbCoincideUrl) { Fail "El nombre de base de datos en la URL no coincide con el esperado." 11 }
    if (-not $destino.conectado) { Fail "No se pudo conectar al destino: $($destino.errorConexion)" 12 }
    if (-not $destino.rolCoincide) { Fail "El rol conectado no es '$RolAdministrativoEsperado'." 13 }
    if (-not $destino.baseActualCoincide) { Fail "'current_database()' real ('$($destino.baseActual)') no coincide con la base esperada." 14 }
    if ($SslModesFuertesPermitidos -notcontains $destino.sslmode) { Fail "TLS insuficiente: sslmode='$($destino.sslmode)'." 15 }
    if ($destino.channelBinding -ne 'require') { Fail "TLS insuficiente: channel_binding='$($destino.channelBinding)', se exige 'require'." 16 }
    Exito "Destino validado por URL Y por conexion efectiva de SOLO LECTURA: host/db/rol esperados, conexion DIRECTA, TLS fuerte."

    # ------------------------------------------------------------------
    # VERIFICACION PRINCIPAL -- UNA SOLA conexion, UNA SOLA transaccion
    # de SOLO LECTURA reforzada a nivel de MOTOR (ver GARANTIAS
    # ESTRUCTURALES (D)). Cubre: _prisma_migrations (NUEVO), enums,
    # tablas, privilegios directos, PRIMARY KEY (NUEVO), CHECK
    # constraints (NUEVO), FOREIGN KEY (NUEVO), indices (NUEVO), patron
    # corregido, funciones (firma CORREGIDA via 'oidvectortypes',
    # propietario, SECURITY DEFINER, proconfig, ACL), RLS y politicas.
    # ------------------------------------------------------------------
    $cjsVerificacionSoloLectura = @'
const { createRequire } = require("module");
const requireDesdeRepo = createRequire(process.env.RF24_PACKAGE_JSON_PATH);
const { Client } = requireDesdeRepo("pg");

const migracionesRf24 = JSON.parse(process.env.RF24_MIGRACIONES_JSON);

// Valores de enum esperados, EXACTOS y en orden -- heredado de v8, sin
// cambios.
const enumsEsperados = {
  BucketLimiteTasa: ["INICIO_EVALUACION", "DESBLOQUEO_DETALLE", "SOLICITUD_DERECHOS", "CONFIRMAR_DERECHOS"],
  AlcanceRetiro: ["DIAGNOSTICO", "INVESTIGACION", "AMBAS_FINALIDADES"],
  TipoSolicitudDerechos: ["RETIRO_CONSENTIMIENTO", "ELIMINACION_CONTACTO", "RETIRO_Y_ELIMINACION"],
  EstadoSolicitudDerechos: ["PENDIENTE", "PROCESADA", "EXPIRADA", "CANCELADA"],
  EstadoResolucion: ["AUTOMATICO", "SOPORTE"],
};

// Firma esperada (SOLO TIPOS -- ver cabecera del .ps1 para la correccion
// via 'oidvectortypes') y si SECURITY DEFINER debe ser true -- heredado
// de v8, sin cambios en los valores: 11 de 12 en true/true, 1 (interna)
// en false/false.
const funcionesEsperadas = {
  crear_solicitud_derechos:                       { firma: "text, text, text, text, text", securityDefiner: true,  concedeEjecucionChainpulse: true  },
  aplicar_efecto_solicitud_derechos:               { firma: "text, text, text, text",       securityDefiner: false, concedeEjecucionChainpulse: false },
  procesar_solicitud_derechos:                     { firma: "text",                         securityDefiner: true,  concedeEjecucionChainpulse: true  },
  resolver_solicitud_por_soporte:                  { firma: "text, text",                   securityDefiner: true,  concedeEjecucionChainpulse: true  },
  reclamar_solicitudes_derechos_para_envio:        { firma: "",                              securityDefiner: true,  concedeEjecucionChainpulse: true  },
  asignar_token_pendiente:                         { firma: "text, text, text, integer",     securityDefiner: true,  concedeEjecucionChainpulse: true  },
  confirmar_envio_token:                           { firma: "text, text",                   securityDefiner: true,  concedeEjecucionChainpulse: true  },
  registrar_fallo_envio_solicitud_derechos:        { firma: "text, text",                   securityDefiner: true,  concedeEjecucionChainpulse: true  },
  cancelar_solicitud_derechos_por_envio_fallido:   { firma: "text, text",                   securityDefiner: true,  concedeEjecucionChainpulse: true  },
  reconciliar_solicitudes_derechos_agotadas:       { firma: "",                              securityDefiner: true,  concedeEjecucionChainpulse: true  },
  expirar_solicitudes_derechos_vencidas:           { firma: "",                              securityDefiner: true,  concedeEjecucionChainpulse: true  },
  purgar_solicitudes_derechos_segun_retencion:     { firma: "",                              securityDefiner: true,  concedeEjecucionChainpulse: true  },
};
const nombresFunciones = Object.keys(funcionesEsperadas);

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL_ADMIN_PROD });
  const r = {};
  try {
    await client.connect();
    // Refuerzo de SOLO LECTURA a nivel de MOTOR -- ver GARANTIAS
    // ESTRUCTURALES (D) en la cabecera del .ps1. Ninguna sentencia
    // mutante puede tener exito en esta sesion, sin importar que SQL se
    // construya en el futuro o por error.
    await client.query(`SET default_transaction_read_only = on`);
    await client.query(`BEGIN`);

    // -------- NUEVO EN ESTA RONDA: '_prisma_migrations' --------
    const migs = await client.query(`
      SELECT migration_name, checksum, started_at, finished_at, rolled_back_at, applied_steps_count, logs
      FROM public."_prisma_migrations" WHERE migration_name = ANY($1) ORDER BY migration_name`, [migracionesRf24]);
    r.migracionesReales = migs.rows;

    // -------- heredado de v8, sin cambios --------
    const enums = await client.query(`
      SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = ANY($1) ORDER BY t.typname, e.enumsortorder`, [Object.keys(enumsEsperados)]);
    r.enumsReales = {};
    for (const fila of enums.rows) {
      if (!r.enumsReales[fila.typname]) r.enumsReales[fila.typname] = [];
      r.enumsReales[fila.typname].push(fila.enumlabel);
    }
    r.enumsEsperados = enumsEsperados;

    const tablas = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name IN ('solicitudes_derechos','intentos_solicitud_derechos_descartados')`);
    r.tablasPresentes = tablas.rows.map(x => x.table_name);

    const privilegiosDirectos = await client.query(`
      SELECT table_name, grantee, privilege_type FROM information_schema.table_privileges
      WHERE grantee IN ('chainpulse_app','PUBLIC') AND table_schema='public'
        AND table_name IN ('solicitudes_derechos','intentos_solicitud_derechos_descartados')`);
    r.privilegiosDirectosIndebidos = privilegiosDirectos.rows;

    // -------- NUEVO EN ESTA RONDA: PRIMARY KEY --------
    const pks = await client.query(`
      SELECT conrelid::regclass::text AS tabla, conname
      FROM pg_constraint
      WHERE contype = 'p' AND conrelid IN ('public.solicitudes_derechos'::regclass, 'public.intentos_solicitud_derechos_descartados'::regclass)
      ORDER BY tabla`);
    r.primaryKeys = pks.rows;

    // -------- NUEVO EN ESTA RONDA: CHECK constraints --------
    const checks = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS definicion
      FROM pg_constraint
      WHERE contype = 'c' AND conrelid = 'public.solicitudes_derechos'::regclass
      ORDER BY conname`);
    r.checkConstraints = checks.rows;

    // -------- NUEVO EN ESTA RONDA: FOREIGN KEY --------
    const fks = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS definicion
      FROM pg_constraint
      WHERE contype = 'f' AND conrelid = 'public.solicitudes_derechos'::regclass
      ORDER BY conname`);
    r.foreignKeys = fks.rows;

    // -------- NUEVO EN ESTA RONDA: indices --------
    const indices = await client.query(`
      SELECT tablename, indexname FROM pg_indexes
      WHERE schemaname='public' AND tablename IN ('solicitudes_derechos','intentos_solicitud_derechos_descartados')
      ORDER BY tablename, indexname`);
    r.indices = indices.rows;

    // -------- heredado de v8, sin cambios --------
    const cuerpoFuncion = await client.query(`SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname='crear_solicitud_derechos' AND pronamespace = 'public'::regnamespace::oid`);
    const def = cuerpoFuncion.rows[0] ? cuerpoFuncion.rows[0].def : '';
    r.patronCorregidoPresente = def.includes('FROM public.evaluaciones_expres_v2 AS ev') && def.includes('WHERE ev.id = p_evaluacion_id');
    r.patronViejoAusente = !/FROM public\.evaluaciones_expres_v2 WHERE id = p_evaluacion_id/.test(def);

    // -------- CORREGIDO EN ESTA RONDA: la firma se reconstruye ahora via
    // 'oidvectortypes(p.proargtypes)' -- ver DEFECTO en la cabecera del
    // .ps1 para la funcion de catalogo que esta remplaza y por que.
    // 'proargtypes' es un 'oidvector' que, por definicion del catalogo,
    // SOLO contiene tipos de entrada -- nunca nombres de parametro,
    // estructuralmente. --------
    const funcionesTodosEsquemas = await client.query(`
      SELECT p.oid::bigint AS oid, p.proname, n.nspname AS esquema, pg_get_userbyid(p.proowner) AS propietario,
             p.prosecdef AS security_definer, p.proconfig AS config,
             oidvectortypes(p.proargtypes) AS firma
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = ANY($1)
      ORDER BY p.proname, n.nspname`, [nombresFunciones]);
    r.funcionesTodosEsquemas = funcionesTodosEsquemas.rows;
    r.funcionesFueraDePublic = funcionesTodosEsquemas.rows.filter(f => f.esquema !== 'public');
    const conteoPorNombre = {};
    for (const f of funcionesTodosEsquemas.rows) { conteoPorNombre[f.proname] = (conteoPorNombre[f.proname] || 0) + 1; }
    r.duplicados = Object.entries(conteoPorNombre).filter(([, n]) => n > 1).map(([nombre, n]) => ({ nombre, n }));

    const oidsPublic = funcionesTodosEsquemas.rows.filter(f => f.esquema === 'public').map(f => f.oid);
    r.aclPorFuncion = oidsPublic.length ? (await client.query(`
      SELECT p.oid::bigint AS oid, p.proname,
             (aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))).grantee::regrole::text AS grantee,
             (aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))).privilege_type AS privilegio
      FROM pg_proc p
      WHERE p.oid = ANY($1::bigint[])
      ORDER BY p.proname, grantee, privilegio`, [oidsPublic])).rows : [];

    const rls = await client.query(`
      SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN ('solicitudes_derechos','intentos_solicitud_derechos_descartados')`);
    r.rls = rls.rows;

    const politicas = await client.query(`
      SELECT tablename, policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename IN ('solicitudes_derechos','intentos_solicitud_derechos_descartados')`);
    r.politicasRls = politicas.rows;

    r.funcionesEsperadas = funcionesEsperadas;
    await client.query(`ROLLBACK`);
    r.ok = true;
  } catch (e) {
    try { await client.query(`ROLLBACK`); } catch (e2) {}
    r.ok = false; r.error = String(e.message || e);
  } finally { await client.end().catch(() => {}); }
  console.log(JSON.stringify(r));
})();
'@
    $rutaCjsVerif = Join-Path $script:DirTrabajo 'verificacion-post-deploy-solo-lectura.cjs'
    Set-Content -Path $rutaCjsVerif -Value $cjsVerificacionSoloLectura -Encoding UTF8 -NoNewline
    $env:DATABASE_URL_ADMIN_PROD = $script:UrlAdminTexto
    $env:RF24_MIGRACIONES_JSON = ($MigracionesRf24EnOrden | ConvertTo-Json -Compress)
    $resultadoVerif = Invoke-ComandoExterno -Ejecutable 'node' -Argumentos @($rutaCjsVerif)
    if ($resultadoVerif.TextoStderr) {
        Set-Content -Path (Join-Path $script:DirTrabajo 'verificacion.stderr.log') -Value $resultadoVerif.TextoStderr -Encoding UTF8
    }
    $salidaVerif = $resultadoVerif.TextoStdout
    Remove-Item Env:\RF24_MIGRACIONES_JSON -ErrorAction SilentlyContinue
    if ($resultadoVerif.CodigoSalida -ne 0 -or -not $salidaVerif) {
        Fail "La verificacion principal no pudo ejecutarse (codigo $($resultadoVerif.CodigoSalida)).$(Resumen-StderrParaError $resultadoVerif.TextoStderr)" 17
    }
    # NUEVO EN ESTA RONDA: el JSON crudo de la verificacion principal se
    # persiste en disco ANTES de convertirlo con 'ConvertFrom-Json' --
    # nunca contiene credenciales (ninguno de sus campos es la cadena de
    # conexion; ver la forma completa de 'r' en el validador embebido de
    # mas arriba) -- para poder diagnosticar, sin volver a conectarse a
    # nada, cualquier fallo futuro de la conversion o de la validacion
    # posterior (ver DEFECTO en la cabecera: asi se habria podido
    # inspeccionar, sin repetir la conexion, el caso real que disparo
    # esta ronda).
    $rutaJsonVerifCrudo = Join-Path $script:DirTrabajo 'verificacion-post-deploy-cruda.json'
    Set-Content -Path $rutaJsonVerifCrudo -Value $salidaVerif -Encoding UTF8
    $verif = $salidaVerif | ConvertFrom-Json
    if (-not $verif.ok) { Fail "La verificacion principal fallo internamente: $($verif.error)" 18 }

    # NUEVO EN ESTA RONDA: toda la validacion de '$verif' vive ahora en
    # 'Validar-ResultadoVerificacionPrincipal' (definida junto al resto
    # de funciones auxiliares, antes de este bloque) -- MISMO
    # comportamiento exacto que antes, nunca debilitado; unico motivo del
    # cambio: poder probarla de forma real y aislada (ver cabecera y
    # 'rf24-prueba-cardinalidad-v1.ps1').
    Validar-ResultadoVerificacionPrincipal -Verif $verif

    Write-Host "RF24_POST_DEPLOY_VERIFICACION_PRINCIPAL_EXIT=0"

    # ------------------------------------------------------------------
    # RESIDUOS -- conexion separada, propia transaccion de solo lectura
    # reforzada a nivel de motor. INFORMATIVO por defecto -- ver nota en
    # la cabecera sobre por que NUNCA bloquea salvo opt-in explicito.
    # ------------------------------------------------------------------
    $cjsResiduos = @'
const { createRequire } = require("module");
const requireDesdeRepo = createRequire(process.env.RF24_PACKAGE_JSON_PATH);
const { Client } = requireDesdeRepo("pg");
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL_ADMIN_PROD });
  const r = {};
  try {
    await client.connect();
    await client.query(`SET default_transaction_read_only = on`);
    await client.query(`BEGIN`);
    const fila = await client.query(`
      SELECT (SELECT count(*)::int FROM "solicitudes_derechos") AS solicitudes,
             (SELECT count(*)::int FROM "intentos_solicitud_derechos_descartados") AS intentos`);
    r.conteos = fila.rows[0];
    await client.query(`ROLLBACK`);
    r.ok = true;
  } catch (e) {
    try { await client.query(`ROLLBACK`); } catch (e2) {}
    r.ok = false; r.error = String(e.message || e);
  } finally { await client.end().catch(() => {}); }
  console.log(JSON.stringify(r));
})();
'@
    $rutaCjsResiduos = Join-Path $script:DirTrabajo 'residuos-solo-lectura.cjs'
    Set-Content -Path $rutaCjsResiduos -Value $cjsResiduos -Encoding UTF8 -NoNewline
    $resultadoResiduos = Invoke-ComandoExterno -Ejecutable 'node' -Argumentos @($rutaCjsResiduos)
    if ($resultadoResiduos.TextoStderr) {
        Set-Content -Path (Join-Path $script:DirTrabajo 'residuos.stderr.log') -Value $resultadoResiduos.TextoStderr -Encoding UTF8
    }
    $salidaResiduos = $resultadoResiduos.TextoStdout
    $residuos = if ($resultadoResiduos.CodigoSalida -eq 0 -and $salidaResiduos) { $salidaResiduos | ConvertFrom-Json } else { $null }
    if (-not $residuos -or -not $residuos.ok) {
        Fail "La consulta de residuos no pudo ejecutarse o devolvio error (codigo $($resultadoResiduos.CodigoSalida)).$(Resumen-StderrParaError $resultadoResiduos.TextoStderr)" 47
    }
    Registrar "Conteos reales (informativo -- nunca se modifican ni se purgan desde este archivo): solicitudes_derechos=$($residuos.conteos.solicitudes), intentos_solicitud_derechos_descartados=$($residuos.conteos.intentos)."
    if ($ExigirCeroResiduosInmediatamenteTrasDeploy) {
        if ($residuos.conteos.solicitudes -ne 0 -or $residuos.conteos.intentos -ne 0) {
            Fail "RESIDUO DETECTADO (exigido via -ExigirCeroResiduosInmediatamenteTrasDeploy): $($residuos.conteos | ConvertTo-Json -Compress)." 46
        }
        Exito "Conteos en cero, exigido explicitamente para una verificacion inmediatamente posterior al primer deploy (-ExigirCeroResiduosInmediatamenteTrasDeploy)."
    } else {
        Exito "Conteos reportados en modo INFORMATIVO (por defecto -- nunca bloqueante): una ejecucion posterior legitima puede tener solicitudes reales de usuarios, no residuos de prueba. Pasa -ExigirCeroResiduosInmediatamenteTrasDeploy solo si esta ejecucion es inmediatamente posterior al primer deploy, sin trafico real todavia."
    }

    # ------------------------------------------------------------------
    # Reporte final persistido -- evidencia local para Alex, nunca
    # enviado ni compartido por este script.
    # ------------------------------------------------------------------
    $rutaReporteFinal = Join-Path $script:DirTrabajo 'reporte-verificacion-post-deploy.json'
    [ordered]@{
        momentoUtc                 = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
        host                       = $HostProduccionEsperado
        baseDeDatos                = $BaseDatosProduccionEsperada
        migracionesVerificadas     = $MigracionesRf24EnOrden
        residuosExigidosEnCero     = [bool]$ExigirCeroResiduosInmediatamenteTrasDeploy
        conteosResiduos            = $residuos.conteos
        resultado                  = 'TODO_OK'
    } | ConvertTo-Json -Depth 5 | Set-Content -Path $rutaReporteFinal -Encoding UTF8
    Registrar "Reporte final persistido en: $rutaReporteFinal"

    $script:CodigoSalidaFinal = 0
    Write-Host "RF24_POST_DEPLOY_VERIFICACION_EXIT=0"
}
catch {
    if ($_.Exception.Message -match '^RF24_RO_FAIL:(\d+)$' -or $_.Exception.Message -match '^RF24_RO_DETENER_SIN_ERROR:(\d+)$') {
        # Ya se registro y se fijo '$script:CodigoSalidaFinal' en 'Fail'/'Detener'.
    } else {
        # NUEVO EN ESTA RONDA: se registra tambien la linea real (numero
        # y texto) donde ocurrio la excepcion NO controlada -- antes solo
        # se registraba el mensaje de la excepcion, lo que obligaba a
        # adivinar el punto exacto de fallo, exactamente como ocurrio con
        # el defecto real de esta misma ronda (sentinel 99 sin mas
        # contexto que "no se encuentra la propiedad 'Count'").
        $numeroLineaFallo = $null
        $textoLineaFallo = $null
        try {
            if ($_.InvocationInfo) {
                $numeroLineaFallo = $_.InvocationInfo.ScriptLineNumber
                if ($_.InvocationInfo.Line) { $textoLineaFallo = $_.InvocationInfo.Line.Trim() }
            }
        } catch {}
        $detalleLinea = if ($numeroLineaFallo) { " (linea $numeroLineaFallo`: $textoLineaFallo)" } else { '' }
        Registrar "EXCEPCION NO CONTROLADA: $($_.Exception.Message)$detalleLinea"
        $script:CodigoSalidaFinal = 99
    }
}
finally {
    LimpiarCredenciales
    Registrar "=== Codigo de salida final: $script:CodigoSalidaFinal ==="
}

exit $script:CodigoSalidaFinal
