/* FitoDoc: lógica de la app (sin dependencias). */
(function () {
  const { SINTOMAS, CULTIVOS, PLAGAS } = window.KB;
  const $ = (s, el = document) => el.querySelector(s);
  const byId = Object.fromEntries(PLAGAS.map((p) => [p.id, p]));
  const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  let iaActiva = false;
  let fotoData = null;

  // --------- Pestañas ---------
  document.querySelectorAll(".tabs button").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", x === b));
      document.querySelectorAll(".panel").forEach((p) => (p.hidden = p.id !== "tab-" + b.dataset.tab));
      if (b.dataset.tab === "historial") renderHistorial();
      try { localStorage.setItem("fitodoc.tab", b.dataset.tab); } catch (e) {}
    })
  );
  try {
    const t = localStorage.getItem("fitodoc.tab");
    if (t) $(`.tabs button[data-tab="${t}"]`)?.click();
  } catch (e) {}

  // --------- Selectores de cultivo ---------
  document.querySelectorAll(".cultivo-select").forEach((sel) => {
    sel.innerHTML = `<option value="">Cualquiera / no sé</option>` + CULTIVOS.map((c) => `<option>${c}</option>`).join("");
  });

  // --------- Estado de la IA ---------
  // "servidor": el servidor tiene la clave. "local": clave gratuita de Gemini guardada en este dispositivo.
  let iaServidor = false;
  const leerClave = () => { try { return localStorage.getItem("fitodoc.gemini") || ""; } catch (e) { return ""; } };
  function actualizarIA() {
    const local = !iaServidor && !!leerClave();
    iaActiva = iaServidor || local;
    const badge = $("#ia-badge");
    badge.textContent = iaServidor ? "IA activa" : local ? "IA gratuita activa" : "Modo sin conexión";
    badge.classList.toggle("on", iaActiva);
    $("#sint-ia-btn").hidden = !iaActiva;
    $("#ajustes-ia").hidden = iaServidor;
    $("#ajustes-titulo").textContent = local ? "⚙️ IA gratuita (Gemini) conectada" : "⚙️ Activar IA gratuita para fotos";
    if (!iaActiva) $("#ajustes-ia").open = true;
    const aviso = $("#foto-aviso");
    aviso.hidden = iaActiva;
    aviso.textContent = "Para diagnosticar por foto, activa la IA gratuita arriba (toma 1 minuto). Mientras tanto, la pestaña Síntomas funciona sin internet.";
    $("#foto-btn").disabled = !(iaActiva && fotoData);
  }
  $("#gemini-key").value = leerClave();
  $("#gemini-guardar").addEventListener("click", () => {
    const k = $("#gemini-key").value.trim();
    try { k ? localStorage.setItem("fitodoc.gemini", k) : localStorage.removeItem("fitodoc.gemini"); } catch (e) {}
    actualizarIA();
    if (k) $("#ajustes-ia").open = false;
  });
  $("#gemini-borrar").addEventListener("click", () => {
    $("#gemini-key").value = "";
    try { localStorage.removeItem("fitodoc.gemini"); } catch (e) {}
    actualizarIA();
  });
  fetch("api/status")
    .then((r) => (r.ok ? r.json() : { ia: false }))
    .catch(() => ({ ia: false }))
    .then((s) => { iaServidor = !!s.ia; actualizarIA(); });

  // --------- Render de diagnósticos ---------
  function li(arr) {
    return (arr && arr.length ? arr : ["Sin recomendaciones específicas."]).map((t) => {
      const e = document.createElement("li"); e.textContent = t; return e;
    });
  }
  function tarjeta(d) {
    const n = $("#tpl-diag").content.cloneNode(true);
    $(".d-nombre", n).textContent = d.nombre;
    $(".d-cient", n).textContent = d.cientifico || "";
    $(".d-tipo", n).textContent = [d.tipo, d.cultivos ? "Cultivos: " + d.cultivos.map((c) => (c === "todos" ? "muchos cultivos" : c)).join(", ") : ""].filter(Boolean).join(" · ");
    $(".d-desc", n).textContent = d.descripcion || d.por_que || "";
    const conf = $(".conf", n);
    if (d.confianza) { conf.textContent = "Confianza " + d.confianza; conf.dataset.nivel = d.confianza; } else conf.remove();
    $(".d-cultural", n).append(...li(d.cultural));
    $(".d-bio", n).append(...li(d.biologico));
    $(".d-quim", n).append(...li(d.quimico));
    $(".d-prev", n).textContent = d.prevencion ? "Prevención: " + d.prevencion : "";
    if (d.severidad === "alta") $(".d-tipo", n).textContent += " · ⚠️ Severidad alta";
    return n;
  }

  function renderIA(cont, r) {
    cont.innerHTML = "";
    if (r.alerta) {
      const a = document.createElement("p"); a.className = "alerta"; a.textContent = "⚠️ " + r.alerta; cont.append(a);
    }
    if (!r.es_planta) {
      const p = document.createElement("p"); p.className = "aviso";
      p.textContent = r.siguiente_paso || "No se reconoce una planta en la imagen. Intenta con otra foto.";
      cont.append(p); return;
    }
    const obs = document.createElement("p"); obs.className = "obs";
    obs.textContent = (r.cultivo_detectado ? `Cultivo: ${r.cultivo_detectado}. ` : "") + (r.que_observe || "");
    cont.append(obs);
    r.diagnosticos.forEach((d, i) => {
      const kb = d.kb_id && byId[d.kb_id];
      const t = tarjeta({ ...d, descripcion: d.por_que, severidad: kb?.severidad });
      if (i > 0) t.querySelector("details").open = false;
      const h = document.createElement("h2"); h.textContent = i === 0 ? "Diagnóstico más probable" : "Alternativa " + i;
      cont.append(h, t);
    });
    if (r.siguiente_paso) { const s = document.createElement("p"); s.className = "obs"; s.textContent = "Siguiente paso: " + r.siguiente_paso; cont.append(s); }
  }

  async function consultarIA({ image, cultivo, descripcion }, cont, btn) {
    btn.disabled = true;
    const txt = btn.textContent; btn.textContent = "Analizando…";
    cont.innerHTML = `<p class="cargando">Analizando con IA, esto puede tardar unos segundos…</p>`;
    try {
      let data;
      if (iaServidor) {
        const r = await fetch("api/diagnose", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image, cultivo, descripcion }),
        });
        data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || "No se pudo completar el diagnóstico.");
      } else {
        data = await window.IA.llamarGemini({ image, cultivo, descripcion }, leerClave()).catch((e) => {
          throw new Error(e instanceof TypeError ? "No hay conexión con el servicio de IA. Revisa tu internet." : e.message);
        });
      }
      renderIA(cont, data);
      guardarHistorial({ modo: image ? "foto" : "síntomas (IA)", cultivo, descripcion, thumb: image ? await miniatura(image) : null, resultado: data });
    } catch (e) {
      cont.innerHTML = ""; const p = document.createElement("p"); p.className = "aviso"; p.textContent = e.message; cont.append(p);
    } finally { btn.disabled = false; btn.textContent = txt; }
  }

  // --------- Foto ---------
  $("#foto-input").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    fotoData = await reducir(f, 1280);
    const img = $("#foto-preview"); img.src = fotoData; img.hidden = false; $("#drop-text").hidden = true;
    actualizarIA();
  });
  $("#foto-btn").addEventListener("click", () =>
    consultarIA({ image: fotoData, cultivo: $("#foto-cultivo").value, descripcion: $("#foto-notas").value.trim() }, $("#foto-result"), $("#foto-btn"))
  );

  function reducir(file, max) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  async function miniatura(dataUrl) {
    const blob = await (await fetch(dataUrl)).blob();
    return reducir(blob, 160);
  }

  // --------- Síntomas (motor local) ---------
  const GRUPOS = {
    "Hojas": ["manchas_hojas", "manchas_amarillas", "manchas_anillos", "manchas_aceitosas", "halo_amarillo", "polvo_blanco", "pustulas_oxido", "moho_gris", "moho_enves", "amarillamiento", "mosaico", "hojas_enrolladas", "hojas_plateadas", "galerias", "hojas_comidas", "rayas_hojas", "fumagina", "melaza", "telaranas", "caida_hojas"],
    "Planta, tallo y raíz": ["marchitez", "enanismo", "volcamiento", "pudricion_tallo", "vasos_oscuros", "cancro", "exudado", "pudricion_raiz", "agallas_raiz"],
    "Bichos que se ven": ["insectos_pequenos", "moscas_blancas", "orugas", "escamas", "escarabajos", "caracoles"],
    "Frutos, flores y granos": ["pudricion_fruto", "manchas_fruto", "fondo_negro_fruto", "frutos_perforados", "caida_frutos", "mazorca_hongo"],
  };
  $("#sint-grupos").innerHTML = Object.entries(GRUPOS).map(([g, ids]) =>
    `<fieldset><legend>${g}</legend>${ids.map((id) =>
      `<label class="chip"><input type="checkbox" value="${id}"><span>${SINTOMAS[id]}</span></label>`).join("")}</fieldset>`
  ).join("");

  function puntuar(cultivo, marcados, texto) {
    const palabras = norm(texto).split(/[^a-zñ]+/).filter((w) => w.length > 3);
    const txt = norm(texto);
    return PLAGAS.map((p) => {
      let s = 0;
      const coinc = p.sintomas.filter((x) => marcados.includes(x));
      s += coinc.length * 3;
      if (marcados.length) s -= (marcados.length - coinc.length) * 0.5;
      if (cultivo) {
        if (p.cultivos.includes(cultivo)) s += 3;
        else if (p.cultivos.includes("todos")) s += 0.5;
        else s -= 4;
      }
      if (txt) {
        p.clave.forEach((k) => { if (txt.includes(norm(k))) s += 3; });
        const bolsa = norm([p.nombre, p.descripcion, p.clave.join(" "), p.sintomas.map((x) => SINTOMAS[x]).join(" ")].join(" "));
        palabras.forEach((w) => { if (bolsa.includes(w)) s += 0.7; });
        if (txt.includes(norm(p.nombre.split(" (")[0]))) s += 5;
      }
      return { p, s, coinc };
    }).filter((x) => x.s > 1).sort((a, b) => b.s - a.s).slice(0, 4)
      .filter((x, _, arr) => x.s >= arr[0].s * 0.4);
  }

  $("#sint-btn").addEventListener("click", () => {
    const cultivo = $("#sint-cultivo").value;
    const marcados = [...document.querySelectorAll("#sint-grupos input:checked")].map((i) => i.value);
    const texto = $("#sint-texto").value;
    const cont = $("#sint-result");
    cont.innerHTML = "";
    if (!marcados.length && !texto.trim()) {
      cont.innerHTML = `<p class="aviso">Marca al menos un síntoma o escribe una descripción.</p>`; return;
    }
    const res = puntuar(cultivo, marcados, texto);
    if (!res.length) {
      cont.innerHTML = `<p class="aviso">No encontré coincidencias claras. Prueba marcando más síntomas${iaActiva ? " o consulta a la IA" : ""}.</p>`; return;
    }
    const max = res[0].s;
    res.forEach(({ p, s }, i) => {
      const h = document.createElement("h2");
      h.textContent = i === 0 ? "Causa más probable" : "También podría ser";
      const conf = s >= max * 0.9 && s >= 8 ? "alta" : s >= 5 ? "media" : "baja";
      const t = tarjeta({ ...p, confianza: i === 0 ? conf : s >= 5 ? "media" : "baja" });
      if (i > 0) t.querySelector("details").open = false;
      cont.append(h, t);
    });
    guardarHistorial({ modo: "síntomas", cultivo, descripcion: [marcados.map((m) => SINTOMAS[m]).join(", "), texto].filter(Boolean).join(". "), resultado: { local: res.map((r) => r.p.id) } });
    cont.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("#sint-ia-btn").addEventListener("click", () => {
    const marcados = [...document.querySelectorAll("#sint-grupos input:checked")].map((i) => SINTOMAS[i.value]);
    const descripcion = [marcados.join(", "), $("#sint-texto").value.trim()].filter(Boolean).join(". ");
    if (!descripcion) { $("#sint-result").innerHTML = `<p class="aviso">Marca síntomas o escribe una descripción.</p>`; return; }
    consultarIA({ cultivo: $("#sint-cultivo").value, descripcion }, $("#sint-result"), $("#sint-ia-btn"));
  });

  // --------- Biblioteca ---------
  function renderBiblioteca() {
    const q = norm($("#bib-buscar").value);
    const cont = $("#bib-lista"); cont.innerHTML = "";
    PLAGAS.filter((p) => !q || norm([p.nombre, p.cientifico, p.tipo, p.cultivos.join(" "), p.clave.join(" ")].join(" ")).includes(q))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
      .forEach((p) => {
        const d = document.createElement("details"); d.className = "bib";
        const s = document.createElement("summary");
        s.innerHTML = `<strong></strong><small></small>`;
        s.querySelector("strong").textContent = p.nombre;
        s.querySelector("small").textContent = p.tipo;
        d.append(s, tarjeta(p));
        cont.append(d);
      });
    if (!cont.children.length) cont.innerHTML = `<p class="hint">Sin resultados.</p>`;
  }
  $("#bib-buscar").addEventListener("input", renderBiblioteca);
  renderBiblioteca();

  // --------- Historial (localStorage) ---------
  function leerHist() { try { return JSON.parse(localStorage.getItem("fitodoc.hist") || "[]"); } catch (e) { return []; } }
  function guardarHistorial(item) {
    try {
      const h = [{ ...item, fecha: new Date().toISOString() }, ...leerHist()].slice(0, 30);
      localStorage.setItem("fitodoc.hist", JSON.stringify(h));
    } catch (e) {}
  }
  function renderHistorial() {
    const cont = $("#hist-lista"); const h = leerHist();
    cont.innerHTML = h.length ? "" : `<p class="hint">Aún no hay diagnósticos.</p>`;
    h.forEach((it) => {
      const nombre = it.resultado?.diagnosticos?.[0]?.nombre || (it.resultado?.local?.[0] && byId[it.resultado.local[0]]?.nombre) || "Sin diagnóstico";
      const row = document.createElement("div"); row.className = "hist";
      if (it.thumb) { const im = document.createElement("img"); im.src = it.thumb; im.alt = ""; row.append(im); }
      const tx = document.createElement("div");
      tx.innerHTML = `<strong></strong><small></small>`;
      tx.querySelector("strong").textContent = nombre;
      tx.querySelector("small").textContent = `${new Date(it.fecha).toLocaleString("es")} · ${it.modo}${it.cultivo ? " · " + it.cultivo : ""}`;
      row.append(tx); cont.append(row);
    });
  }

  // --------- PWA ---------
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
