# Guía de seguridad para pruebas de integración y migraciones

**Alcance:** prácticas reutilizables para cualquier prueba de integración, script de mantenimiento o migración que necesite tocar una base de datos real (aunque sea una base de prueba). No es específica de ningún proveedor, host o proyecto — los ejemplos usan nombres genéricos.

Este documento resume criterios que se fueron aplicando de forma consistente a lo largo de varias rondas de trabajo sobre un sistema con aislamiento multitenant basado en RLS (Row-Level Security) de PostgreSQL. Cada sección es una práctica independiente; se puede adoptar una sin las demás.

## 1. Branches y bases temporales para pruebas

Cuando el proveedor de base de datos soporta branches (copias aisladas de la base, con su propio ciclo de vida), cualquier prueba de integración que escriba datos reales debería correr contra un branch temporal, nunca contra el branch principal:

- Crear el branch con un nombre que deje claro su propósito y que sea fácil de identificar en una lista (por ejemplo, un prefijo fijo más la fecha).
- Verificar **visualmente**, antes de borrar un branch, que el nombre coincide exactamente con el esperado y que no tiene ninguna marca de branch principal o de producción.
- Borrar el branch completo (y los computes asociados) como una sola operación cuando la prueba termina, en vez de borrar solo algunas bases dentro de él y dejar el branch huérfano.
- Nunca automatizar la creación/eliminación de branches desde un proceso que no sea el que la persona responsable ejecuta a mano, salvo que exista una autorización explícita y acotada para eso.

Si el proveedor no soporta branches, el equivalente es una base o esquema completo dedicado exclusivamente a pruebas, nunca compartido con datos reales, con un nombre que lo identifique sin ambigüedad.

## 2. Verificación de destino y rol antes de escribir

Ninguna herramienta que vaya a escribir contra una base real debería confiar en "se configuró bien en algún momento". El patrón que dio mejores resultados fue:

1. **Confirmación explícita y separada del destino.** Una variable de entorno (o parámetro) que contenga el destino exacto esperado (host, puerto, base, esquema), fijada a mano por la persona que ejecuta la herramienta — nunca un simple `"si"`/`"true"`. La herramienta compara ese valor contra la cadena de conexión real que va a usar, y aborta si no coinciden byte a byte.
2. **Verificación del rol efectivo**, no solo de la cadena de conexión. Antes de la primera consulta o escritura, confirmar contra la base (`SELECT current_user` o equivalente) que el rol con el que se conectó es el esperado — una cadena de conexión puede apuntar a un usuario distinto del que el string sugiere si hay alias, variables de entorno superpuestas, o un `.pgpass`/gestor de credenciales de por medio.
3. **Dos autorizaciones distintas para dos decisiones distintas**, cuando la herramienta puede tanto leer como escribir: una variable confirma "este destino es de prueba", y otra, separada, confirma "autorizo que esta operación concreta escriba ahí". Ninguna sustituye a la otra.
4. **Nunca ejecutar el CLI del ORM/migrador con "npx" sin resolver**, en un script que vaya a correr sin supervisión: resolver la ruta exacta del binario/entry point instalado localmente y lanzarlo con el runtime del lenguaje directamente, para que la herramienta no pueda silenciosamente descargar o ejecutar una versión distinta de la esperada.

## 3. Migraciones idempotentes y con plan de rollback

- Toda migración nueva debería ser **puramente aditiva** cuando sea posible: agregar una columna con un `DEFAULT` que no cambie el comportamiento de las filas existentes, en vez de migrar datos o reinterpretar una columna ya en uso.
- Si una migración agrega una columna que una futura funcionalidad va a leer (por ejemplo, un contador de versión usado para invalidar sesiones), el código que la lee debe tratar su **ausencia** en datos/tokens emitidos antes de la migración de forma explícita seguro por defecto (ver Sección 4), no asumir que siempre va a estar presente.
- Antes de aplicar cualquier migración nueva contra un entorno con datos reales, preparar y documentar aparte el paso de reversión (otra migración, o el procedimiento manual exacto), y no aplicar la migración hasta tener autorización explícita y separada para ese paso concreto — "preparada, no aplicada" es un estado legítimo y debería quedar así hasta que alguien lo confirme.
- Un verificador de drift — un script de solo lectura que compara el catálogo real de la base contra lo que las migraciones versionadas deberían haber dejado — es más confiable que confiar en que "la migración ya corrió" porque el repositorio lo dice. Cuando una migración reconstruye permisos u objetos manuales que antes solo vivían en un script separado (RLS, funciones `SECURITY DEFINER`, `GRANT`s), el verificador de drift debe confirmar **identidad completa** (esquema, firma, tipos de retorno, conjunto exacto de privilegios) y no solo "el objeto existe" — una función con la misma firma pero un cuerpo distinto, o una tabla con permisos de más, pasan un chequeo superficial sin que nadie lo note.

