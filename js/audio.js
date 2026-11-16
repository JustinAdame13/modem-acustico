// ============================================================
//  audio.js — Bocina, micrófono y canal (Web Audio API)
//
//  Hay dos canales:
//    aire    : la señal sale por la bocina y entra por el micrófono.
//    interno : la señal va directo del emisor al receptor dentro de la
//              página, con atenuación, ruido y golpes de ruido (simulación).
//
//  Camino de recepción:  entrada -> filtro pasa-altas -> analizador -> captura
// ============================================================

const audio = {
  ctx: null,
  analizador: null,
  microfonoActivo: false,
  canal: 'aire',
  eco: false,            // un solo dispositivo: se escucha a sí mismo
  duplex: false,         // full dúplex: transmite y escucha al mismo tiempo
  transmitiendo: false,
  sordo: false,          // half dúplex: mientras transmite, no escucha
  alRecibirMuestras: null,
  alVolverAEscuchar: null,
  ajustes: { atenuacionDb: 20, ruido: 0, monitor: true },
};

async function iniciarAudio() {
  if (audio.ctx) {
    if (audio.ctx.state === 'suspended') await audio.ctx.resume();
    return;
  }
  const Contexto = window.AudioContext || window.webkitAudioContext;
  const ctx = new Contexto({ latencyHint: 'interactive' });
  audio.ctx = ctx;

  // --- Recepción ---
  audio.entrada = ctx.createGain();
  const filtro = ctx.createBiquadFilter();   // quita voces graves y zumbidos
  filtro.type = 'highpass';
  filtro.frequency.value = 900;
  audio.analizador = ctx.createAnalyser();   // calcula el espectro para la pantalla
  audio.analizador.fftSize = 2048;
  audio.analizador.smoothingTimeConstant = 0.25;
  audio.entrada.connect(filtro);
  filtro.connect(audio.analizador);

  const mudo = ctx.createGain();             // mantiene vivo el camino sin que suene
  mudo.gain.value = 0;
  mudo.connect(ctx.destination);

  const entregar = (muestras) => {
    if (!audio.sordo && audio.alRecibirMuestras) audio.alRecibirMuestras(muestras);
  };
  try {
    await ctx.audioWorklet.addModule('js/captura-worklet.js');
    const captura = new AudioWorkletNode(ctx, 'captura');
    captura.port.onmessage = (e) => entregar(e.data);
    audio.analizador.connect(captura);
    captura.connect(mudo);
  } catch (error) {
    // Navegadores sin AudioWorklet (o página abierta como archivo local)
    const captura = ctx.createScriptProcessor(2048, 1, 1);
    captura.onaudioprocess = (e) => entregar(new Float32Array(e.inputBuffer.getChannelData(0)));
    audio.analizador.connect(captura);
    captura.connect(mudo);
  }

  // --- Transmisión ---
  audio.salida = ctx.createGain();
  audio.aBocina = ctx.createGain();
  audio.aInterno = ctx.createGain();
  audio.salida.connect(audio.aBocina);
  audio.aBocina.connect(ctx.destination);
  audio.salida.connect(audio.aInterno);
  audio.aInterno.connect(audio.entrada);

  // --- Ruido blanco para el canal interno ---
  const ruido = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const datos = ruido.getChannelData(0);
  for (let i = 0; i < datos.length; i++) datos[i] = Math.random() * 2 - 1;
  const fuenteRuido = ctx.createBufferSource();
  fuenteRuido.buffer = ruido;
  fuenteRuido.loop = true;
  audio.gananciaRuido = ctx.createGain();
  fuenteRuido.connect(audio.gananciaRuido);
  audio.gananciaRuido.connect(audio.entrada);
  // Golpe de ruido (ruido de impulso): el mismo ruido, muy fuerte y muy breve
  audio.gananciaGolpe = ctx.createGain();
  audio.gananciaGolpe.gain.value = 0;
  fuenteRuido.connect(audio.gananciaGolpe);
  audio.gananciaGolpe.connect(audio.entrada);
  fuenteRuido.start();

  audio.gananciaMic = ctx.createGain();
  audio.gananciaMic.connect(audio.entrada);

  aplicarCanal();
}

// Ajusta las "llaves" según el canal elegido.
function aplicarCanal() {
  if (!audio.ctx) return;
  const interno = audio.canal === 'interno';
  const a = audio.ajustes;
  audio.aBocina.gain.value = interno ? (a.monitor ? 0.4 : 0) : 1;
  audio.aInterno.gain.value = interno ? Math.pow(10, -a.atenuacionDb / 20) : 0;
  audio.gananciaRuido.gain.value = interno ? (a.ruido / 100) * 0.5 : 0;
  audio.gananciaMic.gain.value = interno ? 0 : 1;
}

// Ruido de impulso en el canal interno: 150 ms de ruido fuerte.
function golpeDeRuido() {
  if (!audio.ctx || audio.canal !== 'interno') return;
  const g = audio.gananciaGolpe.gain;
  const t = audio.ctx.currentTime;
  g.cancelScheduledValues(t);
  g.setValueAtTime(0.6, t);
  g.setValueAtTime(0, t + 0.15);
}

async function activarMicrofono() {
  await iniciarAudio();
  if (audio.microfonoActivo) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Este navegador no da acceso al micrófono. Abre la página con https o en localhost.');
  }
  // Se apagan los "mejoradores" de voz: borrarían nuestros tonos.
  const flujo = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  audio.flujo = flujo;
  audio.fuenteMic = audio.ctx.createMediaStreamSource(flujo);
  audio.fuenteMic.connect(audio.gananciaMic);
  audio.microfonoActivo = true;
}

function apagarMicrofono() {
  if (!audio.microfonoActivo) return;
  audio.fuenteMic.disconnect();
  for (const pista of audio.flujo.getTracks()) pista.stop();
  audio.microfonoActivo = false;
}

// Reproduce muestras ya sintetizadas. La promesa termina cuando deja de sonar.
// alEmpezar(tiempo) recibe el instante (reloj del audio) en que empieza a sonar.
function transmitir(muestras, alEmpezar) {
  const ctx = audio.ctx;
  return new Promise((resolver) => {
    const bufer = ctx.createBuffer(1, muestras.length, ctx.sampleRate);
    bufer.getChannelData(0).set(muestras);
    const fuente = ctx.createBufferSource();
    fuente.buffer = bufer;
    fuente.connect(audio.salida);

    // Half dúplex: por el aire, quien transmite no se escucha a sí mismo
    // (a menos que se pruebe con un solo dispositivo). En full dúplex sigue
    // escuchando, porque el otro dispositivo transmite en otra banda.
    const ensordecer = audio.canal === 'aire' && !audio.eco && !audio.duplex;
    if (ensordecer) audio.sordo = true;
    audio.transmitiendo = true;
    const inicio = ctx.currentTime + 0.05;
    if (alEmpezar) alEmpezar(inicio);
    fuente.onended = () => {
      audio.transmitiendo = false;
      if (!ensordecer) { resolver(); return; }
      setTimeout(() => {
        audio.sordo = false;
        if (audio.alVolverAEscuchar) audio.alVolverAEscuchar();
        resolver();
      }, 150);
    };
    fuente.start(inicio);
  });
}
