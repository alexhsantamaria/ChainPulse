<#
ChainPulse -- RF24 (derechos/retiro). Procedimiento FINAL BLOQUEADO v8
para aplicar en PRODUCCION las 6 migraciones de PR #13.

CAMBIO DE v7 A v8 (dos defectos reales observados en produccion por Alex;
v7 y anteriores quedan intactas, ya autenticadas, sin tocar):

  ------------------------------------------------------------------------
  DEFECTO 1 -- FALSO POSITIVO DEL SENTINEL 53 (lista negra de 'migrate
  status' bloqueaba salida INFORMATIVA real, nunca un error):
  ------------------------------------------------------------------------

  FALLO REAL OBSERVADO: 'migrate status' terminaba en el sentinel 53
  ("anomalia reconocida ... error") pese a no haber ningun error real.
  El stderr capturado por PowerShell al invocar un proceso nativo SIEMPRE
  incluye metadatos propios de PowerShell (nunca de Prisma) como
  'NativeCommandError' y 'FullyQualifiedErrorId' en cuanto el proceso
  escribe aunque sea una linea informativa a stderr (p.ej. la advertencia
  de deprecacion de Prisma sobre 'package.json#prisma', o el aviso
  rutinario "Environment variables loaded from .env"). La lista negra de
  v4-v7 usaba el alternante SIN delimitar '...|error', que coincide como
  SUBCADENA dentro de 'NativeCommandError' y de 'FullyQualifiedErrorId' --
  bloqueando produccion por una anomalia que nunca existio.

  CORRECCION: el alternante generico 'error' se reemplaza por '\berror\b'
  (limite de palabra en AMBOS lados) -- exige que 'error' aparezca como
  palabra INDEPENDIENTE, nunca como subcadena de otra palabra contigua de
  letras. 'NativeCommandError' y 'FullyQualifiedErrorId' NO tienen un
  limite de palabra inmediatamente antes de 'Error'/'Error' (la letra
  anterior es tambien alfabetica, 'd'/'d'), por lo que '\berror\b' nunca
  coincide dentro de ellas. Las demas senales de la lista negra
  ('migrate resolve', 'drift', 'failed migration', 'deviat', 'could not')
  se CONSERVAN exactamente como estaban -- siguen siendo coincidencias de
  subcadena deliberadas (p.ej. 'deviat' debe seguir cubriendo tanto
  'deviation' como 'deviating'), el unico cambio es el alternante
  'error' -> '\berror\b'. Un error real ('Error: P1001: ...', 'Error
  occurred', etc.) sigue bloqueando sin cambios: '\berror\b' SI coincide
  cuando 'Error'/'error' aparece como palabra propia (limite de palabra
  antes por inicio-de-cadena/espacio/puntuacion, y despues por
  espacio/puntuacion/fin-de-cadena). El sentinel se mantiene en **53**
  (mismo significado, regex corregida) -- ver bloque D mas abajo para el
  texto exacto.

  Se entrega una prueba real dedicada
  ('rf24-prueba-filtro-stderr-migrate-status-v1.ps1', descrita en la nota
  al final de este bloque) que ejercita el autómata de deteccion de
  anomalias EXTRAIDO VIA AST REAL del propio '.ps1' (mismo patron ya
  usado por el arnes A-I y la prueba de worktree para
  'Invoke-ComandoExterno') contra los 4 textos informativos reales
  listados arriba (deben NO bloquear) y contra un error real, 'drift',
  'failed migration' y 'migrate resolve' (deben SI bloquear).

  ------------------------------------------------------------------------
  DEFECTO 2 -- PRISMA USABA EL ENDPOINT POOLED VIA 'SEED_DATABASE_URL'
  (schema real con 'directUrl'), AJENO A LA URL ADMINISTRATIVA VALIDADA:
  ------------------------------------------------------------------------

  FALLO REAL OBSERVADO: el 'schema.prisma' real de ChainPulse declara

      url       = env("DATABASE_URL")
      directUrl = env("SEED_DATABASE_URL")

  v7 (y todas las versiones anteriores) solo fijaba '$env:DATABASE_URL'
  con la URL administrativa DIRECTA ya validada (Compuerta 1). Para los
  comandos de migracion, Prisma usa 'directUrl' -- es decir,
  'SEED_DATABASE_URL' -- que v7 NUNCA fijaba, por lo que Prisma caia al
  valor presente en '.env' del repositorio. Ese valor resulto ser, en
  produccion, el endpoint POOLED
  ('ep-steep-firefly-ac5drua5-pooler.sa-east-1.aws.neon.tech') -- un
  endpoint que la Compuerta 1 de este mismo procedimiento rechaza
  explicitamente para la conexion administrativa directa (sentinel 27),
  pero que 'migrate status'/'migrate deploy' usaban igualmente, por una
  via distinta ('.env', nunca por el entorno de proceso que este script
  controla).

  CORRECCION: inmediatamente antes de 'migrate status' y de
  'migrate deploy' (Compuerta 3), el script fija AMBAS variables de
  entorno -- 'DATABASE_URL' Y 'SEED_DATABASE_URL' -- a la MISMA URL
  administrativa DIRECTA ya validada ('$script:UrlAdminTexto'). Como
  Prisma (via la libreria 'dotenv' que usa internamente) NUNCA sobrescribe
  una variable de entorno que el PROCESO ya tiene fijada al cargar '.env'
  (solo completa las que faltan), fijar ambas variables en el proceso
  ANTES de invocar a Prisma garantiza que el destino EFECTIVO de
  'migrate status'/'migrate deploy' nunca dependa de '.env' -- se fija
  explicitamente, se demuestra, y se restaura despues.

  Disciplina de guardado/restauracion (nueva funcion
  'Guardar-VariablesEntornoBaseDatosPrevias' /
  'Restaurar-VariablesEntornoBaseDatosPrevias'):
    1. ANTES de fijar ninguna de las 2 variables, se captura -- SOLO EN
       MEMORIA de esta ejecucion, NUNCA registrado ni persistido -- si
       cada una existia previamente, y su valor EXACTO si existia.
    2. Al finalizar la Compuerta 3 (exito, 'Fail', o excepcion no
       controlada -- 'finally' local alrededor de todo el bloque, igual
       patron que ya protegia 'DATABASE_URL' en v7), ambas variables se
       RESTAURAN exactamente a su valor previo, o se ELIMINAN si antes no
       existian -- nunca se deja un valor fijado por este script tras la
       ejecucion.
    3. La misma restauracion se invoca tambien desde 'LimpiarCredenciales'
       (el 'finally' GLOBAL) y desde el manejador de cancelacion Ctrl+C
       ('CancelKeyPress') -- ambos ahora restauran, no solo eliminan, para
       que una cancelacion interactiva a mitad de la Compuerta 3 tampoco
       deje 'DATABASE_URL'/'SEED_DATABASE_URL' en un valor distinto al que
       tenian antes de esta ejecucion.
    4. Ningun valor de estas 2 variables se escribe nunca en el log ni se
       muestra en pantalla -- ni el previo ni el nuevo.

  Demostracion programatica (antes de invocar 'migrate deploy', nunca
  despues):
    1. Verificacion PREVIA (defensa en profundidad sobre el propio valor
       que este script esta a punto de fijar): se extrae el host de
       '$script:UrlAdminTexto' por regex y se exige que sea EXACTAMENTE
       '$HostProduccionEsperado' y que NO contenga la subcadena
       '-pooler' -- si fallara (lo que indicaria una regresion interna de
       este mismo script, nunca del entorno), bloquea ANTES de fijar
       nada (sentinel NUEVO 36).
    2. Verificacion POSTERIOR real sobre la salida EFECTIVA de
       'migrate status' (stdout + stderr, ambos streams, igual disciplina
       que el resto del script): se bloquea si aparece cualquier hostname
       de la forma '*-pooler*.neon.tech' (sentinel NUEVO 37), y se
       bloquea tambien si aparece cualquier otro hostname '*.neon.tech'
       que NO sea exactamente el host directo esperado (sentinel NUEVO
       38) -- cubre tanto el endpoint pooled especifico ya observado como
       cualquier otro host indebido que Prisma pudiera reportar. Si
       ninguno de los 2 patrones aparece en la salida, no se concluye
       nada en ningun sentido (Prisma no siempre imprime el host en una
       ejecucion sin errores de conexion) -- la garantia real viene del
       control de entorno (fijar ambas variables antes de invocar), este
       chequeo es defensa en profundidad adicional, nunca el unico
       mecanismo.
    3. La MISMA verificacion (2) se repite, con los sentinels NUEVOS 63 y
       64, sobre la salida combinada de 'migrate deploy' -- por
       simetria y porque 'migrate deploy' usa las mismas 2 variables de
       entorno que 'migrate status'.

  CAMBIOS EN EL '.ps1' para ambos defectos (NINGUNO afecta las 4
  correcciones de 'pg'/'createRequire' de v7, que se mantienen
  EXACTAMENTE iguales -- ver 'CAMBIO DE v6 A v7' mas abajo, conservado
  integro):
    - Sentinel 53: regex corregida ('\berror\b' en vez de 'error' sin
      delimitar), mismo significado y mismo numero.
    - Sentinels NUEVOS: 36 (auto-chequeo previo de host/pooler sobre
      '$script:UrlAdminTexto'), 37 y 38 ('migrate status' reporta un
      host pooled o un host distinto al esperado), 63 y 64 (idem para
      'migrate deploy').
    - Todas las demas compuertas, sentinels y validaciones de v7 (incluida
      la correccion 'createRequire'/'RF24_PACKAGE_JSON_PATH' completa)
      se mantienen EXACTAMENTE iguales.

  NOTA SOBRE LAS PRUEBAS NUEVAS (entregadas por separado, ver el paquete
  de esta ronda):
    - 'rf24-prueba-filtro-stderr-migrate-status-v1.ps1': extrae via AST
      real el fragmento de deteccion de anomalias de este mismo '.ps1' y
      lo ejercita contra los 4 textos informativos reales (deben pasar) y
      4 textos de error real/'drift'/'failed migration'/'migrate resolve'
      (deben bloquear).
    - 'rf24-prueba-precedencia-database-url-v1.ps1': demuestra, con
      variables de entorno REALES (nunca simuladas en texto), que
      'Guardar-VariablesEntornoBaseDatosPrevias' /
      'Restaurar-VariablesEntornoBaseDatosPrevias' (extraidas via AST real
      del mismo '.ps1') devuelven el entorno EXACTAMENTE al estado previo
      en los 3 escenarios posibles ('DATABASE_URL'/'SEED_DATABASE_URL'
      ausentes antes; presentes con un valor distinto antes; y uno
      presente/otro ausente), y que mientras estan fijadas, ambas
      contienen el valor administrativo esperado, nunca el valor previo.

CAMBIO DE v6 A v7 (fallo real reportado por Alex en Windows PowerShell 5.1;
v6 y anteriores quedan intactas, ya autenticadas, sin tocar; seccion
conservada integra por trazabilidad):

  FALLO REAL OBSERVADO (codigo de salida final 25):
      Mensaje: "Cannot find module 'pg'"
      Script causante: '%TEMP%\rf24-prod-v6-...\validar-destino.cjs'

  CAUSA RAIZ CONFIRMADA: los 4 bloques de Node EMBEBIDOS que usan el
  driver 'pg' ('cjsValidarDestino', 'cjsVerificacionPosterior',
  'cjsResiduos', 'cjsDefaultAcl') se escriben, los 4, a un archivo dentro
  de '$script:DirTrabajo' (una carpeta bajo '$env:TEMP', creada de nuevo
  en cada ejecucion) y se invocan desde ahi. Node.js resuelve
  'require("pg")' buscando 'node_modules/pg' a partir del DIRECTORIO DEL
  ARCHIVO que lo contiene, subiendo por el arbol de directorios -- NUNCA
  a partir del directorio de trabajo actual (cwd) ni de ningun
  'Push-Location' previo. Como '%TEMP%\rf24-prod-v6-<GUID>' esta fuera
  por completo del arbol de 'ChainPulse' (y por tanto de
  'ChainPulse\node_modules\pg'), esa busqueda nunca encuentra el modulo y
  Node termina con 'MODULE_NOT_FOUND' ANTES de llegar a analizar la URL o
  a intentar conectarse -- exactamente el sintoma reportado (sentinel 25,
  "no pudo ejecutarse", disparado por el fallo de arranque de Node, no
  por un problema real de conexion o de la URL).

  CORRECCION (en los 4 bloques de Node, de forma identica): en vez de
  'require("pg")' directo, cada bloque usa ahora
  'createRequire' (del modulo nucleo 'module' de Node) ANCLADO al
  'package.json' REAL del repositorio, leido desde una variable de
  entorno que el propio '.ps1' fija ANTES de invocar cualquiera de los 4:

      const { createRequire } = require("module");
      const requireDesdeRepo = createRequire(process.env.RF24_PACKAGE_JSON_PATH);
      const { Client } = requireDesdeRepo("pg");

  'createRequire(rutaAPackageJson)' crea una funcion 'require' que
  resuelve modulos a partir del DIRECTORIO de esa ruta (igual que si el
  script viviera ahi) -- como esa ruta es el 'package.json' REAL de
  'ChainPulse', la busqueda de 'pg' encuentra
  'ChainPulse\node_modules\pg' sin importar en que carpeta temporal se
  haya escrito el '.cjs' que lo invoca, y sin depender en absoluto del
  directorio de trabajo actual ni de ningun 'Push-Location'.

  CAMBIOS EN EL '.ps1' (nunca en la v6 -- esto ES la v7):
    1. ANTES de pedir la URL de conexion (por lo tanto antes de que
       pueda existir ningun riesgo de conectarse a Neon o de exponer
       ninguna credencial), se valida que '<RutaRepositorio>\package.json'
       y '<RutaRepositorio>\node_modules\pg\package.json' existan de
       verdad (sentinels NUEVOS 34 y 35) -- justo despues de la
       resolucion ya existente del Prisma local (sentinels 21-23), en el
       mismo bloque de comprobaciones de 'node_modules'.
    2. Si ambos existen, se fija '$env:RF24_PACKAGE_JSON_PATH' con la
       ruta ABSOLUTA resuelta ('Resolve-Path') al 'package.json' real --
       una sola vez, reutilizada por los 4 bloques de Node a lo largo de
       toda la ejecucion (mismo patron ya establecido para
       'DATABASE_URL_ADMIN_PROD': se fija una vez, se reutiliza, se
       limpia al final).
    3. 'LimpiarCredenciales' (el 'finally' GLOBAL del script, se ejecute
       lo que se ejecute) ahora SIEMPRE retira tambien
       'Env:\RF24_PACKAGE_JSON_PATH', ademas de 'DATABASE_URL_ADMIN_PROD'
       y 'DATABASE_URL' -- nunca queda esa variable de entorno tras esta
       ejecucion, exito o fallo.
    4. NO se usa 'NODE_PATH' global en ningun punto (afectaria a CUALQUIER
       proceso Node del sistema mientras este definida, un alcance mucho
       mas amplio y mas fragil que anclar cada 'require' con
       'createRequire'), y la solucion NUNCA depende del directorio de
       trabajo actual (cwd) ni de ningun 'Push-Location' -- 'pg' se
       resuelve siempre por la ruta explicita de 'package.json', pasada
       por variable de entorno.
    5. La lectura oculta de la URL (`Read-Host -AsSecureString`) y su
       limpieza (vía 'LimpiarCredenciales') quedan EXACTAMENTE igual que
       en v6 -- no se tocaron.
    6. Los 3 errores bloqueantes que dependen de que uno de los 4
       bloques de Node arranque (sentinels 25, 70 y 89 -- validador de
       destino, verificacion posterior, auditoria de residuos) ahora
       incluyen, en el mensaje de 'Fail', el 'stderr' REAL de Node
       (redactado por la misma expresion regular que ya usa 'Registrar'
       para cualquier 'postgres://...' -- nunca se expone la URL), para
       que un fallo de arranque futuro (de esta clase o de cualquier
       otra) sea diagnosticable sin tener que ir a buscar los archivos
       '.stderr.log' sueltos.
    7. TODAS las compuertas (1, 2, 3), TODOS los sentinels existentes
       (2-99) y TODAS las validaciones de v6 (identidad byte a byte,
       preflight, validacion de destino, evidencia de restauracion,
       'migrate status'/'migrate deploy', verificacion posterior
       ampliada, auditoria de residuos) se mantienen EXACTAMENTE
       iguales -- esta ronda SOLO corrige la resolucion del modulo 'pg'
       dentro de los 4 bloques de Node embebidos y anade las 2
       comprobaciones nuevas (34, 35) mas la limpieza de la variable de
       entorno nueva. Los 4 'smoke tests' retirados en v4/v5/v6 SIGUEN
       retirados (sin cambios, ver bloque F mas abajo).

  NOTA SOBRE LA PRUEBA NUEVA (entregada por separado, ver el paquete de
  esta ronda): se anade una prueba real dedicada
  ('rf24-v6-prueba-resolucion-pg-temporal.ps1') que ejecuta, de forma
  AISLADA (sin v6, sin wrapper, sin Neon), un '.cjs' MINIMO que replica
  EXACTAMENTE el patron de 'createRequire' de arriba, invocado desde una
  carpeta temporal totalmente AJENA a 'ChainPulse' (ningun ancestro
  comun), y demuestra que SI logra resolver y cargar 'pg' desde
  'ChainPulse\node_modules\pg' (imprime la ruta real resuelta del modulo
  cargado, vía 'require.resolve' dentro del propio '.cjs' de prueba, y la
  compara contra la ruta esperada dentro del repositorio) -- la prueba
  que la version anterior (v6) NUNCA tuvo, y que habria detectado este
  defecto antes de la ejecucion real contra produccion.

CAMBIO DE v5 A v6 (revision integral del mismo bug de fondo; v4 y v5
quedan intactas, ya autenticadas, sin tocar; seccion conservada integra
por trazabilidad):

  ALCANCE: v5 corrigio, de forma deliberadamente ESTRECHA (a pedido
  explicito de Alex, en esa ronda), SOLO 'git worktree add' frente al bug
  de PowerShell con stderr nativo + '$ErrorActionPreference = "Stop"'
  global (ver seccion de v4-a-v5 mas abajo, conservada integra por
  trazabilidad). v5 documentaba explicitamente, como "riesgo residual",
  que el mismo mecanismo de fondo era igual de fragil en otras 13
  invocaciones nativas del script. Alex pidio esta vez una revision
  INTEGRAL, no otra correccion parcial: v6 identifica, mediante
  enumeracion manual exhaustiva de cada invocacion con el operador '&' o
  un nombre de comando nativo (ver "INVENTARIO DE INVOCACIONES NATIVAS"
  mas abajo) las 14 invocaciones nativas totales del script (8 de 'git',
  6 de 'node') y aplica, a las 14, el mismo patron de proteccion -- no
  solo a 'git worktree add'.

  REDISENO DE 'Invoke-ComandoExterno' (unica funcion que cambia de forma
  estructural; su firma de parametros no cambia, su forma de uso SI):
  v5 fusionaba stdout+stderr con '2>&1' en un solo texto -- aceptable
  para 'git worktree add' (su salida nunca se parsea como JSON ni linea
  por linea), pero riesgoso para las 5 llamadas a 'node' que SI dependen
  de un stdout puro (4 de ellas emiten JSON vía 'console.log'; la quinta,
  'migrate status', se parsea linea por linea con un automata de estados
  estricto -- ver bloque B mas abajo). v6 captura stdout y stderr POR
  SEPARADO (stderr vía un archivo temporal propio, nunca con un merge
  '2>&1'), bajo el mismo '$ErrorActionPreference = "Continue"' local (el
  scoping de variables de PowerShell sigue garantizando que esto nunca
  afecta el 'Stop' global). Ademas, v6 anade dos salvaguardas que v5 no
  tenia:
    - Comprueba, ANTES de invocar, que el ejecutable existe de verdad
      ('Get-Command -CommandType Application') -- si no existe, devuelve
      un sentinel propio (CodigoSalida = -1) SIN leer jamas
      '$LASTEXITCODE' en esa rama (evita contaminacion por un codigo de
      una invocacion anterior no relacionada).
    - Envuelve la invocacion real en su propio try/catch: un fallo de
      ARRANQUE (el binario existe pero no pudo ejecutarse) tambien se
      convierte en el mismo sentinel (-1), nunca en una excepcion sin
      clasificar ni en un '$LASTEXITCODE' heredado.
  El objeto que devuelve ahora expone, por separado: 'CodigoSalida',
  'LineasStdout'/'TextoStdout', 'LineasStderr'/'TextoStderr', y
  'LineasCombinadas'/'TextoCombinado' (stdout seguido de stderr -- un
  ORDEN PRACTICO para quien solo quiere ver "todo", nunca una
  intercalacion cronologica real) mas 'DetalleFalloInvocacion' (solo
  cuando CodigoSalida=-1). El resultado se decide SIEMPRE por
  'CodigoSalida', nunca por la mera presencia de texto en stderr, y
  nunca se confunde una salida vacia con un fallo.

  LAS 14 INVOCACIONES NATIVAS, y como v6 las trata (detalle completo
  tambien en el informe de auditoria entregado por separado):
    1. 'git worktree remove --force' (en 'LimpiarCredenciales'): ahora
       pasa por el wrapper, con una guarda nueva ANTES de invocarlo (ruta
       absoluta, no vacia, sin caracteres de comodin '*'/'?', existente)
       y una "ALERTA DE RESIDUO" explicita si falla -- sin alterar jamas
       '$script:CodigoSalidaFinal' ya fijado por la logica principal.
    2. 'git fetch origin main --quiet': wrapper; codigo real -ne 0
       bloquea (sentinel 11, sin cambios de significado).
    3. 'git rev-parse origin/main': wrapper; se exige ADEMAS cardinalidad
       y formato exactos (una sola linea, 40 caracteres hexadecimales) --
       cualquier fallo de codigo o de formato bloquea con el sentinel
       NUEVO 95 (antes solo se comparaba el valor con un '.Trim()' ciego,
       sin verificar exit code ni forma).
    4. 'git merge-base --is-ancestor': wrapper; AHORA se distingue
       explicitamente entre 3 casos -- codigo 0 (es ancestro, OK), codigo
       1 (NO es ancestro, sentinel 13 sin cambios), y cualquier OTRO
       codigo (error operativo real de Git, sentinel NUEVO 97) -- v5
       trataba cualquier codigo distinto de 0 de forma identica.
    5. 'git worktree add --detach': ya estaba envuelta en v5; se adapta
       a la nueva forma del objeto devuelto (sentinel 14, sin cambios).
    6. 'git -C <worktree> rev-parse HEAD': wrapper; misma cardinalidad y
       formato que el punto 3 (sentinel NUEVO 96 si falla codigo o
       forma; sentinel 15 sin cambios si el SHA no coincide con el
       esperado).
    7. 'git -C <worktree> status --porcelain': wrapper; codigo -ne 0
       bloquea con el sentinel NUEVO 98 (fallo operativo de git, DISTINTO
       de "arbol sucio"); salida no vacia con codigo 0 sigue bloqueando
       con el sentinel 16, sin cambios.
    8. 'git status --porcelain -- <rutas>' (arbol de trabajo real):
       wrapper; mismo tratamiento que el punto 7 -- sentinel 98
       (operativo) o sentinel 92 (sucio), sin cambios de significado.
    9. 'node validar-destino.cjs' (bloque D): wrapper; el JSON se parsea
       desde 'TextoStdout' PURO (nunca mezclado con stderr); stderr se
       sigue volcando al mismo archivo de log de siempre, sin perder
       nada; sentinels 25-33 sin cambios de significado.
    10. 'node migrate status': wrapper; CAMBIO DELIBERADO (no un
        aflojamiento, una mejora de robustez expresamente permitida por
        el pedido de Alex): el automata de estados que extrae las
        migraciones "pendientes" linea por linea ahora lee EXCLUSIVAMENTE
        'LineasStdout' (stdout puro) -- en v5 leia el merge '2>&1', lo
        que en teoria podia intercalar una linea de stderr en medio del
        bloque de pendientes y disparar un bloqueo espurio (sentinel 59)
        por una linea que en realidad no venia de stdout. Como red de
        seguridad adicional (para no perder cobertura al separar los
        streams), la lista negra de anomalias conocidas ('migrate
        resolve'/drift/'failed migration'/'could not'/'error') se sigue
        evaluando TANTO en 'TextoStdout' COMO en 'TextoStderr' -- si
        aparece en cualquiera de los dos, bloquea igual que en v5
        (sentinel 53). Sentinels 54/56/57/58/59/60/61 sin cambios de
        significado.
    11. 'node migrate deploy': wrapper; sentinel 62 sin cambios.
    12. 'node verificacion-posterior.cjs' (bloque E): wrapper; mismo
        tratamiento que el punto 9 (JSON desde stdout puro); sentinels
        70-88 sin cambios de significado.
    13. 'node auditoria-residuos.cjs': wrapper; mismo tratamiento;
        sentinels 89/90 sin cambios.
    14. 'node diagnostico-default-acl.cjs': wrapper; sigue siendo
        puramente informativo/no bloqueante, sin cambios de
        comportamiento observable.

  LOS 4 BLOQUES DE NODE EMBEBIDOS ('cjsValidarDestino',
  'cjsVerificacionPosterior', 'cjsResiduos', 'cjsDefaultAcl') QUEDAN
  BYTE-IDENTICOS a v4/v5 -- v6 solo cambia COMO el .ps1 invoca a 'node' y
  procesa su stdout/stderr, nunca el contenido de esos scripts .cjs
  embebidos. Verificado por extraccion y diff, ver informe de auditoria.

  LIMITACION DE ENTORNO DECLARADA EXPLICITAMENTE (ver informe de
  auditoria para el detalle completo): este archivo se preparo en un
  entorno sin ningun runtime de PowerShell real alcanzable (ni el
  contenedor cloud ni la VM Linux enlazada tienen 'pwsh'/'powershell', y
  no hay ruta de instalacion viable dado el filtrado de salida de red de
  esta sesion). Por lo tanto: el parseo PowerShell real, la inspeccion
  AST real ('CommandAst'), y la ejecucion real de las 9 pruebas locales
  A-I (mas la prueba aislada de 'git worktree') NO se realizaron aqui --
  se entregan, junto con v6, como scripts listos para que Alex los
  ejecute en su Windows real y reporte el resultado. Lo que SI se
  verifico aqui, con rigor mecanico real, se detalla en el informe de
  auditoria separado.

CAMBIO DE v4 A v5 (unico; v4 queda intacta, ya autenticada, sin tocar;
seccion conservada integra por trazabilidad):

  HALLAZGO EN EJECUCION REAL (reportado por Alex, 2026-10-28): al correr
  v4 en Windows PowerShell 5.1, 'git worktree add' SI completa la
  creacion del worktree con exito (el propio Git confirma "HEAD is now
  at 20690ba") pero el proceso termina con el codigo de salida 99
  (excepcion no controlada). Causa raiz: Git escribe, por diseno, una
  linea puramente informativa en su stream de stderr ("Preparing
  worktree (detached HEAD 20690ba)") incluso cuando la operacion termina
  bien. PowerShell, con '$ErrorActionPreference = "Stop"' activo (como
  en este script, globalmente, por diseno), envuelve CUALQUIER linea que
  un ejecutable nativo escriba en stderr en un ErrorRecord y la trata
  como un error NO CONTROLADO -- sin importar si se redirige con '2>' a
  un archivo: el chequeo de '$ErrorActionPreference' ocurre ANTES de que
  la redireccion decida donde termina ese texto. El resultado es que
  'git worktree add' parecia "fallar" (excepcion -> catch generico ->
  codigo 99) aun cuando el comando habia tenido exito real (exit code 0).

  CORRECCION EN v5: se añade una funcion nueva, 'Invoke-ComandoExterno'
  (ver mas abajo, justo despues de 'Exito'), que ejecuta un comando
  nativo con un '$ErrorActionPreference' puesto a 'Continue' SOLO dentro
  del ambito local de esa funcion (nunca afecta el 'Stop' global del
  resto del script -- el scoping de variables de PowerShell garantiza
  esto sin try/finally adicional), fusiona stdout+stderr como texto
  plano, y determina exito/fracaso UNICA Y EXCLUSIVAMENTE por
  '$LASTEXITCODE' -- nunca por la mera presencia de texto en stderr. La
  llamada a 'git worktree add' ahora usa este wrapper; el resto de las
  llamadas a 'git' (fetch, rev-parse, merge-base, status --porcelain)
  NO se tocaron en esta ronda -- ver nota de riesgo residual abajo.

  NOTA DE RIESGO RESIDUAL (no corregido en esta ronda, por alcance
  explicito de Alex): el mismo mecanismo de fondo (stderr nativo +
  '$ErrorActionPreference = "Stop"' global) es, en teoria, igual de
  fragil para 'git fetch origin main --quiet' (linea ~310), 'git
  rev-parse origin/main' (~313), 'git merge-base --is-ancestor' (~317),
  'git -C <worktree> rev-parse HEAD' (~325), 'git -C <worktree> status
  --porcelain' (~326), y 'git status --porcelain -- $rutasClaveRelativas'
  (~389). Ninguna de ellas fallo en la ejecucion real de Alex (git se
  mantuvo silencioso en stderr para esos subcomandos en su entorno), por
  lo que v5 NO las modifica -- Alex pidio especificamente corregir 'git
  worktree add'. Si alguna de esas otras llamadas llegara a fallar de la
  misma forma en una ejecucion futura (por ejemplo, si 'git fetch' tiene
  algo nuevo que reportar), el mismo patron 'Invoke-ComandoExterno'["git",
  @(...)]' resolveria el problema igual -- queda disponible para una v6
  si Alex lo pide.

Merge commit esperado en main:  20690ba808da5ff0d4eb655e2350780d0ae9ef4f
SHA de PR-A ya validado (rama temporal): 4e1e374bbfd851f3d6d41f9b4dc05e64bf2853b6

PROVENIENCIA DE LAS 2 CONSTANTES DE DESTINO (nunca inventadas, sin cambios
respecto a v3): el host y la base de datos de produccion de abajo ya
estaban confirmados, de forma no secreta, en el historial versionado de
ChainPulse:
  - `_documentos-locales/evidencias/evidencia-4.7-procedimiento-v6.md` (linea 154-156)
  - `_documentos-locales/evidencias/evidencia-4.7-procedimiento-v7.md` (linea 162-164, 1008-1012)
Si el proyecto de Neon de produccion se recreo o se migro desde que esas
evidencias se escribieron, ESTAS 2 CONSTANTES PUEDEN ESTAR DESACTUALIZADAS
-- Alex debe confirmarlas una vez mas antes de la primera ejecucion real.

CAMBIOS DE v3 A v4 (resumen; diff literal entregado por separado):
  A. Identidad exacta del codigo desplegable:
     1. La comparacion byte-a-byte worktree-vs-checkout ya no cubre solo
        prisma/migrations: ahora incluye tambien prisma/schema.prisma,
        package.json y el lockfile real del proyecto (detectado en
        tiempo de ejecucion entre package-lock.json/pnpm-lock.yaml/
        yarn.lock -- en este repo es 'package-lock.json', confirmado).
     2. Se exige 'git status --porcelain' LIMPIO en $RutaRepositorio,
        restringido a esas 4 rutas exactas -- cualquier cambio sin
        confirmar en ellas bloquea antes de continuar.
  B. Estado de las migraciones:
     3. El analisis de 'migrate status' ya NO ignora silenciosamente una
        linea no reconocida dentro del bloque de "pendientes": cualquier
        linea que no sea ni una migracion con formato valido ni una linea
        en blanco de cierre ahora bloquea explicitamente (antes, v3
        simplemente no la anadia al conjunto, sin bloquear -- una forma
        de "interpretar por aproximacion" que v4 elimina).
  C. Punto de restauracion -- cambio de fondo:
     4. YA NO hay Read-Host interactivo que el propio operador autoafirma
        linea por linea dentro del script. Ahora el script EXIGE un
        parametro -ArchivoEvidenciaRestauracion con la ruta a un JSON
        preparado EXTERNAMENTE (fuera de este script), valida su esquema
        estricto (ver 'evidencia-restauracion.schema.json', entregado por
        separado) y su coherencia interna (rama origen = rama produccion,
        host declarado = host canonico de este procedimiento), y clasifica
        el resultado EXPLICITAMENTE como 'DECLARADO' -- nunca como
        'VERIFICADO_INDEPENDIENTEMENTE', porque este script JAMAS consulta
        la API o la consola de Neon. El SHA-256 que se calcula es
        UNICAMENTE un control de integridad del archivo (demuestra que no
        se corrompio/edito despues de prepararlo), NUNCA una prueba de que
        el punto de restauracion exista de verdad.
     5. Como ultimo paso de la compuerta, se exige una confirmacion humana
        explicita, textual ('CONFIRMO'), inmediatamente anterior a esta
        ejecucion, declarando que el operador acaba de revisar esos mismos
        datos contra la consola/CLI de Neon. Esa confirmacion NO cambia la
        clasificacion -- sigue siendo DECLARADO, nunca
        VERIFICADO_INDEPENDIENTEMENTE.
     6. Este script sigue sin crear ningun punto de restauracion ni rama
        de Neon, y sin conectarse a la API de Neon en ningun momento.
  D. Destino efectivo: sin cambios de fondo -- ya en v3 las 7
     validaciones (host, no-pooled, db por URL, current_database() real,
     rol, TLS fuerte, channel_binding) ocurrian antes de 'migrate status'.
     Se mantiene ese orden explicitamente.
  E. Verificacion posterior -- cambios de fondo:
     7. 'proconfig' ya NO se compara con una regex de substring: ahora se
        compara como CONJUNTO EXACTO (Compare-Object -SyncWindow 0) contra
        el unico valor esperado ('search_path=public, pg_temp') -- una
        entrada adicional cualquiera bloquea.
     8. Los grants sobre las funciones RF24 ya NO se leen de
        'information_schema.routine_privileges': se leen directamente de
        'pg_proc.proacl' via 'aclexplode(...)', asociados por OID exacto
        (no por nombre), lo que distingue el privilegio implicito del
        propietario (siempre presente una vez que el ACL se materializa)
        de los grants explicitos reales -- evitando el falso positivo de
        confundir "el propietario puede ejecutar" con "chainpulse_app
        puede ejecutar".
     9. La comprobacion de RLS ahora tambien exige, de forma explicita,
        que la consulta devuelva EXACTAMENTE 2 filas (las 2 tablas RF24) --
        antes solo se revisaba el valor de 'relrowsecurity' de las filas
        que hubiera, sin exigir la cantidad.
     10. Se documentan, en esta cabecera, las lineas SQL REALES (citadas
         textualmente, leidas de
         'prisma/migrations/20261022100000_rf24_funciones_controladas/migration.sql'
         en el checkout de Alex) que respaldan la desviacion deliberada de
         'SECURITY DEFINER' -- ver seccion dedicada mas abajo.
  F. Residuos y smoke tests:
     11. Se retiran los 4 smoke tests mutantes (incluso bajo
         BEGIN/ROLLBACK) por preferencia explicita de Alex: el
         procedimiento de produccion ya NO ejecuta ninguna de las 4
         funciones RF24 contra production, ni siquiera dentro de una
         transaccion revertida. Queda, exclusivamente, verificacion de
         catalogo/lectura (enums, tablas, privilegios, funciones, ACL,
         RLS, politicas, cuerpo de funcion). La revision estatica de las
         4 funciones ya realizada en v3 (sin secuencias, NOTIFY ni
         advisory locks) se conserva documentada mas abajo como evidencia
         de que la decision de retirarlas fue por preferencia, no porque
         se hubiera encontrado un riesgo nuevo.
     12. Auditoria de residuos: sin cambios de fondo -- aborto inmediato
         ante cualquier fila o error, exactamente igual que en v2/v3.
  G. Limpieza y manejo de errores -- cambio estructural importante:
     13. HALLAZGO DE v3 CORREGIDO EN v4: en v3, la auto-auditoria anti-npx
         y el chequeo de "constantes sin reemplazar" corrian ANTES del
         'try' global, y usaban 'Fail'/'exit' directos. Si 'Fail' se
         disparaba ahi (lanzando una excepcion), esa excepcion NO estaba
         dentro de ningun 'try/catch' de este script: PowerShell la
         propagaria sin control, el 'finally' global (limpieza de
         credenciales y retiro del worktree) NUNCA se ejecutaria, y el
         codigo de salida resultante NO seria el sentinel disenado, sino
         un codigo generico de error no controlado. En v4, TODO el cuerpo
         -- auto-auditoria, chequeo de constantes, las 3 compuertas, y la
         logica principal -- corre dentro del UNICO try/catch/finally
         global. Las compuertas "no autorizada, deten sin error" ya NO
         usan 'exit' directo: usan una funcion 'Detener' que lanza un
         centinela capturado por el mismo 'catch' que ya maneja 'Fail',
         garantizando que 'finally' (limpieza) se ejecute siempre, sin
         depender de la semantica exacta de 'exit' dentro de un 'try' en
         PowerShell 5.1 (que no esta garantizada de forma simple).
     14. Se audito cada ruta de advertencia no bloqueante para confirmar
         que ninguna "advertencia critica" (relacionada con la
         correctitud de RF24) deja un codigo de salida 0: la unica
         advertencia que sigue sin bloquear es el diagnostico de
         'ALTER DEFAULT PRIVILEGES' (deuda documentada por separado,
         ajena a RF24, siempre etiquetado como informativo) y el aviso de
         "no se pudo retirar el worktree temporal" dentro de la limpieza
         final (ocurre en 'finally', despues de que el codigo de salida
         real ya quedo fijado por la logica principal).
  H. Entrega y verificacion: identicas a v3 (archivo real en "Claude
     outputs", no una reconstruccion; diff literal; matriz; mas, ahora,
     el JSON Schema de la evidencia de restauracion como entregable
     adicional).

DESVIACION DELIBERADA -- 'SECURITY DEFINER' (confirmada con citas SQL
literales, leidas directamente del archivo de migracion real en el
checkout de Alex el 2026-10-28):

  Archivo: prisma/migrations/20261022100000_rf24_funciones_controladas/migration.sql

  Las 11 funciones de cara a la aplicacion (ejemplo, linea 133):
    "LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp"
  seguida, en cada caso, de su propio
    "GRANT EXECUTE ON FUNCTION public.<nombre>(...) TO chainpulse_app;"
  (ejemplo literal, lineas 178-180 para 'crear_solicitud_derechos'):
    "REVOKE ALL ON FUNCTION public.crear_solicitud_derechos(text, text, text, text, text) FROM PUBLIC;"
    "GRANT EXECUTE ON FUNCTION public.crear_solicitud_derechos(text, text, text, text, text) TO chainpulse_app;"

  La funcion interna 'aplicar_efecto_solicitud_derechos' (lineas 187-234)
  declara, en cambio (linea 189, SIN la palabra 'SECURITY DEFINER'):
    "LANGUAGE plpgsql SET search_path = public, pg_temp"
  y termina (linea 234, un REVOKE, nunca un GRANT a chainpulse_app):
    "REVOKE ALL ON FUNCTION public.aplicar_efecto_solicitud_derechos(text, text, text, text) FROM PUBLIC;"
    -- comentario original en el SQL, linea 235: "Sin GRANT a chainpulse_app a proposito"

  Por eso este script exige, por funcion (no como regla unica para las
  12): SECURITY DEFINER=true y GRANT EXECUTE a chainpulse_app en las 11
  funciones publicas; SECURITY DEFINER=false y AUSENCIA de ese grant,
  exactamente, en 'aplicar_efecto_solicitud_derechos'.

NOTA sobre los smoke tests retirados (ver cambio F.11) -- la revision
estatica que en v2/v3 justifico conservarlos sigue siendo valida y se
documenta aqui por trazabilidad, aunque v4 ya no los ejecute: ninguna de
las 4 funciones ('reclamar_solicitudes_derechos_para_envio',
'reconciliar_solicitudes_derechos_agotadas',
'expirar_solicitudes_derechos_vencidas',
'purgar_solicitudes_derechos_segun_retencion') usa secuencias, NOTIFY,
advisory locks, DDL, llamadas externas u otro efecto no transaccional --
son SQL/plpgsql puro sobre tablas. Retirarlas en v4 es una decision de
PREFERENCIA (menos superficie de ejecucion contra produccion dentro del
propio script), no una correccion de un riesgo encontrado.

ESTADO DE ESTE ARCHIVO: preparado, NUNCA ejecutado.

PROHIBIDO, de forma permanente, en todo este script: cualquier variante
del subcomando "migrate resolve"; cualquier UPDATE/DELETE/INSERT manual
sobre `_prisma_migrations`; cualquier DELETE/DROP/TRUNCATE sobre datos de
aplicacion; imprimir o loguear la cadena de conexion, usuario o
contraseña reales en ningun punto; crear puntos de restauracion, ramas de
Neon, o conectarse de verdad a produccion -- este archivo NUNCA se ha
ejecutado y su sola existencia no autoriza ninguna de esas acciones.
#>

[CmdletBinding()]
param(
    [switch]$AutorizarPreflight,
    [switch]$AutorizarPuntoRestauracion,
    [switch]$AutorizarMigracion,
    [string]$RutaRepositorio = (Get-Location).Path,
    [string]$ArchivoEvidenciaRestauracion = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ============================================================================
# CONSTANTES CANONICAS -- ver proveniencia en la cabecera. Sin marcadores
# __PENDIENTE_...__: este archivo es, a proposito, el canonico final.
# ============================================================================
$HostProduccionEsperado      = 'ep-steep-firefly-ac5drua5.sa-east-1.aws.neon.tech'
$BaseDatosProduccionEsperada = 'neondb'
$RolAdministrativoEsperado   = 'neondb_owner'
$ShaMergeEsperado            = '20690ba808da5ff0d4eb655e2350780d0ae9ef4f'
$ShaPrAEsperado              = '4e1e374bbfd851f3d6d41f9b4dc05e64bf2853b6'
$MigracionesRf24EnOrden = @(
    '20261022080000_rf24_enum_bucket_limite_tasa',
    '20261022090000_rf24_tabla_solicitud_derechos',
    '20261022100000_rf24_funciones_controladas',
    '20261023053758_rf24_revocar_privilegios_directos_tablas_derechos',
    '20261023160000_rf24_correccion_ambiguedad_id_y_consentimiento_sin_id',
    '20261023170000_rf24_correccion_referencia_ambigua_id_verificacion_correo'
)
$SslModesFuertesPermitidos = @('require', 'verify-ca', 'verify-full')
$ConfigEsperadoFunciones = @('search_path=public, pg_temp')
$CamposRequeridosEvidencia = @(
    'proyectoNeon', 'region', 'ramaProduccion', 'idPuntoORamaRespaldo',
    'ramaOrigen', 'fechaUtcCreacionPunto', 'estadoReportado', 'hostProduccionAsociado'
)

$script:DirTrabajo = Join-Path $env:TEMP ("rf24-prod-v6-" + [guid]::NewGuid().ToString('N'))
$script:ArchivoLog = Join-Path $script:DirTrabajo 'procedimiento.log'
$script:RutaWorktreeHeadLimpio = $null
$script:RestauracionConfirmadaEnEstaEjecucion = $false
$script:CodigoSalidaFinal = 1
$script:ManejadorCancelacion = $null

function Registrar {
    param([string]$Mensaje)
    $seguro = [regex]::Replace($Mensaje, 'postgres(ql)?://[^\s"]+', 'postgres://[REDACTADO]')
    $linea = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $seguro
    Write-Host $linea
    if (Test-Path $script:DirTrabajo) { Add-Content -Path $script:ArchivoLog -Value $linea }
}

# NUEVO EN v7 -- resumen de stderr para incluir DENTRO del mensaje bloqueante
# de 'Fail' cuando uno de los 4 validadores embebidos (Node) no arranca o
# falla operativamente (p.ej. 'Cannot find module ...', el caso real que
# origino esta version). Se redacta aqui mismo (defensa en profundidad,
# aunque 'Fail' -> 'Registrar' ya redacta cualquier 'postgres(ql)://...' en
# TODO mensaje antes de mostrarlo/escribirlo) y se trunca para no inundar la
# consola/el log con una traza completa. Nunca expone la URL: solo redacta.
function Resumen-StderrParaError {
    param([string]$TextoStderr, [int]$MaxLargo = 500)
    if ([string]::IsNullOrWhiteSpace($TextoStderr)) { return '' }
    $plano = ($TextoStderr -replace '\s+', ' ').Trim()
    $plano = [regex]::Replace($plano, 'postgres(ql)?://[^\s"]+', 'postgres://[REDACTADO]')
    if ($plano.Length -gt $MaxLargo) { $plano = $plano.Substring(0, $MaxLargo) + ' [...TRUNCADO...]' }
    return " Stderr de Node (redactado): $plano"
}

# NUEVO EN v8 -- extrae el host de una cadena de conexion Postgres
# ('postgres://usuario:password@host:puerto/base?...') via regex simple,
# sin depender de ninguna libreria externa ni de Node. Devuelve $null si
# el texto no calza el patron esperado (nunca lanza, nunca registra el
# texto recibido).
function Extraer-HostDeUrlPostgres {
    param([string]$Url)
    if ([string]::IsNullOrWhiteSpace($Url)) { return $null }
    $m = [regex]::Match($Url, '^postgres(?:ql)?://[^@/]*@([^/:?]+)')
    if ($m.Success) { return $m.Groups[1].Value } else { return $null }
}

# NUEVO EN v8 -- ver DEFECTO 2 en la cabecera ('CAMBIO DE v7 A v8').
# Defensa en profundidad: bloquea si el TEXTO indicado (salida REAL de
# 'migrate status' o 'migrate deploy', stdout+stderr) contiene un
# hostname de Neon que sea el endpoint POOLED (cualquier
# '*-pooler*....neon.tech', no solo el proyecto especifico ya observado
# en produccion) o que, siendo un hostname de Neon, no coincida EXACTO
# con el host directo esperado. Nunca imprime ni registra la URL
# completa -- solo el hostname encontrado (un hostname, por si solo,
# nunca es una credencial).
function Probar-HostIndebidoEnTexto {
    param([string]$Texto, [string]$Etiqueta, [int]$SentinelPooled, [int]$SentinelOtroHost)
    if ([string]::IsNullOrWhiteSpace($Texto)) { return }
    $patronHostNeon = '(?i)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+neon\.tech'
    $coincidencias = [regex]::Matches($Texto, $patronHostNeon)
    foreach ($c in $coincidencias) {
        $hostEncontrado = $c.Value
        if ($hostEncontrado -imatch '-pooler') {
            Fail "$Etiqueta reporto un hostname POOLED de Neon ('$hostEncontrado') -- el destino efectivo debe ser siempre el endpoint DIRECTO administrativo ya validado, nunca el pooled." $SentinelPooled
        }
        if ($hostEncontrado -ine $HostProduccionEsperado) {
            Fail "$Etiqueta reporto un hostname de Neon distinto al esperado ('$hostEncontrado', se esperaba exactamente '$HostProduccionEsperado')." $SentinelOtroHost
        }
    }
}

# NUEVO EN v8 -- ver DEFECTO 1 en la cabecera. Extraida a funcion propia
# (antes era un 'if' inline en la Compuerta 3) precisamente para poder
# probarla de forma REAL y aislada via extraccion AST (mismo patron ya
# usado por el arnes A-I y la prueba de worktree para
# 'Invoke-ComandoExterno') -- ver
# 'rf24-prueba-filtro-stderr-migrate-status-v1.ps1'. Devuelve $true si
# CUALQUIERA de los 2 textos contiene una anomalia reconocida de la lista
# negra, $false si ninguno la contiene. CORREGIDA EN v8: el alternante
# generico 'error' ahora exige limite de palabra ('\berror\b') para no
# coincidir como subcadena de 'NativeCommandError'/'FullyQualifiedErrorId'
# (metadatos que PowerShell SIEMPRE anade al stderr de un proceso nativo
# en cuanto este escribe aunque sea una linea informativa). Las demas
# senales ('migrate resolve', 'drift', 'failed migration', 'deviat',
# 'could not') se conservan SIN delimitar, deliberadamente, sin cambios.
# Nunca registra ni modifica nada por si misma -- solo clasifica.
function Detectar-AnomaliaMigrateStatus {
    param([string]$StdoutTexto, [string]$StderrTexto)
    $patron = '(?i)migrate resolve|drift|failed migration|deviat|could not|\berror\b'
    return (($StdoutTexto -match $patron) -or ($StderrTexto -match $patron))
}

# NUEVO EN v8 -- ver DEFECTO 2 en la cabecera. Captura, SOLO EN MEMORIA de
# esta ejecucion (nunca se registra ni se persiste ningun valor), si
# 'DATABASE_URL' y 'SEED_DATABASE_URL' existian ANTES de que la Compuerta
# 3 los fije a la URL administrativa ya validada, y su valor EXACTO si
# existian -- para poder restaurarlos (o eliminarlos, si antes no
# existian) sin importar como termine la ejecucion (exito, 'Fail',
# excepcion no controlada, o cancelacion Ctrl+C).
function Guardar-VariablesEntornoBaseDatosPrevias {
    $script:PrevioDatabaseUrlExistia = Test-Path Env:\DATABASE_URL
    $script:PrevioDatabaseUrlValor = if ($script:PrevioDatabaseUrlExistia) { $env:DATABASE_URL } else { $null }
    $script:PrevioSeedDatabaseUrlExistia = Test-Path Env:\SEED_DATABASE_URL
    $script:PrevioSeedDatabaseUrlValor = if ($script:PrevioSeedDatabaseUrlExistia) { $env:SEED_DATABASE_URL } else { $null }
}

# NUEVO EN v8 -- contraparte de 'Guardar-VariablesEntornoBaseDatosPrevias'.
# Idempotente y segura de invocar varias veces (desde el 'finally' local
# de la Compuerta 3, desde 'LimpiarCredenciales', y desde el manejador de
# cancelacion Ctrl+C) -- si el guardado previo nunca se hizo (p.ej. se
# cancelo antes de llegar a la Compuerta 3), no hace nada. Nunca registra
# ni muestra ningun valor, ni el previo ni el nuevo.
function Restaurar-VariablesEntornoBaseDatosPrevias {
    if (-not (Get-Variable -Name PrevioDatabaseUrlExistia -Scope Script -ErrorAction SilentlyContinue)) { return }
    if ($script:PrevioDatabaseUrlExistia) { $env:DATABASE_URL = $script:PrevioDatabaseUrlValor } else { Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue }
    if ($script:PrevioSeedDatabaseUrlExistia) { $env:SEED_DATABASE_URL = $script:PrevioSeedDatabaseUrlValor } else { Remove-Item Env:\SEED_DATABASE_URL -ErrorAction SilentlyContinue }
}

function LimpiarCredenciales {
    if (Test-Path Env:\DATABASE_URL_ADMIN_PROD) { Remove-Item Env:\DATABASE_URL_ADMIN_PROD -ErrorAction SilentlyContinue }
    # NUEVO EN v8 -- 'DATABASE_URL'/'SEED_DATABASE_URL' ya NO se eliminan a
    # ciegas aqui: se RESTAURAN exactamente a su valor previo a esta
    # ejecucion (o se eliminan, si antes no existian) via
    # 'Restaurar-VariablesEntornoBaseDatosPrevias' -- backstop por si el
    # 'finally' local de la Compuerta 3 no llego a ejecutarse. Idempotente:
    # si la Compuerta 3 ya restauro, esta segunda llamada no cambia nada.
    Restaurar-VariablesEntornoBaseDatosPrevias
    # NUEVO EN v7 -- retirar SIEMPRE la ruta de 'package.json' usada para
    # anclar 'require("pg")' en los 4 validadores embebidos (nunca una
    # credencial, pero se limpia igual, por disciplina y porque ya no
    # tiene ningun uso fuera de esta ejecucion).
    if (Test-Path Env:\RF24_PACKAGE_JSON_PATH) { Remove-Item Env:\RF24_PACKAGE_JSON_PATH -ErrorAction SilentlyContinue }
    if (Get-Variable -Name UrlAdminTexto -Scope Script -ErrorAction SilentlyContinue) { $script:UrlAdminTexto = $null }
    # v6: guarda explicita ANTES de intentar retirar el worktree -- ruta
    # no vacia, ABSOLUTA, SIN caracteres de comodin ('*'/'?', nunca un
    # glob ni una ruta ancha), y que exista de verdad. 'ALERTA DE RESIDUO'
    # explicita en caso de fallo, SIN alterar jamas
    # '$script:CodigoSalidaFinal' (ya fijado por la logica principal --
    # esto es limpieza best-effort en 'finally', nunca debe enmascarar la
    # causa de salida original).
    if ($script:RutaWorktreeHeadLimpio -and
        $script:RutaWorktreeHeadLimpio -notmatch '[\*\?]' -and
        [System.IO.Path]::IsPathRooted($script:RutaWorktreeHeadLimpio) -and
        (Test-Path $script:RutaWorktreeHeadLimpio)) {
        try {
            Push-Location $RutaRepositorio
            $resultadoLimpieza = Invoke-ComandoExterno -Ejecutable 'git' -Argumentos @('worktree', 'remove', $script:RutaWorktreeHeadLimpio, '--force')
            if ($resultadoLimpieza.CodigoSalida -ne 0) {
                Registrar ("ALERTA DE RESIDUO (no bloqueante, no altera el codigo de salida ya fijado): no se pudo retirar el worktree temporal '{0}' (codigo {1}). Retiralo manualmente con 'git worktree remove <ruta> --force' tras confirmar que ningun otro proceso lo esta usando. Detalle: {2}" -f `
                    $script:RutaWorktreeHeadLimpio, $resultadoLimpieza.CodigoSalida, $resultadoLimpieza.TextoCombinado)
            }
        } catch { Registrar "ALERTA DE RESIDUO (no bloqueante): excepcion inesperada al intentar retirar el worktree temporal: $($_.Exception.Message)" }
        finally { Pop-Location }
    } elseif ($script:RutaWorktreeHeadLimpio) {
        Registrar "ALERTA DE RESIDUO (no bloqueante): la ruta de worktree temporal registrada no paso la guarda de seguridad (vacia, relativa, con comodines, o inexistente) -- no se intento retirar automaticamente. Ruta registrada: '$script:RutaWorktreeHeadLimpio'."
    }
    if ($script:ManejadorCancelacion) {
        try { Unregister-Event -SourceIdentifier $script:ManejadorCancelacion.Name -ErrorAction SilentlyContinue } catch {}
    }
    [System.GC]::Collect()
}

function Fail {
    param([string]$Mensaje, [int]$Sentinel)
    Registrar "BLOQUEADO: $Mensaje"
    $script:CodigoSalidaFinal = $Sentinel
    throw "RF24_FAIL:$Sentinel"
}

function Detener {
    # "Compuerta no autorizada -- detener SIN marcar error", pero SIEMPRE
    # dentro del mismo try/catch/finally global (ver cambio G.13).
    param([string]$Mensaje, [int]$Sentinel)
    Registrar $Mensaje
    $script:CodigoSalidaFinal = $Sentinel
    throw "RF24_DETENER_SIN_ERROR:$Sentinel"
}

function Exito { param([string]$Mensaje) Registrar "OK: $Mensaje" }

function Invoke-ComandoExterno {
    # REDISENADO en v6 (ver "CAMBIO DE v5 A v6" en la cabecera para el
    # razonamiento completo). Ejecuta un comando NATIVO (no un cmdlet de
    # PowerShell) sin que la salida puramente informativa que ese
    # programa escriba en stderr se convierta en una excepcion
    # terminante por culpa de '$ErrorActionPreference = Stop' (bug
    # conocido de PowerShell con comandos nativos). 'Continue' se asigna
    # SOLO en el ambito local de esta funcion: por el scoping de
    # variables de PowerShell, esto NUNCA modifica ni filtra al 'Stop'
    # global del resto del script (se restaura explicitamente al salir,
    # ademas, por disciplina defensiva -- no solo por el scoping).
    #
    # A diferencia de v5 (que fusionaba stdout+stderr con '2>&1'), v6
    # captura AMBOS STREAMS POR SEPARADO: stdout via el pipeline normal,
    # stderr via un archivo temporal propio. Esto es indispensable para
    # los llamadores que necesitan stdout PURO (JSON, el parser de
    # 'migrate status') sin riesgo de que una linea de stderr se cuele
    # en medio. Tambien expone una vista combinada (stdout seguido de
    # stderr -- orden PRACTICO, nunca una intercalacion cronologica real)
    # para quien solo quiere "toda la salida".
    #
    # Ademas:
    #   - Comprueba que el ejecutable existe ANTES de invocarlo
    #     ('Get-Command -CommandType Application'). Si no existe,
    #     devuelve CodigoSalida=-1 SIN leer jamas '$LASTEXITCODE' en esa
    #     rama (nunca se contamina con un codigo de una invocacion
    #     anterior no relacionada).
    #   - Envuelve la invocacion real en su propio try/catch: un fallo de
    #     ARRANQUE (el binario existe pero no pudo ejecutarse) tambien se
    #     convierte en CodigoSalida=-1, con el detalle en
    #     'DetalleFalloInvocacion', nunca en una excepcion sin clasificar.
    #   - '$LASTEXITCODE' se lee INMEDIATAMENTE despues de la invocacion
    #     real, nunca en otro punto.
    #
    # El resultado se decide SIEMPRE por 'CodigoSalida' (nunca por la
    # mera presencia de texto en stderr), y una salida vacia en
    # cualquiera de los dos streams NUNCA se interpreta, por si misma,
    # como fallo -- eso queda, como siempre, a cargo de quien llama.
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
            # Fallo de ARRANQUE/INVOCACION -- nunca leer '$LASTEXITCODE'
            # aqui: podria ser un residuo de una invocacion anterior sin
            # relacion con esta.
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

New-Item -ItemType Directory -Path $script:DirTrabajo -Force | Out-Null
Registrar "=== RF24 -- procedimiento de produccion v6 (wrapper nativo generalizado a las 14 invocaciones, bloqueado por diseno) ==="
Registrar "Merge commit esperado en main: $ShaMergeEsperado"
Registrar "SHA de PR-A validado: $ShaPrAEsperado"
Registrar "Directorio de trabajo: $script:DirTrabajo"

# Red adicional para cancelacion (Ctrl+C) -- segunda capa, no sustituye el
# try/finally global de mas abajo.
$script:ManejadorCancelacion = Register-ObjectEvent -InputObject ([Console]) -EventName CancelKeyPress -Action {
    Write-Host "Cancelacion detectada (Ctrl+C) -- limpiando credenciales antes de salir."
    if (Test-Path Env:\DATABASE_URL_ADMIN_PROD) { Remove-Item Env:\DATABASE_URL_ADMIN_PROD -ErrorAction SilentlyContinue }
    # NUEVO EN v8 -- 'DATABASE_URL'/'SEED_DATABASE_URL' ya NO se eliminan a
    # ciegas aqui tampoco: se RESTAURAN exactamente a su valor previo a
    # esta ejecucion (o se eliminan, si antes no existian), igual que en
    # 'LimpiarCredenciales' -- ver DEFECTO 2 en la cabecera. Nunca se
    # registra ni se muestra ningun valor.
    Restaurar-VariablesEntornoBaseDatosPrevias
    # NUEVO EN v7 -- misma disciplina de "eliminar siempre" aplicada a la
    # segunda ruta de limpieza (cancelacion interactiva Ctrl+C), no solo a
    # LimpiarCredenciales en el finally global.
    if (Test-Path Env:\RF24_PACKAGE_JSON_PATH) { Remove-Item Env:\RF24_PACKAGE_JSON_PATH -ErrorAction SilentlyContinue }
}

# ============================================================================
# CUERPO PRINCIPAL -- try/catch/finally GLOBAL UNICO (cambio G.13: TODO,
# incluidas la auto-auditoria y las 3 compuertas, corre dentro de este
# bloque, para que 'finally' se ejecute sin excepcion).
# ============================================================================
try {

    # ------------------------------------------------------------------
    # AUTO-AUDITORIA -- este mismo archivo, sin sus comentarios, nunca
    # debe invocar al ejecutor de paquetes npm bajo demanda.
    # ------------------------------------------------------------------
    $textoCompleto = Get-Content -Raw -Path $PSCommandPath
    $sinBloquesComentario = [regex]::Replace($textoCompleto, '(?s)<#.*?#>', '')
    $lineasSinComentarioInline = ($sinBloquesComentario -split "`n") | ForEach-Object {
        $idx = $_.IndexOf('#')
        if ($idx -ge 0) { $_.Substring(0, $idx) } else { $_ }
    }
    $textoEjecutable = ($lineasSinComentarioInline -join "`n")
    if ($textoEjecutable -match '(?i)\bn\s*p\s*x\b') {
        Fail "Auto-auditoria: se detecto una posible invocacion del ejecutor de paquetes npm bajo demanda fuera de los comentarios. Prohibido en este procedimiento -- solo el Prisma local." 5
    }
    Exito "Auto-auditoria: confirmado, fuera de comentarios, que este archivo nunca invoca el ejecutor de paquetes npm bajo demanda."

    # ------------------------------------------------------------------
    # PASO 0 -- constantes sin reemplazar (red de seguridad).
    # ------------------------------------------------------------------
    if ($HostProduccionEsperado -like '__PENDIENTE_*' -or $BaseDatosProduccionEsperada -like '__PENDIENTE_*') {
        Detener "BLOQUEADO: constantes de host/base de datos de produccion sin reemplazar." 10
    }

    if (-not $AutorizarPreflight) {
        Detener "Compuerta 1 (preflight) NO autorizada -- pasa -AutorizarPreflight para llegar hasta ahi." 2
    }

    # ------------------------------------------------------------------
    # PASO 1 -- preflight: HEAD limpio real; identidad exacta del codigo
    # desplegable (bloque A): prisma/migrations COMPLETO, mas
    # prisma/schema.prisma, package.json y el lockfile real.
    # ------------------------------------------------------------------
    Push-Location $RutaRepositorio
    try {
        $resultadoFetch = Invoke-ComandoExterno -Ejecutable 'git' -Argumentos @('fetch', 'origin', 'main', '--quiet')
        if ($resultadoFetch.CodigoSalida -ne 0) { Fail "git fetch origin main fallo (codigo $($resultadoFetch.CodigoSalida)). Detalle: $($resultadoFetch.TextoCombinado)" 11 }

        # v6: se exige ADEMAS cardinalidad y formato exactos (una sola
        # linea no vacia, 40 caracteres hexadecimales) -- v5 solo
        # comparaba el valor tras un '.Trim()' ciego, sin verificar el
        # codigo de salida ni la forma de la salida. Sentinel NUEVO 95.
        $resultadoRevParseOrigin = Invoke-ComandoExterno -Ejecutable 'git' -Argumentos @('rev-parse', 'origin/main')
        $lineasRevParseOrigin = @($resultadoRevParseOrigin.LineasStdout | Where-Object { $_.Trim() -ne '' })
        if ($resultadoRevParseOrigin.CodigoSalida -ne 0 -or $lineasRevParseOrigin.Count -ne 1 -or $lineasRevParseOrigin[0].Trim() -notmatch '^[0-9a-f]{40}$') {
            Fail "git rev-parse origin/main no tuvo exito o su salida no es un SHA unico de 40 hex (codigo $($resultadoRevParseOrigin.CodigoSalida)). Detalle: $($resultadoRevParseOrigin.TextoCombinado)" 95
        }
        $shaOriginMain = $lineasRevParseOrigin[0].Trim()
        if ($shaOriginMain -ne $ShaMergeEsperado) { Fail "origin/main esta en '$shaOriginMain', no en '$ShaMergeEsperado'." 12 }
        Exito "origin/main coincide exactamente con el merge commit esperado."

        # v6: se distingue EXPLICITAMENTE entre 3 casos -- codigo 0 (es
        # ancestro), codigo 1 (NO es ancestro, sentinel 13 sin cambios de
        # significado), y cualquier OTRO codigo (error operativo real de
        # Git, sentinel NUEVO 97) -- v5 trataba cualquier codigo distinto
        # de 0 de forma identica (bloqueaba igual, sin distinguir "no es
        # ancestro" de "Git fallo al intentar decidirlo").
        $resultadoMergeBase = Invoke-ComandoExterno -Ejecutable 'git' -Argumentos @('merge-base', '--is-ancestor', $ShaPrAEsperado, 'origin/main')
        if ($resultadoMergeBase.CodigoSalida -eq 1) {
            Fail "El SHA de PR-A validado NO es ancestro de origin/main." 13
        } elseif ($resultadoMergeBase.CodigoSalida -ne 0) {
            Fail "git merge-base --is-ancestor devolvio un codigo operativo inesperado ($($resultadoMergeBase.CodigoSalida)), distinto de 0 (es ancestro) y 1 (no es ancestro) -- error real de Git, no una respuesta negativa normal. Detalle: $($resultadoMergeBase.TextoCombinado)" 97
        }
        Exito "main contiene el SHA de PR-A validado como ancestro."

        $script:RutaWorktreeHeadLimpio = Join-Path $env:TEMP ("rf24-head-limpio-" + [guid]::NewGuid().ToString('N'))

        # CORRECCION v4->v5 (sin cambios de fondo en v6, solo adaptada a
        # la nueva forma del objeto devuelto): 'git worktree add' escribe,
        # por diseno de Git, una linea puramente informativa en stderr
        # incluso cuando tiene exito ("Preparing worktree (detached HEAD
        # ...)"). El wrapper evita que esa linea se trate como fallo --
        # el resultado se decide exclusivamente por el codigo de salida.
        $resultadoWorktreeAdd = Invoke-ComandoExterno -Ejecutable 'git' -Argumentos @('worktree', 'add', '--detach', $script:RutaWorktreeHeadLimpio, $ShaMergeEsperado)
        Set-Content -Path (Join-Path $script:DirTrabajo 'worktree-add.salida.log') -Value $resultadoWorktreeAdd.TextoCombinado -Encoding UTF8
        Registrar "Salida combinada (stdout+stderr) de 'git worktree add' -- puramente informativa, el resultado se decide EXCLUSIVAMENTE por el codigo de salida: $($resultadoWorktreeAdd.TextoCombinado)"
        if ($resultadoWorktreeAdd.CodigoSalida -ne 0) {
            Fail "No se pudo fijar un worktree aislado en el merge commit esperado (codigo de salida real: $($resultadoWorktreeAdd.CodigoSalida))." 14
        }

        # v6: misma cardinalidad/formato que origin/main (sentinel NUEVO
        # 96 si falla codigo o forma); si el SHA no coincide con el
        # esperado, sentinel 15 sin cambios de significado.
        $resultadoRevParseWorktree = Invoke-ComandoExterno -Ejecutable 'git' -Argumentos @('-C', $script:RutaWorktreeHeadLimpio, 'rev-parse', 'HEAD')
        $lineasRevParseWorktree = @($resultadoRevParseWorktree.LineasStdout | Where-Object { $_.Trim() -ne '' })
        if ($resultadoRevParseWorktree.CodigoSalida -ne 0 -or $lineasRevParseWorktree.Count -ne 1 -or $lineasRevParseWorktree[0].Trim() -notmatch '^[0-9a-f]{40}$') {
            Fail "git -C <worktree> rev-parse HEAD no tuvo exito o su salida no es un SHA unico de 40 hex (codigo $($resultadoRevParseWorktree.CodigoSalida)). Detalle: $($resultadoRevParseWorktree.TextoCombinado)" 96
        }
        $shaWorktree = $lineasRevParseWorktree[0].Trim()
        if ($shaWorktree -ne $ShaMergeEsperado) { Fail "El worktree aislado no quedo exactamente en el SHA esperado." 15 }

        # v6: codigo de salida -ne 0 es un fallo OPERATIVO de git
        # (sentinel NUEVO 98, distinto de "arbol sucio"); salida no vacia
        # con codigo 0 sigue bloqueando como "sucio" (sentinel 16, sin
        # cambios de significado).
        $resultadoStatusWorktree = Invoke-ComandoExterno -Ejecutable 'git' -Argumentos @('-C', $script:RutaWorktreeHeadLimpio, 'status', '--porcelain')
        if ($resultadoStatusWorktree.CodigoSalida -ne 0) {
            Fail "git -C <worktree> status --porcelain fallo operativamente (codigo $($resultadoStatusWorktree.CodigoSalida)). Detalle: $($resultadoStatusWorktree.TextoCombinado)" 98
        }
        if ($resultadoStatusWorktree.TextoStdout.Trim() -ne '') { Fail "El worktree recien creado no esta limpio (inesperado): $($resultadoStatusWorktree.TextoStdout)" 16 }
        Exito "HEAD limpio fijado de forma aislada, exactamente en $shaWorktree."

        foreach ($m in $MigracionesRf24EnOrden) {
            if (-not (Test-Path (Join-Path $script:RutaWorktreeHeadLimpio "prisma/migrations/$m/migration.sql"))) {
                Fail "Falta '$m' en el HEAD limpio fijado." 17
            }
        }
        Exito "Las 6 migraciones de RF24 existen, en orden, en el HEAD limpio fijado."

        # Comparacion COMPLETA de prisma/migrations: TODOS los archivos,
        # no solo las 6 de RF24 -- mismo conjunto exacto de rutas y mismo
        # SHA-256 archivo por archivo, entre el HEAD limpio fijado y el
        # checkout real que 'prisma migrate deploy' va a usar de verdad.
        $archivosWorktree = Get-ChildItem -Path (Join-Path $script:RutaWorktreeHeadLimpio 'prisma/migrations') -Recurse -File |
            ForEach-Object { $_.FullName.Substring((Join-Path $script:RutaWorktreeHeadLimpio 'prisma/migrations').Length + 1).Replace('\', '/') } |
            Sort-Object
        $archivosReales = Get-ChildItem -Path (Join-Path $RutaRepositorio 'prisma/migrations') -Recurse -File |
            ForEach-Object { $_.FullName.Substring((Join-Path $RutaRepositorio 'prisma/migrations').Length + 1).Replace('\', '/') } |
            Sort-Object

        $diferenciaArchivos = Compare-Object -ReferenceObject $archivosWorktree -DifferenceObject $archivosReales
        if ($diferenciaArchivos) {
            Fail "El conjunto de archivos bajo prisma/migrations difiere entre el HEAD limpio fijado y el checkout real: $($diferenciaArchivos | ConvertTo-Json -Compress)" 18
        }
        foreach ($rel in $archivosWorktree) {
            $hashWorktree = (Get-FileHash -Algorithm SHA256 -Path (Join-Path $script:RutaWorktreeHeadLimpio "prisma/migrations/$rel")).Hash
            $hashReal = (Get-FileHash -Algorithm SHA256 -Path (Join-Path $RutaRepositorio "prisma/migrations/$rel")).Hash
            if ($hashWorktree -ne $hashReal) {
                Fail "'$rel' NO es byte-identico entre el HEAD limpio fijado y el checkout real." 19
            }
        }
        Exito "TODOS los archivos de prisma/migrations ($($archivosWorktree.Count) archivos) son byte-identicos entre el HEAD limpio fijado y el checkout real que usara Prisma -- no solo las 6 de RF24."

        $rutaSchemaRelativa = 'prisma/schema.prisma'
        if (-not (Test-Path $rutaSchemaRelativa)) { Fail "No se encontro '$rutaSchemaRelativa' en el checkout real ($RutaRepositorio)." 20 }

        # -------------------------------------------------------------
        # BLOQUE A (requisitos 1-4): identidad exacta tambien para
        # prisma/schema.prisma, package.json y el lockfile real.
        # -------------------------------------------------------------
        $lockfileCandidatos = @('package-lock.json', 'pnpm-lock.yaml', 'yarn.lock')
        $lockfilePresente = $lockfileCandidatos | Where-Object { Test-Path (Join-Path $RutaRepositorio $_) } | Select-Object -First 1
        if (-not $lockfilePresente) {
            Fail "No se encontro ningun lockfile reconocido (package-lock.json / pnpm-lock.yaml / yarn.lock) en el checkout real." 91
        }
        Exito "Lockfile del proyecto detectado: '$lockfilePresente'."

        $rutasClaveRelativas = @('prisma/migrations', 'prisma/schema.prisma', 'package.json', $lockfilePresente)
        # v6: mismo tratamiento que 'git -C <worktree> status --porcelain'
        # arriba -- codigo -ne 0 es un fallo OPERATIVO (sentinel NUEVO
        # 98); salida no vacia con codigo 0 sigue bloqueando como
        # "cambios sin confirmar" (sentinel 92, sin cambios de
        # significado).
        $argumentosStatusArbol = @('status', '--porcelain', '--') + $rutasClaveRelativas
        $resultadoStatusArbol = Invoke-ComandoExterno -Ejecutable 'git' -Argumentos $argumentosStatusArbol
        if ($resultadoStatusArbol.CodigoSalida -ne 0) {
            Fail "git status --porcelain (rutas criticas) fallo operativamente (codigo $($resultadoStatusArbol.CodigoSalida)). Detalle: $($resultadoStatusArbol.TextoCombinado)" 98
        }
        if ($resultadoStatusArbol.TextoStdout.Trim() -ne '') {
            Fail "El arbol de trabajo en '$RutaRepositorio' tiene cambios SIN CONFIRMAR en rutas criticas (migraciones/schema/package.json/lockfile) -- no se continua: $($resultadoStatusArbol.TextoStdout)" 92
        }
        Exito "Arbol de trabajo limpio confirmado (git status --porcelain) para prisma/migrations, prisma/schema.prisma, package.json y '$lockfilePresente'."

        foreach ($rutaRel in @('prisma/schema.prisma', 'package.json', $lockfilePresente)) {
            $pWorktree = Join-Path $script:RutaWorktreeHeadLimpio $rutaRel
            $pReal = Join-Path $RutaRepositorio $rutaRel
            if (-not (Test-Path $pWorktree)) { Fail "'$rutaRel' no existe en el HEAD limpio fijado." 93 }
            if (-not (Test-Path $pReal)) { Fail "'$rutaRel' no existe en el checkout real." 93 }
            $hWorktree = (Get-FileHash -Algorithm SHA256 -Path $pWorktree).Hash
            $hReal = (Get-FileHash -Algorithm SHA256 -Path $pReal).Hash
            if ($hWorktree -ne $hReal) { Fail "'$rutaRel' NO es byte-identico entre el HEAD limpio fijado y el checkout real." 94 }
        }
        Exito "prisma/schema.prisma, package.json y '$lockfilePresente' son byte-identicos entre el HEAD limpio fijado y el checkout real (bloque A completo)."
    }
    finally {
        Pop-Location
    }
    Write-Host "RF24_PROD_PREFLIGHT_EXIT=0"

    # ------------------------------------------------------------------
    # Resolver el Prisma LOCAL del proyecto, verificar compatibilidad.
    # ------------------------------------------------------------------
    $rutaPrismaCliLocal = Join-Path $RutaRepositorio 'node_modules/prisma/build/index.js'
    if (-not (Test-Path $rutaPrismaCliLocal)) { Fail "No se encontro el CLI local de Prisma en 'node_modules/prisma'." 21 }
    $rutaClienteLocal = Join-Path $RutaRepositorio 'node_modules/@prisma/client/package.json'
    if (-not (Test-Path $rutaClienteLocal)) { Fail "No se encontro '@prisma/client' local en 'node_modules'." 22 }
    $pkgPrisma = Get-Content (Join-Path $RutaRepositorio 'node_modules/prisma/package.json') -Raw | ConvertFrom-Json
    $pkgPrismaClient = Get-Content $rutaClienteLocal -Raw | ConvertFrom-Json
    Registrar "Prisma CLI local: version $($pkgPrisma.version)"
    Registrar "@prisma/client local: version $($pkgPrismaClient.version)"
    if ($pkgPrisma.version -ne $pkgPrismaClient.version) {
        Fail "Version del CLI local de Prisma ($($pkgPrisma.version)) distinta de '@prisma/client' ($($pkgPrismaClient.version)) -- incompatibilidad potencial, no continuar." 23
    }
    Exito "CLI local de Prisma y '@prisma/client' local coinciden exactamente en version ($($pkgPrisma.version))."

    # ------------------------------------------------------------------
    # NUEVO EN v7 -- resolver 'pg' SIEMPRE desde el repositorio real, para
    # los 4 bloques de Node embebidos que lo usan ('cjsValidarDestino',
    # 'cjsVerificacionPosterior', 'cjsResiduos', 'cjsDefaultAcl'). Esto se
    # valida y se fija ANTES de pedir la URL de conexion -- por lo tanto
    # antes de que pueda existir ningun riesgo de credenciales o de
    # conexion a Neon. Ver "CAMBIO DE v6 A v7" en la cabecera para el
    # fallo real (codigo 25, MODULE_NOT_FOUND) que esto corrige.
    # ------------------------------------------------------------------
    $rutaPackageJsonRepo = Join-Path $RutaRepositorio 'package.json'
    if (-not (Test-Path $rutaPackageJsonRepo)) {
        Fail "No se encontro 'package.json' en el repositorio real ('$RutaRepositorio') -- no se puede anclar la resolucion de modulos de Node para los validadores embebidos (requisito nuevo de v7)." 34
    }
    $rutaPgNodeModules = Join-Path $RutaRepositorio 'node_modules/pg/package.json'
    if (-not (Test-Path $rutaPgNodeModules)) {
        Fail "No se encontro 'pg' instalado en 'node_modules' del repositorio real ('$rutaPgNodeModules' ausente) -- los 4 validadores embebidos que lo requieren no podran resolverlo." 35
    }
    $script:RutaPackageJsonRepoResuelta = (Resolve-Path $rutaPackageJsonRepo).ProviderPath
    $env:RF24_PACKAGE_JSON_PATH = $script:RutaPackageJsonRepoResuelta
    Exito "'package.json' y 'node_modules/pg' confirmados en el repositorio real -- los 4 validadores embebidos resolveran 'pg' anclados a '$($script:RutaPackageJsonRepoResuelta)' (via 'createRequire'), nunca a la carpeta temporal donde se escriben ni al directorio de trabajo actual."

    # ------------------------------------------------------------------
    # Lectura oculta de la URL administrativa de produccion.
    # ------------------------------------------------------------------
    Registrar "Introduce la URL de conexion ADMINISTRATIVA (neondb_owner) de PRODUCCION. No se mostrara en pantalla."
    $urlSegura = Read-Host -AsSecureString -Prompt 'DATABASE_URL (admin, produccion)'
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($urlSegura)
    try { $script:UrlAdminTexto = [System.Runtime.InteropServices.Marshal]::PtrToStringUni($bstr) }
    finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    if ([string]::IsNullOrWhiteSpace($script:UrlAdminTexto)) { Fail "No se recibio ninguna URL." 24 }

    # ------------------------------------------------------------------
    # BLOQUE D -- validacion del destino, ANTES de 'migrate status'
    # (requisito 14): host, base (URL Y current_database()), rol,
    # no-pooled, TLS fuerte, channel_binding.
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
    const r = await client.query("SELECT current_user AS usuario, current_database() AS basedatos");
    resultado.conectado = true;
    resultado.usuarioActual = r.rows[0].usuario;
    resultado.baseActual = r.rows[0].basedatos;
    resultado.rolCoincide = r.rows[0].usuario === rolEsperado;
    resultado.baseActualCoincide = r.rows[0].basedatos === dbEsperada;
  } catch (e) {
    resultado.conectado = false;
    resultado.errorConexion = String(e.message || e);
  } finally {
    await client.end().catch(() => {});
  }
  console.log(JSON.stringify(resultado));
})();
'@
    $rutaCjsValidar = Join-Path $script:DirTrabajo 'validar-destino.cjs'
    Set-Content -Path $rutaCjsValidar -Value $cjsValidarDestino -Encoding UTF8 -NoNewline
    $env:DATABASE_URL_ADMIN_PROD = $script:UrlAdminTexto
    $env:RF24_HOST_ESPERADO = $HostProduccionEsperado
    $env:RF24_DB_ESPERADA = $BaseDatosProduccionEsperada
    $env:RF24_ROL_ESPERADO = $RolAdministrativoEsperado
    # v6: wrapper -- el JSON se parsea desde stdout PURO ('TextoStdout'),
    # nunca mezclado con stderr. El stderr se sigue volcando al mismo
    # archivo de log de siempre (continuidad con v4/v5), sin perder nada.
    $resultadoValidacion = Invoke-ComandoExterno -Ejecutable 'node' -Argumentos @($rutaCjsValidar)
    if ($resultadoValidacion.TextoStderr) {
        Set-Content -Path (Join-Path $script:DirTrabajo 'validar-destino.stderr.log') -Value $resultadoValidacion.TextoStderr -Encoding UTF8
    }
    $codigoValidacion = $resultadoValidacion.CodigoSalida
    $salidaValidacion = $resultadoValidacion.TextoStdout
    Remove-Item Env:\RF24_HOST_ESPERADO, Env:\RF24_DB_ESPERADA, Env:\RF24_ROL_ESPERADO -ErrorAction SilentlyContinue

    if ($codigoValidacion -ne 0 -or -not $salidaValidacion) {
        Fail "El validador de destino no pudo ejecutarse o no conecto (codigo $codigoValidacion).$(Resumen-StderrParaError $resultadoValidacion.TextoStderr)" 25
    }
    $destino = $salidaValidacion | ConvertFrom-Json
    Registrar ("Destino -- hostCoincide={0} esPooled={1} dbCoincideUrl={2} baseActualCoincide={3} conectado={4} rolCoincide={5} sslmode={6} channelBinding={7}" -f `
        $destino.hostCoincide, $destino.esPooled, $destino.dbCoincideUrl, $destino.baseActualCoincide, $destino.conectado, $destino.rolCoincide, $destino.sslmode, $destino.channelBinding)

    if (-not $destino.hostCoincide) { Fail "El host resuelto NO coincide con el de produccion esperado." 26 }
    if ($destino.esPooled) { Fail "La URL es del endpoint POOLED. Usar la conexion DIRECTA." 27 }
    if (-not $destino.dbCoincideUrl) { Fail "El nombre de base de datos en la URL no coincide con el esperado." 28 }
    if (-not $destino.conectado) { Fail "No se pudo conectar al destino: $($destino.errorConexion)" 29 }
    if (-not $destino.rolCoincide) { Fail "El rol conectado no es '$RolAdministrativoEsperado'." 30 }
    if (-not $destino.baseActualCoincide) { Fail "'current_database()' real ('$($destino.baseActual)') no coincide con la base esperada -- la URL y la conexion efectiva DEBEN coincidir." 31 }
    if ($SslModesFuertesPermitidos -notcontains $destino.sslmode) { Fail "TLS insuficiente: sslmode='$($destino.sslmode)'." 32 }
    if ($destino.channelBinding -ne 'require') { Fail "TLS insuficiente: channel_binding='$($destino.channelBinding)', se exige 'require'." 33 }
    Exito "Destino validado por URL Y por conexion efectiva (ANTES de 'migrate status'): host/db/rol esperados, conexion DIRECTA, TLS fuerte."
    Write-Host "RF24_PROD_VALIDACION_DESTINO_EXIT=0"

    # ------------------------------------------------------------------
    # BLOQUE C -- COMPUERTA 2: evidencia DECLARADA del punto de
    # restauracion, preparada EXTERNAMENTE, mas confirmacion humana
    # inmediatamente anterior. Sigue sin crear ni consultar nada en Neon.
    # ------------------------------------------------------------------
    if (-not $AutorizarPuntoRestauracion) {
        Detener "Compuerta 2 (punto de restauracion) NO autorizada. No se ejecutara ninguna migracion." 3
    }

    Registrar "Compuerta 2 autorizada. Este script NO crea ni consulta ningun punto de restauracion ni rama de Neon."

    if ([string]::IsNullOrWhiteSpace($ArchivoEvidenciaRestauracion)) {
        Fail "Se requiere -ArchivoEvidenciaRestauracion con la ruta al JSON de evidencia preparado externamente (ver evidencia-restauracion.schema.json)." 40
    }
    if (-not (Test-Path $ArchivoEvidenciaRestauracion)) {
        Fail "No se encontro el archivo de evidencia en '$ArchivoEvidenciaRestauracion'." 40
    }

    $bytesEvidencia = [System.IO.File]::ReadAllBytes($ArchivoEvidenciaRestauracion)
    $shaEvidenciaArchivo = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash($bytesEvidencia)).Replace('-', '').ToLower()
    Registrar "Integridad del archivo de evidencia (SHA-256 DEL ARCHIVO -- NUNCA prueba de que el respaldo exista): $shaEvidenciaArchivo"

    $textoEvidencia = [System.Text.Encoding]::UTF8.GetString($bytesEvidencia)
    try { $evidenciaJson = $textoEvidencia | ConvertFrom-Json -ErrorAction Stop }
    catch { Fail "El archivo de evidencia no es JSON valido." 41 }

    $camposPresentes = @($evidenciaJson.PSObject.Properties.Name)
    $faltantes = $CamposRequeridosEvidencia | Where-Object { $_ -notin $camposPresentes }
    if ($faltantes) { Fail "Faltan campos obligatorios en el JSON de evidencia: $($faltantes -join ', ')." 42 }
    $sobrantes = $camposPresentes | Where-Object { $_ -notin $CamposRequeridosEvidencia }
    if ($sobrantes) { Fail "El JSON de evidencia contiene campos no permitidos (additionalProperties=false en el esquema): $($sobrantes -join ', ')." 43 }
    foreach ($campo in $CamposRequeridosEvidencia) {
        if ([string]::IsNullOrWhiteSpace([string]$evidenciaJson.$campo)) { Fail "El campo '$campo' esta vacio en el JSON de evidencia." 44 }
    }
    Exito "El JSON de evidencia tiene exactamente los 8 campos requeridos, todos no vacios (validacion de esquema, parte 1)."

    if ($evidenciaJson.region -notmatch '^[a-z]{2}-[a-z]+-\d$') { Fail "El campo 'region' ('$($evidenciaJson.region)') no tiene el formato esperado (ej. 'sa-east-1')." 45 }
    if ($evidenciaJson.idPuntoORamaRespaldo -notmatch '^br-[a-z0-9-]+$') { Fail "El campo 'idPuntoORamaRespaldo' ('$($evidenciaJson.idPuntoORamaRespaldo)') no tiene el formato esperado ('br-...')." 46 }
    $regexIso = '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$'
    if ($evidenciaJson.fechaUtcCreacionPunto -notmatch $regexIso) { Fail "El campo 'fechaUtcCreacionPunto' no tiene formato ISO-8601 UTC ('AAAA-MM-DDThh:mm:ssZ')." 47 }
    try { [void][DateTime]::Parse($evidenciaJson.fechaUtcCreacionPunto, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal) }
    catch { Fail "El campo 'fechaUtcCreacionPunto' no se pudo interpretar como fecha/hora valida." 48 }
    if ($evidenciaJson.estadoReportado -cne 'ready') { Fail "El campo 'estadoReportado' debe ser exactamente 'ready' (real: '$($evidenciaJson.estadoReportado)')." 49 }
    if ($evidenciaJson.ramaOrigen -ne $evidenciaJson.ramaProduccion) {
        Fail "La 'ramaOrigen' declarada ('$($evidenciaJson.ramaOrigen)') NO coincide con la 'ramaProduccion' declarada ('$($evidenciaJson.ramaProduccion)') -- el punto no estaria bifurcado de produccion." 50
    }
    if ($evidenciaJson.hostProduccionAsociado -ne $HostProduccionEsperado) {
        Fail "El 'hostProduccionAsociado' declarado ('$($evidenciaJson.hostProduccionAsociado)') NO coincide con el host canonico de este procedimiento ('$HostProduccionEsperado')." 51
    }
    Exito "El JSON de evidencia es coherente internamente: 'ramaOrigen' coincide con 'ramaProduccion', y 'hostProduccionAsociado' coincide con el host canonico (validacion de esquema, parte 2)."

    Registrar ("Evidencia DECLARADA (NO verificada independientemente por este script -- no se consulto Neon): proyecto={0} region={1} ramaProduccion={2} idPunto={3} ramaOrigen={4} fecha={5} estado={6} host={7}" -f `
        $evidenciaJson.proyectoNeon, $evidenciaJson.region, $evidenciaJson.ramaProduccion, $evidenciaJson.idPuntoORamaRespaldo, $evidenciaJson.ramaOrigen, $evidenciaJson.fechaUtcCreacionPunto, $evidenciaJson.estadoReportado, $evidenciaJson.hostProduccionAsociado)

    Write-Host ""
    Write-Host "=== REVISION HUMANA OBLIGATORIA, INMEDIATAMENTE ANTERIOR A LA EJECUCION ==="
    Write-Host "Los datos de arriba provienen UNICAMENTE del archivo JSON. Este script NO se conecto a Neon ni los verifico de forma independiente. Clasificacion: DECLARADO (nunca VERIFICADO_INDEPENDIENTEMENTE)."
    Write-Host "Antes de continuar, confirma AHORA, contra la consola o el CLI de Neon, que ese punto de restauracion o rama de respaldo existe de verdad, en estado 'ready', bifurcado de la rama de produccion indicada."
    $confirmacionHumana = Read-Host -Prompt "Escribe exactamente CONFIRMO si acabas de verificar lo anterior contra Neon, ahora mismo"
    if ($confirmacionHumana -cne 'CONFIRMO') { Fail "No se recibio la confirmacion humana exacta ('CONFIRMO') inmediatamente anterior a la ejecucion." 52 }

    $rutaEvidenciaPersistida = Join-Path $script:DirTrabajo 'evidencia-punto-restauracion-auditada.json'
    [ordered]@{
        clasificacion                = 'DECLARADO'
        evidenciaDeclarada           = $evidenciaJson
        shaArchivoOriginal           = $shaEvidenciaArchivo
        confirmacionHumanaRecibida   = $true
        momentoConfirmacionHumanaUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
        notaAutenticidad             = 'DECLARADO unicamente. NUNCA VERIFICADO_INDEPENDIENTEMENTE -- este script jamas consulto Neon. La autenticidad de este punto de restauracion depende por completo de la revision humana confirmada arriba, inmediatamente anterior a esta ejecucion.'
    } | ConvertTo-Json -Depth 5 | Set-Content -Path $rutaEvidenciaPersistida -Encoding UTF8

    Exito "Compuerta 2: evidencia DECLARADA validada por esquema y por coherencia interna, mas confirmacion humana explicita inmediatamente anterior. Clasificacion final: DECLARADO. Persistida en: $rutaEvidenciaPersistida"
    $script:RestauracionConfirmadaEnEstaEjecucion = $true
    Write-Host "RF24_PROD_PUNTO_RESTAURACION_EXIT=0"

    if (-not $AutorizarMigracion -or -not $script:RestauracionConfirmadaEnEstaEjecucion) {
        Detener "Compuerta 3 (migracion) NO autorizada, o la Compuerta 2 no se satisfizo en esta ejecucion." 4
    }

    # ------------------------------------------------------------------
    # COMPUERTA 3 -- migracion real: Push-Location + --schema explicito.
    # ------------------------------------------------------------------
    Push-Location $RutaRepositorio
    try {
        # NUEVO EN v8 -- ver DEFECTO 2 en la cabecera. Autochequeo previo
        # (defensa en profundidad sobre el propio valor que este script
        # esta a punto de fijar, ANTES de fijar nada): el host de la URL
        # administrativa ya validada (Compuerta 1) debe ser EXACTO el
        # esperado y nunca contener '-pooler'. Si esto fallara, seria una
        # regresion interna de este mismo script, nunca del entorno.
        $hostUrlAdminPrevio = Extraer-HostDeUrlPostgres $script:UrlAdminTexto
        if ([string]::IsNullOrWhiteSpace($hostUrlAdminPrevio) -or $hostUrlAdminPrevio -ine $HostProduccionEsperado -or $hostUrlAdminPrevio -imatch '-pooler') {
            Fail "Autochequeo interno (defensa en profundidad, NUEVO en v8): el host extraido de la URL administrativa ya validada no coincide exactamente con el esperado, o contiene '-pooler' -- no se fija ninguna variable de entorno de base de datos para 'migrate status'/'migrate deploy'." 36
        }

        # NUEVO EN v8 -- guarda (solo en memoria, nunca registrado) si
        # 'DATABASE_URL'/'SEED_DATABASE_URL' existian antes y su valor
        # previo, ANTES de fijar ninguna de las 2.
        Guardar-VariablesEntornoBaseDatosPrevias

        $env:DATABASE_URL = $script:UrlAdminTexto
        # NUEVO EN v8 -- ver DEFECTO 2 en la cabecera: el schema real
        # tambien lee 'SEED_DATABASE_URL' (directUrl) para las
        # migraciones. Se fija a la MISMA URL administrativa DIRECTA ya
        # validada -- nunca al valor presente en '.env' del repositorio
        # (que en produccion resulto ser el endpoint pooled). Como Prisma
        # (via 'dotenv') nunca sobrescribe una variable que el PROCESO ya
        # tiene fijada, esto garantiza que el destino EFECTIVO de
        # 'migrate status'/'migrate deploy' no dependa de '.env'.
        $env:SEED_DATABASE_URL = $script:UrlAdminTexto

        # v6: wrapper -- CAMBIO DELIBERADO de robustez (no un
        # aflojamiento; ver "CAMBIO DE v5 A v6" en la cabecera). v5 leia
        # el merge '2>&1' tanto para la lista negra como para el
        # automata de estados que extrae las "pendientes" linea por
        # linea; eso arriesgaba intercalar una linea de stderr en medio
        # del bloque de pendientes. v6 usa 'LineasStdout'/'TextoStdout'
        # PUROS para el automata de estados, y evalua la lista negra de
        # anomalias TANTO en stdout COMO en stderr por separado (red de
        # seguridad adicional, para no perder cobertura al separar los
        # streams).
        $resultadoStatus = Invoke-ComandoExterno -Ejecutable 'node' -Argumentos @($rutaPrismaCliLocal, 'migrate', 'status', '--schema', 'prisma\schema.prisma')
        $codigoStatus = $resultadoStatus.CodigoSalida
        $salidaStatus = $resultadoStatus.LineasStdout
        $salidaStatusTexto = $resultadoStatus.TextoStdout
        Registrar "Salida (stdout puro) de 'migrate status' (codigo de salida: $codigoStatus):"
        Registrar $salidaStatusTexto
        if ($resultadoStatus.TextoStderr) {
            Registrar "Stderr (por separado, informativo) de 'migrate status':"
            Registrar $resultadoStatus.TextoStderr
        }

        # Lista negra de anomalias conocidas (defensa en profundidad) --
        # evaluada en AMBOS streams por separado, no solo en stdout.
        # CORREGIDA EN v8 (ver DEFECTO 1 en la cabecera) y extraida a la
        # funcion 'Detectar-AnomaliaMigrateStatus' (definida arriba) para
        # poder probarla de forma real y aislada via extraccion AST.
        if (Detectar-AnomaliaMigrateStatus -StdoutTexto $salidaStatusTexto -StderrTexto $resultadoStatus.TextoStderr) {
            Fail "'migrate status' reporta una anomalia reconocida (drift/fallida/'migrate resolve'/error como palabra independiente, en stdout o en stderr). No continuar por esta via." 53
        }

        # NUEVO EN v8 -- ver DEFECTO 2 en la cabecera. Demostracion
        # programatica, ANTES de invocar 'migrate deploy', de que
        # 'migrate status' no reporto ningun hostname pooled ni ningun
        # otro host de Neon distinto al esperado (defensa en
        # profundidad adicional a fijar las 2 variables de entorno).
        Probar-HostIndebidoEnTexto -Texto $salidaStatusTexto -Etiqueta "'migrate status' (stdout)" -SentinelPooled 37 -SentinelOtroHost 38
        Probar-HostIndebidoEnTexto -Texto $resultadoStatus.TextoStderr -Etiqueta "'migrate status' (stderr)" -SentinelPooled 37 -SentinelOtroHost 38

        if ($codigoStatus -eq 0) { Fail "'migrate status' devolvio codigo 0 (sin pendientes) -- se esperaban 6 pendientes." 54 }
        if ($codigoStatus -ne 1) { Fail "'migrate status' devolvio un codigo inesperado ($codigoStatus)." 56 }

        # Plantilla de "pendientes normales": cualquier salida que NO
        # calce esta plantilla conocida bloquea.
        if ($salidaStatusTexto -notmatch '(?i)have not yet been applied') {
            Fail "Salida de 'migrate status' DESCONOCIDA: no contiene la frase esperada de 'migraciones pendientes'. Bloqueando por salida no reconocida." 57
        }
        if ($salidaStatusTexto -notmatch '(?i)migrate deploy') {
            Fail "Salida de 'migrate status' DESCONOCIDA: falta la sugerencia esperada de 'migrate deploy'. Bloqueando por salida no reconocida." 58
        }

        # Extraccion del conjunto de pendientes -- requisito B.7: una
        # linea no reconocida dentro del bloque ya NO se ignora
        # silenciosamente (como en v3): bloquea, sin interpretar por
        # aproximacion. v6: sobre 'LineasStdout' PURAS (ya separadas por
        # el wrapper), nunca sobre un merge con stderr.
        $lineas = $salidaStatus
        $enBloquePendientes = $false
        $pendientesDetectadas = New-Object System.Collections.Generic.List[string]
        foreach ($linea in $lineas) {
            $recortada = $linea.Trim()
            if ($recortada -match '(?i)have not yet been applied') { $enBloquePendientes = $true; continue }
            if ($enBloquePendientes) {
                if ($recortada -eq '') { $enBloquePendientes = $false; continue }
                if ($recortada -match '^\d{14}_[A-Za-z0-9_]+$') { $pendientesDetectadas.Add($recortada); continue }
                Fail "Linea NO reconocida dentro del bloque de 'pendientes' de 'migrate status': '$recortada'. Bloqueando -- no se intenta interpretar por aproximacion." 59
            }
        }
        $pendientesOrdenadas = $pendientesDetectadas | Sort-Object -Unique
        $esperadasOrdenadas = $MigracionesRf24EnOrden | Sort-Object -Unique
        $diferencia = Compare-Object -ReferenceObject $esperadasOrdenadas -DifferenceObject $pendientesOrdenadas
        if ($pendientesDetectadas.Count -eq 0) { Fail "No se pudo extraer ninguna migracion pendiente pese a codigo de salida 1 -- salida no reconocida." 60 }
        if ($diferencia) { Fail "El conjunto de pendientes NO es exactamente las 6 de RF24: $($diferencia | ConvertTo-Json -Compress)" 61 }
        Exito "Demostrado programaticamente: las unicas migraciones pendientes son, exactamente, las 6 de RF24; cada linea del bloque de pendientes fue reconocida explicitamente (sin aproximaciones)."

        Registrar "Ejecutando 'prisma migrate deploy' (Prisma LOCAL, --schema explicito, desde $RutaRepositorio)."
        # v6: wrapper -- sin cambios de significado (sentinel 62); se usa
        # la vista combinada solo para el log (redactado), igual que v5.
        $resultadoDeploy = Invoke-ComandoExterno -Ejecutable 'node' -Argumentos @($rutaPrismaCliLocal, 'migrate', 'deploy', '--schema', 'prisma\schema.prisma')
        $codigoDeploy = $resultadoDeploy.CodigoSalida
        $salidaDeploySegura = [regex]::Replace($resultadoDeploy.TextoCombinado, 'postgres(ql)?://[^\s"]+', 'postgres://[REDACTADO]')
        Registrar "Salida de 'migrate deploy':"
        Registrar $salidaDeploySegura
        if ($codigoDeploy -ne 0) { Fail "'prisma migrate deploy' termino con codigo $codigoDeploy." 62 }

        # NUEVO EN v8 -- misma demostracion que para 'migrate status',
        # por simetria y porque 'migrate deploy' usa las mismas 2
        # variables de entorno. Se evalua sobre la vista combinada ya
        # redactada (nunca hace falta volver a redactar: un hostname, por
        # si solo, nunca es una credencial de todos modos).
        Probar-HostIndebidoEnTexto -Texto $salidaDeploySegura -Etiqueta "'migrate deploy'" -SentinelPooled 63 -SentinelOtroHost 64

        Exito "'prisma migrate deploy' termino con codigo 0."
        Write-Host "RF24_PROD_MIGRACION_EXIT=0"
    }
    finally {
        # CORREGIDO EN v8 -- ver DEFECTO 2 en la cabecera: ya NO se
        # elimina 'DATABASE_URL' a ciegas. Se restauran 'DATABASE_URL' Y
        # 'SEED_DATABASE_URL' exactamente a su valor previo a esta
        # ejecucion (o se eliminan, si antes no existian).
        Restaurar-VariablesEntornoBaseDatosPrevias
        Pop-Location
    }

    # ------------------------------------------------------------------
    # BLOQUE E -- VERIFICACION POSTERIOR AMPLIADA (solo lectura, igualdad
    # exacta; ACL via proacl/aclexplode por OID; proconfig como conjunto
    # exacto; RLS con cantidad exigida).
    # ------------------------------------------------------------------
    $cjsVerificacionPosterior = @'
const { createRequire } = require("module");
const requireDesdeRepo = createRequire(process.env.RF24_PACKAGE_JSON_PATH);
const { Client } = requireDesdeRepo("pg");
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL_ADMIN_PROD });
  const r = {};

  // Firma esperada y si SECURITY DEFINER debe ser true -- ver "DESVIACION
  // DELIBERADA" en la cabecera del .ps1 (con citas SQL literales):
  // 11 de 12 en true/true, 1 (interna) en false/false.
  const funcionesEsperadas = {
    crear_solicitud_derechos:                       { firma: "text, text, text, text, text", securityDefiner: true,  grantChainpulseApp: true  },
    aplicar_efecto_solicitud_derechos:               { firma: "text, text, text, text",       securityDefiner: false, grantChainpulseApp: false },
    procesar_solicitud_derechos:                     { firma: "text",                         securityDefiner: true,  grantChainpulseApp: true  },
    resolver_solicitud_por_soporte:                  { firma: "text, text",                   securityDefiner: true,  grantChainpulseApp: true  },
    reclamar_solicitudes_derechos_para_envio:        { firma: "",                              securityDefiner: true,  grantChainpulseApp: true  },
    asignar_token_pendiente:                         { firma: "text, text, text, integer",     securityDefiner: true,  grantChainpulseApp: true  },
    confirmar_envio_token:                           { firma: "text, text",                   securityDefiner: true,  grantChainpulseApp: true  },
    registrar_fallo_envio_solicitud_derechos:        { firma: "text, text",                   securityDefiner: true,  grantChainpulseApp: true  },
    cancelar_solicitud_derechos_por_envio_fallido:   { firma: "text, text",                   securityDefiner: true,  grantChainpulseApp: true  },
    reconciliar_solicitudes_derechos_agotadas:       { firma: "",                              securityDefiner: true,  grantChainpulseApp: true  },
    expirar_solicitudes_derechos_vencidas:           { firma: "",                              securityDefiner: true,  grantChainpulseApp: true  },
    purgar_solicitudes_derechos_segun_retencion:     { firma: "",                              securityDefiner: true,  grantChainpulseApp: true  },
  };
  const nombresFunciones = Object.keys(funcionesEsperadas);

  // Valores de enum esperados, EXACTOS y en orden.
  const enumsEsperados = {
    BucketLimiteTasa: ["INICIO_EVALUACION", "DESBLOQUEO_DETALLE", "SOLICITUD_DERECHOS", "CONFIRMAR_DERECHOS"],
    AlcanceRetiro: ["DIAGNOSTICO", "INVESTIGACION", "AMBAS_FINALIDADES"],
    TipoSolicitudDerechos: ["RETIRO_CONSENTIMIENTO", "ELIMINACION_CONTACTO", "RETIRO_Y_ELIMINACION"],
    EstadoSolicitudDerechos: ["PENDIENTE", "PROCESADA", "EXPIRADA", "CANCELADA"],
    EstadoResolucion: ["AUTOMATICO", "SOPORTE"],
  };

  try {
    await client.connect();

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

    const funcionesTodosEsquemas = await client.query(`
      SELECT p.oid::bigint AS oid, p.proname, n.nspname AS esquema, pg_get_userbyid(p.proowner) AS propietario,
             p.prosecdef AS security_definer, p.proconfig AS config,
             pg_get_function_identity_arguments(p.oid) AS firma
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = ANY($1)
      ORDER BY p.proname, n.nspname`, [nombresFunciones]);
    r.funcionesTodosEsquemas = funcionesTodosEsquemas.rows;
    r.funcionesFueraDePublic = funcionesTodosEsquemas.rows.filter(f => f.esquema !== 'public');
    const conteoPorNombre = {};
    for (const f of funcionesTodosEsquemas.rows) { conteoPorNombre[f.proname] = (conteoPorNombre[f.proname] || 0) + 1; }
    r.duplicados = Object.entries(conteoPorNombre).filter(([, n]) => n > 1).map(([nombre, n]) => ({ nombre, n }));

    // ACL exacto via pg_proc.proacl + aclexplode, asociado por OID exacto
    // (reemplaza information_schema.routine_privileges -- requisito 22).
    const oidsPublic = funcionesTodosEsquemas.rows.filter(f => f.esquema === 'public').map(f => f.oid);
    r.aclPorFuncion = oidsPublic.length ? (await client.query(`
      SELECT p.oid::bigint AS oid, p.proname,
             (aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))).grantee::regrole::text AS grantee,
             (aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))).privilege_type AS privilegio
      FROM pg_proc p
      WHERE p.oid = ANY($1::bigint[])
      ORDER BY p.proname, grantee, privilegio`, [oidsPublic])).rows : [];

    const cuerpoFuncion = await client.query(`SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname='crear_solicitud_derechos' AND pronamespace = 'public'::regnamespace::oid`);
    const def = cuerpoFuncion.rows[0] ? cuerpoFuncion.rows[0].def : '';
    r.patronCorregidoPresente = def.includes('FROM public.evaluaciones_expres_v2 AS ev') && def.includes('WHERE ev.id = p_evaluacion_id');
    r.patronViejoAusente = !/FROM public\.evaluaciones_expres_v2 WHERE id = p_evaluacion_id/.test(def);

    const rls = await client.query(`
      SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN ('solicitudes_derechos','intentos_solicitud_derechos_descartados')`);
    r.rls = rls.rows;

    const politicas = await client.query(`
      SELECT tablename, policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename IN ('solicitudes_derechos','intentos_solicitud_derechos_descartados')`);
    r.politicasRls = politicas.rows;

    r.funcionesEsperadas = funcionesEsperadas;
    r.ok = true;
  } catch (e) { r.ok = false; r.error = String(e.message || e); }
  finally { await client.end().catch(() => {}); }
  console.log(JSON.stringify(r));
})();
'@
    $rutaCjsVerif = Join-Path $script:DirTrabajo 'verificacion-posterior.cjs'
    Set-Content -Path $rutaCjsVerif -Value $cjsVerificacionPosterior -Encoding UTF8 -NoNewline
    $env:DATABASE_URL_ADMIN_PROD = $script:UrlAdminTexto
    # v6: wrapper -- JSON desde stdout PURO, stderr al mismo log de
    # siempre (continuidad), igual patron que el bloque D.
    $resultadoVerif = Invoke-ComandoExterno -Ejecutable 'node' -Argumentos @($rutaCjsVerif)
    if ($resultadoVerif.TextoStderr) {
        Set-Content -Path (Join-Path $script:DirTrabajo 'verificacion-posterior.stderr.log') -Value $resultadoVerif.TextoStderr -Encoding UTF8
    }
    $salidaVerif = $resultadoVerif.TextoStdout
    if ($resultadoVerif.CodigoSalida -ne 0 -or -not $salidaVerif) {
        Fail "La verificacion posterior no pudo ejecutarse (codigo $($resultadoVerif.CodigoSalida)).$(Resumen-StderrParaError $resultadoVerif.TextoStderr)" 70
    }
    $verif = $salidaVerif | ConvertFrom-Json
    if (-not $verif.ok) { Fail "La verificacion posterior fallo: $($verif.error)" 71 }

    foreach ($nombreEnum in $verif.enumsEsperados.PSObject.Properties.Name) {
        $esperado = $verif.enumsEsperados.$nombreEnum
        $real = @($verif.enumsReales.$nombreEnum)
        $diffEnum = Compare-Object -ReferenceObject $esperado -DifferenceObject $real -SyncWindow 0
        if ($diffEnum -or ($esperado.Count -ne $real.Count)) {
            Fail "El enum '$nombreEnum' no coincide EXACTO (orden y valores) con lo esperado. Esperado: $($esperado -join ','); real: $($real -join ',')." 72
        }
    }
    Exito "Los 5 enums de RF24 (incluido 'BucketLimiteTasa' completo) coinciden EXACTO, valor por valor y en orden, con lo esperado."

    if ($verif.tablasPresentes.Count -ne 2) { Fail "Se esperaban exactamente las 2 tablas de RF24 en 'public'; se encontraron $($verif.tablasPresentes.Count)." 73 }
    if ($verif.privilegiosDirectosIndebidos.Count -gt 0) {
        Fail "Privilegios directos indebidos (chainpulse_app o PUBLIC) sobre las tablas de RF24: $($verif.privilegiosDirectosIndebidos | ConvertTo-Json -Compress)" 74 }
    if (-not $verif.patronCorregidoPresente -or -not $verif.patronViejoAusente) { Fail "El cuerpo real de 'crear_solicitud_derechos' no refleja el patron corregido de la migracion 6." 75 }
    if ($verif.funcionesFueraDePublic.Count -gt 0) { Fail "Funciones RF24 FUERA de 'public' (shadowing): $($verif.funcionesFueraDePublic | ConvertTo-Json -Compress)" 76 }
    if ($verif.duplicados.Count -gt 0) { Fail "Funciones RF24 duplicadas (mas de una firma con el mismo nombre): $($verif.duplicados | ConvertTo-Json -Compress)" 77 }

    $funcionesPublic = $verif.funcionesTodosEsquemas | Where-Object { $_.esquema -eq 'public' }
    if ($funcionesPublic.Count -ne 12) { Fail "Se esperaban exactamente 12 funciones RF24 en 'public'; se encontraron $($funcionesPublic.Count)." 78 }

    $aclPorOid = @{}
    foreach ($fila in $verif.aclPorFuncion) {
        $clave = [string]$fila.oid
        if (-not $aclPorOid.ContainsKey($clave)) { $aclPorOid[$clave] = New-Object System.Collections.Generic.List[object] }
        $aclPorOid[$clave].Add($fila)
    }

    foreach ($f in $funcionesPublic) {
        $esperadaFuncion = $verif.funcionesEsperadas.$($f.proname)
        if ($f.propietario -ne $RolAdministrativoEsperado) { Fail "'$($f.proname)' no es propiedad de '$RolAdministrativoEsperado' (es de '$($f.propietario)')." 79 }
        if ($f.firma -ne $esperadaFuncion.firma) { Fail "Firma inesperada en '$($f.proname)': esperada '$($esperadaFuncion.firma)', real '$($f.firma)'." 80 }
        if ([bool]$f.security_definer -ne [bool]$esperadaFuncion.securityDefiner) {
            Fail "'SECURITY DEFINER' de '$($f.proname)' es '$($f.security_definer)', se esperaba '$($esperadaFuncion.securityDefiner)' (ver 'DESVIACION DELIBERADA' en la cabecera, con citas SQL literales)." 81
        }

        # proconfig como CONJUNTO EXACTO -- requisito 21, nunca substring.
        $configReal = @($f.config)
        $diffConfig = Compare-Object -ReferenceObject $ConfigEsperadoFunciones -DifferenceObject $configReal -SyncWindow 0
        if ($diffConfig -or ($ConfigEsperadoFunciones.Count -ne $configReal.Count)) {
            Fail "'$($f.proname)': 'proconfig' NO coincide EXACTO con lo esperado (conjunto, no substring). Esperado: [$($ConfigEsperadoFunciones -join ' | ')]; real: [$($configReal -join ' | ')]." 82
        }

        # ACL real via proacl/aclexplode, asociado por OID -- requisitos 22-24.
        $claveOid = [string]$f.oid
        $aclFuncion = if ($aclPorOid.ContainsKey($claveOid)) { $aclPorOid[$claveOid] } else { @() }
        $grantsIndebidos = $aclFuncion | Where-Object { $_.grantee -ne 'chainpulse_app' -and $_.grantee -ne $RolAdministrativoEsperado }
        if ($grantsIndebidos.Count -gt 0) { Fail "'$($f.proname)': grantees NO autorizados en el ACL real (proacl/aclexplode): $($grantsIndebidos | ConvertTo-Json -Compress)." 83 }
        $tieneExecuteChainpulse = [bool]($aclFuncion | Where-Object { $_.grantee -eq 'chainpulse_app' -and $_.privilegio -eq 'EXECUTE' })
        if ($tieneExecuteChainpulse -ne [bool]$esperadaFuncion.grantChainpulseApp) {
            Fail "'$($f.proname)': EXECUTE para chainpulse_app (via proacl/aclexplode) es '$tieneExecuteChainpulse', se esperaba '$($esperadaFuncion.grantChainpulseApp)'." 84
        }
        $tienePublic = [bool]($aclFuncion | Where-Object { $_.grantee -eq 'PUBLIC' })
        if ($tienePublic) { Fail "'$($f.proname)': PUBLIC tiene algun privilegio en el ACL real -- nunca deberia." 85 }
    }
    Exito "Las 12 funciones RF24: firma exacta, propietario exacto, 'SECURITY DEFINER' exacto por funcion (11 true / 1 false, por diseno), 'proconfig' como conjunto EXACTO, y ACL real (via proacl/aclexplode por OID) exactamente donde corresponde (chainpulse_app: 11 si / 1 no; PUBLIC: 0; sin grantees adicionales)."

    if ($verif.rls.Count -ne 2) { Fail "Se esperaban exactamente las 2 tablas RF24 en la consulta de RLS; se encontraron $($verif.rls.Count)." 86 }
    foreach ($f in $verif.rls) { if ($f.relrowsecurity) { Fail "La tabla '$($f.relname)' (esquema public) tiene RLS activado -- se esperaba que NO." 87 } }
    if ($verif.politicasRls.Count -gt 0) { Fail "Politicas RLS sobre tablas RF24 en 'public' (deberia ser cero): $($verif.politicasRls | ConvertTo-Json -Compress)" 88 }

    Exito "Verificacion posterior ampliada completa: enums exactos, 2 tablas exactas en public, privilegios directos en cero (chainpulse_app y PUBLIC), ACL exacto por OID, sin shadowing ni duplicados, RLS en exactamente 2 tablas desactivado, cero politicas."
    Write-Host "RF24_PROD_VERIFICACION_POSTERIOR_EXIT=0"

    # ------------------------------------------------------------------
    # AUDITORIA DE RESIDUOS -- aborto inmediato ante cualquier fila o
    # error (sin cambios de fondo respecto a v2/v3).
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
    const fila = await client.query(`
      SELECT (SELECT count(*)::int FROM "solicitudes_derechos") AS solicitudes,
             (SELECT count(*)::int FROM "intentos_solicitud_derechos_descartados") AS intentos`);
    r.conteos = fila.rows[0];
    r.ok = true;
  } catch (e) { r.ok = false; r.error = String(e.message || e); }
  finally { await client.end().catch(() => {}); }
  console.log(JSON.stringify(r));
})();
'@
    $rutaCjsResiduos = Join-Path $script:DirTrabajo 'auditoria-residuos.cjs'
    Set-Content -Path $rutaCjsResiduos -Value $cjsResiduos -Encoding UTF8 -NoNewline
    $resultadoResiduos = Invoke-ComandoExterno -Ejecutable 'node' -Argumentos @($rutaCjsResiduos)
    if ($resultadoResiduos.TextoStderr) {
        Set-Content -Path (Join-Path $script:DirTrabajo 'auditoria-residuos.stderr.log') -Value $resultadoResiduos.TextoStderr -Encoding UTF8
    }
    $salidaResiduos = $resultadoResiduos.TextoStdout
    $residuos = if ($resultadoResiduos.CodigoSalida -eq 0 -and $salidaResiduos) { $salidaResiduos | ConvertFrom-Json } else { $null }
    if (-not $residuos -or -not $residuos.ok) {
        Fail "La auditoria de residuos no pudo ejecutarse o devolvio error (codigo $($resultadoResiduos.CodigoSalida)).$(Resumen-StderrParaError $resultadoResiduos.TextoStderr)" 89
    }
    if ($residuos.conteos.solicitudes -ne 0 -or $residuos.conteos.intentos -ne 0) {
        Fail "RESIDUO DETECTADO inmediatamente despues de migrar: $($residuos.conteos | ConvertTo-Json -Compress). Aborto inmediato -- no se declara exito." 90
    }
    Exito "Auditoria de residuos: cero filas en ambas tablas."
    Write-Host "RF24_PROD_AUDITORIA_RESIDUOS_EXIT=0"

    # ------------------------------------------------------------------
    # NOTA (bloque F): los 4 smoke tests mutantes de v2/v3 se RETIRARON
    # por preferencia explicita -- ver cabecera. Solo quedan, arriba,
    # verificaciones de catalogo/lectura.
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # DIAGNOSTICO (solo lectura, NUNCA bloqueante, ajeno a RF24) --
    # ALTER DEFAULT PRIVILEGES. Unica advertencia que puede no bloquear,
    # por diseno documentado desde v1: es deuda tecnica separada, no una
    # condicion de exito/fracaso de RF24.
    # ------------------------------------------------------------------
    $cjsDefaultAcl = @'
const { createRequire } = require("module");
const requireDesdeRepo = createRequire(process.env.RF24_PACKAGE_JSON_PATH);
const { Client } = requireDesdeRepo("pg");
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL_ADMIN_PROD });
  const r = {};
  try {
    await client.connect();
    const filas = await client.query(`
      SELECT n.nspname AS esquema, d.defaclrole::regrole::text AS rol,
             (aclexplode(d.defaclacl)).grantee::regrole::text AS otorgado_a,
             (aclexplode(d.defaclacl)).privilege_type AS privilegio
      FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
      WHERE n.nspname IN ('public','pgboss') AND d.defaclobjtype = 'r'
      ORDER BY esquema, otorgado_a, privilegio`);
    r.defaultAcl = filas.rows;
    r.ok = true;
  } catch (e) { r.ok = false; r.error = String(e.message || e); }
  finally { await client.end().catch(() => {}); }
  console.log(JSON.stringify(r));
})();
'@
    $rutaCjsAcl = Join-Path $script:DirTrabajo 'diagnostico-default-acl.cjs'
    Set-Content -Path $rutaCjsAcl -Value $cjsDefaultAcl -Encoding UTF8 -NoNewline
    $resultadoAcl = Invoke-ComandoExterno -Ejecutable 'node' -Argumentos @($rutaCjsAcl)
    if ($resultadoAcl.TextoStderr) {
        Set-Content -Path (Join-Path $script:DirTrabajo 'diagnostico-default-acl.stderr.log') -Value $resultadoAcl.TextoStderr -Encoding UTF8
    }
    $salidaAcl = $resultadoAcl.TextoStdout
    $acl = if ($resultadoAcl.CodigoSalida -eq 0 -and $salidaAcl) { $salidaAcl | ConvertFrom-Json } else { $null }
    if ($acl -and $acl.ok) {
        Registrar "Diagnostico ALTER DEFAULT PRIVILEGES (informativo, NO bloqueante, ajeno a RF24): $($acl.defaultAcl | ConvertTo-Json -Compress)"
    } else {
        Registrar "ADVERTENCIA (no critica, no bloqueante): diagnostico de ALTER DEFAULT PRIVILEGES no pudo ejecutarse."
    }

    $script:CodigoSalidaFinal = 0
    Registrar "=== Procedimiento completado con exito. ==="
}
catch {
    if ($_.Exception.Message -like 'RF24_DETENER_SIN_ERROR:*') { }
    elseif ($_.Exception.Message -like 'RF24_FAIL:*') { }
    else {
        Registrar "EXCEPCION NO CONTROLADA: $($_.Exception.Message)"
        $script:CodigoSalidaFinal = 99
    }
}
finally {
    LimpiarCredenciales
    Registrar "=== finally global ejecutado -- credenciales limpiadas, worktree temporal retirado. Log: $script:ArchivoLog ==="
}

Write-Host "RF24_PROD_PROCEDIMIENTO_CODIGO_SALIDA=$script:CodigoSalidaFinal"
exit $script:CodigoSalidaFinal
