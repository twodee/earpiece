// http://soundfile.sapp.org/doc/WaveFormat

const Wave = Object.freeze({
  Sine: 'sine',
  Triangle: 'triangle',
  Sawtooth: 'sawtooth',
  Square: 'square',
});

const Interpolant = Object.freeze({
  Constant: 'constant',
  Linear: 'linear',
  Quadratic: 'quadratic',
});

// --------------------------------------------------------------------------- 

let durationInput;
let waveTypePicker;
let dutyCycleLabel;
let dutyCycleInput;

let piecePicker;
let pieceNameInput;
let startTimeInput;
let startValueInput;
let interpolantPicker;
let controlTimeLabel;
let controlTimeInput;
let controlValueLabel;
let controlValueInput;

let canvases = [];
let contexts;

let selectedPiece;

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
      current.interpolate = constantInterpolant(current.start.value);
    } else if (current.interpolant === 'linear') {
      current.interpolate = linearInterpolant(current.start.time, current.start.value, next.start.time, next.start.value);
    } else if (current.interpolant === 'quadratic') {
      current.interpolate = quadraticInterpolant(current.start.time, current.start.value, current.control.time, current.control.value, next.start.time, next.start.value);
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
    if (t > effect.frequencies[frequencyIndex + 1].start.time) {
      frequencyIndex += 1;
    }
    if (t > effect.amplitudes[amplitudeIndex + 1].start.time) {
      amplitudeIndex += 1;
    }

    const frequencyA = effect.frequencies[frequencyIndex];
    const frequencyB = effect.frequencies[frequencyIndex + 1];
    const amplitudeA = effect.amplitudes[amplitudeIndex];
    const amplitudeB = effect.amplitudes[amplitudeIndex + 1];

    // Interpolate.
    const frequencyT = (t - frequencyA.start.time) / (frequencyB.start.time - frequencyA.start.time);
    const amplitudeT = (t - amplitudeA.start.time) / (amplitudeB.start.time - amplitudeA.start.time);
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

    {name: 'whoop', start: {time: 0, value: 880}, interpolant: Interpolant.Quadratic, control: {time: 0.5, value: 3000}},
    {name: 'end', start: {time: 1, value: 200}, interpolant: Interpolant.Constant},

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

    {name: 'start', start: {time: 0, value: 0.1}, interpolant: Interpolant.Constant},
    {name: 'mid', start: {time: 0.5, value: 0.5}, interpolant: Interpolant.Linear},
    {name: 'end', start: {time: 1, value: 1}, interpolant: Interpolant.Constant},

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

function hookElements() {
  durationInput = document.getElementById('duration-input');
  waveTypePicker = document.getElementById('wave-type-picker');
  dutyCycleLabel = document.getElementById('duty-cycle-label');
  dutyCycleInput = document.getElementById('duty-cycle-input');
  interpolantPicker = document.getElementById('interpolant-picker');
  piecePicker = document.getElementById('piece-picker');
  pieceNameInput = document.getElementById('piece-name-input');
  startTimeInput = document.getElementById('start-time-input');
  startValueInput = document.getElementById('start-value-input');
  controlTimeLabel = document.getElementById('control-time-label');
  controlTimeInput = document.getElementById('control-time-input');
  controlValueLabel = document.getElementById('control-value-label');
  controlValueInput = document.getElementById('control-value-input');
  player = document.getElementById('player');

  canvases.push(document.getElementById('frequency-canvas'));
  canvases.push(document.getElementById('amplitude-canvas'));
}

function resize() {
  for (let canvas of canvases) {
    const realWidth = canvas.clientWidth;
    const realHeight = canvas.clientHeight;
    if (realWidth !== canvas.width || realHeight !== canvas.height) {
      canvas.width = realWidth;
      canvas.height = realHeight;
    }
  }

  window.requestAnimationFrame(renderCanvases);
}

function renderCanvas(canvas, context, pieces, maximumY) {
  context.clearRect(0, 0, canvas.width, canvas.height);

  const gap = 10;
  const plotWidth = canvas.width - 2 * gap;
  const plotHeight = canvas.height - 2 * gap;

  const xify = x => gap + plotWidth * x;
  const yify = y => canvas.height - (gap + plotHeight * (y / maximumY));

  context.lineWidth = 0.4;
  context.strokeStyle = 'black';
  context.strokeRect(gap, gap, plotWidth, plotHeight);

  context.lineWidth = 1;
  context.strokeStyle = 'red';
  for (let i = 0; i < pieces.length - 1; ++i) {
    const curr = pieces[i];
    const next = pieces[i + 1];

    context.lineWidth = curr === selectedPiece ? 2 : 0.4;

    if (curr.interpolant === Interpolant.Linear) {
      context.beginPath();
      context.moveTo(xify(curr.start.time), yify(curr.start.value));
      context.lineTo(xify(next.start.time), yify(next.start.value));
      context.stroke();
    } else if (curr.interpolant === Interpolant.Constant) {
      context.beginPath();
      context.moveTo(xify(curr.start.time), yify(curr.start.value));
      context.lineTo(xify(next.start.time), yify(curr.start.value));
      context.stroke();
    } else if (curr.interpolant === Interpolant.Quadratic) {
      context.beginPath();
      context.moveTo(xify(curr.start.time), yify(curr.start.value));
      const interpolator = quadraticInterpolant(curr.start.time, curr.start.value, curr.control.time, curr.control.value, next.start.time, next.start.value);
      const deltaT = 1 / plotWidth;
      for (let t = curr.start.time; t < next.start.time; t += deltaT) {
        context.lineTo(xify(t), yify(interpolator(t)));
      }
      context.stroke();
    }
  }

  context.fillStyle = 'rgb(0, 0, 0)';
  for (let piece of pieces) {
    context.beginPath();
    context.arc(xify(piece.start.time), yify(piece.start.value), 5, 0, 2 * Math.PI);
    context.fill();
  }
}

function renderCanvases() {
  renderCanvas(canvases[0], contexts[0], effect.frequencies, effect.frequencies.reduce((accumulator, piece) => {
    let max = Math.max(accumulator, piece.start.value);
    if (piece.interpolant === Interpolant.Quadratic) {
      max = Math.max(max, piece.control.value);
    }
    return max;
  }, 1000));
  renderCanvas(canvases[1], contexts[1], effect.amplitudes, 1);
}

function getMouseMoveListener(canvas, pieces) {
  return event => {

    const gap = 10;
    const plotWidth = canvas.width - 2 * gap;
    const plotHeight = canvas.height - 2 * gap;
    const xify = x => gap + plotWidth * x;
    const yify = y => canvas.height - (gap + plotHeight * (y / maximumY));

    const mouseX = event.clientX;
    const mouseY = event.clientY;

    const plotX = (mouseX - gap) / plotWidth;
    const plotY = 1.0 - (mouseY - gap) / plotHeight;

    const isNear = pieces.some(piece => {
      const deltaX = plotX - piece.start.time;
      const deltaY = 0;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      return distance <= 5 / canvas.width;
    });

    document.documentElement.classList.toggle('cursor-grab', isNear);
  };
}

function initialize() {
  hookElements();
  contexts = canvases.map(canvas => canvas.getContext('2d'));

  canvases[0].addEventListener('mousemove', getMouseMoveListener(canvases[0], effect.frequencies));
  canvases[1].addEventListener('mousemove', getMouseMoveListener(canvases[1], effect.amplitudes));

  for (let type of Object.keys(Wave)) {
    let option = document.createElement('option');
    option.value = Wave[type];
    option.textContent = Wave[type];
    waveTypePicker.appendChild(option);
  }

  for (let type of Object.keys(Interpolant)) {
    let option = document.createElement('option');
    option.value = Interpolant[type];
    option.textContent = Interpolant[type];
    interpolantPicker.appendChild(option);
  }

  const registerEffectFloatListener = (input, key) => {
    input.addEventListener('input', () => {
      if (input.value.match(/^\d+(\.\d+)?$/)) {
        effect[key] = parseFloat(input.value);
        renderCanvases();
        input.classList.remove('error');
      } else {
        input.classList.add('error');
      }
    });
  };

  const registerPieceFloatListener = (host, input, key) => {
    input.addEventListener('input', () => {
      if (input.value.match(/^\d+(\.\d+)?$/)) {
        selectedPiece[host][key] = parseFloat(input.value);
        renderCanvases();
        input.classList.remove('error');
      } else {
        input.classList.add('error');
      }
    });
  };

  registerEffectFloatListener(durationInput, 'duration');
  registerEffectFloatListener(dutyCycleInput, 'dutyCycle');

  waveTypePicker.addEventListener('change', () => {
    effect.waveType = waveTypePicker.value;
    syncWaveOptions();
    renderCanvases();
  });

  piecePicker.addEventListener('change', () => {
    const index = parseInt(piecePicker.value.substring(2));
    if (piecePicker.value.charAt(0) === 'f') {
      loadPiece(effect.frequencies[index]);
    } else {
      loadPiece(effect.amplitudes[index]);
    }
  });

  interpolantPicker.addEventListener('change', () => {
    selectedPiece.interpolant = interpolantPicker.value;
    loadPiece(selectedPiece);
  });

  pieceNameInput.addEventListener('input', () => {
    selectedPiece.name = pieceNameInput.value;
  });

  registerPieceFloatListener('start', startTimeInput, 'time');
  registerPieceFloatListener('start', startValueInput, 'value');
  registerPieceFloatListener('control', controlTimeInput, 'time');
  registerPieceFloatListener('control', controlValueInput, 'value');

  const generateWavButton = document.getElementById('generate-wav-button');
  generateWavButton.addEventListener('click', generateWav);

  loadEffect(effect);

  window.addEventListener('resize', resize);
  resize();
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

function loadEffect(effect) {
  durationInput.value = effect.duration;
  waveTypePicker.value = effect.waveType;
  syncWaveOptions();

  while (piecePicker.firstChild) {
    piecePicker.removeChild(piecePicker.lastChild);
  }

  for (let [i, frequencyPiece] of effect.frequencies.entries()) {
    let option = document.createElement('option');
    option.value = `f:${i}`;
    option.textContent = `frequency ${i}: ${frequencyPiece.name}`;
    piecePicker.appendChild(option);
  }

  for (let [i, amplitudePiece] of effect.amplitudes.entries()) {
    let option = document.createElement('option');
    option.value = `a:${i}`;
    option.textContent = `amplitude ${i}: ${amplitudePiece.name}`;
    piecePicker.appendChild(option);
  }

  loadPiece(effect.frequencies[0]);
}

function loadPiece(piece) {
  selectedPiece = piece;

  pieceNameInput.value = piece.name;
  startTimeInput.value = piece.start.time;
  startValueInput.value = piece.start.value;
  interpolantPicker.value = piece.interpolant;
  if (piece.interpolant === Interpolant.Quadratic) {
    controlTimeInput.style.display = 'inline';
    controlValueInput.style.display = 'inline';
    controlTimeLabel.style.display = 'inline';
    controlValueLabel.style.display = 'inline';
    controlTimeInput.value = piece.control.time;
    controlValueInput.value = piece.control.value;
  } else {
    controlTimeInput.style.display = 'none';
    controlValueInput.style.display = 'none';
    controlTimeLabel.style.display = 'none';
    controlValueLabel.style.display = 'none';
  }

  renderCanvases();
}

document.addEventListener('DOMContentLoaded', initialize);