## 4. RLS y aislamiento multitenant

- Row-Level Security no sustituye la verificación en la capa de aplicación: son dos controles independientes y ambos deben estar presentes. RLS protege contra un bug en la capa de aplicación que olvide filtrar por tenant; la capa de aplicación evita depender de que RLS esté bien configurado en absolutamente todas las tablas nuevas.
- Fijar el contexto de tenant (`set_config` o equivalente) y ejecutar la consulta que depende de ese contexto **dentro de la misma transacción**, nunca en dos pasos sobre una conexión que podría haberse reutilizado o reseteado entre medio — un pool de conexiones puede entregar la siguiente consulta a una conexión distinta de la que fijó el contexto.
- Cualquier verificación de "¿esta fila le pertenece a este tenant?" que se vaya a usar para decisiones de seguridad (autenticación, autorización, revocación de sesión) debería hacerse con el cliente ya scoped al tenant, en vez de reimplementar el filtro a mano en cada lugar — un único helper central reduce la superficie de "alguien se olvidó el filtro en una ruta nueva".
- Al auditar qué objetos tienen RLS configurado, distinguir explícitamente entre tablas con **políticas de columna directa** (la condición de tenant está en la propia tabla) y tablas con **políticas por subconsulta** (la condición depende de otra tabla relacionada) — ambas existen en un esquema maduro y un verificador de drift que solo sepa buscar una de las dos deja huecos silenciosos.

## 5. Gates explícitos para pruebas destructivas o costosas

Cualquier prueba o script que pueda borrar filas reales, aplicar una migración, o ejercitar un camino que normalmente estaría deshabilitado, debería requerir una confirmación explícita en tiempo de ejecución — nunca activarse solo porque el archivo existe en el repositorio:

- Una variable de entorno cuyo **valor** sea el destino exacto esperado (ver Sección 2), no un booleano.
- Cuando dentro de una misma suite hay un grupo de pruebas particularmente invasivo (por ejemplo, el único grupo que requiere una base completamente vacía), ese grupo debería tener su **propia** variable de confirmación, independiente de la que habilita el resto de la suite — permite correr "todo menos lo peligroso" sin tener que comentar código.
- El valor esperado de la variable de confirmación no debería ser adivinable ni genérico (`"si"`, `"true"`) — un valor específico de la operación reduce el riesgo de que quede copiado en un script de CI o en la configuración de otro entorno por descuido.

## 6. Ownership de fixtures y limpieza segura

Cuando una prueba crea datos (un esquema, filas, un job en una cola), su limpieza posterior **(`afterAll`/`finally`)** no debería borrar nada de forma incondicional:

- Usar una bandera de propiedad (`creadoPorEstaSuite`, o equivalente) que se active únicamente **después** de que la creación terminó con éxito por completo — nunca al principio del `beforeAll`, nunca de forma optimista.
- El paso de limpieza comprueba esa bandera antes de borrar. Si la preparación abortó (porque el recurso ya existía, o porque falló a mitad de camino), la bandera queda en su valor por defecto (falso) y la limpieza no borra nada ajeno.
- Nunca usar un DELETE/DROP "amplio" (por ejemplo, "borrar todo lo que devolvió el último `fetch()`" o un `TRUNCATE`) cuando lo que se busca es borrar exactamente lo que esta prueba creó — acotar siempre por un identificador específico de esa corrida (un UUID generado al vuelo, una clave compuesta por nombre+identificador único).
- Cuando dos pasos de limpieza son independientes (por ejemplo, cerrar una cola de jobs y borrar un fixture de base de datos), encadenarlos con su propio `finally` cada uno, para que el fallo de un paso nunca impida que el otro se ejecute.

## 7. Controles de residuos antes y después

Antes de ejecutar cualquier prueba que vaya a crear objetos con un nombre predecible (un esquema fijo, una empresa con un prefijo reservado), verificar su **ausencia** primero y abortar con un error fijo y claro si ya existe — nunca asumir que "si existe, es de una corrida anterior interrumpida, así que lo piso". Ese objeto preexistente podría ser importante y su creador quizás necesite investigarlo, no que una corrida nueva lo destruya en silencio.

Después de que la prueba (y su limpieza) terminaron, correr una verificación de solo lectura que confirme la ausencia de los objetos temporales esperados — esto detecta fugas de limpieza (un `afterAll` que no corrió por algún camino de error no cubierto) antes de que se acumulen corrida tras corrida.

## 8. Prohibición de `DROP ... CASCADE` sobre objetos que la suite no creó

