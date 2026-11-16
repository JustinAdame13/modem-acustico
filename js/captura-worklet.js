// Corre en el hilo de audio del navegador: junta las muestras que
// llegan del micrófono y las manda a la página en bloques de 512.
class Captura extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bloque = new Float32Array(512);
    this.usados = 0;
  }
  process(entradas) {
    const canal = entradas[0][0];
    if (canal) {
      for (let i = 0; i < canal.length; i++) {
        this.bloque[this.usados++] = canal[i];
        if (this.usados === this.bloque.length) {
          this.port.postMessage(this.bloque.slice(0));
          this.usados = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('captura', Captura);
