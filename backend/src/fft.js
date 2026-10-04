// FFT radix-2 itérative et transformée de Fourier à court terme.
const cache = new Map();
function tables(n) {
  let t = cache.get(n);
  if (!t) {
    const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2), rev = new Uint32Array(n);
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = Math.sin((2 * Math.PI * i) / n); }
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
    const win = new Float64Array(n);
    for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    cache.set(n, (t = { cos, sin, rev, win }));
  }
  return t;
}

/** FFT en place sur re/im (longueur puissance de 2). */
export function fft(re, im) {
  const n = re.length, { cos, sin, rev } = tables(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0, j = i; k < half; k++, j++) {
        const c = cos[k * step], s = sin[k * step];
        const xr = re[j + half] * c + im[j + half] * s, xi = im[j + half] * c - re[j + half] * s;
        re[j + half] = re[j] - xr; im[j + half] = im[j] - xi;
        re[j] += xr; im[j] += xi;
      }
    }
  }
}

/** Spectres d'amplitude (fenêtre de Hann, trames centrées). Trame i ↔ instant i*hop/sr. */
export function stft(y, nfft, hop) {
  const { win } = tables(nfft), half = nfft >> 1;
  const nFrames = Math.floor(y.length / hop) + 1;
  const re = new Float64Array(nfft), im = new Float64Array(nfft), out = new Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    const start = f * hop - half;
    for (let i = 0; i < nfft; i++) {
      const k = start + i;
      re[i] = k >= 0 && k < y.length ? y[k] * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float32Array(half + 1);
    for (let i = 0; i <= half; i++) mag[i] = Math.hypot(re[i], im[i]);
    out[f] = mag;
  }
  return out;
}
