# 📱 ПЛАН: ПРЯМЫЕ СООБЩЕНИЯ МЕЖДУ ПОЛЬЗОВАТЕЛЯМИ

## 🎯 ЧТО НУЖНО СДЕЛАТЬ

### Функция:
Пользователи могут отправлять друг другу личные сообщения (ДМ).

### Где разместить:
1. **В профиле** - кнопка "💬 Написать сообщение" возле имени пользователя
2. **В ТОПе** - кнопка возле каждого игрока
3. **В поиске** - кнопка возле найденного пользователя

### Функциональность:
- ✅ Открыть личный чат с пользователем
- ✅ История сообщений
- ✅ Отправка/получение
- ✅ Уведомления о новых сообщениях
- ✅ Счётчик непрочитанных

---

## 📁 ЧТО НУЖНО ИЗМЕНИТЬ

### 1. DATABASE (prisma/schema.prisma)
```prisma
✅ Создать таблицу UserMessage
   - id
   - fromUserId (FK User)
   - toUserId (FK User)
   - message (2000 chars)
   - isRead
   - createdAt
   - Индексы: (fromUserId, toUserId), (toUserId, isRead)
```

### 2. BACKEND API (api/app-user-messages.js)
```javascript
✅ POST /api/app-user-messages
   action: 'history'      // История чата с пользователем
   action: 'send'         // Отправить сообщение
   action: 'list'         // Список всех чатов
   action: 'unread_count' // Количество непрочитанных
```

### 3. LIB FUNCTIONS (lib/user-messages.js)
```javascript
✅ sendUserMessage(fromId, toId, message)
✅ getUserMessageHistory(userId, otherId, limit)
✅ getUserMessagesList(userId)
✅ getUnreadUserMessagesCount(userId)
✅ markUserMessagesAsRead(userId, otherId)
✅ searchUserMessagesConversations(userId)
```

### 4. FRONTEND UI (mini/app.js + index.html)
```html
✅ Добавить кнопку "💬 Написать" в профиль
✅ Новая вкладка в навигации "💬 Сообщения" (если нужна)
✅ Модаль для личного чата
✅ Список активных чатов
```

### 5. FRONTEND LOGIC (mini/app.js)
```javascript
✅ openUserChatModal(userId, userName)
✅ loadUserMessages(userId)
✅ sendUserMessage(recipientId, message)
✅ loadMessagesList()
✅ renderUserMessagesList()
✅ markAsRead(userId)
```

---

## 🔄 WORKFLOW

```
1. Пользователь открывает профиль другого пользователя
2. Видит кнопку "💬 Написать сообщение"
3. Нажимает кнопку
4. Открывается модаль с чатом
5. Видит историю сообщений
6. Пишет новое сообщение
7. Отправляет (Enter или кнопка)
8. Сообщение сохраняется в БД
9. Получатель видит уведомление
10. Оба видят сообщение в истории
```

---

## 📊 DATABASE STRUCTURE

```sql
CREATE TABLE UserMessage (
  id Int PRIMARY KEY AUTO_INCREMENT,
  fromUserId Int NOT NULL,
  toUserId Int NOT NULL,
  message VARCHAR(2000) NOT NULL,
  isRead Boolean DEFAULT false,
  createdAt DateTime DEFAULT NOW(),
  
  FOREIGN KEY (fromUserId) REFERENCES User(id) ON DELETE CASCADE,
  FOREIGN KEY (toUserId) REFERENCES User(id) ON DELETE CASCADE,
  
  INDEX idx_from_to (fromUserId, toUserId),
  INDEX idx_to_unread (toUserId, isRead),
  INDEX idx_createdat (createdAt DESC)
)
```

---

## 🎨 UI ELEMENTS

### 1. Кнопка в профиле:
```html
<button class="btn-message" data-user-id="123">
  💬 Написать сообщение
</button>
```

### 2. Модаль чата:
```
┌─────────────────────────────────┐
│  💬 @petya_gamer           [✕]  │
├─────────────────────────────────┤
│  Здравствуйте! Как дела?        │
│  You: Привет! Всё хорошо! 👋    │
│  @petya: Хочу взять задачу      │
│  You: Да, конечно!              │
├─────────────────────────────────┤
│  Сообщение...            [➤]    │
└─────────────────────────────────┘
```

### 3. Список чатов (доп):
```
💬 СООБЩЕНИЯ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@ivan (3) - "Спасибо за помощь!"
@petya (1) - "Ты свободен завтра?"
@maria - "Привет!"
```

---

## 🔐 БЕЗОПАСНОСТЬ

✅ Только авторизованные пользователи могут отправлять  
✅ Пользователь может отправлять только себе (fromId == текущий)  
✅ Максимум 2000 символов  
✅ Rate limiting (макс 10 сообщений в минуту)  
✅ Нельзя отправить себе  
✅ XSS protection через escapeHtml()  

---

## 📈 СТАТИСТИКА

| Метрика | Значение |
|---------|----------|
| Новые таблицы БД | 1 |
| Новые API endpoints | 4 |
| Новые функции | 6 |
| UI компоненты | 2 (кнопка + модаль) |
| Файлы для создания | 2 (schema + lib) |
| Файлы для обновления | 2 (app.js + index.html) |

---

## 🚀 РЕАЛИЗАЦИЯ (ПОРЯДОК)

### Этап 1: Database
```
1. Обновить prisma/schema.prisma
2. Создать миграцию
3. Применить миграцию
```

### Этап 2: Backend
```
1. Создать lib/user-messages.js
2. Создать api/app-user-messages.js
3. Протестировать API
```

### Этап 3: Frontend
```
1. Добавить кнопку в профиль
2. Добавить модаль чата
3. Добавить логику в app.js
4. Протестировать UI
```

### Этап 4: Documentation
```
1. Документация API
2. Примеры использования
3. README обновить
```

---

## ✅ ACCEPTANCE CRITERIA

- ✅ Пользователь может открыть чат с другим пользователем
- ✅ Может отправить сообщение
- ✅ Видит историю сообщений
- ✅ Получает уведомление о новом сообщении
- ✅ Может видеть счётчик непрочитанных
- ✅ Сообщения сохраняются в БД
- ✅ Работает для 1000+ активных пользователей
- ✅ Производительность < 100ms на запрос

---

## 🎯 PRIORITY: HIGH

Это основная функция для общения пользователей!

---

**Status**: PLANNED  
**Date**: 29 Sep 2024  
**Est. Time**: 2-3 часа
