// http://soundfile.sapp.org/doc/WaveFormat

Number.prototype.toShortFloat = function() {
  return parseFloat(this.toLocaleString('fullwide', {useGrouping: false, maximumFractionDigits: 3}));
}

const Motion = Object.freeze({
  Horizontal: 'Horizontal',
  Vertical: 'Vertical',
  Free: 'Free',
});

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

let contextMenu;

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

let oscillationCheckbox;
let oscillationCycleCountLabel;
let oscillationCycleCountInput;
let oscillationAmplitudeLabel;
let oscillationAmplitudeInput;
let oscillationFlipLabel;
let oscillationFlipCheckbox;

let deletePieceButton;
let splitPieceButton;
let openPicker;
let deleteEffectButton;

let canvases = [];

let selectedPieces;
let selectedPiece;
let selectedPieceIndex;

let currentEffect;
let currentName = null;

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
    return p >= duty ? -1 : 1;
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
      current.interpolate = constantInterpolant(current.start.time, current.start.value, next.start.time, next.start.value, current.oscillation);
    } else if (current.interpolant === 'linear') {
      current.interpolate = linearInterpolant(current.start.time, current.start.value, next.start.time, next.start.value, current.oscillation);
    } else if (current.interpolant === 'quadratic') {
      current.interpolate = quadraticInterpolant(current.start.time, current.start.value, current.control.time, current.control.value, next.start.time, next.start.value, current.oscillation);
    } else {
      console.log("boo");
    }
  }
}

function constantInterpolant(fromTime, fromValue, toTime, toValue, oscillation) {
  if (oscillation) {
    const frequency = oscillation.cycleCount / (toTime - fromTime);
    const phaseShift = oscillation.flip ? Math.PI : 0;
    return t => {
      const elapsedTime = t - fromTime;
      return fromValue + Math.sin(2 * Math.PI * frequency * elapsedTime + phaseShift) * oscillation.amplitude;
    };
  } else {
    return t => {
      return fromValue;
    };
  }
}

function linearInterpolant(fromTime, fromValue, toTime, toValue, oscillation) {
  const denominator = toTime - fromTime;

  if (oscillation) {
    const frequency = oscillation.cycleCount / denominator;
    const phaseShift = oscillation.flip ? Math.PI : 0;
    return t => {
      const elapsedTime = t - fromTime;
      const p = elapsedTime / denominator;
      return (1 - p) * fromValue + p * toValue + Math.sin(2 * Math.PI * frequency * elapsedTime + phaseShift) * oscillation.amplitude;
    };
  } else {
    return t => {
      const p = (t - fromTime) / denominator;
      return (1 - p) * fromValue + p * toValue;
    };
  }
}

