// http://soundfile.sapp.org/doc/WaveFormat

function generateWav(samples) {
  let index = 0;

  const putString = text => {
    for (let i = 0; i < text.length; ++i) {
      view.setUint8(index, text.charCodeAt(i));
      index += 1;
    }
  };

  const putInt = x => {
    view.setUint32(index, x, true);
    index += 4;
  };

  const putShort = x => {
    view.setUint16(index, x, true);
    index += 2;
  };

  const putSample = x => {
    view.setInt16(index, x, true);
    index += 2;
  };

  const a = 36 + samples.length * 2;
  const b = 2 * 8;
  const c = 1;
  const d = 22050;
  const e = d * 2;
  const f = 2;
  const g = 16;
  const h = samples.length * 2;

  const size = 4 * 9 + 2 * 4 + 2 * samples.length;

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

  for (let i = 0; i < samples.length; ++i) {
    putSample(parseInt(samples[i] * 32767));
  }

  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; ++i) {
    binary += String.fromCharCode(bytes[i]);
  }

  let base64 = btoa(binary);
  let wav = new Audio('data:Audio/WAV;base64,' + base64);
  wav.setAttribute('controls', 'controls');
  document.body.appendChild(wav);
}

function getRandom() {
  let samples = new Array(50000);
  for (let i = 0; i < samples.length; ++i) {
    samples[i] = parseInt(Math.random() * 65536) - 32768;
  }
  return samples;
}

function sine(p) {
  return Math.sin(2 * Math.PI * p);
}

function square(duty) {
  return p => {
    return p >= duty ? 0 : 1;
  };
}

function sawtooth(p) {
  return p;
}

function triangle(p) {
  return 2 * (0.5 - Math.abs(0.5 - p));
}

function sample(f) {
  const frequencies = [440, 880, 1000, 1500];
  const clipLength = 10000;
  let samples = new Array(frequencies.length * clipLength);
  let p = 0;

  for (let [fi, frequency] of frequencies.entries()) {
    let cyclesPerSample = frequency / 22050.0;
    for (let si = fi * clipLength; si < (fi + 1) * clipLength; ++si) {
      samples[si] = f(p) * 32767;
      p += cyclesPerSample;
      if (p >= 1) {
        p -= 1;
      }
    }
  }

  return samples;
}

function generateSamples(effect) {
  const nsamples = Math.round(effect.duration * effect.rate);
  let samples = new Array(nsamples);
  let p = 0;

  let frequencyIndex = 0;
  let amplitudeIndex = 0;

  for (let sampleIndex = 0; sampleIndex < nsamples; sampleIndex += 1) {
    const proportion = sampleIndex / (nsamples - 1);

    // Advance to next pieces as needed.
    if (proportion > effect.frequencies[frequencyIndex + 1][0]) {
      frequencyIndex += 1;
    }
    if (proportion > effect.amplitudes[amplitudeIndex + 1][0]) {
      amplitudeIndex += 1;
    }

    const frequencyA = effect.frequencies[frequencyIndex];
    const frequencyB = effect.frequencies[frequencyIndex + 1];
    const amplitudeA = effect.amplitudes[amplitudeIndex];
    const amplitudeB = effect.amplitudes[amplitudeIndex + 1];

    // Interpolate frequency.
    const frequencyT = (proportion - frequencyA[0]) / (frequencyB[0] - frequencyA[0]);
    const frequency = (1 - frequencyT) * frequencyA[1] + frequencyT * frequencyB[1];

    // Interpolate amplitude.
    const amplitudeT = (proportion - amplitudeA[0]) / (amplitudeB[0] - amplitudeA[0]);
    const amplitude = (1 - amplitudeT) * amplitudeA[1] + amplitudeT * amplitudeB[1];

    const cyclesPerSample = frequency / effect.rate;

    samples[sampleIndex] = effect.generator(p) * amplitude; p += cyclesPerSample; if (p >= 1) {
      p -= 1;
    }
  }

  return samples;
}

const effect = {
  rate: 11025,
  generator: sawtooth,
  duration: 1,
  frequencies: [
    [0, 880],
    [0.5, 880],
    [0.75, 3000],
    [1, 0],
  ],
  amplitudes: [
    [0, 1],
    [0.5, 1],
    [1, 0],
  ],
};

generateWav(generateSamples(effect));

// generateWav(sample(sine));
// generateWav(sample(sawtooth));
// generateWav(sample(triangle));
// generateWav(sample(square(0.1)));
// generateWav(sample(square(0.2)));
// generateWav(sample(square(0.4)));
// generateWav(sample(square(0.5)));
// generateWav(sample(square(0.6)));
// generateWav(sample(square(0.8)));
// generateWav(sample(square(0.95)));
