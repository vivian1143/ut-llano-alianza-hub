// Pruebas de punta a punta de UT Llano Alianza.
// Recorre los procesos por la API REST de Camunda, como lo haría cada usuario en el portal,
// y revisa lo que quedó guardado en el servicio de registros y lo que ve la ARL en su portal.
//
// Antes de correrlo deben estar encendidos: Camunda (8080), servicio de registros (8082),
// portal de la ARL (8083) y los workers.  Uso:  node pruebas/ejecutarPruebas.js
// Al terminar escribe los resultados en pruebas/resultados.md

const fs = require("fs");
const path = require("path");

const CAMUNDA = process.env.CAMUNDA_URL || "http://localhost:8080/engine-rest";
const REGISTROS = process.env.REGISTROS_URL || "http://localhost:8082/api";
const ARL = process.env.ARL_URL || "http://localhost:8083/arl-api";
const ESPERA_MAX_SEG = Number(process.env.ESPERA_MAX_SEG || 40);

// ---------- llamadas HTTP ----------

async function http(base, metodo, ruta, cuerpo, cookie) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (cookie) headers.Cookie = cookie;
  const resp = await fetch(base + ruta, {
    method: metodo,
    headers,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
  });
  const texto = await resp.text();
  let datos = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch (e) { datos = texto; }
  const nuevaCookie = (resp.headers.get("set-cookie") || "").split(";")[0] || cookie;
  return { status: resp.status, datos, cookie: nuevaCookie };
}

async function pedir(base, metodo, ruta, cuerpo) {
  const r = await http(base, metodo, ruta, cuerpo);
  if (r.status >= 300) {
    const msg = r.datos && (r.datos.message || r.datos.error);
    throw new Error(`${metodo} ${ruta} respondió ${r.status}${msg ? ": " + msg : ""}`);
  }
  return r.datos;
}

const camunda = (m, r, c) => pedir(CAMUNDA, m, r, c);
const registros = (m, r, c) => pedir(REGISTROS, m, r, c);

/** Convierte un objeto en variables de Camunda con su tipo. */
function aVariables(obj) {
  const out = {};
  for (const [k, value] of Object.entries(obj)) {
    let type = "String";
    if (typeof value === "boolean") type = "Boolean";
    else if (typeof value === "number") type = Number.isInteger(value) ? "Long" : "Double";
    out[k] = { value, type };
  }
  return out;
}

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

/** Repite la consulta hasta que devuelva algo (los workers trabajan en segundo plano). */
async function esperar(consulta, descripcion) {
  const limite = Date.now() + ESPERA_MAX_SEG * 1000;
  while (Date.now() < limite) {
    const valor = await consulta();
    if (valor) return valor;
    await pausa(500);
  }
  throw new Error(`Pasaron ${ESPERA_MAX_SEG} s esperando ${descripcion}`);
}

function hoy(dias = 0) {
  const d = new Date(Date.now() + dias * 86400000);
  return d.toISOString().slice(0, 10);
}

// ---------- ayudas sobre los procesos ----------

async function iniciar(clave, variables = {}) {
  const r = await camunda("POST", `/process-definition/key/${clave}/start`, { variables: aVariables(variables) });
  return r.id;
}

/** La instancia principal y sus subprocesos (Call Activity) que sigan activos. */
async function instancias(raiz) {
  const ids = [raiz];
  for (let i = 0; i < ids.length; i++) {
    const hijas = await camunda("GET", `/process-instance?superProcessInstance=${ids[i]}`);
    hijas.forEach((h) => ids.push(h.id));
  }
  return ids;
}

async function buscarTarea(raiz, clave) {
  for (const id of await instancias(raiz)) {
    const t = await camunda("GET", `/task?processInstanceId=${id}&taskDefinitionKey=${clave}`);
    if (t.length) return t[0];
  }
  return null;
}

/** Espera la tarea de usuario y la completa con las variables del formulario. */
async function completar(raiz, clave, variables = {}) {
  const t = await esperar(() => buscarTarea(raiz, clave), `la tarea ${clave}`);
  await camunda("POST", `/task/${t.id}/complete`, { variables: aVariables(variables) });
}

async function variable(raiz, nombre) {
  const r = await camunda("GET", `/history/variable-instance?processInstanceId=${raiz}&variableName=${nombre}`);
  return r.length ? r[0].value : undefined;
}

async function esperarVariable(raiz, nombre) {
  return esperar(async () => {
    const v = await variable(raiz, nombre);
    return v === undefined || v === null ? null : { v };
  }, `la variable ${nombre}`).then((x) => x.v);
}

