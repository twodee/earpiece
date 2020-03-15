// http://soundfile.sapp.org/doc/WaveFormat

Number.prototype.toShortFloat = function() {
  return parseFloat(this.toLocaleString('fullwide', {useGrouping: false, maximumFractionDigits: 3}));
}

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

let selectedPieces;
let selectedPiece;
let selectedPieceIndex;

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
  const c = (throughTime * toTime * (throughTime - toTime) * fromValue + toTime * fromTime * (toTime - fromTime) * throughValue + fromTime * throughTime * (fromTime - throughTime) * toValue) / denominator;
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

    {name: 'whoop', start: {time: 0, value: 880}, interpolant: Interpolant.Quadratic, control: {time: 0.25, value: 3000}},
    {name: 'whoop2', start: {time: 0.5, value: 1000}, interpolant: Interpolant.Quadratic, control: {time: 0.75, value: 4000}},
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
  for (let plot of plots) {
    plot.updateSize();
  }
  window.requestAnimationFrame(renderPlots);
}

function renderPlots() {
  for (let plot of plots) {
    plot.render();
  }
}

// --------------------------------------------------------------------------- 

class Plot {
  static GAP = 10;
  static LABEL_GAP = 30;

  constructor(title, canvas, pieces, minimumMaximumValue, isValueExpandable, piecePrefix) {
    this.title = title;
    this.canvas = canvas;
    this.pieces = pieces;
    this.minimumMaximumValue = minimumMaximumValue;
    this.isValueExpandable = isValueExpandable;
    this.maximumValue = null;
    this.width = null;
    this.height = null;
    this.context = this.canvas.getContext('2d');
    this.piecePrefix = piecePrefix;

    this.canvas.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('click', this.onMouseClick);

    this.dragIndex = null;
    this.dragPiece = null;
    this.dragHandle = null;
    this.mouseDown0 = null;

    this.updateBounds();
  }

  timeToPixel(t) {
    return Plot.LABEL_GAP + this.width * t;
  }

  pixelToTime(x) {
    return (x - Plot.LABEL_GAP) / this.width;
  }

  valueToPixel(value) {
    return this.canvas.height - (Plot.LABEL_GAP + this.height * (value / this.maximumValue));
  }

  pixelToValue(y) {
    return (this.canvas.height - y - Plot.LABEL_GAP) / this.height * this.maximumValue;
  }

  updateBounds() {
    this.maximumValue = this.pieces.reduce((accumulator, piece) => {
      let max = Math.max(accumulator, piece.start.value);
      if (piece.interpolant === Interpolant.Quadratic) {
        max = Math.max(max, piece.control.value);
      }
      return max;
    }, this.minimumMaximumValue);
  }

  onMouseClick = event => {
    const bounds = this.canvas.getBoundingClientRect();
    const mouseAt = [
      event.clientX - bounds.x,
      event.clientY - bounds.y
    ];
    const delta = Math.abs(mouseAt[0] - this.mouseDownAt[0]) + Math.abs(mouseAt[1] - this.mouseDownAt[1]);

    if (delta < 4) {
      const t = this.pixelToTime(event.clientX);
      for (let i = 0; i < this.pieces.length - 1; ++i) {
        if (this.pieces[i].start.time <= t && t < this.pieces[i + 1].start.time) {
          this.selectPiece(i);
          break;
        }
      }
    }
  }

  selectPiece(i) {
    piecePicker.value = `${this.piecePrefix}:${i}`;
    loadPiece(this.pieces, i);
    renderPlots();
  }

  onMouseDown = event => {
    const bounds = this.canvas.getBoundingClientRect();
    this.mouseDownAt = [
      event.clientX - bounds.x,
      event.clientY - bounds.y
    ];

    for (let [i, piece] of this.pieces.entries()) {
      if (this.isNearHandle(this.mouseDownAt, piece.start.time, piece.start.value)) {
        this.dragHandle = piece.start;
      } else if (piece.interpolant === Interpolant.Quadratic && this.isNearHandle(this.mouseDownAt, piece.control.time, piece.control.value)) {
        this.dragHandle = piece.control;
      }

      if (this.dragHandle) {
        this.dragIndex = i;
        this.dragPiece = piece;
        document.documentElement.classList.remove('cursor-grab');
        document.documentElement.classList.add('cursor-grabbing');
        this.selectPiece(i);
        break;
      }
    }
  };

