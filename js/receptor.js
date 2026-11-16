// ============================================================
//  receptor.js — Recepción: dibujar bits, verificar, armar el mensaje
//  y contestar al emisor (ARQ).
// ============================================================

const vistaRx = new VistaDeTrama($('trama-rx'), 'Los bits se dibujan aquí conforme llegan.');
let bytesEnCurso = [];

// El demodulador avisa aquí de todo lo que va pasando.
function alEventoDelReceptor(nombre, d) {
  if (nombre === 'preambulo') {
    vistaRx.limpiar();
    vistaRx.preambulo(bandaRx());
    $('titulo-rx').textContent = 'Bits recibidos';
    bytesEnCurso = [];
    $('recibido').dataset.tipo = 'recibiendo';
    $('veredicto').textContent = 'Recibiendo…';
    $('detalles').textContent = '';
    // Se sigue viendo lo que ya llegó del mensaje; la trama nueva se agrega al final.
    pintarMensajeArmado();
    const enCurso = document.createElement('span');
    enCurso.id = 'en-curso';
    $('texto-recibido').append(enCurso);
    if (!estado.enviando) fijarEstado('Preámbulo detectado: está llegando una trama', true);
  } else if (nombre === 'elemento-inicio') {
    if (d.seccion === 'paralelo' && pantalla.modo === 'normal') { estado.ultimoParalelo = true; actualizarPantalla(); }
    vistaRx.iniciarElemento(d);
  } else if (nombre === 'bit') {
    vistaRx.bit(d.indice, d.valor);
  } else if (nombre === 'simbolo') {
    vistaRx.simbolo(d.valores);
  } else if (nombre === 'elemento') {
    vistaRx.terminarElemento(d);
    if (d.seccion === 'cabecera' && d.indiceCabecera === 1) {
      const num = d.byte >> 4, total = (d.byte & 15) + 1;
      $('titulo-rx').textContent = 'Bits recibidos: trama ' + (num + 1) + ' de ' + total;
      // Primera trama: empieza un mensaje nuevo
      if (num === 0) for (const parte of [...$('texto-recibido').children]) if (parte.id !== 'en-curso') parte.remove();
    }
    if (d.seccion === 'datos' && d.byte !== null && $('en-curso')) {
      bytesEnCurso.push(d.byte);
      $('en-curso').textContent = bytesATexto(bytesEnCurso);
    }
  } else if (nombre === 'sin-sincronia') {
    $('recibido').dataset.tipo = 'espera';
    $('veredicto').textContent = 'Se oyó un preámbulo, pero no llegó el primer carácter';
    if (!estado.enviando) estadoDeReposo();
  } else if (nombre === 'trama') {
    procesarTrama(d);
  }
}

// ---------- Comparar con lo que debió llegar ----------

// Arma la trama que DEBIÓ llegar y cuenta los bits distintos.
// Sirve con el texto de prueba de las series, con el «texto esperado»
// o, en el canal interno, con lo que acaba de enviar el emisor.
function compararConEsperado(r) {
  if (!r.cabeceraOk || !r.completa) return null;
  const p = r.params;
  const intentar = (texto, esPrueba) => {
    const todos = textoABytes(texto);
    const desde = p.num < p.total - 1 ? p.num * p.longitud : todos.length - p.longitud;
    const parte = todos.slice(desde, desde + p.longitud);
    if (desde < 0 || parte.length !== p.longitud) return null;
    const esperada = construirTrama(p, parte);
    if (esperada.elementos.length !== r.registros.length) return null;
    let errores = 0, total = 0;
    esperada.elementos.forEach((el, e) => el.bits.forEach((b, k) => {
      total++;
      if (b.v !== r.registros[e].valores[k]) errores++;
    }));
    const logicos = new Set();
    esperada.logicos.forEach((v, j) => { if (v !== r.logicos[j]) logicos.add(j); });
    return { errores, total, logicos, esperada, esPrueba };
  };
  if (p.total === 1 && p.longitud === textoABytes(CONFIG.textoDePrueba).length) {
    const c = intentar(CONFIG.textoDePrueba, true);
    if (c && c.errores <= 0.2 * c.total) return c;
  }
  const texto = $('esperado').value || ((ajustes.canal === 'interno' || audio.eco) ? estado.ultimoEnviado : '');
  return texto ? intentar(texto, false) : null;
}

// ---------- Armado del mensaje ----------

