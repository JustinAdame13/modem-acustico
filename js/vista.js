// ============================================================
//  vista.js — Lo que se dibuja: espectro en vivo y trama bit por bit
// ============================================================

const PANTALLA = { fMin: 900, fMax: 5700, fondo: [15, 24, 48], neutro: [150, 168, 210] };
const COLOR_CERO = [76, 201, 240];
const COLOR_UNO = [255, 180, 84];

// Qué se marca sobre el espectro: 'normal', 'paralelo' o 'duplex'.
const pantalla = { modo: 'normal', alCambiar: null };

function fijarModoDePantalla(modo) {
  if (pantalla.modo === modo) return;
  pantalla.modo = modo;
  if (pantalla.alCambiar) pantalla.alCambiar();
}

// Barras (una por tono) y etiquetas que se dibujan según el modo.
function marcadoresDePantalla() {
  const barras = [], etiquetas = [];
  const agregar = (f, color, texto, corto, sub) => {
    barras.push({ f, color });
    if (texto) etiquetas.push({ f, color, texto, corto, sub });
  };
  if (pantalla.modo === 'duplex') {
    const banda = (nombre, color) => {
      const b = CONFIG.bandas[nombre];
      agregar(b.cero, color, nombre + ': 0', nombre + '0', String(b.cero));
      agregar(b.uno, color, nombre + ': 1', nombre + '1', String(b.uno));
      agregar(b.preambulo, color, nombre + ': inicio', nombre + 'i', String(b.preambulo));
    };
    banda('A', [255, 180, 84]);
    banda('B', [76, 201, 240]);
  } else if (pantalla.modo === 'paralelo') {
    CONFIG.paralelo.forEach(([f0, f1], canal) => {
      barras.push({ f: f0, color: COLOR_CERO }, { f: f1, color: COLOR_UNO });
      etiquetas.push({ f: (f0 + f1) / 2, color: [223, 230, 247], texto: 'Canal ' + (canal + 1), corto: String(canal + 1),
        sub: f0 + '/' + f1 });
    });
  } else {
    const b = CONFIG.bandas.normal;
    agregar(b.cero, COLOR_CERO, 'Bit 0', '0', b.cero + ' Hz');
    agregar(b.uno, COLOR_UNO, 'Bit 1', '1', b.uno + ' Hz');
    agregar(b.preambulo, [183, 156, 255], 'Preámbulo', 'Pre', b.preambulo + ' Hz');
    agregar(CONFIG.respuesta.ack, [91, 227, 164], 'ACK', 'ACK', CONFIG.respuesta.ack + ' Hz');
    agregar(CONFIG.respuesta.nack, [255, 122, 133], 'NACK', 'NACK', CONFIG.respuesta.nack + ' Hz');
  }
  return { barras, etiquetas };
}

