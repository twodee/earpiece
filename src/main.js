function generateWav() {
  let index = 0;

  const putString = text => {
    for (let i = 0; i < text.length; ++i) {
      view.setUint8(index, text.charCodeAt(i));
      index += 1;
    }
  };

  const putInt = x => {
    view.setUint32(index, x);
    index += 4;
  };

  const putShort = x => {
    view.setUint16(index, x);
    index += 2;
  };

  const putSample = x => {
    view.setInt16(index, x);
    index += 2;
  };

  const nsamples = 5000;
  const a = 36 + nsamples * 2;
  const b = 2 * 8;
  const c = 1;
  const d = 22050;
  const e = d * 2;
  const f = 2;
  const g = 16;
  const h = nsamples * 2;

  const size = 4 * 9 + 2 * 4 + 2 * nsamples;

  let buffer = new ArrayBuffer(size);
  let view = new DataView(buffer);

  putString('RIFF');
  putInt(a);
  putString('WAVE');
  putString('fmt ');
  putInt(b);
  putShort(c);
  putShort(c);
  putInt(d);
  putInt(e);
  putShort(f);
  putShort(g);
  putString('data');
  putInt(h);

  for (let i = 0; i < nsamples; ++i) {
    putSample(parseInt(Math.random() * 65536) - 32768);
  }

  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; ++i) {
    binary += String.fromCharCode(bytes[i]);
  }

  let base64 = btoa(binary);
  let wav = new Audio('data:Audio/WAV;base64,' + base64);
  wav.setAttribute('controls', 'controls');
  // wav.play();
  document.body.appendChild(wav);
}

generateWav();
