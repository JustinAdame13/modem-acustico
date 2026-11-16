// ============================================================
//  vista.js — Lo que se dibuja: espectro en vivo y trama bit por bit
// ============================================================

// Cada tono tiene su color en la pantalla del espectro.
const TONOS_EN_PANTALLA = [
  { clave: 'cero', etiqueta: 'Bit 0', corta: '0', color: [76, 201, 240] },
  { clave: 'uno', etiqueta: 'Bit 1', corta: '1', color: [255, 180, 84] },
  { clave: 'preambulo', etiqueta: 'Preámbulo', corta: 'Pre', color: [183, 156, 255] },
  { clave: 'ack', etiqueta: 'ACK', corta: 'ACK', color: [91, 227, 164] },
  { clave: 'nack', etiqueta: 'NACK', corta: 'NACK', color: [255, 122, 133] },
];
const PANTALLA = { fMin: 900, fMax: 5600, fondo: [15, 24, 48], neutro: [150, 168, 210] };

function iniciarPantalla() {
  const espectro = document.getElementById('espectro');
  const cascada = document.getElementById('cascada');
  const gE = espectro.getContext('2d');
  const gC = cascada.getContext('2d');
  let colorPorColumna = [];
  let datos = null;

  const xDeFrecuencia = (f, ancho) => (f - PANTALLA.fMin) / (PANTALLA.fMax - PANTALLA.fMin) * ancho;

  function ajustarTamano() {
    const escala = window.devicePixelRatio || 1;
    for (const lienzo of [espectro, cascada]) {
      lienzo.width = Math.round(lienzo.clientWidth * escala);
      lienzo.height = Math.round(lienzo.clientHeight * escala);
    }
    // Color de cada columna de la cascada: el del tono más cercano, o gris azulado.
    colorPorColumna = [];
    for (let x = 0; x < cascada.width; x++) {
      const f = PANTALLA.fMin + x / cascada.width * (PANTALLA.fMax - PANTALLA.fMin);
      let color = PANTALLA.neutro;
      for (const t of TONOS_EN_PANTALLA) {
        if (Math.abs(f - CONFIG.frecuencias[t.clave]) < 130) color = t.color;
      }
      colorPorColumna.push(color);
    }
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
    const techo = 34 * escala;   // espacio para las etiquetas

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

    // Una barra y una etiqueta por cada tono del módem
    gE.textAlign = 'center';
    for (const t of TONOS_EN_PANTALLA) {
      const f = CONFIG.frecuencias[t.clave];
      const x = xDeFrecuencia(f, W);
      const m = Math.max(magnitud(f - 25), magnitud(f), magnitud(f + 25));
      const color = 'rgb(' + t.color.join(',') + ')';
      gE.fillStyle = 'rgba(' + t.color.join(',') + ',0.16)';
      gE.fillRect(x - 5 * escala, techo, 10 * escala, H - techo);
      gE.fillStyle = color;
      gE.fillRect(x - 5 * escala, H - m * (H - techo), 10 * escala, m * (H - techo));
      gE.font = '600 ' + 13 * escala + 'px "Segoe UI", system-ui, sans-serif';
      const angosta = W / escala < 560;   // en celular no caben las etiquetas largas
      gE.fillText(angosta ? t.corta : t.etiqueta, x, 14 * escala);
      gE.fillStyle = 'rgba(223, 230, 247, 0.65)';
      gE.font = 11 * escala + 'px Consolas, ui-monospace, monospace';
      gE.fillText(angosta ? String(f) : f + ' Hz', x, 28 * escala);
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

  window.addEventListener('resize', ajustarTamano);
  ajustarTamano();
  cuadro();
}

// ---------- Trama, bit por bit ----------

const NOMBRE_DE_TRAMO = {
  cabecera: 'Cabecera: modo y longitud (siempre con Hamming)',
  datos: 'Datos',
  crc: 'CRC-16',
};

function aHex(n, digitos) {
  return n.toString(16).toUpperCase().padStart(digitos, '0');
}

class VistaDeTrama {
  constructor(contenedor) {
    this.contenedor = contenedor;
    this.limpiar();
  }

  limpiar() {
    this.contenedor.textContent = '';
    this.celdas = [];        // todas las celdas de bit, en orden de transmisión
    this.tramo = null;
    this.seccion = null;
    this.cuenta = 0;
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

  preambulo() {
    this.nuevoTramo('Preámbulo');
    const tono = document.createElement('span');
    tono.className = 'tono-fijo';
    tono.textContent = CONFIG.frecuencias.preambulo + ' Hz, ' + CONFIG.preambuloMs + ' ms';
    this.tramo.append(tono);
  }

  iniciarCaracter(seccion, tipos) {
    if (seccion !== this.seccion) {
      this.seccion = seccion;
      this.cuenta = 0;
      this.nuevoTramo(NOMBRE_DE_TRAMO[seccion]);
    }
    this.caracter = document.createElement('div');
    this.caracter.className = 'caracter';
    const fila = document.createElement('div');
    fila.className = 'caracter-bits';
    this.celdasActuales = tipos.map((tipo) => {
      const celda = document.createElement('i');
      celda.className = 'bit pendiente t-' + tipo;
      celda.textContent = '0';
      fila.append(celda);
      this.celdas.push(celda);
      return celda;
    });
    this.valor = document.createElement('span');
    this.valor.className = 'caracter-valor';
    this.caracter.append(fila, this.valor);
    this.tramo.append(this.caracter);
    this.contenedor.scrollTop = this.contenedor.scrollHeight;
  }

  bit(indice, valor) {
    const celda = this.celdasActuales[indice];
    celda.textContent = valor;
    celda.classList.remove('pendiente');
    celda.classList.toggle('v1', valor === 1);
  }

  // caracter = { byte, bits:[{v, estado}], paridadOk, formatoOk }
  terminarCaracter(caracter) {
    caracter.bits.forEach((b, i) => {
      this.bit(i, b.v);
      if (b.estado !== 'ok') this.celdasActuales[i].classList.add('e-' + b.estado);
    });
    const b = caracter.byte;
    let texto;
    if (this.seccion === 'cabecera') texto = this.cuenta === 0 ? 'control' : b + (b === 1 ? ' byte' : ' bytes');
    else if (this.seccion === 'crc') texto = aHex(b, 2);
    else texto = b === 32 ? '␣' : (b > 32 && b < 127 ? String.fromCharCode(b) : aHex(b, 2));
    this.valor.textContent = texto;
    if (caracter.paridadOk === false || caracter.formatoOk === false) this.caracter.classList.add('malo');
    this.cuenta++;
  }

  // Dibuja de una vez una trama ya armada (lado emisor).
  pintar(trama, danados) {
    this.limpiar();
    this.preambulo();
    let n = 0;
    for (const c of trama.caracteres) {
      this.iniciarCaracter(c.seccion, c.bits.map((b) => b.tipo));
      const bits = c.bits.map((b) => {
        const danado = danados.includes(n++);
        return { v: danado ? b.v ^ 1 : b.v, estado: danado ? 'error' : 'ok' };
      });
      this.terminarCaracter({ byte: c.byte, bits });
    }
    this.contenedor.scrollTop = 0;
    this.marcarAvance(-1);
  }

  // Resalta el bit que está sonando en este momento.
  marcarAvance(indice) {
    if (indice === this.avance) return;
    this.avance = indice;
    if (indice === Infinity) this.contenedor.scrollTop = 0;
    this.celdas.forEach((celda, i) => {
      celda.classList.toggle('sonando', i === indice);
      celda.classList.toggle('por-sonar', i > indice && indice !== Infinity);
    });
    const actual = this.celdas[indice];
    if (actual) {
      const caja = this.contenedor;
      const arriba = actual.offsetTop;
      if (arriba > caja.scrollTop + caja.clientHeight - 60 || arriba < caja.scrollTop) caja.scrollTop = arriba - 40;
    }
  }
}