`DROP SCHEMA ... CASCADE` (o cualquier variante en cascada) es seguro únicamente cuando la suite tiene la certeza de que **ella misma** creó por completo el objeto que está borrando — nunca cuando el objeto podría preexistir por cualquier motivo. La combinación correcta es siempre: verificar ausencia antes de crear (Sección 7) + bandera de propiedad antes de borrar (Sección 6). Sin la primera, una ejecución repetida silenciosamente destruye algo que no le pertenece; sin la segunda, una preparación que abortó igual dispara el borrado.

## 9. Huellas/identidad completa para proteger objetos compartidos

Cuando varias pruebas (o varias rondas de trabajo) dependen de un objeto compartido con privilegios elevados — típicamente una función `SECURITY DEFINER` usada para autenticación — cualquier verificación contra ese objeto debería confirmar su **identidad completa** antes de confiar en él: esquema, nombre, firma exacta de argumentos (modos de entrada/salida/variádico, no solo la cantidad), y tipos de retorno — nunca solo "existe una función con este nombre" o "tiene N argumentos". Guardar una huella de esa definición (por ejemplo, un hash de su cuerpo normalizado, o su OID si el proceso lo permite comparar de forma estable) permite detectar que alguien redesplegó una versión distinta de la función sin que ninguna prueba funcional lo note.

## 10. Mocks de correo y de servicios externos en pruebas de integración

Una prueba de integración que de otro modo sería determinista no debería depender del resultado de un servicio de terceros (proveedor de correo, almacenamiento de objetos, pasarela de pagos) cuando ese servicio no es el objeto bajo prueba:

- Mockear el módulo que llama al servicio externo (nunca el SDK de bajo nivel, para no perder cobertura de cómo el código propio arma la llamada), y hacerlo resolver exitosamente por defecto.
- Con el mock en su lugar, la prueba puede afirmar valores **exactos** (cuántas notificaciones se mandaron, con qué datos) en vez de aserciones débiles como "el resultado es mayor o igual a cero", que en el fondo solo confirman que el código no reventó.
- Si además interesa probar el camino de fallo (el sistema no aborta una operación principal solo porque una notificación falló), un test separado puede sobreescribir el mock base para ese caso puntual, sin tocar el mock compartido.

## 11. Pruebas deterministas vs. pruebas probabilísticas

Una prueba "probabilística" es la que puede pasar o fallar según timing, orden de ejecución concurrente, o un `sleep` que a veces alcanza y a veces no — típicamente, pruebas de condiciones de carrera o de bloqueo. Estas pruebas valen, pero deben identificarse como tales explícitamente (en su nombre o en un comentario de cabecera) y excluirse de cualquier lote que se vaya a correr junto con otras pruebas deterministas sobre el mismo recurso compartido, para que un fallo intermitente no se confunda con una regresión real ni bloquee, sin necesidad, pruebas que sí deberían ser 100% reproducibles. Un lote "determinista" debería poder correr muchas veces seguidas con el mismo resultado exacto.

## 12. Tratamiento seguro de errores y secretos

- Nunca registrar (`console.error`, logs, mensajes de error devueltos al cliente) el mensaje crudo de una excepción que pueda contener una cadena de conexión, contraseña, token o cualquier dato de un secreto — ni siquiera en un log "interno": un error de conexión a base de datos típicamente incluye la cadena de conexión completa en su mensaje.
- El patrón que funcionó bien: clasificar el error contra un conjunto cerrado de motivos conocidos (identificados por un código/enum interno, nunca por el contenido de `message`), y traducir ese motivo a un mensaje fijo y genérico antes de registrarlo o devolverlo — nunca interpolar `err.message` ni `String(err)` directamente en ningún punto de esa traducción.
- Un error que no coincide con ningún motivo conocido debería tratarse igual de genérico (fail-closed), no reenviarse "por si ayuda a debuggear" — la ayuda al diagnóstico se consigue con buenos logs internos acotados (solo el código del motivo + traza, nunca el mensaje crudo), no exponiendo el error real al consumidor final.
- Cuando una respuesta HTTP de autenticación/autorización falla por motivos distintos (usuario no existe, sesión revocada, error de verificación), devolver siempre la **misma** respuesta genérica al cliente — distinguir el motivo solo en el registro interno. Esto evita que un endpoint se pueda usar para enumerar qué condición específica falló.
- Cualquier script que necesite pedir una contraseña o secreto por terminal debería implementar su propia entrada oculta carácter por carácter (nunca mostrar el valor en pantalla ni dejarlo en el historial de la shell), manejando con cuidado las secuencias de escape de teclas de navegación (flechas, Home/End) para que no terminen agregando bytes de control a lo tipeado, y cancelando por completo ante una interrupción (Ctrl-C/Ctrl-D) en vez de enviar lo tipeado hasta ese momento.