async function esperarFin(raiz) {
  return esperar(async () => {
    const h = await camunda("GET", `/history/process-instance/${raiz}`);
    return h.state === "COMPLETED" ? h : null;
  }, "que el proceso termine");
}

async function vecesPor(raiz, actividad) {
  const r = await camunda("GET", `/history/activity-instance?processInstanceId=${raiz}&activityId=${actividad}`);
  return r.length;
}

/** Dispara un temporizador sin esperar el tiempo real (15 días, 1 hora o la fecha de cierre). */
async function dispararTemporizador(raiz, actividad) {
  const job = await esperar(async () => {
    const j = await camunda("GET", `/job?processInstanceId=${raiz}&activityId=${actividad}`);
    return j[0];
  }, `el temporizador ${actividad}`);
  await camunda("POST", `/job/${job.id}/execute`);
}

async function esperarMensaje(raiz, nombre) {
  return esperar(async () => {
    const s = await camunda("GET", `/event-subscription?processInstanceId=${raiz}&eventType=message&eventName=${nombre}`);
    return s[0];
  }, `que el proceso espere el mensaje ${nombre}`);
}

async function esperarIncidente(raiz) {
  return esperar(async () => {
    for (const id of await instancias(raiz)) {
      // Solo el incidente de origen (Camunda también marca la Call Activity del proceso padre)
      const i = (await camunda("GET", `/incident?processInstanceId=${id}`)).filter((x) => x.id === x.rootCauseIncidentId);
      if (i.length) return i[0];
    }
    return null;
  }, "el incidente");
}

async function cancelar(raiz) {
  await http(CAMUNDA, "DELETE", `/process-instance/${raiz}`);
}

// ---------- portal de la ARL ----------

async function sesionArl(correo = "arl@demo.com", clave = "arl12345") {
  const r = await http(ARL, "POST", "/login", { correo, clave });
  if (r.status !== 200) throw new Error(`No se pudo entrar al portal de la ARL (${r.status})`);
  return r.cookie;
}

async function enviarConceptoArl(cookie, idAccidente, datos) {
  return http(ARL, "POST", `/casos/${idAccidente}/concepto`, datos, cookie);
}

// ---------- revisión de resultados ----------

class Revision {
  constructor() {
    this.lineas = [];
    this.ok = true;
  }

  igual(descripcion, obtenido, esperado) {
    const bien = typeof esperado === "number"
      ? Math.abs(Number(obtenido) - esperado) < 0.01
      : obtenido === esperado;
    this.anotar(bien, `${descripcion}: ${texto(obtenido)}${bien ? "" : ` (se esperaba ${texto(esperado)})`}`);
  }

  cumple(descripcion, condicion, obtenido) {
    this.anotar(!!condicion, `${descripcion}: ${texto(obtenido)}`);
  }

  anotar(bien, linea) {
    this.lineas.push(`${bien ? "OK" : "FALLA"} - ${linea}`);
    if (!bien) this.ok = false;
  }
}

function texto(v) {
  if (v === undefined) return "(sin valor)";
  if (typeof v === "string") return v.length > 120 ? v.slice(0, 117) + "..." : v;
  return JSON.stringify(v);
}

// ---------- datos de prueba ----------

const INFORME = {
  nombreTrabajador: "Luis Martínez",
  documentoTrabajador: "1121900123",
  sede: "Villavicencio - Hospital Departamental",
  fechaEvento: hoy(),
  descripcionEvento: "Se resbaló en el pasillo mojado mientras trapeaba y se golpeó la rodilla"
};

/** Lleva un accidente desde el reporte hasta después de la investigación. */
async function accidenteHastaInvestigacion(raiz, gravedad, tipoEvento = "accidente", incapacidad = true) {
  await completar(raiz, "Activity_informar", INFORME);
  await completar(raiz, "Activity_atender", { atencionBrindada: "traslado", areaAsegurada: true, observacionesAtencion: "Se trasladó a urgencias" });
  await completar(raiz, "Activity_clasificar", { tipoEvento, gravedad });
  if (tipoEvento === "accidente") {
    await completar(raiz, "Activity_furat", { numeroFurat: "FURAT-" + Date.now(), fechaFurat: hoy(), parteCuerpoAfectada: "Rodilla derecha", generoIncapacidad: incapacidad, diasIncapacidad: incapacidad ? 5 : 0 });
    if (incapacidad) await completar(raiz, "Activity_nomina", { fechaInicioIncapacidad: hoy(), incapacidadRegistrada: true });
  }
  await completar(raiz, "Activity_conformar", { miembrosEquipo: "Coordinador SST, supervisor de sede y representante del COPASST" });
  await completar(raiz, "Activity_evidencias", { evidencias: "Fotos del pasillo y del aviso de piso mojado", testimonios: "Compañera de turno" });
  await completar(raiz, "Activity_causas", { causasInmediatas: "Piso mojado sin señalizar", causasBasicas: "Falta de inspección del área" });
  await completar(raiz, "Activity_informe", { conclusionesInvestigacion: "El accidente se pudo evitar con señalización", fechaInforme: hoy() });
}