  onMouseUp = event => {
    if (this.dragPiece) {
      document.documentElement.classList.remove('cursor-grabbing');
      this.dragIndex = null;
      this.dragPiece = null;
      this.dragHandle = null;
    }
  };

  getPredecessorHandle(pieceIndex, handle) {
    const piece = this.pieces[pieceIndex];
    if (piece.interpolant === Interpolant.Quadratic && handle === piece.control) {
      return piece.start;
    } else if (pieceIndex > 0) {
      const predecessor = this.pieces[pieceIndex - 1];
      if (predecessor.interpolant === Interpolant.Quadratic) {
        return predecessor.control;
      } else {
        return predecessor.start;
      }
    } else {
      return null;
    }
  }

  getSuccessorHandle(pieceIndex, handle) {
    const piece = this.pieces[pieceIndex];
    if (piece.interpolant === Interpolant.Quadratic) {
      if (handle === piece.start) {
        return piece.control;
      } else if (pieceIndex < this.pieces.length - 1) {
        return this.pieces[pieceIndex + 1].start;
      } else {
        return null;
      }
    } else if (pieceIndex < this.pieces.length - 1) {
      return this.pieces[pieceIndex + 1].start;
    } else {
      return null;
    }
  }

  onMouseMove = event => {
    const bounds = this.canvas.getBoundingClientRect();
    const mouseAt = [
      event.clientX - bounds.x,
      event.clientY - bounds.y
    ];

    if (this.dragPiece) {
      const time = this.pixelToTime(mouseAt[0]).toShortFloat();
      const value = this.pixelToValue(mouseAt[1]).toShortFloat();

      // Don't allow first and last pieces to have their start time moved.
      if ((this.dragIndex > 0 && this.dragIndex < this.pieces.length - 1) || this.dragHandle !== this.dragPiece.start) {

        const predecessor = this.getPredecessorHandle(this.dragIndex, this.dragHandle);
        const successor = this.getSuccessorHandle(this.dragIndex, this.dragHandle);
        if (predecessor.time < time && time < successor.time) {
          this.dragHandle.time = time;
        }
      }

      if (this.isValueExpandable && value > this.maximumValue) {
        this.maximumValue = value;
      }

      this.dragHandle.value = Math.max(0, Math.min(value, this.maximumValue));

      synchronizePieceInputs(this.dragPiece);
      this.render();
    } else {
      const isNear = this.pieces.some(piece => {
        return (
          this.isNearHandle(mouseAt, piece.start.time, piece.start.value) ||
          (piece.interpolant === Interpolant.Quadratic && this.isNearHandle(mouseAt, piece.control.time, piece.control.value))
        );
      });
      document.documentElement.classList.toggle('cursor-grab', isNear);
    }
  };

  isNearHandle(mouseAt, time, value) {
    const x = this.timeToPixel(time);
    const y = this.valueToPixel(value);
    const deltaX = x - mouseAt[0];
    const deltaY = y - mouseAt[1];
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    return distance <= 5;
  }

  updateSize() {
    const realWidth = this.canvas.clientWidth;
    const realHeight = this.canvas.clientHeight;
    if (realWidth !== this.canvas.width || realHeight !== this.canvas.height) {
      this.canvas.width = realWidth;
      this.canvas.height = realHeight;
      this.width = this.canvas.width - Plot.GAP - Plot.LABEL_GAP;
      this.height = this.canvas.height - Plot.GAP - Plot.LABEL_GAP;
    }
  }

