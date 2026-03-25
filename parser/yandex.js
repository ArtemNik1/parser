const {
  filterCompanySocialUrls,
  pickWebsiteUrl,
} = require('../utils/links');
const { extractReviewCountFromBodyText } = require('../utils/mapsCounts');
const { isYandexCardChromeText } = require('../utils/reviewNoise');
const { openReviewsSection } = require('./reviewsUi');
const { getParseTiming } = require('./parseTiming');

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function parseNumberRu(value) {
  const n = Number(String(value).replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

async function collectBusinessLinksFromSearchPage(page, { limit = 10 }, timing) {
  const t = timing || getParseTiming();
  const links = [];
  for (let i = 0; i < t.searchScrollRounds; i++) {
    await page.mouse.wheel(0, 1500);
    await delay(t.searchScrollDelay);
    const batch = await page.$$eval('a[href]', (as) =>
      as
        .map((a) => a.href)
        .filter((href) => {
          if (!href) return false;
          return /maps\/org\//i.test(href) || /\/org\//i.test(href);
        }),
    );
    links.push(...batch);
  }
  return uniq(links).slice(0, limit);
}

/** Раскрыть телефон; опционально вкладка «Контакты» (медленнее). */
async function prepareYandexOrgPage(page, timing) {
  const t = timing || getParseTiming();
  await page.evaluate(() => window.scrollTo(0, Math.min(800, document.body.scrollHeight)));
  await delay(t.prepareScroll);

  const phoneBtn = page.getByRole('button', { name: /показать (телефон|номер)/i }).first();
  if (await phoneBtn.isVisible({ timeout: 900 }).catch(() => false)) {
    await phoneBtn.click({ timeout: 2000 }).catch(() => {});
    await delay(t.prepareAfterPhone);
  }

  if (t.skipContacts) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(t.prepareFinal);
    return;
  }

  await page.locator('a, button, [role="tab"]').filter({ hasText: /^Контакты$/i }).first().click({ timeout: 1500 }).catch(() => {});
  await delay(t.prepareContactsDelay);
  await page.evaluate(() => {
    const el = document.querySelector('[href*="contacts"]') || document.querySelector('[data-section="contacts"]');
    el?.scrollIntoView?.({ block: 'center' });
  });
  await delay(t.prepareAfterContacts);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await delay(t.prepareFinal);
}

/** Несколько вариантов кнопки «показать телефон» / «позвонить» на разных версиях вёрстки. */
async function revealYandexOrgPhone(page, timing) {
  const t = timing || getParseTiming();
  const tryClick = async () => {
    const candidates = [
      page.getByRole('button', { name: /показать (телефон|номер)/i }).first(),
      page.getByRole('button', { name: /показать\s+номер/i }).first(),
      page.locator('[role="button"], button').filter({ hasText: /показать.*(телефон|номер)/i }).first(),
      page.getByRole('link', { name: /позвонить/i }).first(),
    ];
    for (const el of candidates) {
      try {
        if (await el.isVisible({ timeout: 450 }).catch(() => false)) {
          await el.click({ timeout: 2200 }).catch(() => {});
          await delay(Math.max(t.prepareAfterPhone, 450));
          const n = await page.locator('a[href^="tel:"], a[href*="tel:"]').count();
          if (n > 0) return true;
        }
      } catch (e) {
        /* next */
      }
    }
    return false;
  };

  await tryClick();
  await page.evaluate(() => window.scrollTo(0, 0));
  await delay(220);
  await tryClick();
}

async function extractBusinessFromPage(page, { city }) {
  const url = page.url();
  const data = await page.evaluate(() => {
    const clean = (s) => (s ? String(s).replace(/\s+/g, ' ').trim() : null);

    const name =
      clean(document.querySelector('h1')?.textContent) ||
      clean(document.querySelector('[class*="title" i]')?.textContent) ||
      clean(document.querySelector('meta[property="og:title"]')?.getAttribute('content'));

    const phonesSet = new Set();
    for (const a of document.querySelectorAll('a[href^="tel:"], a[href*="tel:"]')) {
      const raw = a.getAttribute('href')?.replace(/^tel:/i, '').trim();
      if (raw && !/^tel:\s*$/i.test(raw)) phonesSet.add(decodeURIComponent(raw).replace(/\s/g, ''));
    }
    const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ');
    const phoneRe = /\+?\d[\d\s\-()]{9,}\d/g;
    let m;
    while ((m = phoneRe.exec(bodyText)) !== null) {
      const p = m[0].replace(/[\s()-]/g, '');
      if (p.length >= 10 && p.length <= 15) phonesSet.add(p);
    }

    const emailsSet = new Set();
    for (const a of document.querySelectorAll('a[href^="mailto:"]')) {
      const raw = a.getAttribute('href')?.replace(/^mailto:/i, '').trim();
      if (raw) emailsSet.add(decodeURIComponent(raw).split('?')[0]);
    }
    const emailRe = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
    while ((m = emailRe.exec(bodyText)) !== null) {
      const e = m[0].toLowerCase();
      if (!e.includes('yandex') && !e.includes('2gis')) emailsSet.add(e);
    }

    const phones = Array.from(phonesSet);
    const emails = Array.from(emailsSet);

    const socialDomains = [
      'instagram.com',
      'vk.com',
      'facebook.com',
      'youtube.com',
      't.me',
      'telegram.me',
      'whatsapp.com',
      'wa.me',
      'ok.ru',
      'tiktok.com',
    ];
    const rawSocials = Array.from(document.querySelectorAll('a[href]'))
      .map((a) => a.getAttribute('href'))
      .filter(Boolean)
      .filter((href) => socialDomains.some((d) => href.toLowerCase().includes(d)));

    const httpLinks = Array.from(document.querySelectorAll('a[href^="http"]'))
      .map((a) => a.getAttribute('href'))
      .filter(Boolean);

    function walkAggregateAndReviews(obj, agg, reviewsOut) {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        for (const x of obj) walkAggregateAndReviews(x, agg, reviewsOut);
        return;
      }
      if (obj['@graph']) walkAggregateAndReviews(obj['@graph'], agg, reviewsOut);

      const types = [].concat(obj['@type'] || []);
      const isReview = types.some((t) => String(t).toLowerCase().includes('review'));
      if (isReview) {
        const rv = obj.reviewRating?.ratingValue;
        const rating =
          rv != null && rv !== ''
            ? parseFloat(String(rv).replace(',', '.'))
            : null;
        const text = obj.reviewBody || obj.description;
        const t = clean(text);
        if (t && t.length >= 15) reviewsOut.push({ rating: Number.isFinite(rating) ? rating : null, text: t });
      }

      const ar = obj.aggregateRating;
      if (ar && ar.ratingValue != null && agg.rating == null) {
        const v = parseFloat(String(ar.ratingValue).replace(',', '.'));
        if (Number.isFinite(v) && v >= 0 && v <= 5) agg.rating = v;
      }
      if (ar && ar.reviewCount != null && agg.reviewCount == null) {
        const n = parseInt(String(ar.reviewCount).replace(/\D/g, ''), 10);
        if (Number.isFinite(n) && n > 0) agg.reviewCount = n;
      }

      const revBlock = obj.review;
      if (revBlock) {
        const revs = Array.isArray(revBlock) ? revBlock : [revBlock];
        for (const r of revs) {
          const rv = r.reviewRating?.ratingValue;
          const rating =
            rv != null && rv !== ''
              ? parseFloat(String(rv).replace(',', '.'))
              : null;
          const text = r.reviewBody || r.description || r.text;
          const t = clean(text);
          if (t && t.length >= 15) reviewsOut.push({ rating: Number.isFinite(rating) ? rating : null, text: t });
        }
      }
    }

    const agg = { rating: null, reviewCount: null };
    const reviewsLd = [];
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        let j = JSON.parse(s.textContent);
        if (!Array.isArray(j)) j = [j];
        for (const item of j) walkAggregateAndReviews(item, agg, reviewsLd);
      } catch (e) {
        /* ignore */
      }
    }

    let rating = agg.rating;
    let reviewCount = agg.reviewCount;

    if (rating == null) {
      const ratingMatch =
        bodyText.match(/Рейтинг\s*[:\-]?\s*([0-5](?:[.,]\d)?)/i) ||
        bodyText.match(/Оценка\s*[:\-]?\s*([0-5](?:[.,]\d)?)/i);
      if (ratingMatch) rating = Number(ratingMatch[1].replace(',', '.'));
    }
    const ownerText =
      bodyText.match(/(контактное лицо|директор|руководитель|владелец)\s*[:\-]\s*([^\n\r,]{2,80})/i) || null;

    const owner = ownerText ? ownerText[2].trim() : null;

    const legalMatch =
      bodyText.match(/\b(ООО|ИП)\s+[A-Za-zА-Яа-я0-9"'.\- ]{2,80}/) || null;

    const legalForm = legalMatch ? legalMatch[1] : null;
    const legalName = legalMatch ? legalMatch[0] : null;

    const possibleReviewBlocks = [];
    const nodes = Array.from(document.querySelectorAll('article, [itemprop="review"], li, div'));
    for (const el of nodes) {
      if (possibleReviewBlocks.length >= 40) break;
      const t = clean(el?.innerText);
      if (!t) continue;
      if (t.length < 40 || t.length > 1400) continue;
      if (/^Рейтинг организации/i.test(t)) continue;
      if (/\bобзор\b/i.test(t) && /\bотзыв/i.test(t) && /\bфото\b/i.test(t)) continue;
      if (/\bтовар.*и\s*услуг/i.test(t) && /\d+\s*отзыв/i.test(t)) continue;
      if (!/[1-5](?:[.,]\d)?/i.test(t)) continue;
      if (!/[а-яёa-z]{3,}/i.test(t)) continue;
      possibleReviewBlocks.push(t);
    }

    const reviewsHeuristic = possibleReviewBlocks.slice(0, 20).map((t) => {
      let rRating = null;
      const mStar = t.match(/([0-5](?:[.,]\d)?)\s*(?:из\s*)?5\b/i);
      if (mStar && /\bиз\s*5\b|\/\s*5\b/i.test(t)) {
        rRating = Number(mStar[1].replace(',', '.'));
      } else {
        const mEv = t.match(/оценк\D{0,22}([1-5](?:[.,]\d)?)/i);
        if (mEv) rRating = Number(mEv[1].replace(',', '.'));
        else {
          const mZv = t.match(/звезд\D{0,22}([1-5](?:[.,]\d)?)/i);
          if (mZv) rRating = Number(mZv[1].replace(',', '.'));
        }
      }
      const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
      const filtered = lines.filter((l) => !/^(звезд|рейтинг|оценк|отзыв)/i.test(l));
      const text = filtered.slice(0, 8).join(' ');
      return { rating: rRating, text };
    });

    return {
      name,
      phones,
      emails,
      rawSocials,
      httpLinks,
      rating,
      reviewCount,
      owner,
      legalForm,
      legalName,
      reviewsLd,
      reviewsHeuristic,
      bodyTextForCounts: bodyText,
    };
  });

  const socials = filterCompanySocialUrls(data.rawSocials);
  const website = pickWebsiteUrl(data.httpLinks);

  const reviewsFromLd = (data.reviewsLd || []).filter((r) => r && r.text && r.text.length >= 15);
  const reviewsHeur = (data.reviewsHeuristic || []).filter(
    (r) =>
      r &&
      r.text &&
      r.text.length >= 25 &&
      !/яндекс\.?\s*карт/i.test(r.text) &&
      !isYandexCardChromeText(r.text),
  );
  const reviews = reviewsFromLd.length ? reviewsFromLd.slice(0, 25) : reviewsHeur.slice(0, 25);

  let reviewCount = typeof data.reviewCount === 'number' ? data.reviewCount : parseNumberRu(data.reviewCount);
  const fromBody = extractReviewCountFromBodyText(data.bodyTextForCounts);
  if (fromBody != null) reviewCount = fromBody;

  return {
    name: data.name,
    city,
    source: 'yandex',
    sourceLink: url,
    link: url,
    phone: data.phones?.[0] || null,
    phones: data.phones || [],
    email: data.emails?.[0] || null,
    emails: data.emails || [],
    socials,
    website,
    contactPerson: data.owner,
    legalForm: data.legalForm,
    legalName: data.legalName,
    rating: typeof data.rating === 'number' ? data.rating : parseNumberRu(data.rating),
    reviewCount,
    reviews: (reviews || []).filter((r) => r && r.text),
  };
}

async function parseYandexMaps({ niche, city, context, limit = 10 }) {
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  const timing = getParseTiming();

  const q = `${niche} ${city}`;
  const searchUrl = `https://yandex.ru/maps/?text=${encodeURIComponent(q)}`;

  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
    await delay(timing.afterSearchGoto);

    const businessLinks = await collectBusinessLinksFromSearchPage(page, { limit: Math.max(5, limit * 2) }, timing);

    const leads = [];
    for (const link of businessLinks) {
      await delay(timing.betweenOrgs);
      try {
        await page.goto(link, { waitUntil: 'domcontentloaded' });
        await delay(timing.afterOrgGoto);
        await prepareYandexOrgPage(page, timing);
        await openReviewsSection(page, timing);
        await revealYandexOrgPhone(page, timing);

        const lead = await extractBusinessFromPage(page, { city });
        lead.sourceLink = link;
        if (lead.name) leads.push(lead);
      } catch (e) {
        /* ignore */
      }
      if (leads.length >= limit) break;
    }
    return leads;
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { parseYandexMaps };