// Guarda la trama en el mensaje que se está armando. Devuelve qué pasó con ella:
// 'ok', 'duplicada', 'descartada' o 'danada'.
function guardarEnMensaje(r) {
  const p = r.params;
  let rx = estado.rx;
  if (!rx || rx.id !== p.id || rx.total !== p.total || rx.modo !== p.modo || rx.variante !== p.variante) {
    rx = estado.rx = { id: p.id, total: p.total, modo: p.modo, variante: p.variante,
      partes: new Array(p.total).fill(null), malas: new Array(p.total).fill(null),
      estados: new Array(p.total).fill('pendiente'), esperado: 0 };
  }
  const n = p.num;
  const yaEstaba = rx.estados[n] === 'ok';
  let resultado;

  if (p.modo === 2 && p.variante !== 2) {
    // Pare y espere y Retroceda N: solo se acepta la trama que sigue, en orden.
    if (r.valido && n === rx.esperado) { resultado = 'ok'; rx.esperado++; }
    else if (r.valido && n < rx.esperado) resultado = 'duplicada';
    else if (r.valido) resultado = 'descartada';
    else resultado = 'danada';
  } else {
    // Rechazo selectivo y sin ARQ: cada trama buena se guarda en su lugar.
    if (r.valido) resultado = yaEstaba && p.modo === 2 ? 'duplicada' : 'ok';
    else resultado = 'danada';
  }

  if (resultado === 'ok') { rx.partes[n] = r.bytes; rx.estados[n] = 'ok'; rx.malas[n] = null; }
  else if (!yaEstaba && resultado !== 'duplicada') {
    rx.estados[n] = resultado;
    rx.malas[n] = r.bytes;
  }
  rx.completo = rx.estados.every((e) => e === 'ok');
  return resultado;
}

// Texto del mensaje: partes buenas normales, dañadas en rojo y faltantes con «…».
function pintarMensajeArmado() {
  const caja = $('texto-recibido');
  caja.textContent = '';
  const rx = estado.rx;
  if (!rx) return;
  let i = 0;
  while (i < rx.total) {
    const clase = rx.estados[i] === 'ok' ? 'ok' : (rx.malas[i] ? 'mala' : 'falta');
    let bytes = [];
    while (i < rx.total && (rx.estados[i] === 'ok' ? 'ok' : (rx.malas[i] ? 'mala' : 'falta')) === clase) {
      bytes = bytes.concat(clase === 'ok' ? rx.partes[i] : (rx.malas[i] || []));
      i++;
    }
    const span = document.createElement('span');
    span.className = 'parte-' + clase;
    span.textContent = clase === 'falta' ? '…' : bytesATexto(bytes);
    caja.append(span);
  }
}

function pintarTira() {
  const tira = $('tira');
  tira.textContent = '';
  const rx = estado.rx;
  if (!rx || rx.total === 1) { tira.hidden = true; return; }
  tira.hidden = false;
  const nombres = { pendiente: 'pendiente', ok: 'llegó bien', danada: 'dañada', descartada: 'descartada' };
  const titulo = document.createElement('span');
  titulo.className = 'tira-nombre';
  titulo.textContent = 'Tramas';
  tira.append(titulo);
  rx.estados.forEach((e, i) => {
    const caja = document.createElement('span');
    caja.className = 'tira-trama ' + e;
    caja.textContent = i + 1;
    caja.title = 'Trama ' + (i + 1) + ': ' + nombres[e];
    tira.append(caja);
  });
}

// ---------- Veredicto ----------

function motivoDeDano(r) {
  const p = r.params;
  if (r.aborto) return r.aborto;
  if (p.modo === 3) return 'hubo más de un error en un grupo y Hamming no alcanzó';
  const partes = [];
  if (r.erroresDeParidad > 0) partes.push('falló la paridad en ' + plural(r.erroresDeParidad, 'carácter', 'caracteres'));
  if (r.crcOk === false) partes.push('el CRC no coincide');
  return partes.join(' y ') || 'llegó incompleta';
}