  render() {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.context.fillStyle = 'rgb(0, 0, 0)';

    this.context.font = '20px sans-serif';
    this.context.textAlign = 'center';
    this.context.textBaseline = 'top';

    this.context.save();
    this.context.rotate(-90 * Math.PI / 180);
    this.context.fillText(this.title, -this.canvas.height * 0.5, 5);
    this.context.restore();

    this.context.textBaseline = 'bottom';
    this.context.fillText('time', this.canvas.width * 0.5, this.canvas.height - 5);

    this.context.lineWidth = 1;
    this.context.strokeStyle = 'rgb(150, 150, 150)';
    this.context.strokeRect(Plot.LABEL_GAP, Plot.GAP, this.width, this.height);

    this.context.strokeStyle = 'rgb(255, 180, 0)';

    for (let i = 0; i < this.pieces.length - 1; ++i) {
      const curr = this.pieces[i];
      const next = this.pieces[i + 1];

      this.context.lineWidth = curr === selectedPiece ? 5 : 1.5;

      if (curr.interpolant === Interpolant.Linear) {
        this.context.beginPath();
        this.context.moveTo(this.timeToPixel(curr.start.time), this.valueToPixel(curr.start.value));
        this.context.lineTo(this.timeToPixel(next.start.time), this.valueToPixel(next.start.value));
        this.context.stroke();
      } else if (curr.interpolant === Interpolant.Constant) {
        this.context.beginPath();
        this.context.moveTo(this.timeToPixel(curr.start.time), this.valueToPixel(curr.start.value));
        this.context.lineTo(this.timeToPixel(next.start.time), this.valueToPixel(curr.start.value));
        this.context.stroke();
      } else if (curr.interpolant === Interpolant.Quadratic) {
        this.context.beginPath();
        this.context.moveTo(this.timeToPixel(curr.start.time), this.valueToPixel(curr.start.value));
        const interpolator = quadraticInterpolant(curr.start.time, curr.start.value, curr.control.time, curr.control.value, next.start.time, next.start.value);
        const deltaT = 1 / this.width;
        for (let t = curr.start.time; t < next.start.time; t += deltaT) {
          this.context.lineTo(this.timeToPixel(t), this.valueToPixel(interpolator(t)));
        }
        this.context.lineTo(this.timeToPixel(next.start.time), this.valueToPixel(next.start.value));
        this.context.stroke();
      }
    }

    for (let piece of this.pieces) {
      this.context.beginPath();
      this.context.arc(this.timeToPixel(piece.start.time), this.valueToPixel(piece.start.value), 5, 0, 2 * Math.PI);
      this.context.fill();

      if (piece.interpolant === Interpolant.Quadratic) {
        this.context.beginPath();
        this.context.arc(this.timeToPixel(piece.control.time), this.valueToPixel(piece.control.value), 5, 0, 2 * Math.PI);
        this.context.fill();
      }
    }
  }
}

// --------------------------------------------------------------------------- 

function initialize() {
  hookElements();

  plots = [
    new Plot('frequency', canvases[0], effect.frequencies, 1000, true, 'f'),
    new Plot('amplitude', canvases[1], effect.amplitudes, 1, false, 'a'),
  ];

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
        synchronizePieceInputs(selectedPiece);
        renderPlots();
        input.classList.remove('error');
      } else {
        input.classList.add('error');
      }
    });
  };

  const registerPieceFloatListener = (host, input, key) => {
    input.addEventListener('input', () => {
      if (input.value.match(/^\d+(\.\d+)?$/)) {
        let value = parseFloat(input.value);
        if (key === 'time') {
          value /= effect.duration;
        }
        selectedPiece[host][key] = value;
        plots[0].updateBounds();
        plots[1].updateBounds();
        renderPlots();
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
    renderPlots();
  });

  piecePicker.addEventListener('change', () => {
    const index = parseInt(piecePicker.value.substring(2));
    if (piecePicker.value.charAt(0) === 'f') {
      loadPiece(effect.frequencies, index);
    } else {
      loadPiece(effect.amplitudes, index);
    }
  });

  interpolantPicker.addEventListener('change', () => {
    selectedPiece.interpolant = interpolantPicker.value;
    loadPiece(selectedPieces, selectedPieceIndex);
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

  const fitPlotsButton = document.getElementById('fit-plots-button');
  fitPlotsButton.addEventListener('click', () => {
    plots[0].updateBounds();
    plots[0].render();
  });

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

  loadPiece(effect.frequencies, 0);
}

function synchronizePieceInputs(piece) {
  startTimeInput.value = piece.start.time * effect.duration;
  startValueInput.value = piece.start.value;
  if (piece.interpolant === Interpolant.Quadratic) {
    controlTimeInput.value = piece.control.time * effect.duration;
    controlValueInput.value = piece.control.value;
  }
}

function loadPiece(pieces, index) {
  selectedPieces = pieces;
  selectedPieceIndex = index;
  selectedPiece = pieces[index];

  pieceNameInput.value = selectedPiece.name;
  interpolantPicker.value = selectedPiece.interpolant;
  synchronizePieceInputs(selectedPiece);

  startTimeInput.disabled = index === 0 || index === pieces.length - 1;

  const display = selectedPiece.interpolant === Interpolant.Quadratic ? 'inline' : 'none';
  controlTimeInput.style.display = display;
  controlValueInput.style.display = display;
  controlTimeLabel.style.display = display;
  controlValueLabel.style.display = display;

  renderPlots();
}

document.addEventListener('DOMContentLoaded', initialize);