function iniciarPantalla() {
  const espectro = document.getElementById('espectro');
  const cascada = document.getElementById('cascada');
  const gE = espectro.getContext('2d');
  const gC = cascada.getContext('2d');
  let colorPorColumna = [];
  let marcadores = marcadoresDePantalla();
  let datos = null;

  const xDeFrecuencia = (f, ancho) => (f - PANTALLA.fMin) / (PANTALLA.fMax - PANTALLA.fMin) * ancho;

  function calcularColores() {
    marcadores = marcadoresDePantalla();
    const ancho = Math.max(80, 3000 / marcadores.barras.length);   // Hz alrededor de cada tono
    colorPorColumna = [];
    for (let x = 0; x < cascada.width; x++) {
      const f = PANTALLA.fMin + x / cascada.width * (PANTALLA.fMax - PANTALLA.fMin);
      let color = PANTALLA.neutro, distancia = Infinity;
      for (const b of marcadores.barras) {
        const d = Math.abs(f - b.f);
        if (d < Math.min(ancho, 130) && d < distancia) { color = b.color; distancia = d; }
      }
      colorPorColumna.push(color);
    }
  }

  function ajustarTamano() {
    const escala = window.devicePixelRatio || 1;
    for (const lienzo of [espectro, cascada]) {
      lienzo.width = Math.round(lienzo.clientWidth * escala);
      lienzo.height = Math.round(lienzo.clientHeight * escala);
    }
    calcularColores();
    gC.fillStyle = 'rgb(' + PANTALLA.fondo.join(',') + ')';
    gC.fillRect(0, 0, cascada.width, cascada.height);
  }

  // Magnitud (0 a 1) del espectro en la frecuencia f.
  function magnitud(f) {
    if (!datos) return 0;
    const porBin = audio.ctx.sampleRate / audio.analizador.fftSize;
    return datos[Math.round(f / porBin)] / 255;
  }

  function dibujarEspectro() {
    const W = espectro.width, H = espectro.height;
    const escala = window.devicePixelRatio || 1;
    gE.fillStyle = 'rgb(' + PANTALLA.fondo.join(',') + ')';
    gE.fillRect(0, 0, W, H);
    const techo = 36 * escala;   // espacio para las etiquetas

    // Curva del espectro completo
    gE.beginPath();
    gE.moveTo(0, H);
    for (let x = 0; x < W; x += 2) {
      const f = PANTALLA.fMin + x / W * (PANTALLA.fMax - PANTALLA.fMin);
      gE.lineTo(x, H - magnitud(f) * (H - techo));
    }
    gE.lineTo(W, H);
    gE.fillStyle = 'rgba(150, 168, 210, 0.28)';
    gE.fill();

    // Una barra por cada tono del módem
    const anchoBarra = (marcadores.barras.length > 8 ? 4 : 10) * escala;
    for (const b of marcadores.barras) {
      const x = xDeFrecuencia(b.f, W);
      const m = Math.max(magnitud(b.f - 25), magnitud(b.f), magnitud(b.f + 25));
      gE.fillStyle = 'rgba(' + b.color.join(',') + ',0.16)';
      gE.fillRect(x - anchoBarra / 2, techo, anchoBarra, H - techo);
      gE.fillStyle = 'rgb(' + b.color.join(',') + ')';
      gE.fillRect(x - anchoBarra / 2, H - m * (H - techo), anchoBarra, m * (H - techo));
    }

    // Etiquetas (cortas si no caben)
    const angosta = W / escala / marcadores.etiquetas.length < 95;
    gE.textAlign = 'center';
    for (const e of marcadores.etiquetas) {
      const x = xDeFrecuencia(e.f, W);
      gE.fillStyle = 'rgb(' + e.color.join(',') + ')';
      gE.font = '600 ' + 13 * escala + 'px "Segoe UI", system-ui, sans-serif';
      gE.fillText(angosta ? e.corto : e.texto, x, 14 * escala);
      if (!angosta || W / escala > 700) {
        gE.fillStyle = 'rgba(223, 230, 247, 0.65)';
        gE.font = 11 * escala + 'px Consolas, ui-monospace, monospace';
        gE.fillText(e.sub, x, 29 * escala);
      }
    }
  }

  // Cascada: cada cuadro agrega un renglón arriba; el tiempo corre hacia abajo.
  function dibujarCascada() {
    const W = cascada.width, H = cascada.height;
    const alto = 2;
    gC.drawImage(cascada, 0, 0, W, H - alto, 0, alto, W, H - alto);
    const renglon = gC.createImageData(W, alto);
    for (let x = 0; x < W; x++) {
      const f = PANTALLA.fMin + x / W * (PANTALLA.fMax - PANTALLA.fMin);
      const a = Math.pow(magnitud(f), 1.6);
      const c = colorPorColumna[x];
      for (let y = 0; y < alto; y++) {
        const i = (y * W + x) * 4;
        renglon.data[i] = PANTALLA.fondo[0] + (c[0] - PANTALLA.fondo[0]) * a;
        renglon.data[i + 1] = PANTALLA.fondo[1] + (c[1] - PANTALLA.fondo[1]) * a;
        renglon.data[i + 2] = PANTALLA.fondo[2] + (c[2] - PANTALLA.fondo[2]) * a;
        renglon.data[i + 3] = 255;
      }
    }
    gC.putImageData(renglon, 0, 0);
  }

  function cuadro() {
    if (audio.analizador) {
      if (!datos) datos = new Uint8Array(audio.analizador.frequencyBinCount);
      audio.analizador.getByteFrequencyData(datos);
      dibujarCascada();
    }
    dibujarEspectro();
    requestAnimationFrame(cuadro);
  }

  pantalla.alCambiar = calcularColores;
  window.addEventListener('resize', ajustarTamano);
  ajustarTamano();
  cuadro();
}

// ---------- Trama, bit por bit ----------

const NOMBRE_DE_TRAMO = {
  cabecera: 'Cabecera: control, número de trama y longitud (siempre con Hamming)',
  datos: 'Datos',
  crc: 'CRC-16',
  entrelazado: 'Datos y CRC entrelazados: cada carácter mezcla bits de muchos grupos',
  paralelo: 'Datos y CRC en paralelo: 8 bits por símbolo, uno por canal',
};

function aHex(n, digitos) {
  return n.toString(16).toUpperCase().padStart(digitos, '0');
}

// Texto corto bajo cada carácter.
function etiquetaDeElemento(seccion, byte, indiceCabecera) {
  if (byte === null || byte === undefined) return '';
  if (seccion === 'cabecera') {
    if (indiceCabecera === 0) return 'control';
    if (indiceCabecera === 1) return 'trama ' + ((byte >> 4) + 1) + ' de ' + ((byte & 15) + 1);
    const n = (byte & 15) + 1;
    return n + (n === 1 ? ' byte' : ' bytes');
  }
  if (seccion === 'crc') return aHex(byte, 2);
  return byte === 32 ? '␣' : (byte > 32 && byte < 127 ? String.fromCharCode(byte) : aHex(byte, 2));
}

class VistaDeTrama {
  constructor(contenedor, textoVacio) {
    this.contenedor = contenedor;
    this.textoVacio = textoVacio;
    this.mostrarVacio();
  }

  mostrarVacio() {
    this.limpiar();
    const p = document.createElement('p');
    p.className = 'vacio';
    p.textContent = this.textoVacio;
    this.contenedor.append(p);
  }

