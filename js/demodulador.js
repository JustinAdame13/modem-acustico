// ============================================================
//  demodulador.js — Demodulación FSK (sonido -> bits)
//
//  Recibe las muestras del micrófono y sigue estos pasos:
//    reposo         : busca un tono de inicio (preámbulo, ACK o NACK).
//    sincronizando  : ubica el primer bit de arranque.
//    elemento       : lee un carácter (bit por bit, con votación) o un
//                     símbolo en paralelo (8 canales a la vez).
//    entre          : busca el bit de arranque del siguiente carácter
//                     (así se vuelve a sincronizar en cada carácter,
//                     como en toda transmisión asíncrona).
// ============================================================

// Algoritmo de Goertzel: mide cuánta energía hay en UNA frecuencia
// dentro de un tramo de audio. Devuelve la potencia de ese tono.
// "ventana" (opcional) suaviza las orillas del tramo para que un tono muy
// fuerte en otra frecuencia no "se fugue" a la que se está midiendo.
function energiaDeTono(muestras, inicio, n, frecuencia, fs, ventana) {
  const coef = 2 * Math.cos(2 * Math.PI * frecuencia / fs);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    const x = ventana ? muestras[inicio + i] * ventana.w[i] : muestras[inicio + i];
    const s0 = x + coef * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const magnitud2 = s1 * s1 + s2 * s2 - coef * s1 * s2;
  const suma = ventana ? ventana.suma : n;
  return 2 * magnitud2 / (suma * suma);
}