async function accidenteHastaCierre(raiz, eficacesALaPrimera = true) {
  await completar(raiz, "Activity_definir", { accionesCorrectivas: "Comprar avisos de piso mojado y capacitar al personal", responsableAcciones: "Supervisor de sede", fechaLimiteAcciones: hoy(15) });
  await completar(raiz, "Activity_implementar", { evidenciaImplementacion: "Avisos instalados y acta de capacitación" });
  if (!eficacesALaPrimera) {
    await completar(raiz, "Activity_verificar", { accionesEficaces: false, observacionesVerificacion: "Falta capacitar al turno de la noche" });
    await completar(raiz, "Activity_implementar", { evidenciaImplementacion: "Acta de capacitación del turno de la noche" });
  }
  await completar(raiz, "Activity_verificar", { accionesEficaces: true, observacionesVerificacion: "Acciones cerradas" });
}

async function asistenciaHastaVerificar(raiz) {
  await completar(raiz, "Activity_plan", { proyecto: "Aseo Hospital Departamental", sede: "Villavicencio", mesProgramacion: "Diciembre 2026", puestosRequeridos: 12, turnos: "Mañana 6-14, tarde 14-22" });
  await completar(raiz, "Activity_asignar", { personalAsignado: "12 operarios asignados", personalSuficiente: true });
  await completar(raiz, "Activity_resp", { clientePideCambios: false });
}

const INICIO_PROPUESTA = {
  modalidadContratacion: "Licitación pública",
  entidadContratante: "Gobernación del Meta",
  objetoContrato: "Servicio integral de aseo y cafetería para las sedes de la Gobernación",
  fechaCierre: hoy(30)
};

const COSTOS = { numeroOperarios: 12, salarioBase: 1750905, factorPrestacional: 0.52, mesesContrato: 10, porcentajeAiu: 10 };

async function propuestaHastaConsistencia(raiz, costos = COSTOS, hayAdenda = false) {
  await completar(raiz, "Activity_revisar", { requisitosJuridicos: "RUT, cámara de comercio, pólizas", requisitosTecnicos: "Experiencia de 3 contratos", requisitosFinancieros: "Índice de liquidez mayor a 1.2" });
  await completar(raiz, "Activity_asignar", { responsableJuridico: "Asuntos legales", responsableTecnico: "Director de proyectos", responsableFinanciero: "Área financiera", fechaEntregaInterna: hoy(10) });
  await completar(raiz, "Activity_jur", { documentosJuridicos: "RUT, cámara de comercio y pólizas listas" });
  await completar(raiz, "Activity_tec", { documentosTecnicos: "Certificados de experiencia de 3 contratos" });
  await completar(raiz, "Activity_cost", costos);
  if (hayAdenda) await completar(raiz, "Activity_ajAd", { ajustesAdenda: "Se agregó un certificado de experiencia" });
}

// ---------- casos de prueba ----------

const casos = [];
const limpiar = [];
const caso = (id, nombre, tipo, esperado, fn) => casos.push({ id, nombre, tipo, esperado, fn });

