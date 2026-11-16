// ============================================================
//  app.js — Une todo: botones, emisor (con ARQ), receptor y estadísticas
// ============================================================

const $ = (id) => document.getElementById(id);
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

const estado = {
  secuencia: 0,            // bit que alterna en cada mensaje nuevo (ARQ)
  enviando: false,
  ultimoEnviado: null,
  ultimaRespuesta: null,   // 'ack' o 'nack' oído después del último envío
  alLlegarRespuesta: null,
  ultimoAceptado: null,    // para reconocer retransmisiones duplicadas
  bytesEnCurso: [],
  pruebas: [],
  stats: { enviadas: 0, bits: 0, correctas: 0, danadas: 0, detectados: 0, corregidos: 0, retransmisiones: 0 },
};

let demodulador = null;
const vistaTx = new VistaDeTrama($('trama-tx'));
const vistaRx = new VistaDeTrama($('trama-rx'));
$('trama-tx').innerHTML = '<p class="vacio">Aquí aparece la trama, bit por bit, cuando envíes un mensaje.</p>';
$('trama-rx').innerHTML = '<p class="vacio">Los bits se dibujan aquí conforme llegan.</p>';

// ---------- Utilidades de pantalla ----------

function fijarEstado(texto, activo) {
  $('estado-linea').textContent = texto;
  $('estado-linea').dataset.activo = activo ? 'si' : 'no';
}

function estadoDeReposo() {
  if (!audio.ctx) return;
  const escucha = audio.canal === 'interno' || audio.microfonoActivo;
  fijarEstado(escucha ? 'Escuchando: en espera de un preámbulo' : 'Audio encendido. El micrófono está apagado.', escucha);
}

function anotar(texto, tipo) {
  const lista = $('bitacora');
  const vacio = lista.querySelector('.vacio');
  if (vacio) vacio.remove();
  const li = document.createElement('li');
  if (tipo) li.dataset.tipo = tipo;
  const hora = document.createElement('time');
  hora.textContent = new Date().toLocaleTimeString('es-MX', { hour12: false });
  const cuerpo = document.createElement('span');
  cuerpo.textContent = texto;
  li.append(hora, cuerpo);
  lista.prepend(li);
}

function pintarStats() {
  for (const clave of Object.keys(estado.stats)) $('s-' + clave).textContent = estado.stats[clave];
}

function modoElegido() {
  return Number(document.querySelector('input[name="modo"]:checked').value);
}

function baudios() {
  return Math.round(1000 / CONFIG.duracionBitMs);
}

// Resumen bajo el mensaje: cuántos bits salen y cuánto tarda.
function actualizarResumen() {
  const texto = $('mensaje').value;
  const bytes = textoABytes(texto).length;
  if (bytes === 0) { $('resumen-envio').textContent = 'Escribe un mensaje para enviarlo.'; return; }
  if (bytes > CONFIG.maxBytesMensaje) {
    $('resumen-envio').textContent = 'El mensaje ocupa ' + bytes + ' bytes; el máximo es ' + CONFIG.maxBytesMensaje + '.';
    return;
  }
  const bits = valoresDeTrama(construirTrama(texto, modoElegido(), 0)).length;
  const segundos = (CONFIG.preambuloMs + (CONFIG.bitsDeReposo + bits) * CONFIG.duracionBitMs) / 1000;
  const utiles = bytes * 8;
  $('resumen-envio').textContent = bytes + (bytes === 1 ? ' byte' : ' bytes') + ' de mensaje se vuelven ' + bits +
    ' bits en el aire (' + Math.round(100 * utiles / bits) + ' % son datos útiles). Tarda ' +
    segundos.toFixed(1) + ' s a ' + baudios() + ' baudios.';
}

// ---------- Audio ----------

async function prepararAudio() {
  await iniciarAudio();
  if (demodulador) return;
  demodulador = new Demodulador(audio.ctx.sampleRate, alEvento);
  demodulador.fijarVelocidad(CONFIG.duracionBitMs);
  audio.alRecibirMuestras = (muestras) => demodulador.alimentar(muestras);
  audio.alVolverAEscuchar = () => demodulador.reiniciar();
  estadoDeReposo();
}

