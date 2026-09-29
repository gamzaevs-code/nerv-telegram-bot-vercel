# 💬 CHAT SYSTEM: PRIVATE + PUBLIC

## 🎯 ЧТО ДОБАВИЛОСЬ

**ДВА ТИПА ЧАТОВ В КАЖДОЙ ЗАДАЧЕ:**

1. **ПРИВАТНЫЙ ЧАТ** 🔒
   - Видимо: создателю + исполнителю
   - Переговоры, уточнения
   - Отдельный timeline
   - Уведомления: только двум

2. **ПУБЛИЧНЫЙ ЧАТ** 💬
   - Видимо: всем участникам
   - Обсуждение задачи
   - Отдельный timeline
   - Уведомления: всем участникам

---

## 🗄️ БАЗА ДАННЫХ

**TaskChat** (существующая)
- Приватные сообщения между двумя людьми

**TaskChatPublic** (новая)
- Публичные сообщения для всех

---

## 📡 NEW API ENDPOINTS

### Приватный чат:
- `action: "history"` - история
- `action: "send"` - отправить
- `action: "unread_count"` - количество непрочитанных

### Публичный чат:
- `action: "public_history"` - история
- `action: "public_send"` - отправить
- `action: "unread_public_count"` - количество непрочитанных

---

## 📝 ФАЙЛЫ

- `lib/chat.js` - приватный чат
- `lib/chat-public.js` - публичный чат (NEW)
- `api/app-chat.js` - обновлен (+ public actions)
- `prisma/migrations/...` - SQL создания таблицы

---

## 💻 ПРИМЕР ИСПОЛЬЗОВАНИЯ

```javascript
// Загрузить публичный чат
await fetch('/api/app-chat', {
  method: 'POST',
  body: JSON.stringify({
    initData: tg.initData,
    action: 'public_history',
    taskId: 123
  })
});

// Отправить публичное сообщение
await fetch('/api/app-chat', {
  method: 'POST',
  body: JSON.stringify({
    initData: tg.initData,
    action: 'public_send',
    taskId: 123,
    message: 'Hello all!'
  })
});
```

---

**Status**: ✅ Ready  
**Commit**: fc3f053  
**Date**: 29 Sep 2024