caso("CP-01", "Accidente grave con concepto de la ARL", "Camino principal",
  "Se reporta a ARL/EPS y al Ministerio, se registra la incapacidad, la ARL envía su concepto desde su portal, "
  + "SST lo revisa y el caso se cierra con riesgo ALTO en la matriz.",
  async (r) => {
    const raiz = await iniciar("procesoAccidenteTrabajo");
    await accidenteHastaInvestigacion(raiz, "grave");
    await esperarMensaje(raiz, "conceptoArl");
    const id = await variable(raiz, "idAccidente");
    const cookie = await sesionArl();
    const casosArl = (await http(ARL, "GET", "/casos", undefined, cookie)).datos;
    r.cumple("el caso aparece en el portal de la ARL", casosArl.pendientes.some((c) => c.id === id), `caso ${id}`);
    const envio = await enviarConceptoArl(cookie, id, { calificacion: "Accidente de trabajo", concepto: "La ARL califica el evento como accidente de trabajo y avala la investigación", recomendaciones: "Señalizar las áreas húmedas" });
    r.igual("respuesta del portal de la ARL", envio.status, 201);
    await completar(raiz, "Activity_revConcepto", { observacionesConcepto: "Se acogen las recomendaciones" });
    await accidenteHastaCierre(raiz);
    await esperarFin(raiz);
    const a = await registros("GET", `/accidentes/${id}`);
    r.igual("proceso terminó en", await vecesPor(raiz, "EndEvent_end"), 1);
    r.igual("estado del accidente en la base de datos", a.estado, "CERRADO");
    r.igual("reportes guardados", a.reportes.map((x) => x.entidad).sort().join(","), "ARL_EPS,MINTRABAJO");
    r.cumple("radicado ARL devuelto por el servicio", /^ARL-\d{4}-\d{6}$/.test(await variable(raiz, "radicadoArl")), await variable(raiz, "radicadoArl"));
    r.igual("calificación que llegó a Camunda", await variable(raiz, "calificacionArl"), "Accidente de trabajo");
    r.igual("concepto guardado", a.conceptoArl && a.conceptoArl.calificacion, "Accidente de trabajo");
    r.igual("nivel de riesgo en la matriz", a.matrizRiesgo && a.matrizRiesgo.nivelRiesgo, "ALTO");
    r.igual("nivel de riesgo que usa el proceso", await variable(raiz, "nivelRiesgo"), "ALTO");
  });

caso("CP-02", "Incidente sin lesión y acciones no eficaces a la primera", "Camino alternativo",
  "La tabla DMN decide que no hay reportes, no se diligencia FURAT ni se remite a la ARL; "
  + "como las acciones no son eficaces se vuelven a implementar y el caso se cierra con riesgo BAJO.",
  async (r) => {
    const raiz = await iniciar("procesoAccidenteTrabajo");
    await accidenteHastaInvestigacion(raiz, "no_aplica", "incidente");
    await accidenteHastaCierre(raiz, false);
    await esperarFin(raiz);
    const id = await variable(raiz, "idAccidente");
    const a = await registros("GET", `/accidentes/${id}`);
    r.igual("decisión de la tabla DMN (nivelReporte)", await variable(raiz, "nivelReporte"), "ninguno");
    r.igual("veces que pasó por Diligenciar FURAT", await vecesPor(raiz, "Activity_furat"), 0);
    r.igual("veces que pasó por Remitir a ARL", await vecesPor(raiz, "Activity_remitir"), 0);
    r.igual("veces que se implementaron acciones", await vecesPor(raiz, "Activity_implementar"), 2);
    r.igual("reportes guardados", a.reportes.length, 0);
    r.igual("estado del accidente", a.estado, "CERRADO");
    r.igual("nivel de riesgo en la matriz", a.matrizRiesgo && a.matrizRiesgo.nivelRiesgo, "BAJO");
  });

caso("CP-03", "Accidente leve sin incapacidad", "Camino alternativo",
  "Se reporta solo a ARL/EPS (no al Ministerio), no pasa por nómina, no se remite a la ARL y queda riesgo MEDIO.",
  async (r) => {
    const raiz = await iniciar("procesoAccidenteTrabajo");
    await accidenteHastaInvestigacion(raiz, "leve", "accidente", false);
    await accidenteHastaCierre(raiz);
    await esperarFin(raiz);
    const a = await registros("GET", `/accidentes/${await variable(raiz, "idAccidente")}`);
    r.igual("decisión de la tabla DMN (nivelReporte)", await variable(raiz, "nivelReporte"), "arl");
    r.igual("reportes guardados", a.reportes.map((x) => x.entidad).join(","), "ARL_EPS");
    r.igual("veces que pasó por Registrar incapacidad", await vecesPor(raiz, "Activity_nomina"), 0);
    r.igual("veces que pasó por Remitir a ARL", await vecesPor(raiz, "Activity_remitir"), 0);
    r.igual("nivel de riesgo en la matriz", a.matrizRiesgo && a.matrizRiesgo.nivelRiesgo, "MEDIO");
  });