async function encenderMicrofono() {
  try {
    await activarMicrofono();
  } catch (error) {
    const sinPermiso = error.name === 'NotAllowedError' || error.name === 'SecurityError';
    throw new Error(sinPermiso
      ? 'El navegador bloqueó el micrófono. Permítelo en el candado de la barra de direcciones y vuelve a intentar.'
      : 'No se pudo abrir el micrófono: ' + error.message);
  }
  pintarMicrofono();
}

function pintarMicrofono() {
  const boton = $('escuchar');
  const interno = audio.canal === 'interno';
  boton.disabled = interno;
  boton.setAttribute('aria-pressed', audio.microfonoActivo && !interno ? 'true' : 'false');
  boton.textContent = audio.microfonoActivo && !interno ? 'Dejar de escuchar' : 'Escuchar';
  $('mic-estado').textContent = interno
    ? 'En el canal interno el receptor oye directo al emisor; no usa micrófono.'
    : (audio.microfonoActivo ? 'Micrófono encendido. Acerca la bocina del emisor.' : 'El micrófono está apagado.');
  estadoDeReposo();
}

// ---------- EMISOR ----------

// Elige al azar qué bits voltear (solo datos y CRC; nunca arranque ni parada).
function elegirBitsADanar(trama, cuantos) {
  const candidatos = [];
  let n = 0;
  for (const c of trama.caracteres) {
    for (const b of c.bits) {
      if (c.seccion !== 'cabecera' && b.tipo !== 'arranque' && b.tipo !== 'parada') candidatos.push(n);
      n++;
    }
  }
  const elegidos = [];
  while (elegidos.length < cuantos && candidatos.length > 0) {
    elegidos.push(candidatos.splice(Math.floor(Math.random() * candidatos.length), 1)[0]);
  }
  return elegidos;
}

// Reproduce la trama y va resaltando el bit que suena.
async function transmitirConAvance(valores) {
  const muestras = sintetizar(tonosDeTrama(valores, CONFIG.duracionBitMs), audio.ctx.sampleRate, CONFIG.volumen);
  const fin = transmitir(muestras);
  const antesDeLosBits = 30 + CONFIG.preambuloMs + CONFIG.bitsDeReposo * CONFIG.duracionBitMs;
  const reloj = setInterval(() => {
    const ms = (audio.ctx.currentTime - audio.inicioTx) * 1000 - antesDeLosBits;
    vistaTx.marcarAvance(Math.max(-1, Math.floor(ms / CONFIG.duracionBitMs)));
  }, 25);
  await fin;
  clearInterval(reloj);
  vistaTx.marcarAvance(Infinity);
}

// Espera el ACK o NACK del receptor, o a que se agote el temporizador.
function esperarRespuesta() {
  return new Promise((resolver) => {
    if (estado.ultimaRespuesta) { resolver(estado.ultimaRespuesta); return; }
    const temporizador = setTimeout(() => {
      estado.alLlegarRespuesta = null;
      resolver('tiempo');
    }, CONFIG.arq.esperaRespuestaMs);
    estado.alLlegarRespuesta = (tipo) => {
      clearTimeout(temporizador);
      estado.alLlegarRespuesta = null;
      resolver(tipo);
    };
  });
}

