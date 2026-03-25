/**
 * Число отзывов из текста страницы: только явные «N отзыв(ов/а)»,
 * не путаем с «N фото / фотографий».
 */
function extractReviewCountFromBodyText(bodyText) {
  const raw = String(bodyText || '');
  const re = /\b(\d{1,6})\s*(?:отзыв|отзыва|отзывов)\b/gi;
  const candidates = [];
  let m;
  while ((m = re.exec(raw)) !== null) {
    const n = parseInt(m[1], 10);
    if (!Number.isFinite(n) || n < 0 || n > 500000) continue;
    const i = m.index;
    const before = raw.slice(Math.max(0, i - 50), i);
    const after = raw.slice(i, Math.min(raw.length, i + m[0].length + 15));
    if (/(?:фото|фотограф|снимк|изображен|галере|альбом)/i.test(before) && !/отзыв/i.test(before)) continue;
    if (/^\s*\d+\s*(?:фото|фотограф)/i.test(after)) continue;
    candidates.push(n);
  }
  if (!candidates.length) return null;
  return Math.max(...candidates);
}

module.exports = { extractReviewCountFromBodyText };