caso("CP-04", "La ARL no responde en 15 días", "Excepción",
  "Vence el temporizador de la compuerta basada en eventos, el proceso sigue sin el concepto, "
  + "y si la ARL intenta responder tarde el portal le dice que el caso ya no espera concepto (409).",
  async (r) => {
    const raiz = await iniciar("procesoAccidenteTrabajo");
    await accidenteHastaInvestigacion(raiz, "mortal");
    await esperarMensaje(raiz, "conceptoArl");
    await dispararTemporizador(raiz, "Event_sinResp");
    await esperar(() => buscarTarea(raiz, "Activity_definir"), "la tarea Definir acciones");
    const id = await variable(raiz, "idAccidente");
    const tarde = await enviarConceptoArl(await sesionArl(), id, { calificacion: "Accidente de trabajo", concepto: "Concepto que llega después del plazo de 15 días", recomendaciones: "Ninguna adicional" });
    r.igual("respuesta del portal de la ARL al responder tarde", tarde.status, 409);
    await accidenteHastaCierre(raiz);
    await esperarFin(raiz);
    const a = await registros("GET", `/accidentes/${id}`);
    r.igual("veces que pasó por 15 días sin respuesta", await vecesPor(raiz, "Event_sinResp"), 1);
    r.igual("veces que pasó por Revisar concepto de ARL", await vecesPor(raiz, "Activity_revConcepto"), 0);
    r.igual("concepto guardado", a.conceptoArl, null);
    r.igual("estado del accidente", a.estado, "CERRADO");
  });

caso("CP-05", "Mes con dos novedades", "Camino principal",
  "Una falta de 8 h requiere reemplazo (DMN), un retardo de 1 h solo se registra. "
  + "El servicio de registros guarda las 2 novedades, suma 9 h y arma la prefactura; nómina y facturación la reciben en paralelo.",
  async (r) => {
    const raiz = await iniciar("procesoAsistenciaPersonal");
    await asistenciaHastaVerificar(raiz);
    await completar(raiz, "Activity_verif", { fechaVerificacion: hoy(), huboNovedad: true, trabajadorNovedad: "Ana Rojas", tipoNovedad: "falta", horasNovedad: 8, finSemana: false });
    await completar(raiz, "Activity_reem", { trabajadorReemplazo: "Carlos Pérez" });
    await completar(raiz, "Activity_verif", { fechaVerificacion: hoy(1), huboNovedad: true, trabajadorNovedad: "Jorge Díaz", tipoNovedad: "retardo", horasNovedad: 1, finSemana: true });
    await completar(raiz, "Activity_audit", { hayInconsistencias: false, finMes: true });
    await completar(raiz, "Activity_nom", { novedadesRecibidas: true });
    await completar(raiz, "Activity_fac", { soportesRecibidos: true });
    await esperarFin(raiz);
    const datos = await registros("GET", `/instancias/${raiz}`);
    r.igual("novedades guardadas", datos.novedades.length, 2);
    r.igual("veces que pasó por Cubrir ausencia", await vecesPor(raiz, "Activity_reem"), 1);
    r.igual("total de novedades que usa el proceso", await variable(raiz, "totalNovedades"), 2);
    r.igual("total de horas que usa el proceso", await variable(raiz, "totalHorasNovedad"), 9);
    r.igual("prefactura guardada (novedades)", datos.prefactura && datos.prefactura.totalNovedades, 2);
    r.cumple("resumen de prefactura en el proceso", (await variable(raiz, "resumenPrefactura") || "").includes("Total novedades: 2"), await variable(raiz, "resumenPrefactura"));
    r.igual("proceso terminó en", await vecesPor(raiz, "EndEvent_end"), 1);
  });

caso("CP-06", "Falta personal, el cliente pide cambios y hay inconsistencias", "Camino alternativo",
  "Se llama el subproceso Gestionar personal adicional, el cliente pide un cambio y se vuelve a asignar, "
  + "la auditoría encuentra inconsistencias y se corrigen. La prefactura queda sin novedades.",
  async (r) => {
    const raiz = await iniciar("procesoAsistenciaPersonal");
    await completar(raiz, "Activity_plan", { proyecto: "Aseo Colegio Departamental", sede: "Acacías", mesProgramacion: "Diciembre 2026", puestosRequeridos: 20, turnos: "Mañana 6-14" });
    await completar(raiz, "Activity_asignar", { personalAsignado: "15 de 20 operarios", personalSuficiente: false });
    await completar(raiz, "Activity_revisar", { candidatosDisponibles: false, candidatos: "Ninguno disponible" });
    await completar(raiz, "Activity_solicitar", { perfilRequerido: "Operario de aseo con experiencia", cantidadRequerida: 5 });
    await completar(raiz, "Activity_vincular", { personalAdicional: "5 operarios vinculados" });
    await completar(raiz, "Activity_asignar", { personalAsignado: "20 operarios asignados", personalSuficiente: true });
    await completar(raiz, "Activity_resp", { clientePideCambios: true, cambiosSolicitados: "Pasar 2 operarios al turno de la tarde" });
    await completar(raiz, "Activity_asignar", { personalAsignado: "20 operarios, 2 en la tarde", personalSuficiente: true });
    await completar(raiz, "Activity_resp", { clientePideCambios: false });
    await completar(raiz, "Activity_verif", { fechaVerificacion: hoy(), huboNovedad: false, finSemana: true });
    await completar(raiz, "Activity_audit", { hayInconsistencias: true, inconsistencias: "Falta la firma del supervisor", finMes: false });
    await completar(raiz, "Activity_corr", { correccionesRealizadas: "Planilla firmada" });
    await completar(raiz, "Activity_audit", { hayInconsistencias: false, finMes: true });
    await completar(raiz, "Activity_nom", { novedadesRecibidas: true });
    await completar(raiz, "Activity_fac", { soportesRecibidos: true });
    await esperarFin(raiz);
    const datos = await registros("GET", `/instancias/${raiz}`);
    r.igual("veces que se llamó Gestionar personal adicional", await vecesPor(raiz, "Activity_gh"), 1);
    r.igual("veces que se asignó personal", await vecesPor(raiz, "Activity_asignar"), 3);
    r.igual("veces que se corrigieron novedades", await vecesPor(raiz, "Activity_corr"), 1);
    r.igual("novedades guardadas", datos.novedades.length, 0);
    r.cumple("resumen de la prefactura", datos.prefactura && datos.prefactura.resumen.includes("Sin novedades"), datos.prefactura && datos.prefactura.resumen);
  });

