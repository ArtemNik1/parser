const { isYandexCardChromeText } = require('../utils/reviewNoise');

const DEFAULT_NEGATIVE_MAX_RATING = 3;

const PAIN_THEME_IDS = [
  'price',
  'queue_wait',
  'booking',
  'communication',
  'staff_negative',
  'quality_result',
  'service_trust',
  'website_online',
];

function normalizeText(s) {
  return (s || '')
    .toString()
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseNumberRu(value) {
  if (value === null || value === undefined) return null;
  const n = Number(String(value).replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function extractNegativeReviews(reviews, maxRating = DEFAULT_NEGATIVE_MAX_RATING) {
  if (!Array.isArray(reviews)) return [];
  return reviews
    .map((r) => ({
      rating: typeof r.rating === 'number' ? r.rating : parseNumberRu(r.rating),
      text: r.text || r.review || '',
    }))
    .filter(
      (r) =>
        !isYandexCardChromeText(r.text) &&
        r.rating !== null &&
        r.rating <= maxRating &&
        normalizeText(r.text).length >= 20,
    );
}

function stripNavNoise(text) {
  return normalizeText(text)
    .replace(/яндекс\.?\s*карт/g, ' ')
    .replace(/рейтинг\s+организации/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function selectReviewsForPainAnalysis(reviews) {
  if (!Array.isArray(reviews)) return [];
  const mapped = reviews
    .map((r, index) => ({
      index,
      rating: typeof r.rating === 'number' ? r.rating : parseNumberRu(r.rating),
      text: r.text || r.review || '',
    }))
    .filter((r) => {
      if (isYandexCardChromeText(r.text)) return false;
      const t = stripNavNoise(r.text);
      return t.length > 0 && !/^[\d\s]+$/i.test(t);
    });

  if (!mapped.length) return [];

  mapped.sort((a, b) => {
    const ar = a.rating !== null && Number.isFinite(a.rating) ? a.rating : 99;
    const br = b.rating !== null && Number.isFinite(b.rating) ? b.rating : 99;
    if (ar !== br) return ar - br;
    return b.index - a.index;
  });

  return mapped.map(({ rating, text }) => ({ rating, text }));
}

const THEME_GROUPS = [
  {
    id: 'price',
    painLabels: ['цена и оплата'],
    patterns: ['дорого', 'переплат', 'дешевле', 'накрутил', 'завышен', 'скрытые платеж', 'доплатил', 'переплатил', 'обманули на'],
  },
  {
    id: 'queue_wait',
    painLabels: ['ожидание, очередь'],
    patterns: ['ждать', 'очередь', 'долго жд', 'опоздал', 'перенос', 'не успел'],
  },
  {
    id: 'booking',
    painLabels: ['запись и слоты'],
    patterns: ['записаться', 'нет мест', 'невозможно записаться', 'онлайн запис', 'календар', 'талон', 'администратор не'],
  },
  {
    id: 'communication',
    painLabels: ['связь и ответы'],
    patterns: ['не отвечают', 'не дозвониться', 'игнор', 'телефон не берут', 'долго отвечают', 'перезвон'],
  },
  {
    id: 'staff_negative',
    painLabels: ['негатив о персонале'],
    patterns: ['груб', 'хам', 'невежлив', 'хамят', 'нагло', 'хамство'],
  },
  {
    id: 'quality_result',
    painLabels: ['результат и качество'],
    patterns: ['косяк', 'переделыв', 'не понравилось', 'плохо сделали', 'разочарован', 'ужасн', 'не работает после ремонта', 'снова сломалось'],
  },
  {
    id: 'service_trust',
    painLabels: ['честность работ и доверие (авто/сервис и др.)'],
    patterns: [
      'развод',
      'обман',
      'навязали',
      'лишние работы',
      'заменили не то',
      'криво',
      'сломали',
      'не рекомендую',
      'не советую',
      'переплатил',
      'развели',
      'навязывали',
      'лишнего',
      'не уложились в срок',
      'поломали',
      'неисправно',
      'обманули',
      'навязали дополнительно',
    ],
  },
  {
    id: 'comfort_pain',
    painLabels: ['комфорт приёма'],
    patterns: ['больно', 'страшно', 'анестез', 'без боли'],
  },
  {
    id: 'cleanliness',
    painLabels: ['чистота'],
    patterns: ['грязно', 'нечисто', 'стериль', 'санитар'],
  },
  {
    id: 'website_online',
    painLabels: ['сайт и онлайн'],
    patterns: ['не работает сайт', 'сайт не открывается', 'не грузится страница', 'битая ссылка', 'не открывается сайт', 'форма на сайте'],
  },
];

function countPatternHits(joined, patterns) {
  let n = 0;
  const j = joined;
  for (const p of patterns) {
    const needle = normalizeText(p);
    if (needle.length < 2) continue;
    let pos = 0;
    while (pos < j.length) {
      const i = j.indexOf(needle, pos);
      if (i === -1) break;
      n++;
      pos = i + needle.length;
    }
  }
  return n;
}

function scoreThemes(joined) {
  const scores = {};
  for (const g of THEME_GROUPS) {
    scores[g.id] = countPatternHits(joined, g.patterns);
  }
  return scores;
}

function excerpt(text, max = 150) {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function collectEvidenceQuotes(reviewRows, scores) {
  const quotes = [];
  const rows = reviewRows || [];
  const painIds = PAIN_THEME_IDS.filter((id) => (scores[id] || 0) > 0).sort((a, b) => (scores[b] || 0) - (scores[a] || 0));

  for (const id of painIds) {
    const g = THEME_GROUPS.find((x) => x.id === id);
    if (!g) continue;
    for (const pat of g.patterns) {
      const needle = normalizeText(pat);
      if (needle.length < 3) continue;
      for (const r of rows) {
        if (isYandexCardChromeText(r.text)) continue;
        const raw = stripNavNoise(r.text);
        if (raw.length < 15) continue;
        if (!raw.includes(needle)) continue;
        const idx = raw.indexOf(needle);
        const start = Math.max(0, idx - 35);
        const frag = excerpt(raw.slice(start), 160);
        if (frag && !quotes.includes(frag)) quotes.push(frag);
        break;
      }
      if (quotes.length >= 4) return quotes;
    }
  }

  const neg = extractNegativeReviews(rows);
  for (const r of neg) {
    const t = excerpt(stripNavNoise(r.text), 160);
    if (t && !quotes.includes(t)) quotes.push(t);
    if (quotes.length >= 3) break;
  }

  return quotes.slice(0, 4);
}

function hasContrastNegative(joined) {
  return (
    /\b(но|кроме|однако|к сожалению)\b/i.test(joined) &&
    /(плохо|не понрав|жалоб|дорог|долго жд|не отвеч|груб|хам|недостат)/i.test(joined)
  );
}

function buildPainLabelsOnly(scores, joined) {
  const items = [];
  for (const id of PAIN_THEME_IDS) {
    const n = scores[id] || 0;
    if (n === 0) continue;
    const g = THEME_GROUPS.find((x) => x.id === id);
    if (!g) continue;
    items.push(n >= 2 ? `${g.painLabels[0]} (повторяется в тексте)` : g.painLabels[0]);
  }
  if (joined.includes('1 из 5') || joined.includes('2 из 5')) {
    items.push('низкие оценки в формулировках');
  }
  if (!items.length && hasContrastNegative(joined)) {
    items.push('смешанный тон: минусы и оговорки («но», «кроме»)');
  }
  return items.slice(0, 6);
}

function buildSummaryFromEvidence(evidenceQuotes, scores) {
  if (evidenceQuotes.length) {
    const parts = evidenceQuotes.slice(0, 2).map((q) => `«${q}»`);
    const hitCount = PAIN_THEME_IDS.reduce((s, id) => s + (scores[id] || 0), 0);
    return `Снято с текста отзывов (фрагменты): ${parts.join(' ')} Совпадений по маркерам боли в тексте: ~${hitCount}.`;
  }
  return 'В извлечённых отзывах мало явных формулировок для выдержек.';
}

function buildOfferHints(scores) {
  const hints = [];
  const s = scores || {};
  if ((s.queue_wait || 0) + (s.booking || 0) >= 2) hints.push('booking');
  if ((s.communication || 0) >= 2) hints.push('bot');
  if ((s.website_online || 0) >= 1) hints.push('site');
  if ((s.price || 0) >= 2) hints.push('price');
  if ((s.staff_negative || 0) + (s.quality_result || 0) >= 3) hints.push('crm');
  if ((s.service_trust || 0) >= 1) hints.push('trust');
  if ((s.comfort_pain || 0) + (s.cleanliness || 0) >= 2) hints.push('content');
  return hints;
}

function leadReviewCount(lead) {
  if (lead == null) return 0;
  const n = Number(lead.reviewCount);
  if (Number.isFinite(n) && n > 0) return n;
  return Array.isArray(lead.reviews) ? lead.reviews.length : 0;
}

function ratingReputationHeuristic(lead) {
  if (lead == null) return false;
  const r = typeof lead.rating === 'number' ? lead.rating : parseNumberRu(lead.rating);
  const rc = leadReviewCount(lead);
  if (r === null || !Number.isFinite(r)) return false;

  if (rc >= 12) {
    return r >= 3.0 && r <= 4.45;
  }

  return r >= 3.15 && r <= 4.4;
}

function hasConcretePain(analysis, reviewRows, minPainScore = 1, lead = null) {

  if (typeof minPainScore === 'number' && minPainScore <= 0) return true;

  if (process.env.ENABLE_RATING_HEURISTIC !== 'false' && lead && ratingReputationHeuristic(lead)) return true;

  const scores = analysis.baseScores || {};
  let painSum = 0;
  for (const id of PAIN_THEME_IDS) {
    painSum += scores[id] || 0;
  }
  if (painSum >= minPainScore) return true;

  for (const r of reviewRows || []) {
    if (isYandexCardChromeText(r.text)) continue;
    const rating = typeof r.rating === 'number' ? r.rating : parseNumberRu(r.rating);
    if (rating !== null && rating <= 3) return true;
  }

  if (extractNegativeReviews(reviewRows || []).length >= 1) return true;

  const joined = (reviewRows || []).map((r) => stripNavNoise(r.text)).join(' ');
  if (hasContrastNegative(joined)) return true;

  return false;
}

function analyzePains(reviewRows, options = {}) {
  const lead = options.lead || null;
  const texts = (reviewRows || [])
    .map((r) => stripNavNoise(r.text))
    .filter((t) => t.length > 0);
  const joined = texts.join(' ');

  if (!joined.length) {
    if (lead && ratingReputationHeuristic(lead) && process.env.ENABLE_RATING_HEURISTIC !== 'false') {
      const rn = typeof lead.rating === 'number' ? lead.rating : parseNumberRu(lead.rating);
      return {
        pains: [
          `рейтинг ${rn != null && Number.isFinite(rn) ? rn.toFixed(1) : '—'} при ${leadReviewCount(lead)} отзывах — зона смешанной репутации`,
        ],
        summary:
          'Текст отзывов с карточки не попал в выборку; отбор по смешанной репутации (рейтинг и число отзывов на карточке).',
        themes: {},
        baseScores: {},
        offerHints: ['trust'],
        evidenceQuotes: [],
      };
    }
    return {
      pains: [],
      summary: 'Нет текста отзывов.',
      themes: {},
      baseScores: {},
      offerHints: [],
      evidenceQuotes: [],
    };
  }

  const base = scoreThemes(joined);
  const themes = { ...base };
  let pains = buildPainLabelsOnly(base, joined);
  if (
    !pains.some((p) => /низкие оценки|смешанный тон/i.test(p)) &&
    reviewRows.some((r) => {
      if (isYandexCardChromeText(r.text)) return false;
      const rt = typeof r.rating === 'number' ? r.rating : parseNumberRu(r.rating);
      return rt !== null && rt <= 3;
    })
  ) {
    pains.push('есть отзывы с оценкой до 3★ (по извлечённым данным)');
  }
  if (lead && ratingReputationHeuristic(lead) && process.env.ENABLE_RATING_HEURISTIC !== 'false') {
    const rn = typeof lead.rating === 'number' ? lead.rating : parseNumberRu(lead.rating);
    pains.push(
      `рейтинг ${rn != null && Number.isFinite(rn) ? rn.toFixed(1) : '—'} при ${leadReviewCount(lead)} отзывах — зона смешанной репутации`,
    );
  }
  let evidenceQuotes = collectEvidenceQuotes(reviewRows, base);
  if (!evidenceQuotes.length && hasContrastNegative(joined)) {
    const sent = joined.split(/[.!?]\s+/).find((s) => /\bно\b/i.test(s) && s.length > 25);
    if (sent) evidenceQuotes.push(excerpt(sent, 160));
  }
  const summary = buildSummaryFromEvidence(evidenceQuotes, base);
  const offerHints = buildOfferHints(base);

  return {
    pains,
    summary,
    themes,
    baseScores: { ...base },
    offerHints,
    evidenceQuotes,
  };
}

function defaultPainResult() {
  return {
    pains: [],
    summary: 'Текст отзывов не извлечён.',
    themes: {},
    baseScores: {},
    offerHints: [],
    evidenceQuotes: [],
  };
}

module.exports = {
  extractNegativeReviews,
  selectReviewsForPainAnalysis,
  analyzePains,
  defaultPainResult,
  hasConcretePain,
  DEFAULT_NEGATIVE_MAX_RATING,
  PAIN_THEME_IDS,
};