// Ventana de Hann de n muestras (se guarda para no recalcularla).
const ventanasDeHann = new Map();
function ventanaDeHann(n) {
  if (!ventanasDeHann.has(n)) {
    const w = new Float32Array(n);
    let suma = 0;
    for (let i = 0; i < n; i++) { w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / n); suma += w[i]; }
    ventanasDeHann.set(n, { w, suma });
  }
  return ventanasDeHann.get(n);
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
    this.banda = 'normal';
    this.duplex = false;
    this.fijarVelocidad(CONFIG.duracionBitMs);
    this.reiniciar();
  }

  fijarVelocidad(duracionBitMs) {
    this.Tb = this.fs * duracionBitMs / 1000;                            // muestras por bit
    this.sub = Math.max(8, Math.floor(this.Tb / CONFIG.lecturasPorBit)); // muestras por lectura
    this.nReposo = Math.round(this.fs * 0.0125);                         // lectura de 12.5 ms
  }

  // Banda que se escucha. En full dúplex se escucha la banda del otro dispositivo.
  fijarBanda(banda, duplex) {
    this.banda = banda;
    this.duplex = duplex;
    this.ruido = 0;
    this.reiniciar();
  }

  get f() { return CONFIG.bandas[this.banda]; }

  reiniciar() {
    this.estado = 'reposo';
    this.cursor = this.base + this.len;
    this.ventana = [];
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
  tono(pos, n, frecuencia) {
    // En full dúplex se usa ventana de Hann: la bocina propia suena mucho más fuerte.
    return energiaDeTono(this.buf, pos - this.base, n, frecuencia, this.fs, this.duplex ? ventanaDeHann(n) : null);
  }

  // Potencia del "fondo" contra la que se compara cada tono.
  // En half dúplex es la potencia total. En full dúplex la propia transmisión
  // suena muy fuerte, así que el fondo se mide en frecuencias testigo (sin tonos).
  fondo(pos, n) {
    if (!this.duplex) return potenciaTotal(this.buf, pos - this.base, n);
    const e = this.f.testigos.map((fr) => this.tono(pos, n, fr)).sort((a, b) => a - b);
    return ((e[1] + e[2]) / 2) * n / 3;   // equivalente a la potencia total de un ruido blanco
  }

  paso() {
    if (this.cursor < this.base) this.cursor = this.base;
    if (this.estado === 'reposo') return this.pasoReposo();
    if (this.estado === 'sincronizando') return this.pasoSincronizar();
    if (this.estado === 'elemento') {
      return this.esperado.tipo === 'simbolo' ? this.pasoSimbolo() : this.pasoBit();
    }
    return this.pasoEntreCaracteres();
  }

  // ---------- reposo: buscar preámbulo, ACK o NACK ----------
  pasoReposo() {
    const n = this.nReposo;
    if (!this.hay(this.cursor + n)) return false;
    const f = this.f;
    const total = this.fondo(this.cursor, n);
    const candidatos = { preambulo: f.preambulo, cero: f.cero, uno: f.uno };
    if (!this.duplex) Object.assign(candidatos, CONFIG.respuesta);

    // ¿Qué tono domina en esta lectura?
    let simbolo = null;
    if (total > 1e-10) {
      let mejor = 0, segundo = 0;
      for (const [nombre, frecuencia] of Object.entries(candidatos)) {
        const e = this.tono(this.cursor, n, frecuencia);
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
      this.iniciarSincronia(null, f.preambulo);
    } else if (!this.duplex) {
      for (const tipo of ['ack', 'nack']) {
        if (cuenta(tipo) >= 12) this.iniciarSincronia(tipo, CONFIG.respuesta[tipo]);
      }
    }
    return true;
  }

  // respuesta = null para una trama, o 'ack' / 'nack' para una respuesta del ARQ.
  iniciarSincronia(respuesta, frecuenciaInicial) {
    this.estado = 'sincronizando';
    this.deteccion = this.cursor;   // el tono se reconoce 150-300 ms después de que empieza
    this.tonoInicial = frecuenciaInicial;
    this.respuesta = respuesta;
    this.ventana = [];
    this.receptor = respuesta ? new ReceptorDeRespuesta() : new ReceptorDeTrama();
    this.sumaSenal = 0; this.bitsMedidos = 0; this.bitsSinSenal = 0;
    if (respuesta) this.alEvento('respuesta-tono', { tipo: respuesta });
    else this.alEvento('preambulo', {});
  }

  // ---------- sincronizando: ubicar el primer bit de arranque ----------
  // Se conoce la secuencia que debe venir: tono inicial, reposo (tono del 1)
  // y bit de arranque (tono del 0). Se prueba cada posición posible y se
  // elige la que mejor coincide con esa secuencia.
  pasoSincronizar() {
    const reposo = CONFIG.bitsDeReposo * this.Tb;
    const desde = Math.round(this.deteccion + reposo - this.fs * 0.06);
    const hasta = Math.round(this.deteccion + reposo + this.fs * 0.2);
    if (!this.hay(hasta + Math.ceil(this.Tb) + 1)) return false;

    const f = this.respuesta ? CONFIG.bandas.normal : this.f;
    const nBit = Math.floor(this.Tb);
    const nReposo = Math.floor(reposo);
    const nPre = Math.round(this.fs * 0.1);
    let mejor = -1, borde = desde;
    for (let c = desde; c <= hasta; c += Math.max(1, this.sub >> 1)) {
      if (c - nReposo - nPre < this.base) continue;
      const puntos = this.tono(c - nReposo - nPre, nPre, this.tonoInicial)
        + this.tono(c - nReposo, nReposo, f.uno)
        + this.tono(c, nBit, f.cero);
      if (puntos > mejor) { mejor = puntos; borde = c; }
    }

    // Comprobación: antes del borde debe dominar el 1 y después el 0.
    const reposoOk = this.tono(borde - nReposo, nReposo, f.uno) > this.tono(borde - nReposo, nReposo, f.cero);
    const arranqueOk = this.tono(borde, nBit, f.cero) > this.tono(borde, nBit, f.uno);
    if (!reposoOk || !arranqueOk) {
      this.cursor = hasta;
      this.entregar('No se encontró el bit de arranque.', true);
      return true;
    }
    this.empezarElemento(borde);
    return true;
  }

  empezarElemento(posicion) {
    this.inicioElemento = posicion;
    this.esperado = this.receptor.siguiente();
    this.valores = [];
    this.estado = 'elemento';
    if (!this.respuesta) this.alEvento('elemento-inicio', this.esperado);
  }

  // Lleva la cuenta del nivel de señal y detecta si la señal se perdió.
  medirSenal(senal, total, umbral) {
    this.sumaSenal += senal;
    this.bitsMedidos++;
    const hayTono = total > 1e-10 && senal / total > umbral;
    this.bitsSinSenal = hayTono ? 0 : this.bitsSinSenal + 1;
    if (this.bitsSinSenal >= 12) {
      this.abortar('Se perdió la señal a media trama.');
      return false;
    }
    return true;
  }

  // ---------- elemento en serie: leer un bit ----------
  pasoBit() {
    const k = this.valores.length;
    const inicioBit = this.inicioElemento + k * this.Tb;
    if (!this.hay(Math.ceil(inicioBit + this.Tb) + 1)) return false;
    const f = this.respuesta ? CONFIG.bandas.normal : this.f;

    // Varias lecturas dentro del bit. Se descartan las de las orillas,
    // donde todavía suena el eco del bit anterior. Gana la mayoría.
    let votosUno = 0, lecturas = 0, senal = 0;
    for (let j = 2; j <= CONFIG.lecturasPorBit - 2; j++) {
      const pos = Math.round(inicioBit + j * this.sub);
      const e0 = this.tono(pos, this.sub, f.cero);
      const e1 = this.tono(pos, this.sub, f.uno);
      if (e1 > e0) votosUno++;
      lecturas++;
      senal += Math.max(e0, e1);
    }
    const total = this.fondo(Math.round(inicioBit + 2 * this.sub), lecturas * this.sub);
    const valor = votosUno * 2 > lecturas ? 1 : 0;
    this.valores.push(valor);
    if (!this.respuesta) this.alEvento('bit', { indice: k, valor });

    if (!this.medirSenal(senal / lecturas, total, 8 / this.sub)) return true;
    if (this.valores.length === this.esperado.nbits) this.terminarElemento();
    return true;
  }

  // ---------- elemento en paralelo: leer los 8 canales a la vez ----------
  pasoSimbolo() {
    if (!this.hay(Math.ceil(this.inicioElemento + this.Tb) + 1)) return false;
    // Se mide el centro del símbolo (del 20 % al 80 %), lejos de los cambios.
    const pos = Math.round(this.inicioElemento + 0.2 * this.Tb);
    const n = Math.floor(0.6 * this.Tb);
    let senal = 0;
    this.valores = CONFIG.paralelo.map(([f0, f1]) => {
      const e0 = this.tono(pos, n, f0);
      const e1 = this.tono(pos, n, f1);
      senal += Math.max(e0, e1);
      return e1 > e0 ? 1 : 0;
    });
    this.alEvento('simbolo', { valores: this.valores });
    if (!this.medirSenal(senal, this.fondo(pos, n), 64 / n)) return true;
    this.terminarElemento();
    return true;
  }

  terminarElemento() {
    const registro = this.receptor.recibir(this.valores);
    if (!this.respuesta) this.alEvento('elemento', registro);
    const nominal = this.inicioElemento + this.esperado.ranuras * this.Tb;

    if (this.receptor.terminado) {
      this.cursor = Math.round(nominal);
      this.entregar(null);
      return;
    }
    // Los símbolos en paralelo van pegados uno tras otro, sin bits de arranque.
    if (this.receptor.siguiente().tipo === 'simbolo') {
      this.empezarElemento(nominal);
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
    const f = this.f;
    let mejor = -1, borde = this.nominal;
    for (let c = Math.round(this.nominal - margen); c <= this.nominal + margen; c += Math.max(1, this.sub >> 2)) {
      const puntos = this.tono(c - medio, medio, f.uno) + this.tono(c, medio, f.cero);
      if (puntos > mejor) { mejor = puntos; borde = c; }
    }
    this.empezarElemento(borde);
    return true;
  }

  abortar(motivo) {
    if (this.cursor < this.base + this.len - this.nReposo) this.cursor = this.base + this.len - this.nReposo;
    this.entregar(motivo);
  }

  // Avisa a la página que terminó una trama (o una respuesta) y vuelve a reposo.
  entregar(motivoDeAborto, sinSincronia) {
    this.estado = 'reposo';
    this.ventana = [];
    if (this.respuesta) {
      const reg = this.receptor.registro;
      this.alEvento('respuesta', { tipo: this.respuesta, byte: !motivoDeAborto && reg ? reg.byte : null });
      return;
    }
    if (sinSincronia) { this.alEvento('sin-sincronia', {}); return; }

    const resultado = this.receptor.resultado();
    resultado.aborto = motivoDeAborto;
    if (motivoDeAborto) resultado.valido = false;
    const senal = this.bitsMedidos > 0 ? this.sumaSenal / this.bitsMedidos : 0;
    resultado.nivelDb = aDecibeles(2 * senal);          // 0 dB = tono a volumen máximo
    resultado.ruidoDb = aDecibeles(2 * this.ruido);
    resultado.snrDb = senal > 0 && this.ruido > 0 ? aDecibeles(senal / this.ruido) : null;
    this.alEvento('trama', resultado);
  }
}
