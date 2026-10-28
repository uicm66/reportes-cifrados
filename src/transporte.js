// Cliente del buzón. En las pruebas habla con un buzón de mentira en la misma computadora; con el buzón real
// se cambia SIN tocar el resto de la app: solo se reemplaza este archivo (misma interfaz).
export function crearTransporte(base) {
  base = base || "";
  async function pedir(ruta, opciones) {
    const r = await fetch(base + ruta, opciones);
    let cuerpo = null;
    try { cuerpo = await r.json(); } catch (e) { /* sin cuerpo */ }
    if (!r.ok) { const err = new Error((cuerpo && cuerpo.error) || ("Error " + r.status)); err.estado = r.status; throw err; }
    return cuerpo;
  }
  return {
    publicar: function (env) { return pedir("/api/mensajes", { method: "POST", body: JSON.stringify(env) }); },
    pendientes: function (kid) { return pedir("/api/mensajes?kid=" + encodeURIComponent(kid)); },
    confirmar: function (id, kid) { return pedir("/api/mensajes/" + encodeURIComponent(id) + "?kid=" + encodeURIComponent(kid), { method: "DELETE" }); },
    lista: function () { return pedir("/api/lista"); },
    ponerLista: function (lista) { return pedir("/api/lista", { method: "PUT", body: JSON.stringify(lista) }); },
    espejo: function () { return pedir("/api/espejo"); }
  };
}