function quadraticInterpolant(fromTime, fromValue, throughTime, throughValue, toTime, toValue, oscillation) {
  const denominator = (fromTime - throughTime) * (fromTime - toTime) * (throughTime - toTime);
  const a = (toTime * (throughValue - fromValue) + throughTime * (fromValue - toValue) + fromTime * (toValue - throughValue)) / denominator;
  const b = (toTime * toTime * (fromValue - throughValue) + throughTime * throughTime * (toValue - fromValue) + fromTime * fromTime * (throughValue - toValue)) / denominator;
  const c = (throughTime * toTime * (throughTime - toTime) * fromValue + toTime * fromTime * (toTime - fromTime) * throughValue + fromTime * throughTime * (fromTime - throughTime) * toValue) / denominator;
  if (oscillation) {
    const frequency = oscillation.cycleCount / (toTime - fromTime);
    const phaseShift = oscillation.flip ? Math.PI : 0;
    return t => {
      const elapsedTime = t - fromTime;
      return a * t * t + b * t + c + Math.sin(2 * Math.PI * frequency * elapsedTime + phaseShift) * oscillation.amplitude;
    };
  } else {
    return t => {
      return a * t * t + b * t + c;
    };
  }
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

const defaultEffect = {
  rate: 22050,
  duration: 3,
  waveType: Wave.Sine,
  frequencies: [
    {name: 'start', start: {time: 0, value: 880}, interpolant: Interpolant.Linear},
    {name: 'end', start: {time: 1, value: 1760}, interpolant: Interpolant.Constant},
  ],
  amplitudes: [
    {name: 'start', start: {time: 0, value: 0}, interpolant: Interpolant.Linear},
    {name: 'middle', start: {time: 0.5, value: 1}, interpolant: Interpolant.Linear},
    {name: 'end', start: {time: 1, value: 0}, interpolant: Interpolant.Constant},
  ],
};

let effects = {};
/*
const effects = {
  tester: {
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
  }
};
*/

function clonePiece(piece) {
  const clone = {
    name: piece.name,
    start: {time: piece.start.time, value: piece.start.value},
    interpolant: piece.interpolant,
  };

  if (piece.interpolant === Interpolant.Quadratic) {
    clone.control = {time: piece.control.time, value: piece.control.value};
  }

  if (piece.oscillation) {
    clone.oscillation = {cycleCount: piece.oscillation.cycleCount, amplitude: piece.oscillation.amplitude, flip: piece.oscillation.flip};
  }

  return clone;
}

function cloneEffect(effect) {
  const clone = {
    rate: effect.rate,
    waveType: effect.waveType,
    duration: effect.duration,
    frequencies: effect.frequencies.map(piece => clonePiece(piece)),
    amplitudes: effect.amplitudes.map(piece => clonePiece(piece)),
  };

  if (effect.waveType === Wave.Square) {
    clone.dutyCycle = effect.dutyCycle;
  }

  return clone;
}

function serializeEffects() {
  const cleanedEffects = {};
  for (let [key, value] of Object.entries(effects)) {
    cleanedEffects[key] = cloneEffect(value);
  }
  return JSON.stringify(cleanedEffects);
}

function generateWav() {
  const samples = effectToSamples(currentEffect);
  const wav = samplesToWav(samples);
  player.src = wav;
}

function exportWav() {
  const samples = effectToSamples(currentEffect);
  const wav = samplesToWav(samples);
  download(wav, `${currentName ? currentName : 'effect'}.wav`);
}

function exportArchive() {
  const jsonUrl = `data:application/json,${JSON.stringify(effects)}`;
  download(jsonUrl, 'earpiece_archive.json');
}

function download(url, name) {
  const link = document.createElement('a');
  link.download = name;
  link.href = url;
  link.click();
}

function hookElements() {
  contextMenu = document.getElementById('context-menu');
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

  oscillationCheckbox = document.getElementById('oscillation-checkbox');
  oscillationCycleCountLabel = document.getElementById('oscillation-cycle-count-label');
  oscillationCycleCountInput = document.getElementById('oscillation-cycle-count-input');
  oscillationAmplitudeLabel = document.getElementById('oscillation-amplitude-label');
  oscillationAmplitudeInput = document.getElementById('oscillation-amplitude-input');
  oscillationFlipLabel = document.getElementById('oscillation-flip-label');
  oscillationFlipCheckbox = document.getElementById('oscillation-flip-checkbox');

  player = document.getElementById('player');
  deletePieceButton = document.getElementById('delete-piece-button');
  splitPieceButton = document.getElementById('split-piece-button');
  openPicker = document.getElementById('open-picker');
  deleteEffectButton = document.getElementById('delete-effect-button');

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

function getPredecessorHandle(pieces, pieceIndex, vertex) {
  const piece = pieces[pieceIndex];
  if (piece.interpolant === Interpolant.Quadratic && vertex === piece.control) {
    return piece.start;
  } else if (pieceIndex > 0) {
    const predecessor = pieces[pieceIndex - 1];
    if (predecessor.interpolant === Interpolant.Quadratic) {
      return predecessor.control;
    } else {
      return predecessor.start;
    }
  } else {
    return null;
  }
}

function getSuccessorHandle(pieces, pieceIndex, vertex) {
  const piece = pieces[pieceIndex];
  if (piece.interpolant === Interpolant.Quadratic) {
    if (vertex === piece.start) {
      return piece.control;
    } else if (pieceIndex < pieces.length - 1) {
      return pieces[pieceIndex + 1].start;
    } else {
      return null;
    }
  } else if (pieceIndex < pieces.length - 1) {
    return pieces[pieceIndex + 1].start;
  } else {
    return null;
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

    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('click', this.onMouseClick);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);

    deletePieceButton.addEventListener('click', () => {
      if (selectedPieces === this.pieces && selectedPieceIndex > 0 && selectedPieceIndex < selectedPieces.length - 1) {
        selectedPieces.splice(selectedPieceIndex, 1);
        synchronizePieceOptions();
        piecePicker.value = `${this.piecePrefix}:${selectedPieceIndex - 1}`;
        loadPiece(selectedPieces, selectedPieceIndex - 1);
        renderPlots();
      }
      contextMenu.style.display = 'none';
    });

    splitPieceButton.addEventListener('click', mouseAt => {
      contextMenu.style.display = 'none';
      if (selectedPieces === this.pieces && selectedPieceIndex < selectedPieces.length - 1) {
        const mouseAt = this.getMouseAt(event);
        let time = this.pixelToTime(mouseAt[0]).toShortFloat();
        let value = this.pixelToValue(mouseAt[1]).toShortFloat();

        if (selectedPiece.interpolant === Interpolant.Quadratic) {
          if (time < selectedPiece.control.time) {
            const successor = getSuccessorHandle(this.pieces, selectedPieceIndex, selectedPiece.control);
            time = (selectedPiece.control.time + successor.time) * 0.5;
          }
        }

        selectedPieces.splice(selectedPieceIndex + 1, 0, {
          name: '?',
          start: {time, value},
          interpolant: Interpolant.Linear,
        });
        synchronizePieceOptions();
        const piecePrefix = selectedPieces === currentEffect.frequencies ? 'f' : 'a';
        piecePicker.value = `${piecePrefix}:${selectedPieceIndex + 1}`;
        loadPiece(selectedPieces, selectedPieceIndex + 1);
        renderPlots();
      }
    });

    this.dragIndex = null;
    this.dragPiece = null;
    this.dragHandle = null;

    this.updateBounds();
  }

  loadPieces(pieces) {
    this.pieces = pieces;
    this.updateBounds();
  }

  getMouseAt(event) {
    const bounds = this.canvas.getBoundingClientRect();
    return [
      event.clientX - bounds.x,
      event.clientY - bounds.y
    ];
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

  onContextMenu = event => {
    this.handleSelect(event);
    contextMenu.style.display = 'flex';
    contextMenu.style.top = event.pageY + 'px';
    contextMenu.style.left = event.pageX + 'px';
    event.preventDefault();
    return false;
  };

  onMouseClick = event => {
    if (contextMenu.style.display !== 'none') {
      contextMenu.style.display = 'none';
    } else {
      this.handleSelect(event);
    }
  }

  handleSelect(event) {
    const mouseAt = this.getMouseAt(event);
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
    this.dragMotion = null;

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
        document.addEventListener('mouseup', this.onMouseUp);
        document.addEventListener('mousemove', this.onMouseDrag);
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
      document.removeEventListener('mouseup', this.onMouseUp);
      document.removeEventListener('mousemove', this.onMouseDrag);
    }
  };

  onMouseDrag = event => {
    const mouseAt = this.getMouseAt(event);
    const time = this.pixelToTime(mouseAt[0]).toShortFloat();
    const value = this.pixelToValue(mouseAt[1]).toShortFloat();

    if (this.dragMotion === null) {
      if (event.shiftKey) {
        const deltaX = Math.abs(mouseAt[0] - this.mouseDownAt[0]);
        const deltaY = Math.abs(mouseAt[1] - this.mouseDownAt[1]);
        if (deltaX >= deltaY) {
          this.dragMotion = Motion.Horizontal;
        } else {
          this.dragMotion = Motion.Vertical;
        }
      } else {
        this.dragMotion = Motion.Free;
      }
    }

    // Don't allow first and last pieces to have their start time moved.
    if ((this.dragIndex > 0 && this.dragIndex < this.pieces.length - 1) || this.dragHandle !== this.dragPiece.start) {
      const predecessor = getPredecessorHandle(this.pieces, this.dragIndex, this.dragHandle);
      const successor = getSuccessorHandle(this.pieces, this.dragIndex, this.dragHandle);
      if (predecessor.time < time && time < successor.time && (this.dragMotion === Motion.Free || this.dragMotion === Motion.Horizontal)) {
        this.dragHandle.time = time;
      }
    }

    if (this.dragMotion === Motion.Free || this.dragMotion === Motion.Vertical) {
      if (this.isValueExpandable && value > this.maximumValue) {
        this.maximumValue = value;
      }
      this.dragHandle.value = Math.max(0, Math.min(value, this.maximumValue));
    }

    synchronizePieceInputs(this.dragPiece);
    this.render();
  };

  onMouseMove = event => {
    if (!this.dragPiece) {
      const mouseAt = this.getMouseAt(event);
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
        const interpolator = linearInterpolant(curr.start.time, curr.start.value, next.start.time, next.start.value, curr.oscillation);
        const deltaT = 1 / this.width;
        for (let t = curr.start.time; t < next.start.time; t += deltaT) {
          this.context.lineTo(this.timeToPixel(t), this.valueToPixel(interpolator(t)));
        }
        this.context.lineTo(this.timeToPixel(next.start.time), this.valueToPixel(next.start.value));
        this.context.stroke();
      } else if (curr.interpolant === Interpolant.Constant) {
        this.context.beginPath();
        this.context.moveTo(this.timeToPixel(curr.start.time), this.valueToPixel(curr.start.value));
        const interpolator = constantInterpolant(curr.start.time, curr.start.value, next.start.time, next.start.value, curr.oscillation);
        const deltaT = 1 / this.width;
        for (let t = curr.start.time; t < next.start.time; t += deltaT) {
          this.context.lineTo(this.timeToPixel(t), this.valueToPixel(interpolator(t)));
        }
        this.context.stroke();
      } else if (curr.interpolant === Interpolant.Quadratic) {
        this.context.beginPath();
        this.context.moveTo(this.timeToPixel(curr.start.time), this.valueToPixel(curr.start.value));
        const interpolator = quadraticInterpolant(curr.start.time, curr.start.value, curr.control.time, curr.control.value, next.start.time, next.start.value, curr.oscillation);
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

    if (this.dragHandle) {
      this.context.font = '12px sans-serif';
      this.context.textAlign = 'center';
      this.context.textBaseline = 'bottom';

      const label = `(${(this.dragHandle.time * currentEffect.duration).toShortFloat()}, ${this.dragHandle.value})`;
      const measures = this.context.measureText(label);

      let x = this.timeToPixel(this.dragHandle.time);
      let y = this.valueToPixel(this.dragHandle.value);

      if (x - measures.width / 2 < 0) {
        x += Math.abs(x - measures.width / 2);
      } else if (x + measures.width / 2 > this.canvas.width) {
        x -= Math.abs(x + measures.width / 2 - this.canvas.width);
      }

      if (y - measures.actualBoundingBoxAscent - 10 < 0) {
        this.context.textBaseline = 'top';
        y += 10;
      } else {
        y -= 10;
      }

      this.context.fillText(label, x, y);
    }
  }
}

// --------------------------------------------------------------------------- 

function initialize() {
  hookElements();

  plots = [
    new Plot('frequency', canvases[0], [], 1000, true, 'f'),
    new Plot('amplitude', canvases[1], [], 1, false, 'a'),
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
        currentEffect[key] = parseFloat(input.value);
        synchronizePieceInputs(selectedPiece);
        renderPlots();
        input.classList.remove('error');
      } else {
        input.classList.add('error');
      }
    });
  };

  const registerPieceIntListener = (host, input, key) => {
    input.addEventListener('input', () => {
      if (input.value.match(/^\d+$/)) {
        let value = parseInt(input.value);
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

  const registerPieceFloatListener = (host, input, key) => {
    input.addEventListener('input', () => {
      if (input.value.match(/^\d+(\.\d+)?$/)) {
        let value = parseFloat(input.value);
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

  const registerPieceTimeListener = (host, input) => {
    input.addEventListener('input', () => {
      if (input.value.match(/^\d+(\.\d+)?$/)) {
        let time = parseFloat(input.value);
        time /= currentEffect.duration;

        const predecessor = getPredecessorHandle(selectedPieces, selectedPieceIndex, selectedPiece[host]);
        const successor = getSuccessorHandle(selectedPieces, selectedPieceIndex, selectedPiece[host]);
        if (predecessor.time < time && time < successor.time) {
          selectedPiece[host].time = time;
          plots[0].updateBounds();
          plots[1].updateBounds();
          renderPlots();
          input.classList.remove('error');
        } else {
          input.classList.add('error');
        }
      } else {
        input.classList.add('error');
      }
    });

    input.addEventListener('blur', () => {
      input.value = selectedPiece[host].time * currentEffect.duration;
      input.classList.remove('error');
    });
  };

  registerEffectFloatListener(durationInput, 'duration');
  registerEffectFloatListener(dutyCycleInput, 'dutyCycle');

  waveTypePicker.addEventListener('change', () => {
    currentEffect.waveType = waveTypePicker.value;
    if (currentEffect.waveType === Wave.Square) {
      currentEffect.dutyCycle = 0.5;
    } else {
      delete currentEffect.dutyCycle;
    }
    synchronizeWaveOptions();
    renderPlots();
  });

  piecePicker.addEventListener('change', () => {
    const index = parseInt(piecePicker.value.substring(2));
    if (piecePicker.value.charAt(0) === 'f') {
      loadPiece(currentEffect.frequencies, index);
    } else {
      loadPiece(currentEffect.amplitudes, index);
    }
  });

  interpolantPicker.addEventListener('change', () => {
    selectedPiece.interpolant = interpolantPicker.value;
    if (selectedPiece.interpolant === Interpolant.Quadratic) {
      const successor = selectedPieces[selectedPieceIndex + 1].start;
      const time = (selectedPiece.start.time + successor.time) * 0.5;
      const value = (selectedPiece.start.value + successor.value) * 0.5;
      selectedPiece.control = {time, value};
    } else {
      delete selectedPiece.control;
    }
    loadPiece(selectedPieces, selectedPieceIndex);
  });

  pieceNameInput.addEventListener('input', () => {
    selectedPiece.name = pieceNameInput.value;
  });

  oscillationCheckbox.addEventListener('change', () => {
    if (oscillationCheckbox.checked) {
      selectedPiece.oscillation = {cycleCount: 3, amplitude: selectedPieces === currentEffect.frequencies ? 100 : 0.1, flip: false};
    } else {
      delete selectedPiece.oscillation;
    }
    loadPiece(selectedPieces, selectedPieceIndex);
  });

  oscillationFlipCheckbox.addEventListener('change', () => {
    selectedPiece.oscillation.flip = oscillationFlipCheckbox.checked;
    loadPiece(selectedPieces, selectedPieceIndex);
  });

  registerPieceIntListener('oscillation', oscillationCycleCountInput, 'cycleCount');
  registerPieceFloatListener('oscillation', oscillationAmplitudeInput, 'amplitude');

  registerPieceTimeListener('start', startTimeInput);
  registerPieceFloatListener('start', startValueInput, 'value');
  registerPieceTimeListener('control', controlTimeInput);
  registerPieceFloatListener('control', controlValueInput, 'value');

  const generateWavButton = document.getElementById('generate-wav-button');
  generateWavButton.addEventListener('click', generateWav);

  const fitButton = document.getElementById('fit-button');
  fitButton.addEventListener('click', () => {
    plots[0].updateBounds();
    plots[0].render();
    contextMenu.style.display = 'none';
  });

  const duplicateButton = document.getElementById('duplicate-button');
  duplicateButton.addEventListener('click', duplicate);

  const saveAllButton = document.getElementById('save-all-button');
  saveAllButton.addEventListener('click', saveAll);

  const exportWavButton = document.getElementById('export-wav-button');
  exportWavButton.addEventListener('click', exportWav);

  openPicker.addEventListener('change', () => {
    const name = openPicker.value; 
    if (name === 'new') {
      currentName = null;
      deleteEffectButton.disabled = true;
      loadEffect(cloneEffect(defaultEffect));
      openPicker.value = '';
      duplicate();
    } else if (name) {
      currentName = name;
      loadEffect(effects[name]);
      deleteEffectButton.disabled = false;
    }
  });

  deleteEffectButton.addEventListener('click', () => {
    delete effects[currentName];
    currentName = null;
    deleteEffectButton.disabled = true;
    synchronizeOpenOptions();
    loadEffect(cloneEffect(defaultEffect));
  });

  const exportArchiveButton = document.getElementById('export-archive-button');
  exportArchiveButton.addEventListener('click', exportArchive);

  const importArchiveButton = document.getElementById('import-archive-button');
  const importArchiveInput = document.getElementById('import-archive-input');
  importArchiveButton.addEventListener('click', () => {
    importArchiveInput.click();
  });
  importArchiveInput.addEventListener('change', event => {
    if (event.target.files.length > 0) {
      const file = event.target.files[0];
      const reader = new FileReader();
      reader.onerror = event => {
        console.log("error", event);
      };
      reader.onload = event => {
        const json = event.target.result;
        const newEffects = JSON.parse(json);
        Object.assign(effects, newEffects);
        synchronizeOpenOptions();
        openPicker.value = '';
        importArchiveInput.value = null;
        loadEffect(cloneEffect(defaultEffect));
      };
      reader.readAsText(file);
    }
  });

  deleteEffectButton.disabled = true;

  const json = localStorage.getItem('effects');
  if (json) {
    effects = JSON.parse(json);
  }

  synchronizeOpenOptions();
  loadEffect(cloneEffect(defaultEffect));

  window.addEventListener('resize', resize);
  resize();
}

function duplicate() {
  const name = prompt('Name of new effect:');
  if (name && name.length > 0) {
    currentName = name;
    const newEffect = cloneEffect(currentEffect);
    effects[name] = newEffect;
    loadEffect(newEffect);
    synchronizeOpenOptions();
    deleteEffectButton.disabled = false;
    openPicker.value = name;
  }
}

function saveAll() {
  const json = serializeEffects();
  localStorage.setItem('effects', json);
}
window.saveAll = saveAll;

function synchronizeWaveOptions() {
  dutyCycleInput.value = currentEffect.dutyCycle;
  if (currentEffect.waveType === Wave.Square) {
    dutyCycleLabel.style.display = 'inline';
    dutyCycleInput.style.display = 'inline';
  } else {
    dutyCycleLabel.style.display = 'none';
    dutyCycleInput.style.display = 'none';
  }
}

function synchronizePieceOptions() {
  while (piecePicker.firstChild) {
    piecePicker.removeChild(piecePicker.lastChild);
  }

  for (let [i, frequencyPiece] of currentEffect.frequencies.entries()) {
    let option = document.createElement('option');
    option.value = `f:${i}`;
    option.textContent = `frequency ${i}: ${frequencyPiece.name}`;
    piecePicker.appendChild(option);
  }

  for (let [i, amplitudePiece] of currentEffect.amplitudes.entries()) {
    let option = document.createElement('option');
    option.value = `a:${i}`;
    option.textContent = `amplitude ${i}: ${amplitudePiece.name}`;
    piecePicker.appendChild(option);
  }
}

function synchronizeOpenOptions() {
  while (openPicker.firstChild) {
    openPicker.removeChild(openPicker.lastChild);
  }

  let option = document.createElement('option');
  option.value = '';
  option.textContent = 'load effect...';
  openPicker.appendChild(option);

  option = document.createElement('option');
  option.value = 'new';
  option.textContent = 'new';
  openPicker.appendChild(option);

  for (let key of Object.keys(effects)) {
    let option = document.createElement('option');
    option.value = key;
    option.textContent = key;
    openPicker.appendChild(option);
  }
}

function loadEffect(effect) {
  currentEffect = effect;
  durationInput.value = effect.duration;
  waveTypePicker.value = effect.waveType;
  synchronizeWaveOptions();
  synchronizePieceOptions();
  plots[0].loadPieces(effect.frequencies);
  plots[1].loadPieces(effect.amplitudes);
  loadPiece(effect.frequencies, 0);
}

function synchronizePieceInputs(piece) {
  startTimeInput.value = (piece.start.time * currentEffect.duration).toShortFloat();
  startValueInput.value = piece.start.value;
  if (piece.interpolant === Interpolant.Quadratic) {
    controlTimeInput.value = (piece.control.time * currentEffect.duration).toShortFloat();
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
  interpolantPicker.disabled = index === pieces.length - 1;

  let display = selectedPiece.interpolant === Interpolant.Quadratic ? 'inline' : 'none';
  controlTimeInput.style.display = display;
  controlValueInput.style.display = display;
  controlTimeLabel.style.display = display;
  controlValueLabel.style.display = display;

  oscillationCheckbox.checked = !!selectedPiece.oscillation;

  if (selectedPiece.oscillation) {
    oscillationCycleCountInput.value = selectedPiece.oscillation.cycleCount;
    oscillationAmplitudeInput.value = selectedPiece.oscillation.amplitude;
    oscillationFlipCheckbox.checked = selectedPiece.oscillation.flip;
    display = 'inline';
  } else {
    display = 'none';
  }

  oscillationCycleCountLabel.style.display = display;
  oscillationCycleCountInput.style.display = display;
  oscillationAmplitudeLabel.style.display = display;
  oscillationAmplitudeInput.style.display = display;
  oscillationFlipLabel.style.display = display;
  oscillationFlipCheckbox.style.display = display;

  renderPlots();
}

document.addEventListener('DOMContentLoaded', initialize);
