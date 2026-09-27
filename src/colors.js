/**
 * ANSI renk yardimcilari.
 *
 * Sifir bagimlilik ilkesi gereigi `chalk` yerine elle yazildi.
 * Kurallar:
 *   - NO_COLOR degiskeni varsa           -> renk yok (https://no-color.org)
 *   - TERM=dumb ise                      -> renk yok
 *   - cikti TTY degilse (pipe/CI logu)   -> renk yok
 *   - FORCE_COLOR=1 varsa                -> renk zorla acik (CI'da badge vs.)
 *
 * Dikkat: bu dosyada ham kontrol karakteri YOKTUR; ESC kodu calisma
 * zamaninda uretilir. (Ham ESC, dosya iceriginin tasima sirasinda
 * bozulmasina yol aciyor.)
 */

const env = process.env;

const forceColor =
  env.FORCE_COLOR !== undefined &&
  env.FORCE_COLOR !== '0' &&
  env.FORCE_COLOR !== 'false';

const isTTY = Boolean(process.stdout && process.stdout.isTTY);

export const enabled =
  forceColor || (!env.NO_COLOR && env.TERM !== 'dumb' && isTTY);

/** ASCII ESC (0x1B) karakteri. */
const ESC = String.fromCharCode(27);

const wrap = (open, close) => (s) =>
  enabled ? ESC + '[' + open + 'm' + String(s) + ESC + '[' + close + 'm' : String(s);

export const reset = wrap(0, 0);
export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const italic = wrap(3, 23);
export const underline = wrap(4, 24);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const blue = wrap(34, 39);
export const magenta = wrap(35, 39);
export const cyan = wrap(36, 39);
export const gray = wrap(90, 39);
export const white = wrap(37, 39);

const ANSI_RE = new RegExp(ESC + '\\[[0-9;]*m', 'g');

/** ANSI sarmalayicilari temizler (olcum ve JSON ciktisi icin). */
export function stripAnsi(s) {
  return String(s).replace(ANSI_RE, '');
}

/**
 * Metni terminal hucresi genisligine gore hizalar.
 * `String.padEnd` emoji'lerde kayar (emoji 2 hucresi kaplar), bu yuzden
 * unicode araliklarini elle sayiyoruz.
 */
export function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    // cesitlilik secici, zero-width joiner ve zero-width space genislik katmaz
    if (cp === 0xfe0f || cp === 0x200d || cp === 0x200b) continue;
    if (
      (cp >= 0x1f300 && cp <= 0x1faff) || // emoji
      (cp >= 0x1f000 && cp <= 0x1f2ff) || // oyun/kart sembolleri
      (cp >= 0x1f900 && cp <= 0x1f9ff) ||
      (cp >= 0x2600 && cp <= 0x27bf) || // misc symbols + dingbats
      (cp >= 0x1100 && cp <= 0x115f) || // hangul jamo
      (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals, punctuation
      (cp >= 0x3041 && cp <= 0x33ff) || // kana, CJK compat
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified
      (cp >= 0xac00 && cp <= 0xd7a3) || // hangul syllables
      (cp >= 0xf900 && cp <= 0xfaff) || // CJK compat ideographs
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) || // fullwidth forms
      (cp >= 0xffe0 && cp <= 0xffe6)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

export function padEndWidth(s, width) {
  const str = String(s);
  const diff = width - displayWidth(str);
  return diff > 0 ? str + ' '.repeat(diff) : str;
}

export function padStartWidth(s, width) {
  const str = String(s);
  const diff = width - displayWidth(str);
  return diff > 0 ? ' '.repeat(diff) + str : str;
}

export function truncateWidth(s, max) {
  const str = String(s);
  if (max <= 0) return '';
  if (displayWidth(str) <= max) return str;
  let out = '';
  let w = 0;
  for (const ch of str) {
    const cw = displayWidth(ch);
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return out + '\u2026';
}
