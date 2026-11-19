// Crea los 12 grupos y usuarios de UT Llano Alianza por la API REST de Camunda.
// Hace lo mismo que UsuariosYGruposConfig del motor en Spring Boot, pero sirve también para Camunda Run.
// Usuario y contraseña son iguales (ej. sst / sst). El usuario demo queda en todos los grupos.
// Uso: node scripts/crearUsuarios.js    (se puede correr varias veces, no duplica nada)

const CAMUNDA = process.env.CAMUNDA_URL || "http://localhost:8080/engine-rest";

const GRUPOS = [
  ["trabajador", "Trabajador afectado o testigo"],
  ["supervisor", "Jefe inmediato / Supervisor de sede"],
  ["investigador", "Equipo investigador"],
  ["nomina", "Analista de nómina"],
  ["sst", "Coordinador SST"],
  ["coordinador", "Coordinador Operativo"],
  ["gestionHumana", "Gestión Humana"],
  ["facturacion", "Área de facturación"],
  ["legal", "Coordinador de Asuntos Legales y Contractuales"],
  ["proyectos", "Director de Proyectos"],
  ["financiera", "Área financiera"],
  ["gerencia", "Gerencia"]
];

async function llamar(metodo, ruta, cuerpo) {
  const resp = await fetch(CAMUNDA + ruta, {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  if (!resp.ok) throw new Error(`${metodo} ${ruta} respondió ${resp.status}: ${await resp.text()}`);
  const texto = await resp.text();
  return texto ? JSON.parse(texto) : null;
}

async function existe(tipo, id) {
  const r = await llamar("GET", `/${tipo}/count?id=${encodeURIComponent(id)}`);
  return r.count > 0;
}

async function crearUsuario(id, nombre, clave) {
  if (await existe("user", id)) return false;
  await llamar("POST", "/user/create", {
    profile: { id, firstName: nombre, lastName: "UT Llano Alianza" },
    credentials: { password: clave }
  });
  return true;
}

async function agregarAlGrupo(grupo, usuario) {
  const miembros = await llamar("GET", `/user?memberOfGroup=${encodeURIComponent(grupo)}&id=${encodeURIComponent(usuario)}`);
  if (!miembros.length) await llamar("PUT", `/group/${encodeURIComponent(grupo)}/members/${encodeURIComponent(usuario)}`);
}

(async () => {
  if (await crearUsuario("demo", "Demo", "demo")) console.log("Usuario demo creado (contraseña demo)");
  for (const [id, nombre] of GRUPOS) {
    if (!(await existe("group", id))) {
      await llamar("POST", "/group/create", { id, name: nombre, type: "WORKFLOW" });
    }
    const nuevo = await crearUsuario(id, nombre, id);
    await agregarAlGrupo(id, id);
    await agregarAlGrupo(id, "demo");
    console.log(`${id.padEnd(14)} ${nuevo ? "creado" : "ya existía"} - ${nombre}`);
  }
  console.log(`Listo: ${GRUPOS.length} grupos y usuarios en ${CAMUNDA}`);
})().catch((e) => {
  console.error("No se pudieron crear los usuarios:", e.message);
  console.error("Revisa que Camunda esté encendido en", CAMUNDA);
  process.exit(1);
});
