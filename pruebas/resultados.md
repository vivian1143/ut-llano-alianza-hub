# Resultados de las pruebas

Fecha: 18/11/2026, 11:50:34 p. m.
Resultado: 12 de 12 casos aprobados

Generado por `node pruebas/ejecutarPruebas.js` contra Camunda, el servicio de registros, el portal de la ARL y los workers.

## CP-01 Accidente grave con concepto de la ARL

Tipo: Camino principal

**Resultado esperado:** Se reporta a ARL/EPS y al Ministerio, se registra la incapacidad, la ARL envía su concepto desde su portal, SST lo revisa y el caso se cierra con riesgo ALTO en la matriz.

**Resultado obtenido:**

- OK - el caso aparece en el portal de la ARL: caso 1
- OK - respuesta del portal de la ARL: 201
- OK - proceso terminó en: 1
- OK - estado del accidente en la base de datos: CERRADO
- OK - reportes guardados: ARL_EPS,MINTRABAJO
- OK - radicado ARL devuelto por el servicio: ARL-2026-000002
- OK - calificación que llegó a Camunda: Accidente de trabajo
- OK - concepto guardado: Accidente de trabajo
- OK - nivel de riesgo en la matriz: ALTO
- OK - nivel de riesgo que usa el proceso: ALTO

**Estado:** APROBADO (3.3 s)

## CP-02 Incidente sin lesión y acciones no eficaces a la primera

Tipo: Camino alternativo

**Resultado esperado:** La tabla DMN decide que no hay reportes, no se diligencia FURAT ni se remite a la ARL; como las acciones no son eficaces se vuelven a implementar y el caso se cierra con riesgo BAJO.

**Resultado obtenido:**

- OK - decisión de la tabla DMN (nivelReporte): ninguno
- OK - veces que pasó por Diligenciar FURAT: 0
- OK - veces que pasó por Remitir a ARL: 0
- OK - veces que se implementaron acciones: 2
- OK - reportes guardados: 0
- OK - estado del accidente: CERRADO
- OK - nivel de riesgo en la matriz: BAJO

**Estado:** APROBADO (1.3 s)

## CP-03 Accidente leve sin incapacidad

Tipo: Camino alternativo

**Resultado esperado:** Se reporta solo a ARL/EPS (no al Ministerio), no pasa por nómina, no se remite a la ARL y queda riesgo MEDIO.

**Resultado obtenido:**

- OK - decisión de la tabla DMN (nivelReporte): arl
- OK - reportes guardados: ARL_EPS
- OK - veces que pasó por Registrar incapacidad: 0
- OK - veces que pasó por Remitir a ARL: 0
- OK - nivel de riesgo en la matriz: MEDIO

**Estado:** APROBADO (1.8 s)

## CP-04 La ARL no responde en 15 días

Tipo: Excepción

**Resultado esperado:** Vence el temporizador de la compuerta basada en eventos, el proceso sigue sin el concepto, y si la ARL intenta responder tarde el portal le dice que el caso ya no espera concepto (409).

**Resultado obtenido:**

- OK - respuesta del portal de la ARL al responder tarde: 409
- OK - veces que pasó por 15 días sin respuesta: 1
- OK - veces que pasó por Revisar concepto de ARL: 0
- OK - concepto guardado: null
- OK - estado del accidente: CERRADO

**Estado:** APROBADO (2.5 s)

## CP-05 Mes con dos novedades

Tipo: Camino principal

**Resultado esperado:** Una falta de 8 h requiere reemplazo (DMN), un retardo de 1 h solo se registra. El servicio de registros guarda las 2 novedades, suma 9 h y arma la prefactura; nómina y facturación la reciben en paralelo.

**Resultado obtenido:**

- OK - novedades guardadas: 2
- OK - veces que pasó por Cubrir ausencia: 1
- OK - total de novedades que usa el proceso: 2
- OK - total de horas que usa el proceso: 9
- OK - prefactura guardada (novedades): 2
- OK - resumen de prefactura en el proceso: Prefactura Diciembre 2026 | Proyecto: Aseo Hospital Departamental | Sede: Villavicencio
Total novedades: 2 | Horas af...
- OK - proceso terminó en: 1

**Estado:** APROBADO (2.9 s)

## CP-06 Falta personal, el cliente pide cambios y hay inconsistencias

Tipo: Camino alternativo

