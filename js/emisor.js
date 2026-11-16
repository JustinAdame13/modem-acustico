// ============================================================
//  emisor.js — Envío de mensajes: tramas, daños a propósito y ARQ
//
//  Un mensaje se parte en tramas de 4, 8 o 16 bytes. Sin ARQ se mandan
//  todas seguidas (símplex). Con ARQ hay tres variantes (tema 2.5):
//    Pare y espere     : ventana de 1 trama; cada trama espera su respuesta.
//    Retroceda N       : ventana de 4; la respuesta dice desde cuál reenviar.
//    Rechazo selectivo : ventana de 4; la respuesta trae un mapa de las dañadas.
// ============================================================

const vistaTx = new VistaDeTrama($('trama-tx'), 'Aquí aparece la trama, bit por bit, cuando envíes un mensaje.');
const diagrama = new DiagramaDelEnlace($('diagrama'));

function opcionesDelEmisor() {
  const modo = Number(document.querySelector('input[name="modo"]:checked').value);
  return {
    modo,
    variante: modo === 2 ? Number(document.querySelector('input[name="variante"]:checked').value) : 0,
    entrelazado: modo === 3 && $('entrelazado').checked,
    paralelo: !ajustes.duplex && document.querySelector('input[name="transmision"]:checked').value === 'paralelo',
    tam: Number($('tam-trama').value),
  };
}

function nombreDeConfiguracion(o) {
  let nombre = MODOS[o.modo].nombre;
  if (o.modo === 2) nombre += ', ' + VARIANTES_ARQ[o.variante].nombre.toLowerCase();
  if (o.entrelazado) nombre += ', entrelazado';
  if (o.paralelo) nombre += ', en paralelo';
  return nombre;
}

function dividirEnTramas(bytes, tam) {
  const partes = [];
  for (let i = 0; i < bytes.length; i += tam) partes.push(bytes.slice(i, i + tam));
  return partes;
}

function recortar(texto, n) {
  return texto.length > n ? texto.slice(0, n - 1) + '…' : texto;
}

// Resumen bajo el mensaje: cuántas tramas y bits salen, y cuánto tarda.
function actualizarResumen() {
  const o = opcionesDelEmisor();
  const bytes = textoABytes($('mensaje').value);
  const salida = $('resumen-envio');
  if (bytes.length === 0) { salida.textContent = 'Escribe un mensaje para enviarlo.'; actualizarDondeDanar(1); return; }
  if (bytes.length > CONFIG.maxBytesMensaje) {
    salida.textContent = 'El mensaje ocupa ' + bytes.length + ' bytes; el máximo es ' + CONFIG.maxBytesMensaje + '.';
    return;
  }
  const partes = dividirEnTramas(bytes, o.tam);
  if (partes.length > CONFIG.maxTramas) {
    salida.textContent = 'Con tramas de ' + o.tam + ' bytes serían ' + partes.length + ' tramas; el máximo es ' +
      CONFIG.maxTramas + '. Elige tramas más grandes.';
    return;
  }
  let bits = 0, ranuras = 0;
  for (const parte of partes) {
    const t = construirTrama({ ...o, id: 0, num: 0, total: partes.length, pideRespuesta: false }, parte);
    for (const el of t.elementos) bits += el.bits.length;
    ranuras += ranurasDeTrama(t).length;
  }
  const porTrama = CONFIG.preambuloMs + CONFIG.bitsDeReposo * CONFIG.duracionBitMs + 90;
  const ms = partes.length * porTrama + ranuras * CONFIG.duracionBitMs + (partes.length - 1) * CONFIG.pausaEntreTramasMs;
  salida.textContent = plural(bytes.length, 'byte', 'bytes') + ' en ' + plural(partes.length, 'trama', 'tramas') + ': ' +
    bits + ' bits en el aire (' + Math.round(100 * bytes.length * 8 / bits) + ' % son datos útiles)' +
    (o.paralelo ? ' en ' + ranuras + ' ranuras de tiempo' : '') + '. Tarda ' + (ms / 1000).toFixed(1) + ' s a ' +
    baudios() + ' baudios' + (o.modo === 2 ? ', sin contar las respuestas.' : '.');
  actualizarDondeDanar(partes.length);
}