function pintarVeredicto(r, resultado, comparacion) {
  let texto, tipo;
  if (!r.cabeceraOk) {
    texto = 'Cabecera dañada: no se pudo leer la trama'; tipo = 'mal';
  } else {
    const p = r.params;
    const prefijo = p.total > 1 ? 'Trama ' + (p.num + 1) + ' de ' + p.total + ': ' : '';
    if (resultado === 'danada') { texto = prefijo + 'dañada, ' + motivoDeDano(r); tipo = 'mal'; }
    else if (resultado === 'descartada') { texto = prefijo + 'llegó bien pero fuera de orden; Retroceda N la descarta'; tipo = 'aviso'; }
    else if (resultado === 'duplicada') { texto = prefijo + 'repetida, ya se tenía; se vuelve a confirmar'; tipo = 'bien'; }
    else if (p.modo === 0) { texto = prefijo + 'recibida sin verificar: puede traer errores y no hay forma de saberlo'; tipo = 'espera'; }
    else {
      texto = prefijo + (r.bitsCorregidos > 0
        ? 'correcta. Hamming corrigió ' + plural(r.bitsCorregidos, 'bit', 'bits') + ' y el CRC coincide'
        : 'correcta, el CRC coincide');
      tipo = 'bien';
    }
    if (estado.rx && estado.rx.total > 1 && estado.rx.completo && resultado !== 'duplicada') {
      texto += '. Mensaje completo.';
    }
  }
  $('recibido').dataset.tipo = tipo;
  $('veredicto').textContent = texto;
  pintarMensajeArmado();

  // Detalles de la verificación
  const detalles = [];
  if (r.cabeceraOk) {
    const p = r.params;
    detalles.push(['Modo', nombreDeConfiguracion(p)]);
    if (r.crcRecibido !== null) {
      detalles.push(['CRC recibido', aHex(r.crcRecibido, 4)]);
      detalles.push(['CRC calculado', aHex(r.crcCalculado, 4)]);
    }
    if (p.modo === 1 || p.modo === 2) detalles.push(['Errores de paridad', r.erroresDeParidad]);
    if (r.bitsCorregidos > 0) detalles.push(['Bits corregidos', r.bitsCorregidos]);
  }
  if (comparacion) detalles.push(['Bits erróneos en el aire', comparacion.errores + ' de ' + comparacion.total]);
  const dl = $('detalles');
  dl.textContent = '';
  for (const [nombre, valor] of detalles) {
    const fila = document.createElement('div');
    const dt = document.createElement('dt'); dt.textContent = nombre;
    const dd = document.createElement('dd'); dd.textContent = valor;
    fila.append(dt, dd);
    dl.append(fila);
  }
  return tipo;
}

// ---------- Procesar una trama completa ----------

function procesarTrama(r) {
  for (const m of r.marcas) vistaRx.marcar(m.e, m.p, m.estado);
  if (r.cabeceraOk) { estado.ultimoParalelo = r.params.paralelo; actualizarPantalla(); }

  const comparacion = compararConEsperado(r);
  const resultado = r.cabeceraOk && !r.aborto ? guardarEnMensaje(r) : (r.cabeceraOk ? 'danada' : null);
  pintarTira();
  const tipo = pintarVeredicto(r, resultado, comparacion);
  if (r.cabeceraOk && r.params.modo === 3 && r.completa) {
    pintarMatriz(r, comparacion ? comparacion.logicos : null, comparacion ? comparacion.esperada : null);
  }

  const nivel = 'Señal ' + r.nivelDb.toFixed(0) + ' dB';
  $('nivel-linea').textContent = r.snrDb === null ? nivel : nivel + ', ruido ' + r.ruidoDb.toFixed(0) + ' dB, S/N ' + r.snrDb.toFixed(0) + ' dB';

  // Estadísticas
  const s = estado.stats;
  if (tipo === 'mal') s.danadas++; else s.correctas++;
  s.detectados += r.erroresDeParidad + (r.crcOk === false ? 1 : 0) + (r.cabeceraOk ? 0 : 1);
  s.corregidos += r.bitsCorregidos;
  pintarStats();

  registrarRecepcion(r, resultado, tipo, comparacion);
  if (!estado.enviando) estadoDeReposo();

  // ARQ: contestar si la trama lo pide
  if (r.cabeceraOk && r.params.modo === 2 && r.params.pideRespuesta) responder(r.params);
}

// ---------- Respuesta del ARQ ----------

function responder(p) {
  const rx = estado.rx;
  const m = VARIANTES_ARQ[p.variante].ventana;
  let tipo, byte, texto;
  if (p.variante === 2) {
    // Rechazo selectivo: mapa de la ventana (1 = ya llegó bien)
    const base = Math.floor(p.num / m) * m;
    let mapa = 0;
    const faltan = [];
    for (let i = 0; i < m; i++) {
      if (base + i >= p.total || rx.estados[base + i] === 'ok') mapa |= 1 << i;
      else faltan.push('T' + (base + i + 1));
    }
    tipo = mapa === 15 ? 'ack' : 'nack';
    byte = (base << 4) | mapa;
    texto = tipo === 'ack' ? 'la ventana llegó completa, contesta ACK' : 'faltan ' + faltan.join(' y ') + ', contesta NACK';
  } else {
    // Pare y espere y Retroceda N: número de la siguiente trama que espera
    tipo = rx.esperado > p.num ? 'ack' : 'nack';
    byte = (rx.esperado & 15) << 4;
    texto = rx.esperado >= p.total ? 'tiene el mensaje completo, contesta ACK'
      : (tipo === 'ack' ? 'contesta ACK, espera T' : 'contesta NACK, pide desde T') + (rx.esperado + 1);
  }
  setTimeout(async () => {
    anotar('Receptor: ' + texto + '.', tipo === 'ack' ? 'bien' : 'mal');
    await transmitir(sintetizar(tonosDeRespuesta(tipo, byte, CONFIG.duracionBitMs), audio.ctx.sampleRate, CONFIG.volumen));
  }, CONFIG.arq.pausaAntesDeResponderMs);
}
