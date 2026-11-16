// ============================================================
//  demodulador.js — Demodulación FSK (sonido -> bits)
//
//  Recibe las muestras del micrófono y sigue estos pasos:
//    reposo         : busca el tono de preámbulo (o un ACK / NACK).
//    sincronizando  : ubica el primer bit de arranque.
//    caracter       : lee los bits de un carácter. Cada bit se mide
//                     varias veces y se decide por mayoría.
//    entre          : busca el bit de arranque del siguiente carácter
//                     (así se vuelve a sincronizar en cada carácter,
//                     como en toda transmisión asíncrona).
// ============================================================

// Algoritmo de Goertzel: mide cuánta energía hay en UNA frecuencia
// dentro de un tramo de audio. Devuelve la potencia de ese tono.
function energiaDeTono(muestras, inicio, n, frecuencia, fs) {
  const coef = 2 * Math.cos(2 * Math.PI * frecuencia / fs);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    const s0 = muestras[inicio + i] + coef * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const magnitud2 = s1 * s1 + s2 * s2 - coef * s1 * s2;
  return 2 * magnitud2 / (n * n);
}

// Potencia total (de todas las frecuencias) de un tramo de audio.
function potenciaTotal(muestras, inicio, n) {
  let suma = 0;
  for (let i = 0; i < n; i++) suma += muestras[inicio + i] * muestras[inicio + i];
  return suma / n;
}

function aDecibeles(potencia) {
  return 10 * Math.log10(Math.max(potencia, 1e-12));
}

class Demodulador {
  // fs = muestras por segundo. alEvento(nombre, datos) avisa a la página.
  constructor(fs, alEvento) {
    this.fs = fs;
    this.alEvento = alEvento;
    this.capacidad = Math.round(fs * 6);
    this.buf = new Float32Array(this.capacidad);
    this.base = 0;   // posición absoluta de buf[0]
    this.len = 0;    // muestras guardadas
    this.ruido = 0;  // potencia del ruido de fondo, medida en reposo
    this.fijarVelocidad(CONFIG.duracionBitMs);
    this.reiniciar();
  }

  fijarVelocidad(duracionBitMs) {
    this.Tb = this.fs * duracionBitMs / 1000;                        // muestras por bit
    this.sub = Math.max(8, Math.floor(this.Tb / CONFIG.lecturasPorBit)); // muestras por lectura
    this.nReposo = Math.round(this.fs * 0.0125);                     // lectura de 12.5 ms
  }

  reiniciar() {
    this.estado = 'reposo';
    this.cursor = this.base + this.len;
    this.ventana = [];
    this.sordoHasta = 0;
  }

  // Entrada de audio: se guarda y se procesa todo lo que se pueda.
  alimentar(muestras) {
    if (this.len + muestras.length > this.capacidad) {
      const conservar = this.capacidad >> 1;
      const quitar = this.len - conservar;
      this.buf.copyWithin(0, quitar, this.len);
      this.base += quitar;
      this.len = conservar;
    }
    this.buf.set(muestras, this.len);
    this.len += muestras.length;
    while (this.paso()) { /* avanzar mientras haya muestras suficientes */ }
  }

  hay(posFinal) { return posFinal <= this.base + this.len; }
  tono(pos, n, frecuencia) { return energiaDeTono(this.buf, pos - this.base, n, frecuencia, this.fs); }

  paso() {
    if (this.cursor < this.base) this.cursor = this.base;
    if (this.estado === 'reposo') return this.pasoReposo();
    if (this.estado === 'sincronizando') return this.pasoSincronizar();
    if (this.estado === 'caracter') return this.pasoBit();
    return this.pasoEntreCaracteres();
  }