function actualizarDondeDanar(total) {
  const select = $('donde-danar');
  const antes = select.value;
  select.textContent = '';
  const opciones = total === 1 ? [['0', 'en la trama']]
    : [...Array.from({ length: total }, (_, i) => [String(i), 'en la trama ' + (i + 1)]), ['todas', 'en todas las tramas']];
  for (const [valor, texto] of opciones) select.add(new Option(texto, valor));
  select.value = opciones.some(([v]) => v === antes) ? antes : '0';
}

// ---------- Daños a propósito ----------

// Bits del cuerpo que se pueden voltear, en orden de tiempo (sin arranque, parada ni relleno).
function bitsDanables(elementos) {
  const lista = [];
  elementos.forEach((el, e) => {
    if (el.seccion === 'cabecera') return;
    el.bits.forEach((b, p) => { if (!['arranque', 'parada', 'relleno'].includes(b.tipo)) lista.push([e, p]); });
  });
  return lista;
}

// Sueltos: posiciones al azar. Ráfaga: bits seguidos, como un golpe de ruido.
function elegirDanos(elementos, cuantos, como) {
  const lista = bitsDanables(elementos);
  const n = Math.min(cuantos, lista.length);
  if (como === 'rafaga') {
    const inicio = Math.floor(Math.random() * (lista.length - n + 1));
    return lista.slice(inicio, inicio + n);
  }
  const elegidos = [];
  while (elegidos.length < n) elegidos.push(lista.splice(Math.floor(Math.random() * lista.length), 1)[0]);
  return elegidos;
}

function aplicarDanos(elementos, danos) {
  const copia = elementos.map((el) => ({ ...el, bits: el.bits.map((b) => ({ ...b })) }));
  for (const [e, p] of danos) {
    copia[e].bits[p].v ^= 1;
    copia[e].bits[p].estado = 'error';
  }
  return copia;
}

// ---------- Transmisión ----------

// Reproduce una trama y va resaltando la ranura que suena.
async function transmitirElementos(elementos) {
  const ranuras = ranurasDeTrama({ elementos });
  const muestras = sintetizar(tonosDeTrama(ranuras, CONFIG.duracionBitMs, bandaTx()), audio.ctx.sampleRate, CONFIG.volumen);
  const antes = 30 + CONFIG.preambuloMs + CONFIG.bitsDeReposo * CONFIG.duracionBitMs;
  let inicio = null;
  const reloj = setInterval(() => {
    if (inicio === null) return;
    const ms = (audio.ctx.currentTime - inicio) * 1000 - antes;
    vistaTx.marcarAvance(Math.max(-1, Math.floor(ms / CONFIG.duracionBitMs)));
  }, 25);
  await transmitir(muestras, (t) => { inicio = t; });
  clearInterval(reloj);
  vistaTx.marcarAvance(Infinity);
  estado.stats.enviadas++;
  estado.stats.bits += elementos.reduce((suma, el) => suma + el.bits.length, 0);
  pintarStats();
}

// Envía la trama "num" de un envío. Devuelve su fila en el diagrama.
async function enviarTrama(envio, num, pideRespuesta) {
  const intento = ++envio.intentos[num];
  if (intento > 1) estado.stats.retransmisiones++;
  const total = envio.base.total;
  const trama = construirTrama({ ...envio.base, num, pideRespuesta }, envio.partes[num]);

  const d = envio.danar;
  const toca = d && d.cuantos > 0 && intento === 1 && (d.donde === 'todas' || Number(d.donde) === num);
  const danos = toca ? elegirDanos(trama.elementos, d.cuantos, d.como) : [];
  const elementos = aplicarDanos(trama.elementos, danos);

  vistaTx.pintar(elementos, bandaTx());
  $('titulo-tx').textContent = (envio.titulo || 'Trama') + ' ' + (num + 1) + ' de ' + total +
    (intento > 1 ? ', ' + intento + '.º intento' : '');
  const fila = envio.sinDiagrama ? null : diagrama.trama(num, total, intento);
  if (!envio.silencioso) {
    anotar((intento > 1 ? 'Retransmisión de T' : 'Sale T') + (num + 1) + ' de ' + total +
      (pideRespuesta ? ', pide respuesta' : '') + (danos.length ? ', con ' + plural(danos.length, 'bit dañado', 'bits dañados') + ' a propósito' : ''));
  }
  fijarEstado('Transmitiendo trama ' + (num + 1) + ' de ' + total + ' a ' + baudios() + ' baudios', true);
  await transmitirElementos(elementos);
  return fila;
}