  limpiar() {
    this.contenedor.textContent = '';
    this.elementos = [];     // por elemento: { celdas, valor, caja }
    this.ranuras = [];       // por ranura de tiempo: las celdas que suenan juntas
    this.seccion = null;
    this.avance = -1;
  }

  nuevoTramo(nombre) {
    const tramo = document.createElement('div');
    tramo.className = 'tramo';
    const titulo = document.createElement('span');
    titulo.className = 'tramo-nombre';
    titulo.textContent = nombre;
    this.tramo = document.createElement('div');
    this.tramo.className = 'tramo-cuerpo';
    tramo.append(titulo, this.tramo);
    this.contenedor.append(tramo);
  }

  preambulo(banda) {
    this.nuevoTramo('Preámbulo');
    const tono = document.createElement('span');
    tono.className = 'tono-fijo';
    tono.textContent = CONFIG.bandas[banda || 'normal'].preambulo + ' Hz, ' + CONFIG.preambuloMs + ' ms';
    this.tramo.append(tono);
  }

  // desc = { tipo: 'caracter' | 'simbolo', seccion, tipos }
  iniciarElemento(desc) {
    if (desc.seccion !== this.seccion) {
      this.seccion = desc.seccion;
      this.nuevoTramo(NOMBRE_DE_TRAMO[desc.seccion]);
    }
    const caja = document.createElement('div');
    caja.className = desc.tipo === 'simbolo' ? 'caracter simbolo' : 'caracter';
    const fila = document.createElement('div');
    fila.className = 'caracter-bits';
    const celdas = desc.tipos.map((tipo) => {
      const celda = document.createElement('i');
      celda.className = 'bit pendiente t-' + tipo;
      celda.textContent = '0';
      fila.append(celda);
      return celda;
    });
    if (desc.tipo === 'simbolo') this.ranuras.push(celdas);
    else for (const c of celdas) this.ranuras.push([c]);

    const valor = document.createElement('span');
    valor.className = 'caracter-valor';
    caja.append(fila, valor);
    this.tramo.append(caja);
    this.elementos.push({ celdas, valor, caja });
    if (this.avance < 0) this.contenedor.scrollTop = this.contenedor.scrollHeight;
  }

  actual() { return this.elementos[this.elementos.length - 1]; }

  bit(indice, valor) {
    const celda = this.actual().celdas[indice];
    if (!celda) return;
    celda.textContent = valor;
    celda.classList.remove('pendiente');
    celda.classList.toggle('v1', valor === 1);
  }

  simbolo(valores) {
    valores.forEach((v, i) => this.bit(i, v));
  }

  // r = { valores, estados, byte, seccion, indiceCabecera, formatoOk, paridadOk }
  terminarElemento(r, indice) {
    const el = indice === undefined ? this.actual() : this.elementos[indice];
    r.valores.forEach((v, i) => {
      const celda = el.celdas[i];
      celda.textContent = v;
      celda.classList.remove('pendiente');
      celda.classList.toggle('v1', v === 1);
      if (r.estados && r.estados[i] !== 'ok') celda.classList.add('e-' + r.estados[i]);
    });
    el.valor.textContent = etiquetaDeElemento(r.seccion, r.byte, r.indiceCabecera);
    if (r.formatoOk === false || r.paridadOk === false) el.caja.classList.add('malo');
  }

  marcar(e, p, estado) {
    const el = this.elementos[e];
    if (!el || !el.celdas[p]) return;
    el.celdas[p].classList.remove('e-error', 'e-corregido');
    el.celdas[p].classList.add('e-' + estado);
    if (estado === 'error') el.caja.classList.add('malo');
  }

  // Dibuja de una vez una trama ya armada (lado emisor).
  pintar(elementos, banda) {
    this.limpiar();
    this.preambulo(banda);
    for (const el of elementos) {
      this.iniciarElemento({ tipo: el.tipo, seccion: el.seccion, tipos: el.bits.map((b) => b.tipo) });
      this.terminarElemento({ valores: el.bits.map((b) => b.v), estados: el.bits.map((b) => b.estado || 'ok'),
        byte: el.byte, seccion: el.seccion, indiceCabecera: el.indiceCabecera });
    }
    this.contenedor.scrollTop = 0;
    this.marcarAvance(-1);
  }

  // Resalta la ranura que está sonando en este momento.
  marcarAvance(indice) {
    if (indice === this.avance) return;
    this.avance = indice;
    this.ranuras.forEach((celdas, i) => {
      for (const celda of celdas) {
        celda.classList.toggle('sonando', i === indice);
        celda.classList.toggle('por-sonar', i > indice && indice !== Infinity);
      }
    });
    const actual = this.ranuras[indice];
    if (actual) {
      const caja = this.contenedor;
      const arriba = actual[0].offsetTop;
      if (arriba > caja.scrollTop + caja.clientHeight - 70 || arriba < caja.scrollTop) caja.scrollTop = arriba - 50;
    }
    if (indice === Infinity) this.contenedor.scrollTop = 0;
  }
}
