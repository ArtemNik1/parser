/** Ссылки на карты / Яндекс-сервисы — не считаем сайтом и не показываем как соцсети компании. */
function isMapsOrYandexServiceUrl(href) {
  if (!href) return true;
  const u = href.toLowerCase();
  if (/^tel:/i.test(href) || /^mailto:/i.test(href)) return false;
  return (
    u.includes('yandex.ru/maps') ||
    u.includes('yandex.com/maps') ||
    u.includes('maps.yandex') ||
    u.includes('mapyandex') ||
    u.includes('maps.google') ||
    u.includes('goo.gl/maps') ||
    u.includes('2gis.ru') ||
    /\/maps\//i.test(u)
  );
}

function isYandexOfficialSocialJunk(href) {
  if (!href) return true;
  const u = href.toLowerCase();
  return (
    u.includes('vk.com/yandex') ||
    u.includes('vk.com/yandex.') ||
    u.includes('t.me/mapyandex') ||
    u.includes('t.me/mapsyandex') ||
    (u.includes('youtube.com') && u.includes('yandex')) ||
    (u.includes('instagram.com') && u.includes('yandex'))
  );
}

const SOCIAL_HINTS = [
  { test: (u) => u.includes('instagram.com'), label: 'Instagram' },
  { test: (u) => u.includes('facebook.com'), label: 'Facebook' },
  { test: (u) => u.includes('youtube.com') || u.includes('youtu.be'), label: 'YouTube' },
  { test: (u) => u.includes('vk.com') && !isYandexOfficialSocialJunk(u), label: 'VK' },
  { test: (u) => u.includes('ok.ru'), label: 'Одноклассники' },
  { test: (u) => u.includes('t.me') || u.includes('telegram.me'), label: 'Telegram' },
  { test: (u) => u.includes('wa.me') || u.includes('whatsapp.com'), label: 'WhatsApp' },
  { test: (u) => u.includes('tiktok.com'), label: 'TikTok' },
];

function isCompanySocialUrl(href) {
  if (!href || isMapsOrYandexServiceUrl(href) || isYandexOfficialSocialJunk(href)) return false;
  const u = href.toLowerCase();
  return SOCIAL_HINTS.some((h) => h.test(u));
}

function socialLabelForUrl(href) {
  const u = (href || '').toLowerCase();
  for (const h of SOCIAL_HINTS) {
    if (h.test(u)) return h.label;
  }
  try {
    const host = new URL(href).hostname.replace(/^www\./, '');
    return host || 'Ссылка';
  } catch {
    return 'Ссылка';
  }
}

/** Оставляем только ссылки, похожие на соцсети компании. */
function filterCompanySocialUrls(urls) {
  const seen = new Set();
  const out = [];
  for (const raw of urls || []) {
    const href = String(raw).trim();
    if (!href || !/^https?:\/\//i.test(href)) continue;
    if (!isCompanySocialUrl(href)) continue;
    const key = href.split('?')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(href);
  }
  return out.slice(0, 12);
}

/** Первый подходящий URL сайта компании (не карты, не соцсети). */
function pickWebsiteUrl(httpLinks) {
  const socialDomains = ['instagram.com', 'facebook.com', 'youtube.com', 'vk.com', 'ok.ru', 't.me', 'telegram.me', 'wa.me', 'whatsapp.com', 'tiktok.com'];
  for (const href of httpLinks || []) {
    if (!href || !/^https?:\/\//i.test(href)) continue;
    if (isMapsOrYandexServiceUrl(href)) continue;
    const lower = href.toLowerCase();
    if (socialDomains.some((d) => lower.includes(d))) continue;
    if (lower.includes('yandex.ru') || lower.includes('yandex.com')) continue;
    return href;
  }
  return null;
}

module.exports = {
  isMapsOrYandexServiceUrl,
  isYandexOfficialSocialJunk,
  isCompanySocialUrl,
  socialLabelForUrl,
  filterCompanySocialUrls,
  pickWebsiteUrl,
};
