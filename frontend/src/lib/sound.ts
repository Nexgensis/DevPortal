// Interaction sounds, synthesised with the Web Audio API.
//
// No audio files and no library: everything here is oscillators, a noise
// buffer and a delay line, so there is nothing to download before the first
// click and the whole cue stays tweakable in code.
// Sounds are opt-out via localStorage — see isMuted/setMuted.

const STORAGE_KEY = 'sound:muted';

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

export function isMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Private mode / blocked storage — default to audible.
    return false;
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
  } catch {
    /* nothing we can do; the preference just won't stick */
  }
}

// Built on first play, never at import time: browsers refuse to start an
// AudioContext outside a user gesture, and a suspended one stays silent.
function audio(): AudioContext | null {
  if (isMuted()) return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

// One second of white noise, generated once and reused as the source for the
// riser. Cheaper than re-filling a Float32Array on every click.
function noiseBuffer(ac: AudioContext): AudioBuffer {
  if (!noise) {
    noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

// Feedback delay: what turns a run of notes into something with space around
// it rather than a dry beep sequence. Returns [dry destination, echo send].
function makeBus(ac: AudioContext, at: number): { master: GainNode; echo: GainNode } {
  const master = ac.createGain();
  master.gain.value = 0.9;
  master.connect(ac.destination);

  const echo = ac.createGain();
  echo.gain.value = 0.34;

  const delay = ac.createDelay(1);
  delay.delayTime.value = 0.17;

  const feedback = ac.createGain();
  feedback.gain.value = 0.36;

  // Roll the top off each repeat so the tail dissolves instead of hissing.
  const damp = ac.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 2600;

  echo.connect(delay);
  delay.connect(damp);
  damp.connect(feedback);
  feedback.connect(delay); // the actual feedback loop
  damp.connect(master);

  // Tear the loop down once the tail has died, so a rapid series of clicks
  // doesn't leave a pile of live feedback loops running forever.
  window.setTimeout(() => {
    feedback.disconnect();
    damp.disconnect();
    master.disconnect();
  }, (at - ac.currentTime + 4) * 1000);

  return { master, echo };
}

// Filtered white-noise sweep — the "something is coming" lift before the hit.
function riser(ac: AudioContext, t0: number, dur: number, dest: AudioNode): void {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);

  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 6;
  band.frequency.setValueAtTime(400, t0);
  band.frequency.exponentialRampToValueAtTime(7000, t0 + dur);

  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.22, t0 + dur * 0.85);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.08);

  src.connect(band).connect(gain).connect(dest);
  src.start(t0);
  src.stop(t0 + dur + 0.1);
}

// Sine pitched sharply downward: the weight under the first melodic note.
function bassDrop(ac: AudioContext, t0: number, dest: AudioNode): void {
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(180, t0);
  osc.frequency.exponentialRampToValueAtTime(48, t0 + 0.4);

  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.5, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);

  osc.connect(gain).connect(dest);
  osc.start(t0);
  osc.stop(t0 + 0.55);
}

// One melodic note: two saws detuned against each other through a closing
// lowpass. The beating between the pair is what stops it sounding synthetic.
function voice(
  ac: AudioContext,
  freq: number,
  t0: number,
  peak: number,
  dry: AudioNode,
  send: AudioNode,
): void {
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.014);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42);

  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(Math.min(freq * 7, 11000), t0);
  lp.frequency.exponentialRampToValueAtTime(Math.max(freq * 2, 400), t0 + 0.42);
  lp.Q.value = 4;

  for (const cents of [-7, 7]) {
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, t0);
    osc.detune.setValueAtTime(cents, t0);
    osc.connect(lp);
    osc.start(t0);
    osc.stop(t0 + 0.45);
  }

  // A bell an octave up on top, for the sparkle the saws don't have.
  const bell = ac.createOscillator();
  const bellGain = ac.createGain();
  bell.type = 'sine';
  bell.frequency.setValueAtTime(freq * 2, t0);
  bellGain.gain.setValueAtTime(0.0001, t0);
  bellGain.gain.exponentialRampToValueAtTime(peak * 0.35, t0 + 0.01);
  bellGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
  bell.connect(bellGain).connect(gain);
  bell.start(t0);
  bell.stop(t0 + 0.32);

  lp.connect(gain);
  gain.connect(dry);
  gain.connect(send);
}

/**
 * Download cue: a noise riser into a bass hit, then a major-pentatonic run
 * that echoes out. Roughly 1.5s including the tail.
 */
export function playDownload(): void {
  const ac = audio();
  if (!ac) return;

  const t0 = ac.currentTime + 0.02;
  const { master, echo } = makeBus(ac, t0);

  const lift = 0.28;
  riser(ac, t0, lift, master);

  const hit = t0 + lift;
  bassDrop(ac, hit, master);

  // C major pentatonic, climbing then landing an octave up: reads as "went
  // somewhere" rather than a plain scale.
  const run = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5]; // C5 D5 E5 G5 A5 C6
  run.forEach((freq, i) => {
    // Slight accelerando — the gaps shrink as the run climbs.
    const at = hit + i * (0.085 - i * 0.004);
    voice(ac, freq, at, i === run.length - 1 ? 0.26 : 0.18, master, echo);
  });
}
