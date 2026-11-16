// ============================================================
//  diagrama.js — Diagrama del enlace (como los de los libros de ARQ)
//  Dos líneas verticales, emisor y receptor; el tiempo corre hacia abajo.
//  Cada trama es una flecha de ida y cada respuesta una flecha de regreso.
// ============================================================

const ESTADOS_DE_TRAMA = {
  enviada: { texto: 'en camino', clase: 'pendiente' },
  ok: { texto: 'llegó bien', clase: 'bien' },
  danada: { texto: 'dañada', clase: 'mal' },
  descartada: { texto: 'descartada', clase: 'descartada' },
  sinRespuesta: { texto: 'sin confirmar', clase: 'pendiente' },
  simplex: { texto: 'sin confirmación', clase: 'neutra' },
};

class DiagramaDelEnlace {
  constructor(contenedor) {
    this.contenedor = contenedor;
    this.limpiar();
  }

  limpiar() {
    this.filas = [];
    this.dibujar();
  }

  mensaje(texto) { this.filas.push({ clase: 'mensaje', texto }); this.dibujar(); }

  // Devuelve la fila para poder cambiar su estado cuando llegue la respuesta.
  trama(num, total, intento) {
    const fila = { clase: 'trama', num, total, intento, estado: 'enviada' };
    this.filas.push(fila);
    this.dibujar();
    return fila;
  }

  estadoDe(fila, estado) { fila.estado = estado; this.dibujar(); }

  respuesta(tipo, texto) { this.filas.push({ clase: 'respuesta', tipo, texto }); this.dibujar(); }

  tiempoAgotado(texto) { this.filas.push({ clase: 'tiempo', texto }); this.dibujar(); }

  dibujar() {
    const NS = 'http://www.w3.org/2000/svg';
    const ancho = 600, izq = 92, der = 462, inicio = 44;
    const altos = { mensaje: 34, trama: 40, respuesta: 40, tiempo: 30 };
    const alto = inicio + this.filas.reduce((s, f) => s + altos[f.clase], 0) + 16;

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + ancho + ' ' + alto);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Diagrama de tramas y respuestas entre emisor y receptor');
    const nuevo = (nombre, atributos, texto) => {
      const el = document.createElementNS(NS, nombre);
      for (const [k, v] of Object.entries(atributos)) el.setAttribute(k, v);
      if (texto !== undefined) el.textContent = texto;
      svg.append(el);
      return el;
    };

    // Puntas de flecha, una por color
    const defs = nuevo('defs', {});
    for (const clase of ['pendiente', 'bien', 'mal', 'descartada', 'neutra']) {
      const m = document.createElementNS(NS, 'marker');
      for (const [k, v] of Object.entries({ id: 'punta-' + clase, viewBox: '0 0 10 10', refX: 9, refY: 5,
        markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' })) m.setAttribute(k, v);
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', 'M0,0 L10,5 L0,10 z');
      p.setAttribute('class', 'punta ' + clase);
      m.append(p);
      defs.append(m);
    }

    nuevo('text', { x: izq, y: 18, class: 'actor', 'text-anchor': 'middle' }, 'Emisor');
    nuevo('text', { x: der, y: 18, class: 'actor', 'text-anchor': 'middle' }, 'Receptor');
    nuevo('line', { x1: izq, y1: 28, x2: izq, y2: alto - 6, class: 'vida' });
    nuevo('line', { x1: der, y1: 28, x2: der, y2: alto - 6, class: 'vida' });

    if (this.filas.length === 0) {
      nuevo('text', { x: ancho / 2, y: inicio + 30, class: 'vacio-svg', 'text-anchor': 'middle' }, 'Envía un mensaje para ver el diagrama.');
    }

    let y = inicio;
    for (const f of this.filas) {
      if (f.clase === 'mensaje') {
        nuevo('line', { x1: 8, y1: y + 6, x2: ancho - 8, y2: y + 6, class: 'separador' });
        nuevo('text', { x: ancho / 2, y: y + 24, class: 'mensaje-svg', 'text-anchor': 'middle' }, f.texto);
      } else if (f.clase === 'trama') {
        const e = ESTADOS_DE_TRAMA[f.estado];
        nuevo('line', { x1: izq, y1: y + 8, x2: der - 2, y2: y + 32, class: 'flecha ' + e.clase,
          'marker-end': 'url(#punta-' + e.clase + ')' });
        nuevo('text', { x: izq - 10, y: y + 13, class: 'etiqueta-svg', 'text-anchor': 'end' },
          'T' + (f.num + 1) + (f.intento > 1 ? ' (' + f.intento + '.º)' : ''));
        nuevo('text', { x: der + 10, y: y + 36, class: 'estado-svg ' + e.clase }, e.texto);
      } else if (f.clase === 'respuesta') {
        const clase = f.tipo === 'ack' ? 'bien' : 'mal';
        nuevo('line', { x1: der, y1: y + 8, x2: izq + 2, y2: y + 32, class: 'flecha respuesta ' + clase,
          'marker-end': 'url(#punta-' + clase + ')' });
        nuevo('text', { x: der + 10, y: y + 13, class: 'etiqueta-svg ' + clase }, f.tipo.toUpperCase());
        nuevo('text', { x: (izq + der) / 2, y: y + 14, class: 'nota-svg', 'text-anchor': 'middle' }, f.texto);
      } else {
        nuevo('circle', { cx: izq, cy: y + 14, r: 6, class: 'reloj' });
        nuevo('text', { x: izq + 14, y: y + 18, class: 'nota-svg mal' }, f.texto);
      }
      y += altos[f.clase];
    }

    this.contenedor.textContent = '';
    this.contenedor.append(svg);
    this.contenedor.scrollTop = this.contenedor.scrollHeight;
  }
}