caso("CP-07", "El supervisor no verifica la asistencia a tiempo", "Excepción",
  "Se dispara el temporizador no interruptivo de 1 hora: el worker envía el recordatorio y la tarea Verificar asistencia sigue abierta.",
  async (r) => {
    const raiz = await iniciar("procesoAsistenciaPersonal");
    limpiar.push(raiz);
    await asistenciaHastaVerificar(raiz);
    await esperar(() => buscarTarea(raiz, "Activity_verif"), "la tarea Verificar asistencia");
    await dispararTemporizador(raiz, "Event_bTimer");
    r.cumple("el worker envió el recordatorio", !!(await esperarVariable(raiz, "ultimoRecordatorio")), await variable(raiz, "ultimoRecordatorio"));
    r.igual("veces que pasó por Recordatorio enviado", await esperar(async () => (await vecesPor(raiz, "EndEvent_endRec")) || null, "el fin del recordatorio"), 1);
    r.cumple("la tarea Verificar asistencia sigue abierta", !!(await buscarTarea(raiz, "Activity_verif")), "sí");
  });

caso("CP-08", "Propuesta aprobada a la primera", "Camino principal",
  "Las tres ramas paralelas terminan, el servicio de registros calcula el valor con el salario mínimo 2026, "
  + "la DMN da el factor de desempate, gerencia aprueba y la propuesta queda enviada a radicación.",
  async (r) => {
    const raiz = await iniciar("procesoElaborarPropuesta", { ...INICIO_PROPUESTA, numeroProceso: "LP-012-2026", simularAdenda: false });
    await propuestaHastaConsistencia(raiz);
    await completar(raiz, "Activity_desemp", { serviciosNacionales: true, personalDiscapacidad: false, esMipyme: false, soportesDesempate: "Certificado de origen nacional" });
    await completar(raiz, "Activity_consist", { propuestaCompleta: true });
    await completar(raiz, "Activity_gerente", { propuestaAprobada: true, observacionesGerencia: "Aprobada" });
    await completar(raiz, "Activity_entregar", { propuestaEntregada: true, fechaEntrega: hoy(5) });
    await esperarFin(raiz);
    const esperado = 12 * 1750905 * 1.52 * 10 * 1.1;
    const p = (await registros("GET", `/instancias/${raiz}`)).propuesta;
    r.igual("valor de la propuesta que usa el proceso", await variable(raiz, "valorPropuesta"), esperado);
    r.igual("valor guardado en la base de datos", p && Number(p.valorPropuesta), esperado);
    r.igual("factor de desempate (DMN)", await variable(raiz, "factorDesempate"), "Servicios de origen nacional");
    r.igual("estado de la propuesta", p && p.estado, "ENVIADA_RADICACION");
    r.igual("proceso terminó en Propuesta enviada a radicación", await vecesPor(raiz, "Event_end"), 1);
  });