  // ---------- reposo: buscar preámbulo, ACK o NACK ----------
  pasoReposo() {
    const n = this.nReposo;
    if (!this.hay(this.cursor + n)) return false;
    const f = CONFIG.frecuencias;
    const total = potenciaTotal(this.buf, this.cursor - this.base, n);

    // ¿Qué tono domina en esta lectura?
    let simbolo = null;
    if (total > 1e-10) {
      let mejor = 0, segundo = 0;
      for (const nombre of ['preambulo', 'ack', 'nack', 'cero', 'uno']) {
        const e = this.tono(this.cursor, n, f[nombre]);
        if (e > mejor) { segundo = mejor; mejor = e; simbolo = nombre; }
        else if (e > segundo) segundo = e;
      }
      if (mejor < (30 / n) * total || mejor < 3 * segundo) simbolo = null;
    }
    if (simbolo === null) this.ruido = this.ruido === 0 ? total : 0.9 * this.ruido + 0.1 * total;

    // Se recuerdan las últimas 16 lecturas (200 ms).
    this.ventana.push(simbolo);
    if (this.ventana.length > 16) this.ventana.shift();
    const cuenta = (s) => this.ventana.filter((x) => x === s).length;

    this.cursor += n;
    if (cuenta('preambulo') >= 12) {
      this.estado = 'sincronizando';
      this.deteccion = this.cursor;   // el preámbulo se reconoce 150-300 ms después de que empieza
      this.ventana = [];
      this.receptor = new ReceptorDeTrama();
      this.sumaSenal = 0; this.bitsMedidos = 0; this.bitsSinSenal = 0;
      this.alEvento('preambulo', {});
    } else if (this.cursor > this.sordoHasta) {
      for (const tipo of ['ack', 'nack']) {
        if (cuenta(tipo) >= 12) {
          this.ventana = [];
          this.sordoHasta = this.cursor + this.fs * 0.4;
          this.alEvento('respuesta', { tipo });
        }
      }
    }
    return true;
  }

  // ---------- sincronizando: ubicar el primer bit de arranque ----------
  // Se conoce la secuencia que debe venir: preámbulo, reposo (tono del 1)
  // y bit de arranque (tono del 0). Se prueba cada posición posible y se
  // elige la que mejor coincide con esa secuencia.
  pasoSincronizar() {
    const reposo = CONFIG.bitsDeReposo * this.Tb;
    const desde = Math.round(this.deteccion + reposo - this.fs * 0.06);
    const hasta = Math.round(this.deteccion + reposo + this.fs * 0.2);
    if (!this.hay(hasta + Math.ceil(this.Tb) + 1)) return false;

    const f = CONFIG.frecuencias;
    const nBit = Math.floor(this.Tb);
    const nReposo = Math.floor(reposo);
    const nPre = Math.round(this.fs * 0.1);
    let mejor = -1, borde = desde;
    for (let c = desde; c <= hasta; c += Math.max(1, this.sub >> 1)) {
      if (c - nReposo - nPre < this.base) continue;
      const puntos = this.tono(c - nReposo - nPre, nPre, f.preambulo)
        + this.tono(c - nReposo, nReposo, f.uno)
        + this.tono(c, nBit, f.cero);
      if (puntos > mejor) { mejor = puntos; borde = c; }
    }

    // Comprobación: antes del borde debe dominar el 1 y después el 0.
    const reposoOk = this.tono(borde - nReposo, nReposo, f.uno) > this.tono(borde - nReposo, nReposo, f.cero);
    const arranqueOk = this.tono(borde, nBit, f.cero) > this.tono(borde, nBit, f.uno);
    if (!reposoOk || !arranqueOk) {
      this.estado = 'reposo';
      this.cursor = hasta;
      this.alEvento('sin-sincronia', {});
      return true;
    }
    this.empezarCaracter(borde);
    return true;
  }

  empezarCaracter(posicion) {
    this.inicioCaracter = posicion;
    this.esperado = this.receptor.siguiente();
    this.valores = [];
    this.estado = 'caracter';
    this.alEvento('caracter-inicio', this.esperado);
  }

