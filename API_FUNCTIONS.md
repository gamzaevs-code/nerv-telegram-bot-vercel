# 📊 ПОЛНЫЙ СПИСОК API ФУНКЦИЙ (SERVERLESS)

## 📈 СТАТИСТИКА

| Параметр | Значение |
|----------|----------|
| **Всего функций** | 14 |
| **Hobby лимит** | 12 ❌ |
| **Pro лимит** | ∞ ✅ |
| **Требуется тариф** | **Pro** |

---

## 🔗 ФУНКЦИИ (14 штук)

### 1️⃣ **app-auth.js**
```
POST /api/app-auth
Функция: Аутентификация и регистрация пользователей
```

### 2️⃣ **app-profile.js**
```
POST /api/app-profile
Функция: Профиль пользователя, статистика, достижения
```

### 3️⃣ **app-tasks.js**
```
POST /api/app-tasks
Функция: Список всех задач, фильтрация, поиск
```

### 4️⃣ **app-create-task.js**
```
POST /api/app-create-task
Функция: Создание новой задачи
```

### 5️⃣ **app-task-action.js**
```
POST /api/app-task-action
Функция: Действия с задачей (vote, accept, complete)
```

### 6️⃣ **app-leaderboard.js**
```
POST /api/app-leaderboard
Функция: Таблица лидеров, рейтинги
```

### 7️⃣ **app-chat.js**
```
POST /api/app-chat
Функция: Чат в задачах, сообщения, история
```

### 8️⃣ **app-data.js**
```
POST /api/app-data
Функция: Получение общих данных (конфиг, словари)
```

### 9️⃣ **app-payment.js**
```
POST /api/app-payment
Функция: Платежи (Yookassa), выкупы, переводы
```

### 🔟 **app-change-role.js**
```
POST /api/app-change-role
Функция: Изменение роли пользователя (только админ)
```

### 1️⃣1️⃣ **moderation.js** ⭐ LEVEL 4
```
POST /api/moderation
Функция: Управление пользователями (ban, mute, reports)
```

### 1️⃣2️⃣ **analytics.js** ⭐ LEVEL 4
```
POST /api/analytics
Функция: Аналитика и статистика (stats, health, trends)
```

### 1️⃣3️⃣ **webhook.js**
```
POST /api/webhook
Функция: Webhook от Telegram, Yookassa и других сервисов
```

### 1️⃣4️⃣ **cron.js**
```
GET /api/cron
Функция: Крон-задачи (очистка, ежедневные награды и т.д.)
```

---

## 🎯 ГРУППИРОВКА ПО НАЗНАЧЕНИЮ

### 🔐 Аутентификация (1)
- `app-auth.js` - вход, регистрация

### 👤 Профиль и Данные (3)
- `app-profile.js` - профиль пользователя
- `app-data.js` - конфиг и словари
- `app-change-role.js` - роли (админ-панель)

### 📋 Задачи (3)
- `app-tasks.js` - список задач
- `app-create-task.js` - создание
- `app-task-action.js` - действия (vote, accept, complete)

### 💬 Социальные (2)
- `app-chat.js` - чат в задачах
- `app-leaderboard.js` - лидеры

### 💰 Платежи (1)
- `app-payment.js` - Yookassa, платежи

### ⚙️ Система (4)
- `moderation.js` - модерация (LEVEL 4)
- `analytics.js` - аналитика (LEVEL 4)
- `webhook.js` - webhooks
- `cron.js` - крон-задачи

---

## 🚀 ПОЧЕМУ НУЖЕН PRO?

```
Hobby (12 функций):
├─ app-auth ✓
├─ app-profile ✓
├─ app-tasks ✓
├─ app-create-task ✓
├─ app-task-action ✓
├─ app-leaderboard ✓
├─ app-chat ✓
├─ app-data ✓
├─ app-payment ✓
├─ app-change-role ✓
├─ webhook ✓
└─ cron ✓
   ЛИМИТ ДОСТИГНУТ! 🔴

❌ moderation ✗
❌ analytics ✗

Pro (неограниченно):
├─ app-auth ✓
├─ app-profile ✓
├─ app-tasks ✓
├─ app-create-task ✓
├─ app-task-action ✓
├─ app-leaderboard ✓
├─ app-chat ✓
├─ app-data ✓
├─ app-payment ✓
├─ app-change-role ✓
├─ moderation ✓
├─ analytics ✓
├─ webhook ✓
└─ cron ✓
   ВСЕ 14 ФУНКЦИЙ РАБОТАЮТ! ✅
```

---

## 📦 ПРОЦЕСС ОБНОВЛЕНИЯ

1. **Обновляешь тариф на Pro** ($20/месяц)
2. **Запускаешь редеплой** проекта
3. **Vercel перестраивает все 14 функций**
4. **Все работает идеально!** ✅

---

## ✅ ПОСЛЕ UPGRADE ПРОВЕРИТЬ

```javascript
// Все эти endpoints должны быть доступны:

POST /api/app-auth        ✓ Working
POST /api/app-profile     ✓ Working
POST /api/app-tasks       ✓ Working
POST /api/app-create-task ✓ Working
POST /api/app-task-action ✓ Working
POST /api/app-leaderboard ✓ Working
POST /api/app-chat        ✓ Working
POST /api/app-data        ✓ Working
POST /api/app-payment     ✓ Working
POST /api/app-change-role ✓ Working
POST /api/moderation      ✓ Working (LEVEL 4)
POST /api/analytics       ✓ Working (LEVEL 4)
POST /api/webhook         ✓ Working
GET  /api/cron            ✓ Working
```

---

**Status**: 🔴 Hobby (NEEDS UPGRADE)  
**Solution**: ✅ Pro Tier ($20/month)  
**Benefits**: ∞ Functions, Unlimited Everything