caso("CP-09", "Propuesta con adenda, errores y rechazo de gerencia", "Camino alternativo",
  "El worker de SECOP devuelve una adenda y se ajustan los documentos, la revisión encuentra errores, "
  + "gerencia rechaza una vez y al final se aprueba.",
  async (r) => {
    const raiz = await iniciar("procesoElaborarPropuesta", { ...INICIO_PROPUESTA, numeroProceso: "LP-013-2026", simularAdenda: true });
    await propuestaHastaConsistencia(raiz, COSTOS, true);
    const sinFactor = { serviciosNacionales: false, personalDiscapacidad: false, esMipyme: false };
    await completar(raiz, "Activity_desemp", sinFactor);
    await completar(raiz, "Activity_consist", { propuestaCompleta: false, erroresEncontrados: "Falta la póliza de seriedad" });
    await completar(raiz, "Activity_corr", { correccionesPropuesta: "Se adjuntó la póliza" });
    await completar(raiz, "Activity_desemp", sinFactor);
    await completar(raiz, "Activity_consist", { propuestaCompleta: true });
    await completar(raiz, "Activity_gerente", { propuestaAprobada: false, observacionesGerencia: "Revisar el AIU" });
    await completar(raiz, "Activity_corr", { correccionesPropuesta: "Se revisó el AIU" });
    await completar(raiz, "Activity_desemp", sinFactor);
    await completar(raiz, "Activity_consist", { propuestaCompleta: true });
    await completar(raiz, "Activity_gerente", { propuestaAprobada: true });
    await completar(raiz, "Activity_entregar", { propuestaEntregada: true, fechaEntrega: hoy(5) });
    await esperarFin(raiz);
    r.igual("veces que se ajustó por adenda", await vecesPor(raiz, "Activity_ajAd"), 1);
    r.igual("veces que se corrigió la propuesta", await vecesPor(raiz, "Activity_corr"), 2);
    r.igual("veces que revisó gerencia", await vecesPor(raiz, "Activity_gerente"), 2);
    r.igual("factor de desempate (DMN)", await variable(raiz, "factorDesempate"), "Sin factor de desempate acreditado");
    r.igual("proceso terminó en Propuesta enviada a radicación", await vecesPor(raiz, "Event_end"), 1);
  });

caso("CP-10", "Salario por debajo del mínimo", "Excepción",
  "El servicio de registros rechaza el cálculo y queda un incidente en Formular propuesta económica. "
  + "Al corregir el salario y reintentar, el proceso continúa.",
  async (r) => {
    const raiz = await iniciar("procesoElaborarPropuesta", { ...INICIO_PROPUESTA, numeroProceso: "LP-014-2026", simularAdenda: false });
    limpiar.push(raiz);
    await propuestaHastaConsistencia(raiz, { ...COSTOS, salarioBase: 1000000 });
    const incidente = await esperarIncidente(raiz);
    r.igual("actividad con incidente", incidente.activityId, "Activity_econ");
    r.cumple("mensaje del incidente", /salario mínimo/.test(incidente.incidentMessage || ""), incidente.incidentMessage);
    await camunda("PUT", `/process-instance/${incidente.processInstanceId}/variables/salarioBase`, { value: 1750905, type: "Long" });
    const tareas = await camunda("GET", `/external-task?processInstanceId=${incidente.processInstanceId}`);
    await camunda("PUT", `/external-task/${tareas[0].id}/retries`, { retries: 1 });
    const siguiente = await esperar(() => buscarTarea(raiz, "Activity_desemp"), "que el proceso siga después de corregir");
    r.cumple("después de corregir el proceso sigue", !!siguiente, siguiente && siguiente.name);
  });

caso("CP-11", "Llega la fecha de cierre antes de la aprobación", "Excepción",
  "El temporizador interruptivo de la tarea de gerencia termina el proceso en Propuesta no presentada; "
  + "la propuesta queda FORMULADA, sin enviar.",
  async (r) => {
    const raiz = await iniciar("procesoElaborarPropuesta", { ...INICIO_PROPUESTA, numeroProceso: "LP-015-2026", simularAdenda: false });
    await propuestaHastaConsistencia(raiz);
    await completar(raiz, "Activity_desemp", { serviciosNacionales: false, personalDiscapacidad: false, esMipyme: true });
    await completar(raiz, "Activity_consist", { propuestaCompleta: true });
    await esperar(() => buscarTarea(raiz, "Activity_gerente"), "la tarea de gerencia");
    await dispararTemporizador(raiz, "Event_bCierre");
    await esperarFin(raiz);
    const p = (await registros("GET", `/instancias/${raiz}`)).propuesta;
    r.igual("proceso terminó en Propuesta no presentada", await vecesPor(raiz, "EndEvent_end2"), 1);
    r.igual("estado de la propuesta", p && p.estado, "FORMULADA");
  });

