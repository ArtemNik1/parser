# Tisam Parser

Telegram-бот на Node.js: парсинг организаций с Яндекс.Карт и 2GIS (Playwright), rule-based анализ отзывов и формирование оффера.

## Запуск

```bash
npm install
cp .env.example .env
# Укажите TELEGRAM_TOKEN в .env
npm start
```

Команда в Telegram: `/parse [ниша]` (например `/parse стоматология`).

## Конфигурация

См. `.env.example`: фильтры рейтинга, `MIN_PAIN_SCORE`, `SKIP_2GIS`, `FAST_PARSE` и др.

Секреты не коммитить — `.env` в `.gitignore`.
