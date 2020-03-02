// http://soundfile.sapp.org/doc/WaveFormat

const Wave = Object.freeze({
  Sine: 'Sine',
  Triangle: 'Triangle',
  Sawtooth: 'Sawtooth',
  Square: 'Square',
});

// --------------------------------------------------------------------------- 

let durationInput;
let waveTypePicker;
let dutyCycleLabel;
let dutyCycleInput;

// --------------------------------------------------------------------------- 

function samplesToWav(samples) {
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
  return 'data:Audio/WAV;base64,' + base64;
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

function setInterpolators(pieces) {
  for (let i = 0; i < pieces.length - 1; i += 1) {
    let current = pieces[i];
    let next = pieces[i + 1];

    if (current.interpolant === 'constant') {
      current.interpolate = constantInterpolant(current.value);
    } else if (current.interpolant === 'linear') {
      current.interpolate = linearInterpolant(current.time, current.value, next.time, next.value);
    } else if (current.interpolant === 'quadratic') {
      current.interpolate = quadraticInterpolant(current.time, current.value, current.control.time, current.control.value, next.time, next.value);
    } else {
      console.log("boo");
    }
  }
}

function constantInterpolant(value) {
  return () => value;
}

function linearInterpolant(fromTime, fromValue, toTime, toValue) {
  const denominator = toTime - fromTime;
  return t => {
    const p = (t - fromTime) / denominator;
    return (1 - p) * fromValue + p * toValue;
  };
}

function quadraticInterpolant(fromTime, fromValue, throughTime, throughValue, toTime, toValue) {
  const denominator = (fromTime - throughTime) * (fromTime - toTime) * (throughTime - toTime);
  const a = (toTime * (throughValue - fromValue) + throughTime * (fromValue - toValue) + fromTime * (toValue - throughValue)) / denominator;
  const b = (toTime * toTime * (fromValue - throughValue) + throughTime * throughTime * (toValue - fromValue) + fromTime * fromTime * (throughValue - toValue)) / denominator;
  const c = (throughTime * toTime * (throughTime - toTime) * fromValue + toTime * fromTime * (toTime - fromTime) * throughValue + fromTime * throughTime * (fromTime - fromTime) * toValue) / denominator;
  return t => {
    return a * t * t + b * t + c;
  };
}

function effectToSamples(effect) {
  setInterpolators(effect.frequencies);
  setInterpolators(effect.amplitudes);

  const nsamples = Math.round(effect.duration * effect.rate);
  let samples = new Array(nsamples);
  let p = 0;

  let frequencyIndex = 0;
  let amplitudeIndex = 0;

  let generator;
  if (effect.waveType === Wave.Sine) {
    generator = sine;
  } else if (effect.waveType === Wave.Sawtooth) {
    generator = sawtooth;
  } else if (effect.waveType === Wave.Triangle) {
    generator = triangle;
  } else if (effect.waveType === Wave.Square) {
    generator = square(effect.dutyCycle);
  } else {
    throw new Error('bad wave type');
  }

  for (let sampleIndex = 0; sampleIndex < nsamples; sampleIndex += 1) {
    const t = sampleIndex / (nsamples - 1);

    // Advance to next pieces as needed.
    if (t > effect.frequencies[frequencyIndex + 1].time) {
      frequencyIndex += 1;
    }
    if (t > effect.amplitudes[amplitudeIndex + 1].time) {
      amplitudeIndex += 1;
    }

    const frequencyA = effect.frequencies[frequencyIndex];
    const frequencyB = effect.frequencies[frequencyIndex + 1];
    const amplitudeA = effect.amplitudes[amplitudeIndex];
    const amplitudeB = effect.amplitudes[amplitudeIndex + 1];

    // Interpolate.
    const frequencyT = (t - frequencyA.time) / (frequencyB.time - frequencyA.time);
    const amplitudeT = (t - amplitudeA.time) / (amplitudeB.time - amplitudeA.time);
    const frequency = frequencyA.interpolate(t);
    const amplitude = amplitudeA.interpolate(t);

    const cyclesPerSample = frequency / effect.rate;

    samples[sampleIndex] = generator(p) * amplitude; p += cyclesPerSample; if (p >= 1) {
      p -= 1;
    }
  }

  return samples;
}

const effect = {
  rate: 22050,
  waveType: Wave.Sawtooth,
  dutyCycle: 0.2,
  duration: 1,
  frequencies: [
    // {time: 0, value: 440, interpolant: 'constant'},
    // {time: 0.2, value: 880, interpolant: 'constant'},
    // {time: 0.5, value: 1320, interpolant: 'constant'},
    // {time: 1, value: 1760},

    // {time: 0, value: 880, interpolant: 'constant'},
    // {time: 0.5, value: 880, interpolant: 'linear'},
    // {time: 0.75, value: 3000, interpolant: 'linear'},
    // {time: 1, value: 0 },

    {name: 'whoop', time: 0, value: 880, control: {time: 0.5, value: 3000}, interpolant: 'quadratic'},
    {name: 'end', time: 1, value: 200},

    // [0, 880],
    // [0.5, 880],
    // [0.75, 3000],
    // [1, 0],
  ],
  amplitudes: [
    // {time: 0, value: 0, interpolant: 'linear'},
    // {time: 0.1, value: 1, interpolant: 'constant'},
    // {time: 0.5, value: 1, interpolant: 'linear'},
    // {time: 1, value: 0 },

    {name: 'start', time: 0, value: 1, interpolant: 'constant'},
    {name: 'end', time: 1, value: 1 },

    // [0, 0],
    // [0.1, 1],
    // [0.5, 1],
    // [1, 0],
  ],
};

function generateWav() {
  const samples = effectToSamples(effect);
  const wav = samplesToWav(samples);
  player.src = wav;
}

function initialize() {
  durationInput = document.getElementById('duration-input');
  waveTypePicker = document.getElementById('wave-type-picker');
  dutyCycleLabel = document.getElementById('duty-cycle-label');
  dutyCycleInput = document.getElementById('duty-cycle-input');
  player = document.getElementById('player');

  for (let type of Object.keys(Wave)) {
    let option = document.createElement('option');
    option.value = type;
    option.textContent = type.toLowerCase();
    waveTypePicker.appendChild(option);
  }

  const registerFloatListener = (input, key) => {
    input.addEventListener('input', () => {
      if (input.value.match(/^\d+(\.\d+)?$/)) {
        effect[key] = parseFloat(input.value);
        input.classList.remove('error');
      } else {
        input.classList.add('error');
      }
    });
  };

  registerFloatListener(durationInput, 'duration');
  registerFloatListener(dutyCycleInput, 'dutyCycle');

  waveTypePicker.addEventListener('change', event => {
    effect.waveType = waveTypePicker.value;
    syncWaveOptions();
  });

  const generateWavButton = document.getElementById('generate-wav-button');
  generateWavButton.addEventListener('click', generateWav);

  load(effect);
}

function syncWaveOptions() {
  dutyCycleInput.value = effect.dutyCycle;
  if (effect.waveType === Wave.Square) {
    dutyCycleLabel.style.display = 'inline';
    dutyCycleInput.style.display = 'inline';
  } else {
    dutyCycleLabel.style.display = 'none';
    dutyCycleInput.style.display = 'none';
  }
}

function load(effect) {
  durationInput.value = effect.duration;
  waveTypePicker.value = effect.waveType;
  syncWaveOptions();
}

document.addEventListener('DOMContentLoaded', initialize);
