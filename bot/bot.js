const path = require('path');
require('dotenv').config();

const { Telegraf } = require('telegraf');
const { chromium } = require('playwright');

const { parseYandexMaps } = require('../parser/yandex');
const { parse2gis } = require('../parser/2gis');

const { selectReviewsForPainAnalysis, analyzePains, hasConcretePain } = require('../analyzer/reviews');
const { generateOffer } = require('../analyzer/offer');
const { formatLeadMessage } = require('../utils/formatter');

function getArgValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}

const TELEGRAM_TOKEN =
  getArgValue('--token') ||
  getArgValue('--telegram-token') ||
  process.env.TELEGRAM_TOKEN ||
  process.env.TELEGRAM_BOT_TOKEN ||
  process.env.TELEGRA_TOKEN;

if (!TELEGRAM_TOKEN) {

  throw new Error('Missing TELEGRAM_TOKEN (or TELEGRA_TOKEN) in environment variables.');
}

const cities = ['Москва'];

const MIN_RATING = Number(process.env.MIN_RATING ?? 2.8);
const MAX_RATING = Number(process.env.MAX_RATING ?? 5.0);
const MIN_TOTAL_REVIEWS = Number(process.env.MIN_TOTAL_REVIEWS ?? 1);

const MAX_LEADS = Number(process.env.MAX_LEADS || 20);
const LEADS_TARGET_MIN = Number(process.env.LEADS_TARGET_MIN || 5);
const LEADS_TARGET_MAX = Number(process.env.LEADS_TARGET_MAX || 8);
const PER_SOURCE_LIMIT = Number(process.env.PER_SOURCE_LIMIT || 35);

const SKIP_2GIS = String(process.env.SKIP_2GIS || 'false').toLowerCase() === 'true';

const MIN_PAIN_SCORE = (() => {
  const n = Number(process.env.MIN_PAIN_SCORE ?? 0);
  return Number.isFinite(n) ? n : 0;
})();

