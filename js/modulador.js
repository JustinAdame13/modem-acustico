// ============================================================
//  modulador.js — Modulación FSK (bits -> sonido)
//  Cada ranura de tiempo dura un bit. En serie suena un tono por ranura;
//  en paralelo suenan 8 tonos a la vez (uno por canal).
// ============================================================

// Ranuras de una trama: los caracteres ocupan una ranura por bit,
// los símbolos en paralelo ocupan una sola ranura con 8 bits.
function ranurasDeTrama(trama) {
  const ranuras = [];
  trama.elementos.forEach((el, e) => {
    if (el.tipo === 'caracter') el.bits.forEach((b, p) => ranuras.push({ e, p, valores: [b.v] }));
    else ranuras.push({ e, p: -1, valores: el.bits.map((b) => b.v) });
  });
  return ranuras;
}

// Frecuencias que suenan en una ranura.
function frecuenciasDeRanura(valores, banda) {
  if (valores.length === 1) return [valores[0] === 1 ? banda.uno : banda.cero];
  return valores.map((v, canal) => CONFIG.paralelo[canal][v]);
}

// Lista de tonos de una trama: preámbulo, reposo y las ranuras.
function tonosDeTrama(ranuras, duracionBitMs, nombreBanda) {
  const banda = CONFIG.bandas[nombreBanda];
  const tonos = [
    { frecuencias: [banda.preambulo], ms: CONFIG.preambuloMs },
    { frecuencias: [banda.uno], ms: CONFIG.bitsDeReposo * duracionBitMs },
  ];
  for (const r of ranuras) tonos.push({ frecuencias: frecuenciasDeRanura(r.valores, banda), ms: duracionBitMs });
  return tonos;
}

// Respuesta del ARQ: tono de ACK o NACK, reposo y un carácter con Hamming.
function tonosDeRespuesta(tipo, byte, duracionBitMs) {
  const banda = CONFIG.bandas.normal;
  const tonos = [
    { frecuencias: [CONFIG.respuesta[tipo]], ms: CONFIG.tonoRespuestaMs },
    { frecuencias: [banda.uno], ms: CONFIG.bitsDeReposo * duracionBitMs },
  ];
  for (const v of [0, ...cargaDeByte(byte, 'hamming'), 1]) {
    tonos.push({ frecuencias: [v === 1 ? banda.uno : banda.cero], ms: duracionBitMs });
  }
  return tonos;
}

// Genera las muestras de audio: suma de senos, muestra = A * sin(fase).
// Cada canal guarda su propia fase y nunca la reinicia, así el cambio
// de un tono a otro es suave y no produce "clics".
function sintetizar(tonos, fs, volumen) {
  const silencioInicial = Math.round(fs * 0.03);
  const silencioFinal = Math.round(fs * 0.06);

  let totalMs = 0;
  for (const t of tonos) totalMs += t.ms;
  const nTonos = Math.round(fs * totalMs / 1000);
  const muestras = new Float32Array(silencioInicial + nTonos + silencioFinal);

  const fases = new Array(CONFIG.paralelo.length).fill(0);
  let msAcumulados = 0;
  let i = 0;
  for (const tono of tonos) {
    msAcumulados += tono.ms;
    const fin = Math.round(fs * msAcumulados / 1000);
    const amplitud = volumen / tono.frecuencias.length;
    const avances = tono.frecuencias.map((f) => 2 * Math.PI * f / fs);
    for (; i < fin; i++) {
      let s = 0;
      for (let c = 0; c < avances.length; c++) {
        s += Math.sin(fases[c]);
        fases[c] += avances[c];
      }
      muestras[silencioInicial + i] = amplitud * s;
    }
  }

  // Subida y bajada gradual del volumen (5 ms) al inicio y al final.
  const rampa = Math.round(fs * 0.005);
  for (let k = 0; k < rampa && k < nTonos; k++) {
    const g = k / rampa;
    muestras[silencioInicial + k] *= g;
    muestras[silencioInicial + nTonos - 1 - k] *= g;
  }
  return muestras;
}

// Duración total (ms) de una lista de tonos.
function duracionDeTonos(tonos) {
  return tonos.reduce((suma, t) => suma + t.ms, 0);
}