async function enviar() {
  if (estado.enviando) return;
  const texto = $('mensaje').value;
  const bytes = textoABytes(texto).length;
  if (bytes === 0 || bytes > CONFIG.maxBytesMensaje) { actualizarResumen(); $('mensaje').focus(); return; }
  const modo = modoElegido();
  const conARQ = modo === 2;

  estado.enviando = true;
  $('enviar').disabled = true;
  try {
    await prepararAudio();
    // Con ARQ (o al probar con un solo dispositivo) el emisor también necesita oír.
    if (audio.canal === 'aire' && (conARQ || audio.eco) && !audio.microfonoActivo) await encenderMicrofono();

    estado.secuencia ^= 1;
    estado.ultimoEnviado = texto;
    const trama = construirTrama(texto, modo, estado.secuencia);   // queda guardada por si hay que retransmitir
    const cuantosDanar = Math.max(0, Math.min(8, parseInt($('inyectar').value, 10) || 0));

    for (let intento = 1; ; intento++) {
      const valores = valoresDeTrama(trama);
      const danados = intento === 1 ? elegirBitsADanar(trama, cuantosDanar) : [];
      for (const i of danados) valores[i] ^= 1;
      vistaTx.pintar(trama, danados);

      estado.ultimaRespuesta = null;
      if (intento > 1) estado.stats.retransmisiones++;
      anotar((intento === 1 ? 'Se envía «' + texto + '» en modo ' + MODOS[modo].nombre : 'Retransmisión, intento ' + intento) +
        ' (' + valores.length + ' bits' + (danados.length ? ', ' + danados.length + (danados.length === 1 ? ' dañado' : ' dañados') + ' a propósito' : '') + ')');
      fijarEstado('Transmitiendo ' + valores.length + ' bits a ' + baudios() + ' baudios', true);
      await transmitirConAvance(valores);
      estado.stats.enviadas++;
      estado.stats.bits += valores.length;
      pintarStats();

      if (!conARQ) break;

      // --- ARQ pare y espere ---
      fijarEstado('Pare y espere: aguardando ACK o NACK', true);
      const respuesta = await esperarRespuesta();
      if (respuesta === 'ack') { anotar('Llegó ACK: el receptor confirmó el mensaje.', 'bien'); break; }
      anotar(respuesta === 'nack'
        ? 'Llegó NACK: el receptor detectó errores y pide retransmisión.'
        : 'Se agotó el temporizador (' + CONFIG.arq.esperaRespuestaMs / 1000 + ' s) sin respuesta.', 'mal');
      if (intento >= CONFIG.arq.maxIntentos) {
        anotar('Comunicación abortada después de ' + intento + ' intentos.', 'mal');
        break;
      }
      await pausa(350);
    }
  } catch (error) {
    anotar(error.message, 'mal');
  } finally {
    estado.enviando = false;
    $('enviar').disabled = false;
    pintarStats();
    estadoDeReposo();
  }
}

// ---------- RECEPTOR ----------

// El demodulador avisa aquí de todo lo que va pasando.
function alEvento(nombre, d) {
  if (nombre === 'preambulo') {
    vistaRx.limpiar();
    vistaRx.preambulo();
    estado.bytesEnCurso = [];
    $('recibido').dataset.tipo = 'recibiendo';
    $('veredicto').textContent = 'Recibiendo…';
    $('texto-recibido').textContent = '';
    $('detalles').textContent = '';
    if (!estado.enviando) fijarEstado('Preámbulo detectado: está llegando un mensaje', true);
  } else if (nombre === 'caracter-inicio') {
    vistaRx.iniciarCaracter(d.seccion, d.tipos);
  } else if (nombre === 'bit') {
    vistaRx.bit(d.indice, d.valor);
  } else if (nombre === 'caracter') {
    vistaRx.terminarCaracter(d);
    if (d.seccion === 'datos') {
      estado.bytesEnCurso.push(d.byte);
      $('texto-recibido').textContent = bytesATexto(estado.bytesEnCurso);
    }
  } else if (nombre === 'sin-sincronia') {
    $('recibido').dataset.tipo = 'espera';
    $('veredicto').textContent = 'Esperando un mensaje';
    if (!estado.enviando) estadoDeReposo();
  } else if (nombre === 'trama') {
    procesarTrama(d);
  } else if (nombre === 'respuesta') {
    estado.ultimaRespuesta = d.tipo;
    if (estado.alLlegarRespuesta) estado.alLlegarRespuesta(d.tipo);
  }
}

// Cuenta bits distintos entre lo que llegó y lo que debió llegar.
function contarBitsErroneos(r) {
  const esperado = $('esperado').value || ((audio.canal === 'interno' || audio.eco) ? estado.ultimoEnviado : '');
  if (!esperado || !r.cabeceraOk) return null;
  const correctos = valoresDeTrama(construirTrama(esperado, r.modo, r.secuencia));
  let recibidos = [];
  for (const c of r.caracteres) recibidos = recibidos.concat(c.valoresCrudos);
  if (recibidos.length !== correctos.length) return null;
  let errores = 0;
  for (let i = 0; i < correctos.length; i++) if (correctos[i] !== recibidos[i]) errores++;
  return { errores, total: correctos.length };
}