caso("CP-12", "Validación de datos en el portal de la ARL y en el servicio de registros", "Excepción",
  "Los datos malos se rechazan con 400, una cuenta repetida con 409 y una contraseña equivocada con 401. Los datos buenos se aceptan.",
  async (r) => {
    const correo = `arl${Date.now()}@prueba.com`;
    const nit = String(Date.now()).slice(-9) + "-1";
    const base = { nombre: "ARL de prueba", nit, correo, clave: "clave2026", confirmarClave: "clave2026" };
    r.igual("registro con NIT mal escrito", (await http(ARL, "POST", "/registro", { ...base, nit: "123" })).status, 400);
    r.igual("registro con contraseñas distintas", (await http(ARL, "POST", "/registro", { ...base, confirmarClave: "otra2026" })).status, 400);
    r.igual("registro correcto", (await http(ARL, "POST", "/registro", base)).status, 201);
    r.igual("registro repetido", (await http(ARL, "POST", "/registro", base)).status, 409);
    r.igual("ingreso con contraseña equivocada", (await http(ARL, "POST", "/login", { correo, clave: "mala1234" })).status, 401);
    const cookie = await sesionArl(correo, "clave2026");
    r.igual("ingreso con la cuenta nueva", (await http(ARL, "GET", "/sesion", undefined, cookie)).status, 200);
    r.igual("concepto demasiado corto", (await enviarConceptoArl(cookie, 1, { calificacion: "Accidente de trabajo", concepto: "corto", recomendaciones: "Ninguna adicional" })).status, 400);
    r.igual("ver casos sin iniciar sesión", (await http(ARL, "GET", "/casos")).status, 401);
    r.igual("novedad con 30 horas en un día", (await http(REGISTROS, "POST", "/novedades", { tareaId: "prueba-" + Date.now(), processInstanceId: "prueba", fecha: hoy(), trabajador: "Ana", tipo: "falta", horas: 30 })).status, 400);
    r.igual("novedad con un tipo que no existe", (await http(REGISTROS, "POST", "/novedades", { tareaId: "prueba-" + Date.now(), processInstanceId: "prueba", fecha: hoy(), trabajador: "Ana", tipo: "vacaciones", horas: 8 })).status, 400);
  });

// ---------- ejecución ----------

async function revisarServicios() {
  const servicios = [["Camunda", CAMUNDA + "/engine"], ["Servicio de registros", REGISTROS], ["Portal de la ARL", ARL + "/sesion"]];
  for (const [nombre, url] of servicios) {
    try {
      await fetch(url);
    } catch (e) {
      console.error(`No responde ${nombre} (${url}). Enciéndelo y vuelve a correr las pruebas.`);
      process.exit(1);
    }
  }
}

(async () => {
  await revisarServicios();
  const filtro = process.argv[2]; // opcional: node ejecutarPruebas.js CP-05
  const resultados = [];
  for (const c of casos.filter((x) => !filtro || x.id === filtro)) {
    process.stdout.write(`${c.id} ${c.nombre}... `);
    const r = new Revision();
    const inicio = Date.now();
    try {
      await c.fn(r);
    } catch (e) {
      r.anotar(false, "Error: " + e.message);
    }
    const seg = ((Date.now() - inicio) / 1000).toFixed(1);
    console.log(r.ok ? `OK (${seg} s)` : `FALLA (${seg} s)`);
    if (!r.ok) r.lineas.filter((l) => l.startsWith("FALLA")).forEach((l) => console.log("   " + l));
    resultados.push({ ...c, revision: r, seg });
  }
  for (const id of limpiar) await cancelar(id);

  const aprobados = resultados.filter((x) => x.revision.ok).length;
  console.log(`\n${aprobados} de ${resultados.length} casos aprobados`);

  const md = [
    "# Resultados de las pruebas",
    "",
    `Fecha: ${new Date().toLocaleString("es-CO")}`,
    `Resultado: ${aprobados} de ${resultados.length} casos aprobados`,
    "",
    "Generado por `node pruebas/ejecutarPruebas.js` contra Camunda, el servicio de registros, el portal de la ARL y los workers.",
    ""
  ];
  for (const x of resultados) {
    md.push(`## ${x.id} ${x.nombre}`, "", `Tipo: ${x.tipo}`, "", `**Resultado esperado:** ${x.esperado}`, "",
      "**Resultado obtenido:**", "", ...x.revision.lineas.map((l) => "- " + l), "",
      `**Estado:** ${x.revision.ok ? "APROBADO" : "FALLIDO"} (${x.seg} s)`, "");
  }
  fs.writeFileSync(path.join(__dirname, "resultados.md"), md.join("\n"));
  console.log("Resultados escritos en pruebas/resultados.md");
  process.exit(aprobados === resultados.length ? 0 : 1);
})();
