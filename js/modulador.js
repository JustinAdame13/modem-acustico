// ============================================================
//  modulador.js — Modulación FSK (bits -> sonido)
//  Cada bit se convierte en un tono: una onda seno de cierta
//  frecuencia que dura lo que dura un bit.
// ============================================================

// Lista de tonos de una trama: preámbulo, reposo y un tono por bit.
function tonosDeTrama(valoresDeBits, duracionBitMs) {
  const f = CONFIG.frecuencias;
  const tonos = [
    { frecuencia: f.preambulo, ms: CONFIG.preambuloMs },
    { frecuencia: f.uno, ms: CONFIG.bitsDeReposo * duracionBitMs },
  ];
  for (const bit of valoresDeBits) {
    tonos.push({ frecuencia: bit === 1 ? f.uno : f.cero, ms: duracionBitMs });
  }
  return tonos;
}

// Tono de confirmación del ARQ: 'ack' o 'nack'.
function tonoDeRespuesta(tipo) {
  return [{ frecuencia: CONFIG.frecuencias[tipo], ms: CONFIG.tonoRespuestaMs }];
}

// Genera las muestras de audio: muestra = volumen * sin(fase).
// La fase avanza 2*pi*frecuencia/fs en cada muestra y nunca se reinicia,
// así el cambio de un tono a otro es suave y no produce "clics".
function sintetizar(tonos, fs, volumen) {
  const silencioInicial = Math.round(fs * 0.03);
  const silencioFinal = Math.round(fs * 0.06);

  let totalMs = 0;
  for (const t of tonos) totalMs += t.ms;
  const nTonos = Math.round(fs * totalMs / 1000);
  const muestras = new Float32Array(silencioInicial + nTonos + silencioFinal);

  let fase = 0;
  let msAcumulados = 0;
  let i = 0;
  for (const tono of tonos) {
    msAcumulados += tono.ms;
    const fin = Math.round(fs * msAcumulados / 1000);
    const avance = 2 * Math.PI * tono.frecuencia / fs;
    for (; i < fin; i++) {
      muestras[silencioInicial + i] = volumen * Math.sin(fase);
      fase += avance;
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