function procesarTrama(r) {
  // 1. Veredicto
  let veredicto, tipo;
  if (!r.cabeceraOk) {
    veredicto = 'Cabecera dañada: no se pudo leer la trama'; tipo = 'mal';
  } else if (r.aborto) {
    veredicto = 'Mensaje incompleto. ' + r.aborto; tipo = 'mal';
  } else if (r.modo === 0) {
    veredicto = 'Recibido sin verificar: puede traer errores y no hay forma de saberlo'; tipo = 'espera';
  } else if (r.valido) {
    veredicto = r.bitsCorregidos > 0
      ? 'Mensaje correcto. Hamming corrigió ' + r.bitsCorregidos + (r.bitsCorregidos === 1 ? ' bit' : ' bits') + ' y el CRC coincide'
      : 'Mensaje correcto: el CRC coincide';
    tipo = 'bien';
  } else {
    veredicto = r.modo === 3
      ? 'Mensaje dañado: hubo más de un error en un grupo y Hamming no alcanzó'
      : 'Mensaje dañado: ' + (r.erroresDeParidad > 0 ? 'falló la paridad en ' + r.erroresDeParidad +
        (r.erroresDeParidad === 1 ? ' carácter' : ' caracteres') + (r.crcOk === false ? ' y el CRC no coincide' : '') : 'el CRC no coincide');
    tipo = 'mal';
  }
  const duplicado = r.valido && r.modo === 2 && estado.ultimoAceptado === r.secuencia + ':' + r.texto;
  if (duplicado) veredicto = 'Retransmisión repetida de un mensaje que ya se había recibido bien';
  if (r.valido && r.modo === 2) estado.ultimoAceptado = r.secuencia + ':' + r.texto;

  $('recibido').dataset.tipo = tipo;
  $('veredicto').textContent = veredicto;
  $('texto-recibido').textContent = r.texto;

  // 2. Detalles de la verificación
  const bitsMalos = contarBitsErroneos(r);
  const detalles = [];
  if (r.cabeceraOk) {
    detalles.push(['Modo', MODOS[r.modo].nombre]);
    if (r.crcRecibido !== null) {
      detalles.push(['CRC recibido', aHex(r.crcRecibido, 4)]);
      detalles.push(['CRC calculado', aHex(r.crcCalculado, 4)]);
    }
    if (r.modo === 1 || r.modo === 2) detalles.push(['Errores de paridad', r.erroresDeParidad]);
    if (r.bitsCorregidos > 0) detalles.push(['Bits corregidos', r.bitsCorregidos]);
  }
  if (bitsMalos) detalles.push(['Bits erróneos en el aire', bitsMalos.errores + ' de ' + bitsMalos.total]);
  $('detalles').textContent = '';
  for (const [nombre, valor] of detalles) {
    const fila = document.createElement('div');
    const dt = document.createElement('dt'); dt.textContent = nombre;
    const dd = document.createElement('dd'); dd.textContent = valor;
    fila.append(dt, dd);
    $('detalles').append(fila);
  }
  const nivel = 'Señal ' + r.nivelDb.toFixed(0) + ' dB';
  $('nivel-linea').textContent = r.snrDb === null ? nivel : nivel + ', ruido ' + r.ruidoDb.toFixed(0) + ' dB, S/N ' + r.snrDb.toFixed(0) + ' dB';

  // 3. Estadísticas y registro
  const s = estado.stats;
  if (tipo === 'bien' || (r.modo === 0 && r.cabeceraOk && !r.aborto)) s.correctas++; else s.danadas++;
  s.detectados += r.erroresDeParidad + (r.crcOk === false ? 1 : 0) + (r.cabeceraOk ? 0 : 1);
  s.corregidos += r.bitsCorregidos;
  pintarStats();

  estado.pruebas.push({
    modo: r.cabeceraOk ? MODOS[r.modo].nombre : '?',
    baudios: baudios(),
    resultado: tipo === 'bien' ? 'Correcto' : (tipo === 'mal' ? 'Dañado' : 'Sin verificar'),
    bien: tipo === 'bien', mal: tipo === 'mal',
    bitsMalos: bitsMalos ? bitsMalos.errores + ' de ' + bitsMalos.total : '',
    corregidos: r.bitsCorregidos,
    nivel: r.nivelDb.toFixed(0) + ' dB',
    snr: r.snrDb === null ? '' : r.snrDb.toFixed(0) + ' dB',
    nota: $('nota').value,
    texto: r.texto,
  });
  pintarRegistro();
  if (!estado.enviando) estadoDeReposo();

  // 4. ARQ: contestar con ACK o NACK después de una pausa breve
  if (r.cabeceraOk && r.modo === 2) {
    const respuesta = r.valido ? 'ack' : 'nack';
    setTimeout(async () => {
      anotar(respuesta === 'ack' ? 'Receptor: trama correcta, se contesta ACK.' : 'Receptor: trama dañada, se contesta NACK.',
        respuesta === 'ack' ? 'bien' : 'mal');
      await transmitir(sintetizar(tonoDeRespuesta(respuesta), audio.ctx.sampleRate, CONFIG.volumen));
    }, CONFIG.arq.pausaAntesDeResponderMs);
  }
}