function randomLeadTarget() {
  const lo = Math.min(LEADS_TARGET_MIN, LEADS_TARGET_MAX);
  const hi = Math.max(LEADS_TARGET_MIN, LEADS_TARGET_MAX);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

const HEADLESS = String(process.env.HEADLESS || 'true').toLowerCase() !== 'false';
const USER_AGENT = process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const PROXY_URL = process.env.PROXY_URL || null;
const TELEGRAM_PROXY_URL = getArgValue('--telegram-proxy') || process.env.TELEGRAM_PROXY_URL || null;

let bot;
if (TELEGRAM_PROXY_URL) {
  const { HttpsProxyAgent } = require('https-proxy-agent');
  const agent = new HttpsProxyAgent(TELEGRAM_PROXY_URL);
  bot = new Telegraf(TELEGRAM_TOKEN, { telegram: { agent } });
} else {
  bot = new Telegraf(TELEGRAM_TOKEN);
}

bot.botInfo = {
  id: 0,
  is_bot: true,
  first_name: 'bot',
  username: 'bot',
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
};

bot.catch((err) => {

  console.error('Telegraf error:', err);
});

const parseLocks = new Set();

function getNicheFromCommand(text) {
  if (!text) return null;
  const m = text.match(/\/parse\s+(.+)/i);
  return m?.[1]?.trim() || null;
}

function normalizeNicheForSearch(niche) {
  const s = String(niche || '').trim();
  if (s.length > 4 && /[а-яёa-z]ы$/i.test(s)) return s.slice(0, -1);
  return s;
}

function normalizeName(s) {
  return (s || '')
    .toString()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim();
}

function toArray(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function getRating(lead) {
  const rating = typeof lead.rating === 'number' ? lead.rating : Number(lead.rating);
  return Number.isFinite(rating) ? rating : null;
}

function getTotalReviews(lead) {
  if (lead.reviewCount !== null && lead.reviewCount !== undefined) {
    const rc = Number(lead.reviewCount);
    if (Number.isFinite(rc)) return rc;
  }
  return toArray(lead.reviews).length;
}

function passesRatingAndReviewFilters(lead) {
  const rating = getRating(lead);
  if (rating !== null && (rating < MIN_RATING || rating > MAX_RATING)) return false;

  const totalReviews = getTotalReviews(lead);
  if (Number.isFinite(totalReviews) && totalReviews >= MIN_TOTAL_REVIEWS) return true;

  if (rating !== null && (lead.name || lead.sourceLink || lead.link)) return true;

  return false;
}

function dedupeLeads(leads) {
  const map = new Map();
  for (const l of leads) {
    const nameKey = normalizeName(l.name);
    const key = `${l.city || ''}:${nameKey || l.sourceLink || l.link || ''}`.trim();
    const prev = map.get(key);
    if (!prev) {
      map.set(key, l);
      continue;
    }

    const prevRating = getRating(prev) ?? -1;
    const nextRating = getRating(l) ?? -1;

    if (nextRating > prevRating) map.set(key, l);
    else {
      if ((getTotalReviews(l) || 0) > (getTotalReviews(prev) || 0)) map.set(key, l);
    }
  }
  return Array.from(map.values());
}

async function createContext() {
  const userDataDir = path.join(__dirname, '..', '.playwright', 'user-data');
  const args = [
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
  ];

  const proxy = PROXY_URL ? { server: PROXY_URL } : undefined;

  return chromium.launchPersistentContext(userDataDir, {
    headless: HEADLESS,
    userAgent: USER_AGENT,
    viewport: { width: 1366, height: 768 },
    locale: 'ru-RU',
    proxy,
    args,
  });
}

async function parseNiche(niche, chatId) {
  if (parseLocks.has(chatId)) return { leads: [], stats: { raw: 0, filtered: 0 } };
  parseLocks.add(chatId);

  const searchNiche = normalizeNicheForSearch(niche);

  let context;
  try {
    context = await createContext();
    const allLeads = [];

    for (const city of cities) {

      bot.telegram.sendMessage(chatId, `Ищу лиды в ${city} по нише: "${searchNiche}"...`);

      try {
        const yandexLeads = await parseYandexMaps({ niche: searchNiche, city, context, limit: PER_SOURCE_LIMIT });
        allLeads.push(...yandexLeads);
      } catch (e) {
        bot.telegram.sendMessage(chatId, `Яндекс: ошибка парсинга в ${city}. Продолжаю...`);
      }

      if (!SKIP_2GIS) {
        try {
          const gisLeads = await parse2gis({ niche: searchNiche, city, context, limit: PER_SOURCE_LIMIT });
          allLeads.push(...gisLeads);
        } catch (e) {
          console.error('parse2gis failed:', e?.message || e);
          bot.telegram.sendMessage(
            chatId,
            `2GIS: ошибка парсинга в ${city} (${String(e?.message || e).slice(0, 120)}). Продолжаю...`,
          );
        }
      }
    }

    const deduped = dedupeLeads(allLeads);

    const filtered = deduped.filter((l) => passesRatingAndReviewFilters(l));

    filtered.sort((a, b) => {
      const ra = getRating(a);
      const rb = getRating(b);
      if (ra !== null && rb !== null && ra !== rb) return ra - rb;
      if (ra === null && rb !== null) return 1;
      if (rb === null && ra !== null) return -1;
      const aHasSite = a.website ? 1 : 0;
      const bHasSite = b.website ? 1 : 0;
      if (aHasSite !== bHasSite) return aHasSite - bHasSite;
      return 0;
    });

    const leadTarget = Math.min(randomLeadTarget(), MAX_LEADS);
    const goodLeads = [];
    for (const lead of filtered) {
      const forPain = selectReviewsForPainAnalysis(lead.reviews);
      const painRes = analyzePains(forPain, { lead });
      if (!hasConcretePain(painRes, forPain, MIN_PAIN_SCORE, lead)) continue;

      const offerText = generateOffer({
        pains: painRes.pains,
        themes: painRes.themes,
        offerHints: painRes.offerHints,
        hasWebsite: Boolean(lead.website),
        evidenceQuotes: painRes.evidenceQuotes || [],
      });

      goodLeads.push({
        ...lead,
        pains: painRes.pains,
        painSummary: painRes.summary,
        offerText,
        evidenceQuotes: painRes.evidenceQuotes || [],
        hasWebsite: Boolean(lead.website),
      });

      if (goodLeads.length >= leadTarget) break;
    }

    return { leads: goodLeads, stats: { raw: deduped.length, filtered: filtered.length } };
  } finally {
    parseLocks.delete(chatId);
    if (context) await context.close().catch(() => {});
  }
}

bot.start(async (ctx) => {
  return ctx.reply(
    [
      'Я Telegram-бот для лидогенерации агентства.',
      '',
      'Команды:',
      '/start — описание бота',
      '/parse [ниша] — запуск парсинга (например: /parse стоматология)',
      '',
      'Работаем по Москве. Источники: Яндекс Карты, 2GIS.',
      'AI не используется: фильтрация и боли — rule-based.',
    ].join('\n'),
  );
});

bot.command('parse', async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const niche = getNicheFromCommand(ctx.message.text);
  if (!niche || niche.length < 2) {
    return ctx.reply('Укажите нишу: /parse стоматология');
  }

  if (parseLocks.has(chatId)) {
    return ctx.reply('Парсинг уже запущен. Дождитесь завершения.');
  }

  try {
    await ctx.reply(`Запускаю парсинг по нише: "${niche}"... Это может занять время.`);
    const { leads, stats } = await parseNiche(niche, chatId);

    if (!leads.length) {
      const hint =
        stats.raw === 0
          ? 'Карточки из Яндекс.Карт и 2GIS не собрались (сеть, капча, блокировка или смена страницы). Попробуйте HEADLESS=false в .env или другую сеть.'
          : stats.filtered === 0
            ? `Собрано карточек: ${stats.raw}, но ни одна не прошла фильтр по рейтингу (MIN_RATING/MAX_RATING в .env).`
            : `Собрано: ${stats.raw}, после фильтра рейтинга: ${stats.filtered}, но ни одна не прошла отбор по болям/эвристике. В .env поставьте MIN_PAIN_SCORE=0 (или оставьте по умолчанию) для широких ниш; для только «болящих» карточек — MIN_PAIN_SCORE=1.`;
      await ctx.reply(
        ['Не нашёл лидов для выдачи.', hint, `Диагностика: raw=${stats.raw}, filtered=${stats.filtered}.`].join(
          '\n',
        ),
      );
      return;
    }

    for (let i = 0; i < leads.length; i++) {
      const msg = formatLeadMessage(leads[i]);
      await ctx.replyWithHTML(msg, { disable_web_page_preview: true });
      await new Promise((r) => setTimeout(r, 600));
      if (i === leads.length - 1) break;
    }

    await ctx.reply(`Готово. Отправлено лидов: ${leads.length}.`);
  } catch (e) {
    await ctx.reply(`Ошибка: ${e?.message || 'неизвестно'}`);
  }
});

bot.launch();
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

