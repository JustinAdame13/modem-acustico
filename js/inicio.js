// ============================================================
//  inicio.js — Arranque de la página: conecta botones y ajustes
// ============================================================

// Muestra u oculta lo que solo aplica en ciertos casos (clases solo-*).
function actualizarVisibilidad() {
  const modo = Number(document.querySelector('input[name="modo"]:checked').value);
  const condiciones = {
    'solo-aire': ajustes.canal === 'aire',
    'solo-interno': ajustes.canal === 'interno',
    'solo-half': !ajustes.duplex,
    'solo-full': ajustes.duplex,
    'solo-arq': modo === 2,
    'solo-hamming': modo === 3,
  };
  document.querySelectorAll('[class*="solo-"]').forEach((el) => {
    let visible = true;
    for (const c of el.classList) if (c in condiciones && !condiciones[c]) visible = false;
    el.hidden = !visible;
  });
}

// Qué tonos se marcan sobre el espectro
function actualizarPantalla() {
  fijarModoDePantalla(ajustes.duplex ? 'duplex' : (estado.ultimoParalelo ? 'paralelo' : 'normal'));
}

function crearOpcion(nombre, valor, titulo, detalle, marcada) {
  const etiqueta = document.createElement('label');
  etiqueta.className = 'modo';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = nombre;
  input.value = valor;
  input.checked = marcada;
  const cuerpo = document.createElement('span');
  cuerpo.className = 'modo-cuerpo';
  const t = document.createElement('span');
  t.className = 'modo-nombre';
  t.textContent = titulo;
  const d = document.createElement('span');
  d.className = 'modo-detalle';
  d.textContent = detalle;
  cuerpo.append(t, d);
  etiqueta.append(input, cuerpo);
  return etiqueta;
}

// Full dúplex: solo por el aire, sin ARQ y en serie.
function cambiarSentido(full) {
  ajustes.duplex = full;
  audio.duplex = full;
  const interno = document.querySelector('input[name="canal"][value="interno"]');
  const arq = document.querySelector('input[name="modo"][value="2"]');
  const paralelo = document.querySelector('input[name="transmision"][value="paralelo"]');
  if (full) {
    if (interno.checked) { document.querySelector('input[name="canal"][value="aire"]').checked = true; cambiarCanal('aire'); }
    if (arq.checked) document.querySelector('input[name="modo"][value="1"]').checked = true;
    if (paralelo.checked) document.querySelector('input[name="transmision"][value="serie"]').checked = true;
  }
  for (const input of [interno, arq, paralelo]) {
    input.disabled = full;
    input.closest('label').title = full ? 'No disponible en full dúplex' : '';
  }
  if (demodulador) demodulador.fijarBanda(bandaRx(), ajustes.duplex);
  actualizarPantalla();
  actualizarVisibilidad();
  actualizarResumen();
  pintarMicrofono();
}

function cambiarCanal(canal) {
  ajustes.canal = canal;
  audio.canal = canal;
  aplicarCanal();
  if (demodulador) demodulador.reiniciar();
  actualizarVisibilidad();
  pintarMicrofono();
}

function iniciarPagina() {
  // Tarjetas de modos y variantes del ARQ
  for (const m of MODOS) $('lista-modos').append(crearOpcion('modo', m.id, m.nombre, m.detalle, m.id === 1));
  for (const v of VARIANTES_ARQ) {
    const etiqueta = document.createElement('label');
    etiqueta.title = v.detalle;
    const input = document.createElement('input');
    input.type = 'radio'; input.name = 'variante'; input.value = v.id; input.checked = v.id === 0;
    const texto = document.createElement('span');
    texto.textContent = v.nombre;
    etiqueta.append(input, texto);
    $('variantes').append(etiqueta);
  }

  // Emisor
  $('enviar').addEventListener('click', enviar);
  $('mensaje').addEventListener('input', actualizarResumen);
  $('tam-trama').addEventListener('change', actualizarResumen);
  $('lista-modos').addEventListener('change', () => { actualizarVisibilidad(); actualizarResumen(); });
  $('entrelazado').addEventListener('change', actualizarResumen);
  for (const r of document.querySelectorAll('input[name="transmision"]')) {
    r.addEventListener('change', () => {
      estado.ultimoParalelo = r.value === 'paralelo';
      actualizarPantalla();
      actualizarResumen();
    });
  }

  // Receptor
  $('escuchar').addEventListener('click', async () => {
    try {
      await prepararAudio();
      if (audio.microfonoActivo) apagarMicrofono(); else await encenderMicrofono();
    } catch (error) {
      anotar(error.message, 'mal');
      $('mic-estado').textContent = error.message;
    }
    pintarMicrofono();
  });

  // Enlace
  for (const r of document.querySelectorAll('input[name="canal"]')) r.addEventListener('change', () => cambiarCanal(r.value));
  for (const r of document.querySelectorAll('input[name="sentido"]')) r.addEventListener('change', () => cambiarSentido(r.value === 'full'));
  for (const r of document.querySelectorAll('input[name="estacion"]')) {
    r.addEventListener('change', () => {
      ajustes.estacion = r.value;
      if (demodulador) demodulador.fijarBanda(bandaRx(), ajustes.duplex);
      estadoDeReposo();
    });
  }
  $('velocidad').addEventListener('change', () => {
    CONFIG.duracionBitMs = Number($('velocidad').value);
    if (demodulador) { demodulador.fijarVelocidad(CONFIG.duracionBitMs); demodulador.reiniciar(); }
    actualizarResumen();
  });
  $('eco').addEventListener('change', () => { audio.eco = $('eco').checked; });
  $('atenuacion').addEventListener('input', () => {
    audio.ajustes.atenuacionDb = Number($('atenuacion').value);
    $('atenuacion-valor').textContent = audio.ajustes.atenuacionDb + ' dB';
    aplicarCanal();
  });
  $('ruido').addEventListener('input', () => {
    audio.ajustes.ruido = Number($('ruido').value);
    $('ruido-valor').textContent = audio.ajustes.ruido + ' %';
    aplicarCanal();
  });
  $('monitor').addEventListener('change', () => { audio.ajustes.monitor = $('monitor').checked; aplicarCanal(); });
  $('golpe').addEventListener('click', () => { golpeDeRuido(); anotar('Golpe de ruido en el canal (ruido de impulso, 150 ms).'); });

  // Estadísticas, diagrama y mediciones
  $('reiniciar-stats').addEventListener('click', () => {
    for (const clave of Object.keys(estado.stats)) estado.stats[clave] = 0;
    pintarStats();
  });
  $('limpiar-diagrama').addEventListener('click', () => diagrama.limpiar());
  $('enviar-serie').addEventListener('click', enviarSerie);
  $('exportar').addEventListener('click', descargarCSV);
  $('limpiar').addEventListener('click', () => {
    estado.registro = [];
    estado.mediciones = [];
    pintarRegistro();
    pintarResumen();
    dibujarGraficas();
  });

  actualizarVisibilidad();
  actualizarResumen();
  pintarStats();
  pintarTira();
  pintarMatriz(null);
  iniciarPantalla();
  iniciarGraficas();
}

iniciarPagina();
