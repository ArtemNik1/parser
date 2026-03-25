const { socialLabelForUrl } = require('./links');

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function bold(label) {
  return `<b>${escapeHtml(label)}</b>`;
}

function websiteHostForDisplay(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return String(url || '')
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .split('?')[0];
  }
}

function sourceLinkLabel(lead) {
  const s = (lead.source || '').toLowerCase();
  if (s === '2gis') return '2GIS';
  return 'Яндекс.Карты';
}

function formatSocialLinks(urls) {
  if (!urls || !urls.length) return null;
  return urls
    .filter(Boolean)
    .map((href) => `<a href="${escapeHtml(href)}">${escapeHtml(socialLabelForUrl(href))}</a>`)
    .join(' · ');
}

function formatLeadMessage(lead) {
  const phone = lead.phone ? lead.phone : (lead.phones?.[0] ?? null);
  const email = lead.email ? lead.email : (lead.emails?.[0] ?? null);
  const socials = (lead.socials?.length ? lead.socials : []).filter(Boolean);
  const socialsHtml = formatSocialLinks(socials);

  const srcUrl = lead.sourceLink || lead.link;
  const sourceLine =
    srcUrl && /^https?:\/\//i.test(srcUrl)
      ? `${bold('Источник')} — <a href="${escapeHtml(srcUrl)}">${escapeHtml(sourceLinkLabel(lead))}</a>`
      : null;

  const websiteLine = lead.website
    ? `${bold('Сайт')} — <a href="${escapeHtml(lead.website)}">${escapeHtml(websiteHostForDisplay(lead.website))}</a>`
    : `${bold('Сайт')} — не найден на карточке`;

  const ratingLine =
    typeof lead.rating === 'number' && !Number.isNaN(lead.rating)
      ? `${bold('Рейтинг')} — ${lead.rating.toFixed(1)}${lead.reviewCount ? ` (${lead.reviewCount} отзывов)` : ''}`
      : `${bold('Рейтинг')} — —${lead.reviewCount ? ` (${lead.reviewCount} отзывов)` : ''}`;

  const pains = Array.isArray(lead.pains) ? lead.pains : [];
  const painLines = pains.length ? pains.map((p) => `• ${escapeHtml(p)}`).join('\n') : '• —';

  const painSummary = lead.painSummary
    ? `${bold('Резюме по отзывам')}\n${escapeHtml(lead.painSummary)}`
    : null;

  const evidenceQuotes = Array.isArray(lead.evidenceQuotes) ? lead.evidenceQuotes.filter(Boolean) : [];
  const evidenceBlock =
    evidenceQuotes.length > 0
      ? `${bold('Фрагменты из отзывов')}\n${evidenceQuotes.map((q) => `• ${escapeHtml(q)}`).join('\n')}`
      : null;

  const offer = lead.offerText ? escapeHtml(lead.offerText) : '—';

  const contact = [
    lead.contactPerson ? `${bold('Контактное лицо')} — ${escapeHtml(lead.contactPerson)}` : null,
    lead.legalForm ? `${bold('Юр. форма')} — ${escapeHtml(lead.legalForm)}` : null,
    lead.legalName ? `${bold('Юр. название')} — ${escapeHtml(lead.legalName)}` : null,
  ].filter(Boolean);

  const parts = [
    bold(lead.name || '—'),
    '',
    `${bold('Город')} — ${escapeHtml(lead.city || '—')}`,
    '',
    `${bold('Телефон')} — ${phone ? escapeHtml(phone) : '—'}`,
    `${bold('Email')} — ${email ? escapeHtml(email) : '—'}`,
  ];

  if (socialsHtml) {
    parts.push(`${bold('Соцсети')}\n${socialsHtml}`);
  }

  if (contact.length) {
    parts.push('', ...contact);
  }

  parts.push('', websiteLine, ratingLine);

  if (sourceLine) {
    parts.push('', sourceLine);
  }

  parts.push(
    '',
    '⚠️ ' + bold('Боли и темы в отзывах'),
    painLines,
  );

  if (evidenceBlock) {
    parts.push('', evidenceBlock);
  }

  if (painSummary) {
    parts.push('', painSummary);
  }

  parts.push('', '💡 ' + bold('Оффер'), offer);

  return parts.join('\n');
}

module.exports = {
  escapeHtml,
  formatLeadMessage,
  formatSocialLinks,
  websiteHostForDisplay,
};