// ---------- Registro de pruebas ----------

function pintarRegistro() {
  const cuerpo = $('registro');
  cuerpo.textContent = '';
  if (estado.pruebas.length === 0) {
    cuerpo.innerHTML = '<tr class="vacio"><td colspan="9">Cada mensaje recibido agrega un renglón.</td></tr>';
    return;
  }
  estado.pruebas.forEach((p, i) => {
    const tr = document.createElement('tr');
    const celdas = [i + 1, p.modo, p.baudios, p.resultado, p.bitsMalos, p.corregidos, p.nivel, p.snr, p.nota];
    celdas.forEach((valor, k) => {
      const td = document.createElement('td');
      td.textContent = valor;
      if (k === 3) td.className = p.bien ? 'bien' : (p.mal ? 'mal' : '');
      tr.append(td);
    });
    cuerpo.prepend(tr);
  });
}

function descargarCSV() {
  const comillas = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  const lineas = ['prueba,modo,baudios,resultado,bits_erroneos,bits_corregidos,nivel,senal_ruido,nota,texto_recibido'];
  estado.pruebas.forEach((p, i) => {
    lineas.push([i + 1, p.modo, p.baudios, p.resultado, p.bitsMalos, p.corregidos, p.nivel, p.snr, p.nota, p.texto].map(comillas).join(','));
  });
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv' }));
  enlace.download = 'pruebas-modem-acustico.csv';
  enlace.click();
}

// ---------- Arranque de la página ----------

function iniciarPagina() {
  // Tarjetas de los cuatro modos
  for (const modo of MODOS) {
    const etiqueta = document.createElement('label');
    etiqueta.className = 'modo';
    etiqueta.innerHTML = '<input type="radio" name="modo" value="' + modo.id + '"' + (modo.id === 1 ? ' checked' : '') + '>' +
      '<span class="modo-cuerpo"><span class="modo-nombre">' + modo.nombre + '</span>' +
      '<span class="modo-detalle">' + modo.detalle + '</span></span>';
    $('lista-modos').append(etiqueta);
  }

  $('enviar').addEventListener('click', enviar);
  $('mensaje').addEventListener('input', actualizarResumen);
  $('lista-modos').addEventListener('change', actualizarResumen);

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

  $('velocidad').addEventListener('change', () => {
    CONFIG.duracionBitMs = Number($('velocidad').value);
    if (demodulador) { demodulador.fijarVelocidad(CONFIG.duracionBitMs); demodulador.reiniciar(); }
    actualizarResumen();
  });

  for (const radio of document.querySelectorAll('input[name="canal"]')) {
    radio.addEventListener('change', () => {
      audio.canal = radio.value;
      const interno = audio.canal === 'interno';
      document.querySelector('.solo-interno').hidden = !interno;
      document.querySelector('.solo-aire').hidden = interno;
      aplicarCanal();
      if (demodulador) demodulador.reiniciar();
      pintarMicrofono();
    });
  }

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

  $('reiniciar-stats').addEventListener('click', () => {
    for (const clave of Object.keys(estado.stats)) estado.stats[clave] = 0;
    pintarStats();
  });
  $('exportar').addEventListener('click', descargarCSV);
  $('limpiar').addEventListener('click', () => { estado.pruebas = []; pintarRegistro(); });

  actualizarResumen();
  iniciarPantalla();
}

iniciarPagina();
