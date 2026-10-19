function excerpt(s, max) {
  const t = String(s || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function generateOffer({ themes, offerHints, hasWebsite, evidenceQuotes = [], pains = [] }) {
  const t = themes || {};
  let hints = (Array.isArray(offerHints) ? offerHints : []).filter((h) => h && h !== 'fallback');
  if (!hints.length) hints = inferHintsFromThemes(t);
  const lines = [];
  const q0 = evidenceQuotes[0];

  const pushUnique = (s) => {
    const x = String(s).trim();
    if (x && !lines.includes(x)) lines.push(x);
  };

  if (q0) {
    pushUnique(`Опираемся на формулировку из отзыва: «${excerpt(q0, 130)}»`);
  }

  if (hints.includes('booking') || (t.queue_wait || 0) + (t.booking || 0) >= 2) {
    pushUnique(
      'Запись и ожидание: вынести слоты и напоминания в мессенджеры, синхронизацию с календарём — по теме отзывов выше.',
    );
  }

  if (hints.includes('bot') || (t.communication || 0) >= 2) {
    pushUnique(
      'Связь: сценарии ответов в WhatsApp/Telegram на типовые вопросы до визита, без потери обращения.',
    );
  }

  if (hints.includes('price') || (t.price || 0) >= 2) {
    pushUnique(
      'Цена: прозрачные этапы и формулировки в боте/на сайте под запросы из отзывов (без давления).',
    );
  }

  if (hints.includes('crm') || (t.staff_negative || 0) + (t.quality_result || 0) >= 3) {
    pushUnique(
      'Качество коммуникации и ожиданий: чек-листы консультации и фиксация обещаний в CRM.',
    );
  }

  if (hints.includes('trust') || (t.service_trust || 0) >= 1) {
    pushUnique(
      'Прозрачность работ: смета и согласование до начала, фото этапов в мессенджер, договор и переписка как доказательная база — против типичных жалоб «навязали» и «развод».',
    );
  }

  if (hints.includes('site') || (t.website_online || 0) >= 1) {
    if (!hasWebsite) {
      pushUnique('Сайт как точка входа с карт: быстрые формы и цели в аналитике.');
    } else {
      pushUnique('Сайт уже есть — доработать первый экран под запросы из отзывов и UTM с карт.');
    }
  }

  if (hints.includes('content') || (t.comfort_pain || 0) + (t.cleanliness || 0) >= 2) {
    pushUnique('Комфорт/переживания: короткие блоки «как проходит приём» в чате и на сайте.');
  }

  if (lines.length <= 1 && q0) {
    pushUnique(
      'Дальше — упаковать эти формулировки в единый сценарий: от карточки в картах до ответа в мессенджере за минуты.',
    );
  }

  if (lines.length === 0) {
    const p = Array.isArray(pains) ? pains.join(' ') : '';
    pushUnique(
      p
        ? `По размеченным темам: ${excerpt(p, 200)} — детализируем в созвоне под вашу воронку.`
        : 'Недостаточно выдержек из отзывов для автоматического оффера — нужен ручной разбор карточки.',
    );
  }

  return lines.slice(0, 4).join('\n');
}

function inferHintsFromThemes(themes) {
  const h = [];
  const s = themes || {};
  if ((s.queue_wait || 0) + (s.booking || 0) >= 2) h.push('booking');
  if ((s.communication || 0) >= 2) h.push('bot');
  if ((s.price || 0) >= 2) h.push('price');
  if ((s.staff_negative || 0) + (s.quality_result || 0) >= 3) h.push('crm');
  if ((s.service_trust || 0) >= 1) h.push('trust');
  if ((s.website_online || 0) >= 1) h.push('site');
  if ((s.comfort_pain || 0) + (s.cleanliness || 0) >= 2) h.push('content');
  return h;
}

module.exports = { generateOffer };
