/**
 * One-off generator for short VC UI WAV samples (PCM 16-bit mono 44.1kHz).
 * Run: node scripts/gen-vc-sounds.js
 */
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "sounds");
const SR = 44100;

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function writeWav(filePath, samples) {
  const n = samples.length;
  const dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) {
    const s = clamp(Math.round(samples[i] * 32767), -32768, 32767);
    buf.writeInt16LE(s, 44 + i * 2);
  }
  fs.writeFileSync(filePath, buf);
}

function env(t, attack, decay) {
  if (t < attack) return t / attack;
  const x = (t - attack) / Math.max(0.0001, decay);
  return Math.exp(-3.5 * x);
}

function softJoin() {
  // Two soft pops — short, muted, UI-like
  const dur = 0.22;
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    // first blip ~70ms
    if (t < 0.09) {
      const e = env(t, 0.004, 0.07);
      s += Math.sin(2 * Math.PI * 540 * t) * e * 0.22;
      s += (Math.random() * 2 - 1) * e * 0.015;
    }
    // second blip
    const t2 = t - 0.085;
    if (t2 > 0 && t2 < 0.11) {
      const e = env(t2, 0.003, 0.09);
      s += Math.sin(2 * Math.PI * 720 * t2) * e * 0.18;
      s += (Math.random() * 2 - 1) * e * 0.012;
    }
    out[i] = s;
  }
  return out;
}

function softLeave() {
  const dur = 0.18;
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const e = env(t, 0.005, 0.15);
    const f = 680 * Math.exp(-t * 4.2);
    let s = Math.sin(2 * Math.PI * f * t) * e * 0.2;
    s += (Math.random() * 2 - 1) * e * 0.02;
    out[i] = s;
  }
  return out;
}

function bubbleJoin() {
  const dur = 0.14;
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const e = env(t, 0.002, 0.11);
    const f = 900 * Math.exp(-t * 12);
    let s = Math.sin(2 * Math.PI * f * t) * e * 0.28;
    // soft harmonic
    s += Math.sin(2 * Math.PI * f * 1.5 * t) * e * 0.06;
    out[i] = s;
  }
  return out;
}

function bubbleLeave() {
  const dur = 0.16;
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const e = env(t, 0.003, 0.13);
    const f = 520 * Math.exp(-t * 8);
    out[i] = Math.sin(2 * Math.PI * f * t) * e * 0.22;
  }
  return out;
}

function minimalJoin() {
  const dur = 0.06;
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const e = env(t, 0.001, 0.05);
    out[i] = Math.sin(2 * Math.PI * 1000 * t) * e * 0.12;
  }
  return out;
}

function minimalLeave() {
  const dur = 0.055;
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const e = env(t, 0.001, 0.045);
    out[i] = Math.sin(2 * Math.PI * 700 * t) * e * 0.1;
  }
  return out;
}

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const files = {
  "join-soft.wav": softJoin,
  "leave-soft.wav": softLeave,
  "join-bubble.wav": bubbleJoin,
  "leave-bubble.wav": bubbleLeave,
  "join-minimal.wav": minimalJoin,
  "leave-minimal.wav": minimalLeave,
};

for (const [name, fn] of Object.entries(files)) {
  const p = path.join(OUT, name);
  writeWav(p, fn());
  console.log("wrote", p);
}
console.log("done");
