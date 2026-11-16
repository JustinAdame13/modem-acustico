// ============================================================
//  app.js — Estado compartido y utilidades de la página
//  (el emisor está en emisor.js, el receptor en receptor.js,
//   las mediciones en experimento.js y el arranque en inicio.js)
// ============================================================

const $ = (id) => document.getElementById(id);
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// Configuración del enlace (la eligen los botones de arriba)
const ajustes = {
  canal: 'aire',     // 'aire' o 'interno'
  duplex: false,     // full dúplex
  estacion: 'A',     // en full dúplex: banda en la que transmite este dispositivo
};

// Banda en la que se transmite y banda que se escucha
function bandaTx() { return ajustes.duplex ? ajustes.estacion : 'normal'; }
function bandaRx() { return ajustes.duplex ? (ajustes.estacion === 'A' ? 'B' : 'A') : 'normal'; }

const estado = {
  enviando: false,
  idMensaje: 0,            // alterna en cada mensaje nuevo
  ultimoEnviado: '',
  esperaRespuesta: null,   // funciones del emisor mientras espera ACK / NACK
  rx: null,                // mensaje que el receptor está armando
  registro: [],            // una fila por trama recibida
  mediciones: [],          // tramas de las series de prueba
  stats: { enviadas: 0, bits: 0, correctas: 0, danadas: 0, detectados: 0, corregidos: 0, retransmisiones: 0 },
};

let demodulador = null;

// ---------- Utilidades de pantalla ----------

function fijarEstado(texto, activo) {
  $('estado-linea').textContent = texto;
  $('estado-linea').dataset.activo = activo ? 'si' : 'no';
}

function estadoDeReposo() {
  if (!audio.ctx) return;
  const escucha = ajustes.canal === 'interno' || audio.microfonoActivo;
  const banda = ajustes.duplex ? ' en la banda ' + bandaRx() : '';
  fijarEstado(escucha ? 'Escuchando' + banda + ': en espera de un preámbulo' : 'Audio encendido. El micrófono está apagado.', escucha);
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

function baudios() {
  return Math.round(1000 / CONFIG.duracionBitMs);
}

function plural(n, uno, varios) {
  return n + ' ' + (n === 1 ? uno : varios);
}

// ---------- Audio ----------

async function prepararAudio() {
  await iniciarAudio();
  if (demodulador) return;
  demodulador = new Demodulador(audio.ctx.sampleRate, alEventoDelDemodulador);
  demodulador.fijarVelocidad(CONFIG.duracionBitMs);
  demodulador.fijarBanda(bandaRx(), ajustes.duplex);
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
  const interno = ajustes.canal === 'interno';
  boton.disabled = interno;
  boton.setAttribute('aria-pressed', audio.microfonoActivo && !interno ? 'true' : 'false');
  boton.textContent = audio.microfonoActivo && !interno ? 'Dejar de escuchar' : 'Escuchar';
  $('mic-estado').textContent = interno
    ? 'En el canal interno el receptor oye directo al emisor; no usa micrófono.'
    : (audio.microfonoActivo ? 'Micrófono encendido. Acerca la bocina del emisor.' : 'El micrófono está apagado.');
  estadoDeReposo();
}

// ---------- Eventos del demodulador ----------
// El receptor dibuja las tramas; el emisor atiende las respuestas del ARQ.
function alEventoDelDemodulador(nombre, datos) {
  if (nombre === 'respuesta-tono' || nombre === 'respuesta') {
    if (estado.esperaRespuesta) estado.esperaRespuesta[nombre === 'respuesta' ? 'alRespuesta' : 'alTono'](datos);
    return;
  }
  alEventoDelReceptor(nombre, datos);
}
