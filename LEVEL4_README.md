# 🛡️ LEVEL 4: ANALYTICS & MODERATION SYSTEM

## 📋 Что это?

LEVEL 4 - полная система администратора с:
- ✅ **AdminLog** - логирование всех действий админов
- ✅ **SystemLog** - логирование ошибок и событий
- ✅ **UserReport** - система жалоб пользователей
- ✅ **UserMute** - временное блокирование чата
- ✅ **DailyStats** - ежедневная статистика
- ✅ **ContentFilter** - словарь плохих слов
- ✅ **Anti-spam** - защита от спама
- ✅ **/api/moderation** - API для админа
- ✅ **/api/analytics** - API для статистики

---

## 🗄️ PRISMA MODELS

### AdminLog
```javascript
{
  id, adminId, action, targetId, targetType, reason, details, createdAt
}
// action: 'ban_user', 'mute_user', 'delete_task', etc
```

### SystemLog  
```javascript
{
  id, level, message, context, stackTrace, createdAt
}
// level: 'error', 'warning', 'info'
```

### UserReport
```javascript
{
  id, reporterId, reportedId, reason, description, status, decision, createdAt, resolvedAt
}
// status: 'open' | 'resolved'
```

### UserMute
```javascript
{
  id, userId, reason, muteUntil, createdAt
}
```

### ContentFilter
```javascript
{
  id, word, severity, createdAt
}
```

### DailyStats
```javascript
{
  id, date, totalUsers, activeUsers, newUsers, tasksCreated, tasksCompleted, totalRevenue, messagesCount, createdAt
}
```

---

## 🔗 API ENDPOINTS

### POST /api/moderation
- `action: "ban_user"` - забанить пользователя
- `action: "mute_user"` - замьютить пользователя
- `action: "unmute_user"` - разблокировать чат
- `action: "get_logs"` - получить логи действий
- `action: "get_reports"` - получить жалобы
- `action: "resolve_report"` - разрешить жалобу

### POST /api/analytics
- `action: "basic_stats"` - основная статистика
- `action: "daily_stats"` - дневная статистика
- `action: "top_users"` - топ пользователей
- `action: "recent_payments"` - последние платежи
- `action: "system_health"` - здоровье системы
- `action: "moderation_stats"` - статистика модерации

---

## 🛡️ ANTI-SPAM (/lib/anti-spam.js)

### Функции:
- `checkContent(text)` - проверка плохих слов
- `checkRateLimit(userId, max, window)` - rate limiting
- `validateUserBehavior(userId)` - проверка статуса
- `checkMuteStatus(userId)` - статус мута
- `logAbuse(userId, type, reason)` - логирование нарушений

### Пример:
```javascript
const { checkContent, checkRateLimit } = require('./lib/anti-spam');

// Проверка контента
const check = checkContent("bad word here");
if (!check.clean) return res.status(400).json({ error: 'Inappropriate content' });

// Проверка rate limit
const limit = checkRateLimit(userId);
if (limit.limited) return res.status(429).json({ error: 'Rate limited' });
```

---

## 🔒 БЕЗОПАСНОСТЬ

✅ Все админ-действия требуют `isModerator` флага  
✅ Верификация Telegram `initData`  
✅ Логирование всех действий админов  
✅ Фильтр плохих слов  
✅ Rate limiting на сообщения  
✅ Система жалоб от пользователей  

---

## 📦 МИГРАЦИЯ

Создана Prisma миграция:
```
prisma/migrations/20260929181901-add-level-4-analytics/
```

При deploy на Vercel:
1. Schema изменится
2. Миграция выполнится автоматически
3. Все таблицы создадутся
4. API endpoints готовы к использованию

---

## 🚀 DEPLOYMENT READY

✅ Prisma schema валидна  
✅ Все API endpoints синтаксически верны  
✅ Миграция SQL готова  
✅ Все relations правильно настроены  
✅ Запущено на GitHub (коммит 58a6385)

---

**Status:** ✅ PRODUCTION READY  
**Version:** 4.0  
**Date:** 29 Sep 2024