**Resultado esperado:** Se llama el subproceso Gestionar personal adicional, el cliente pide un cambio y se vuelve a asignar, la auditoría encuentra inconsistencias y se corrigen. La prefactura queda sin novedades.

**Resultado obtenido:**

- OK - veces que se llamó Gestionar personal adicional: 1
- OK - veces que se asignó personal: 3
- OK - veces que se corrigieron novedades: 1
- OK - novedades guardadas: 0
- OK - resumen de la prefactura: Prefactura Diciembre 2026 | Proyecto: Aseo Colegio Departamental | Sede: Acacías
Total novedades: 0 | Horas afectadas...

**Estado:** APROBADO (2.3 s)

## CP-07 El supervisor no verifica la asistencia a tiempo

Tipo: Excepción

**Resultado esperado:** Se dispara el temporizador no interruptivo de 1 hora: el worker envía el recordatorio y la tarea Verificar asistencia sigue abierta.

**Resultado obtenido:**

- OK - el worker envió el recordatorio: 2026-11-19T04:50:19.567Z
- OK - veces que pasó por Recordatorio enviado: 1
- OK - la tarea Verificar asistencia sigue abierta: sí

**Estado:** APROBADO (1.6 s)

## CP-08 Propuesta aprobada a la primera

Tipo: Camino principal

**Resultado esperado:** Las tres ramas paralelas terminan, el servicio de registros calcula el valor con el salario mínimo 2026, la DMN da el factor de desempate, gerencia aprueba y la propuesta queda enviada a radicación.

**Resultado obtenido:**

- OK - valor de la propuesta que usa el proceso: 351301579.2
- OK - valor guardado en la base de datos: 351301579.2
- OK - factor de desempate (DMN): Servicios de origen nacional
- OK - estado de la propuesta: ENVIADA_RADICACION
- OK - proceso terminó en Propuesta enviada a radicación: 1

**Estado:** APROBADO (1.3 s)

## CP-09 Propuesta con adenda, errores y rechazo de gerencia

Tipo: Camino alternativo

**Resultado esperado:** El worker de SECOP devuelve una adenda y se ajustan los documentos, la revisión encuentra errores, gerencia rechaza una vez y al final se aprueba.

**Resultado obtenido:**

- OK - veces que se ajustó por adenda: 1
- OK - veces que se corrigió la propuesta: 2
- OK - veces que revisó gerencia: 2
- OK - factor de desempate (DMN): Sin factor de desempate acreditado
- OK - proceso terminó en Propuesta enviada a radicación: 1

**Estado:** APROBADO (1.4 s)

## CP-10 Salario por debajo del mínimo

Tipo: Excepción

**Resultado esperado:** El servicio de registros rechaza el cálculo y queda un incidente en Formular propuesta económica. Al corregir el salario y reintentar, el proceso continúa.

**Resultado obtenido:**

- OK - actividad con incidente: Activity_econ
- OK - mensaje del incidente: Servicio de registros: El salario por operario ($1.000.000) no puede ser menor al salario mínimo ($1.750.905)
- OK - después de corregir el proceso sigue: Validar factores de desempate

**Estado:** APROBADO (11.3 s)

## CP-11 Llega la fecha de cierre antes de la aprobación

Tipo: Excepción

**Resultado esperado:** El temporizador interruptivo de la tarea de gerencia termina el proceso en Propuesta no presentada; la propuesta queda FORMULADA, sin enviar.

**Resultado obtenido:**

- OK - proceso terminó en Propuesta no presentada: 1
- OK - estado de la propuesta: FORMULADA

**Estado:** APROBADO (0.7 s)

## CP-12 Validación de datos en el portal de la ARL y en el servicio de registros

Tipo: Excepción

**Resultado esperado:** Los datos malos se rechazan con 400, una cuenta repetida con 409 y una contraseña equivocada con 401. Los datos buenos se aceptan.

**Resultado obtenido:**

- OK - registro con NIT mal escrito: 400
- OK - registro con contraseñas distintas: 400
- OK - registro correcto: 201
- OK - registro repetido: 409
- OK - ingreso con contraseña equivocada: 401
- OK - ingreso con la cuenta nueva: 200
- OK - concepto demasiado corto: 400
- OK - ver casos sin iniciar sesión: 401
- OK - novedad con 30 horas en un día: 400
- OK - novedad con un tipo que no existe: 400

**Estado:** APROBADO (0.1 s)
