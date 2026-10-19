const { filterCompanySocialUrls, pickWebsiteUrl } = require('../utils/links');
const { extractReviewCountFromBodyText } = require('../utils/mapsCounts');
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

function citySlug(city) {
  const c = String(city).toLowerCase();
  if (c.includes('москва')) return 'moscow';
  if (c.includes('санкт') || c.includes('спб') || c.includes('петер')) return 'spb';
  return 'moscow';
}

async function collectBusinessLinks(page, { limit = 10 }, timing) {
  const t = timing || getParseTiming();
  const links = [];
  for (let i = 0; i < t.searchScrollRounds; i++) {
    await page.mouse.wheel(0, 1400);
    await delay(t.searchScrollDelay);
    const batch = await page.$$eval('a[href]', (as) =>
      as
        .map((a) => a.href)
        .filter((href) => href && /\/(firm|company)\//i.test(href))
        .slice(0, 60),
    );
    links.push(...batch);
  }
  return uniq(links).slice(0, limit);
}

async function prepare2gisOrgPage(page, timing) {
  const t = timing || getParseTiming();
  await page.evaluate(() => window.scrollTo(0, Math.min(900, document.body.scrollHeight)));
  await delay(t.gisPrepareScroll);
  const btn = page.getByRole('button', { name: /показать (телефон|номер|все)|раскрыть телефон/i }).first();
  if (await btn.isVisible({ timeout: 900 }).catch(() => false)) {
    await btn.click({ timeout: 2000 }).catch(() => {});
    await delay(t.gisAfterPhone);
  }
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await delay(t.gisFinal);
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
    for (const a of document.querySelectorAll('a[href^="tel:"]')) {
      const raw = a.getAttribute('href')?.replace(/^tel:/i, '').trim();
      if (raw) phonesSet.add(decodeURIComponent(raw).replace(/\s/g, ''));
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
      emailsSet.add(m[0].toLowerCase());
    }

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
    const owner =
      bodyText.match(/(контактное лицо|директор|руководитель|владелец)\s*[:\-]\s*([^\n\r,]{2,80})/i)?.[2] || null;

    const legalMatch = bodyText.match(/\b(ООО|ИП)\s+[A-Za-zА-Яа-я0-9"'.\- ]{2,80}/);
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
      if (!/[1-5](?:[.,]\d)?/i.test(t)) continue;
      if (!/[а-яёa-z]{3,}/i.test(t)) continue;
      possibleReviewBlocks.push(t);
    }

    const reviewsHeuristic = possibleReviewBlocks.slice(0, 20).map((t) => {
      const mRating =
        t.match(/([1-5](?:[.,]\d)?)\s*(?:из\s*)?5/i) ||
        t.match(/оценк\D*([1-5](?:[.,]\d)?)/i) ||
        t.match(/звезд\D*([1-5](?:[.,]\d)?)/i);
      const rRating = mRating ? Number(mRating[1].replace(',', '.')) : null;
      const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
      const filtered = lines.filter((l) => !/^(звезд|рейтинг|оценк|отзыв)/i.test(l));
      const text = filtered.slice(0, 8).join(' ');
      return { rating: rRating, text };
    });

    return {
      name,
      phones: Array.from(phonesSet),
      emails: Array.from(emailsSet),
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
    (r) => r && r.text && r.text.length >= 25 && !/яндекс\.?\s*карт/i.test(r.text),
  );
  const reviews = reviewsFromLd.length ? reviewsFromLd.slice(0, 25) : reviewsHeur.slice(0, 25);

  let reviewCount = typeof data.reviewCount === 'number' ? data.reviewCount : parseNumberRu(data.reviewCount);
  const fromBody = extractReviewCountFromBodyText(data.bodyTextForCounts);
  if (fromBody != null) reviewCount = fromBody;

  return {
    name: data.name,
    city,
    source: '2gis',
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

async function parse2gis({ niche, city, context, limit = 10 }) {
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  const timing = getParseTiming();

  const url = `https://2gis.ru/${citySlug(city)}/search/${encodeURIComponent(niche)}`;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await delay(timing.gisAfterSearch);

    await page
      .waitForSelector('a[href*="/firm/"], a[href*="/company/"]', { timeout: 20000 })
      .catch(() => {});

    const businessLinks = await collectBusinessLinks(page, { limit: Math.max(6, limit * 2) }, timing);

    const leads = [];
    for (const link of businessLinks) {
      await delay(timing.gisBetweenOrgs);
      try {
        await page.goto(link, { waitUntil: 'domcontentloaded' });
        await delay(timing.gisAfterGoto);
        await prepare2gisOrgPage(page, timing);
        await openReviewsSection(page, timing);

        const lead = await extractBusinessFromPage(page, { city });
        if (lead.name) leads.push(lead);
      } catch (e) {

      }

      if (leads.length >= limit) break;
    }

    return leads;
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { parse2gis };
