/**
 * FAST_PARSE=false — медленнее, стабильнее на капризной вёрстке.
 * SKIP_CONTACTS_TAB=true — не кликать «Контакты» на Яндексе (экономия ~2–4 с на карточку).
 * SKIP_2GIS=true — только Яндекс.Карты (в 2 раза быстрее цикл города).
 */
const FAST = String(process.env.FAST_PARSE ?? 'true').toLowerCase() !== 'false';
const SKIP_CONTACTS = String(process.env.SKIP_CONTACTS_TAB ?? (FAST ? 'true' : 'false')).toLowerCase() === 'true';

function getParseTiming() {
  if (!FAST) {
    return {
      fast: false,
      skipContacts: SKIP_CONTACTS,
      searchScrollRounds: 8,
      searchScrollDelay: 900,
      afterSearchGoto: 1400,
      betweenOrgs: 1200,
      afterOrgGoto: 1500,
      prepareScroll: 350,
      prepareAfterPhone: 900,
      prepareContactsDelay: 500,
      prepareAfterContacts: 400,
      prepareFinal: 500,
      reviewTabDelay: 1200,
      reviewMoreDelay: 900,
      reviewScrolls: 9,
      reviewWheelDelay: 400,
      reviewFinalDelay: 800,
      gisPrepareScroll: 400,
      gisAfterPhone: 800,
      gisFinal: 500,
      gisBetweenOrgs: 1300,
      gisAfterGoto: 1500,
      gisAfterSearch: 1600,
    };
  }

  return {
    fast: true,
    skipContacts: SKIP_CONTACTS,
    searchScrollRounds: 5,
    searchScrollDelay: 420,
    afterSearchGoto: 850,
    betweenOrgs: 380,
    afterOrgGoto: 650,
    prepareScroll: 220,
    prepareAfterPhone: 500,
    prepareContactsDelay: 320,
    prepareAfterContacts: 250,
    prepareFinal: 320,
    reviewTabDelay: 550,
    reviewMoreDelay: 450,
    reviewScrolls: 5,
    reviewWheelDelay: 250,
    reviewFinalDelay: 450,
    gisPrepareScroll: 250,
    gisAfterPhone: 450,
    gisFinal: 280,
    gisBetweenOrgs: 420,
    gisAfterGoto: 650,
    gisAfterSearch: 900,
  };
}

module.exports = { getParseTiming, FAST, SKIP_CONTACTS };