// Espera ACK o NACK. El temporizador se detiene en cuanto empieza a sonar la respuesta.
function esperarRespuesta() {
  return new Promise((resolver) => {
    let reloj = null;
    const terminar = (r) => {
      clearTimeout(reloj);
      estado.esperaRespuesta = null;
      resolver(r);
    };
    reloj = setTimeout(() => terminar({ tipo: 'tiempo' }), CONFIG.arq.esperaRespuestaMs);
    estado.esperaRespuesta = {
      alTono: () => {
        clearTimeout(reloj);
        const dura = duracionDeTonos(tonosDeRespuesta('ack', 0, CONFIG.duracionBitMs));
        reloj = setTimeout(() => terminar({ tipo: 'tiempo' }), dura + 1500);
      },
      alRespuesta: (datos) => terminar(datos),
    };
  });
}

async function enviarConARQ(envio) {
  const { total, variante } = envio.base;
  const m = VARIANTES_ARQ[variante].ventana;
  const confirmada = new Array(total).fill(false);
  let inicio = 0;     // primera trama de la ventana
  let fallas = 0;     // rondas seguidas sin avance

  while (inicio < total) {
    // Qué se envía en esta ronda: toda la ventana, o solo las pendientes (rechazo selectivo)
    const fin = Math.min(total, inicio + m);
    const lista = [];
    for (let i = inicio; i < fin; i++) if (variante !== 2 || !confirmada[i]) lista.push(i);
    const filas = [];
    for (let k = 0; k < lista.length; k++) {
      // Solo la última trama de la ventana pide respuesta
      filas.push(await enviarTrama(envio, lista[k], k === lista.length - 1));
      if (k < lista.length - 1) await pausa(CONFIG.pausaEntreTramasMs);
    }

    fijarEstado(m === 1 ? 'Pare y espere: aguardando ACK o NACK' : 'Ventana enviada: aguardando la respuesta', true);
    const r = await esperarRespuesta();
    let avance = false;

    if (r.tipo === 'tiempo' || r.byte === null) {
      filas.forEach((f) => diagrama.estadoDe(f, 'sinRespuesta'));
      diagrama.tiempoAgotado(r.tipo === 'tiempo' ? 'Temporizador agotado: se reenvía' : 'Respuesta ilegible: se reenvía');
      anotar(r.tipo === 'tiempo' ? 'Se agotó el temporizador (' + CONFIG.arq.esperaRespuestaMs / 1000 + ' s) sin respuesta.'
        : 'Llegó una respuesta que no se pudo leer.', 'mal');
    } else if (variante === 2) {
      // Rechazo selectivo: 4 bits altos = inicio de la ventana, 4 bajos = mapa (1 = llegó bien)
      const base = r.byte >> 4, mapa = r.byte & 15;
      const malas = [];
      lista.forEach((num, k) => {
        const i = num - base;
        const bien = i >= 0 && i < 4 && ((mapa >> i) & 1) === 1;
        if (bien && !confirmada[num]) { confirmada[num] = true; avance = true; }
        if (!bien) malas.push(num);
        diagrama.estadoDe(filas[k], bien ? 'ok' : 'danada');
      });
      const texto = malas.length === 0 ? 'ventana completa' : 'reenvía solo ' + malas.map((n) => 'T' + (n + 1)).join(' y ');
      diagrama.respuesta(r.tipo, texto);
      anotar('Llegó ' + r.tipo.toUpperCase() + ': ' + texto + '.', r.tipo === 'ack' ? 'bien' : 'mal');
      let todas = true;
      for (let i = inicio; i < fin; i++) if (!confirmada[i]) todas = false;
      if (todas) inicio = fin;
    } else {
      // Pare y espere / Retroceda N: 4 bits altos = siguiente trama que espera el receptor
      const n = r.byte >> 4;
      lista.forEach((num, k) => diagrama.estadoDe(filas[k], num < n ? 'ok' : (num === n ? 'danada' : 'descartada')));
      for (let i = 0; i < Math.min(n, total); i++) confirmada[i] = true;
      const texto = n >= total ? 'mensaje completo' : (n > lista[lista.length - 1] ? 'sigue con T' : 'reenvía desde T') + (n + 1);
      diagrama.respuesta(r.tipo, texto);
      anotar('Llegó ' + r.tipo.toUpperCase() + ': ' + texto + '.', r.tipo === 'ack' ? 'bien' : 'mal');
      if (n > inicio) avance = true;
      inicio = Math.min(n, total);
    }

    fallas = avance ? 0 : fallas + 1;
    if (fallas >= CONFIG.arq.maxFallas) {
      diagrama.tiempoAgotado('Comunicación abortada');
      anotar('Comunicación abortada: ' + fallas + ' rondas seguidas sin avance.', 'mal');
      return;
    }
    if (inicio < total) await pausa(350);
  }
  anotar('El receptor confirmó el mensaje completo (' + plural(total, 'trama', 'tramas') + ').', 'bien');
}

