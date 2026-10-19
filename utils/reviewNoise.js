function normalize(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isYandexCardChromeText(text) {
  const t = normalize(text);
  if (t.length < 25) return false;

  if (/обзор/i.test(t) && /отзыв/i.test(t) && (/фото|особенност|новост/i.test(t))) {
    if (t.length < 220) return true;
  }
  if (/товар/i.test(t) && /услуг/i.test(t) && /\d+\s*отзыв/i.test(t)) return true;

  const digits = (t.match(/\d/g) || []).length;
  const letters = (t.match(/[а-яёa-z]/gi) || []).length;
  if (letters > 0 && digits / (letters + digits) > 0.45 && t.length < 220) return true;

  if (/особенност/i.test(t) && !/(что|как|очень|мне|нам|врач|приём|клиник|лечени|больно)/i.test(t)) {
    if (/\d{3,}\s*отзыв|\d+\s*фото/i.test(t)) return true;
  }

  return false;
}

module.exports = { isYandexCardChromeText, normalize };