  // ---------- caracter: leer un bit ----------
  pasoBit() {
    const k = this.valores.length;
    const inicioBit = this.inicioCaracter + k * this.Tb;
    if (!this.hay(Math.ceil(inicioBit + this.Tb) + 1)) return false;
    const f = CONFIG.frecuencias;

    // Varias lecturas dentro del bit. Se descartan las de las orillas,
    // donde todavía suena el eco del bit anterior. Gana la mayoría.
    let votosUno = 0, lecturas = 0, senal = 0, total = 0;
    for (let j = 2; j <= CONFIG.lecturasPorBit - 2; j++) {
      const pos = Math.round(inicioBit + j * this.sub);
      const e0 = this.tono(pos, this.sub, f.cero);
      const e1 = this.tono(pos, this.sub, f.uno);
      if (e1 > e0) votosUno++;
      lecturas++;
      senal += Math.max(e0, e1);
      total += potenciaTotal(this.buf, pos - this.base, this.sub);
    }
    const valor = votosUno * 2 > lecturas ? 1 : 0;
    this.valores.push(valor);
    this.alEvento('bit', { indice: k, valor });

    // Nivel de señal (para medir atenuación) y detección de señal perdida.
    this.sumaSenal += senal / lecturas;
    this.bitsMedidos++;
    const hayTono = total > 1e-10 && senal / total > 8 / this.sub;
    this.bitsSinSenal = hayTono ? 0 : this.bitsSinSenal + 1;
    if (this.bitsSinSenal >= 12) {
      this.abortar('Se perdió la señal a media trama.');
      return true;
    }

    if (this.valores.length === this.esperado.nbits) this.terminarCaracter();
    return true;
  }

  terminarCaracter() {
    const caracter = this.receptor.recibir(this.valores);
    this.alEvento('caracter', caracter);
    const nominal = this.inicioCaracter + this.esperado.nbits * this.Tb;

    if (this.receptor.terminado) {
      this.cursor = Math.round(nominal);
      this.entregarTrama(null);
      return;
    }
    // El siguiente bit de arranque debe caer cerca de "nominal".
    this.nominal = Math.round(nominal);
    this.estado = 'entre';
  }

  // ---------- entre: resincronizar con el siguiente bit de arranque ----------
  // El bit de parada (1) seguido del bit de arranque (0) marca dónde empieza
  // el siguiente carácter. Se busca ese cambio cerca de donde se espera.
  pasoEntreCaracteres() {
    const medio = Math.floor(this.Tb / 2);
    const margen = this.Tb / 4;
    if (!this.hay(Math.ceil(this.nominal + margen) + medio + 1)) return false;
    const f = CONFIG.frecuencias;
    let mejor = -1, borde = this.nominal;
    for (let c = Math.round(this.nominal - margen); c <= this.nominal + margen; c += Math.max(1, this.sub >> 2)) {
      const puntos = this.tono(c - medio, medio, f.uno) + this.tono(c, medio, f.cero);
      if (puntos > mejor) { mejor = puntos; borde = c; }
    }
    this.empezarCaracter(borde);
    return true;
  }

  abortar(motivo) {
    if (this.cursor < this.base + this.len - this.nReposo) this.cursor = this.base + this.len - this.nReposo;
    this.entregarTrama(motivo);
  }

  entregarTrama(motivoDeAborto) {
    const resultado = this.receptor.resultado();
    resultado.aborto = motivoDeAborto;
    if (motivoDeAborto) resultado.valido = false;
    const senal = this.bitsMedidos > 0 ? this.sumaSenal / this.bitsMedidos : 0;
    resultado.nivelDb = aDecibeles(2 * senal);          // 0 dB = tono a volumen máximo
    resultado.ruidoDb = aDecibeles(2 * this.ruido);
    resultado.snrDb = senal > 0 && this.ruido > 0 ? aDecibeles(senal / this.ruido) : null;
    this.estado = 'reposo';
    this.ventana = [];
    this.alEvento('trama', resultado);
  }
}