function bloquearEnvios(bloquear) {
  estado.enviando = bloquear;
  $('enviar').disabled = bloquear;
  $('enviar-serie').disabled = bloquear;
}

async function enviar() {
  if (estado.enviando) return;
  const o = opcionesDelEmisor();
  const texto = $('mensaje').value;
  const bytes = textoABytes(texto);
  const partes = dividirEnTramas(bytes, o.tam);
  if (bytes.length === 0 || bytes.length > CONFIG.maxBytesMensaje || partes.length > CONFIG.maxTramas) {
    actualizarResumen();
    $('mensaje').focus();
    return;
  }

  bloquearEnvios(true);
  try {
    await prepararAudio();
    // Con ARQ (o al probar con un solo dispositivo) el emisor también necesita oír.
    if (ajustes.canal === 'aire' && (o.modo === 2 || audio.eco) && !audio.microfonoActivo) await encenderMicrofono();

    estado.idMensaje ^= 1;
    estado.ultimoEnviado = texto;
    const envio = {
      base: { modo: o.modo, paralelo: o.paralelo, entrelazado: o.entrelazado, variante: o.variante,
        id: estado.idMensaje, total: partes.length },
      partes,
      intentos: new Array(partes.length).fill(0),
      danar: { cuantos: Math.max(0, Math.min(12, parseInt($('inyectar').value, 10) || 0)),
        como: $('como-danar').value, donde: $('donde-danar').value },
    };
    diagrama.mensaje('«' + recortar(texto, 22) + '» en ' + plural(partes.length, 'trama', 'tramas') + ', ' + nombreDeConfiguracion(o));
    anotar('Se envía «' + recortar(texto, 40) + '» en ' + plural(partes.length, 'trama', 'tramas') + ' (' + nombreDeConfiguracion(o) + ').');

    if (o.modo === 2) {
      await enviarConARQ(envio);
    } else {
      for (let num = 0; num < partes.length; num++) {
        const fila = await enviarTrama(envio, num, false);
        diagrama.estadoDe(fila, 'simplex');
        if (num < partes.length - 1) await pausa(CONFIG.pausaEntreTramasMs);
      }
    }
  } catch (error) {
    anotar(error.message, 'mal');
  } finally {
    bloquearEnvios(false);
    pintarStats();
    estadoDeReposo();
  }
}
