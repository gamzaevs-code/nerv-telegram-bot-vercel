# 💬 CHAT UI GUIDE - MINI APP

## 🎯 КАК ЭТО РАБОТАЕТ

### 📱 ПРИ ОТКРЫТИИ ЗАДАЧИ:

1. **Пользователь видит задачу**
2. **Нажимает кнопку "💬 Написать"**
3. **Открывается модальное окно с ДВУМЯ ТАБАМИ:**

```
┌─────────────────────────────────┐
│  💬 ЧАТ ПО ЗАДАНИЮ #123    [✕] │
├─────────────────────────────────┤
│  [🔒 Личный] [💬 Общий]        │  ← ТАБЫ
├─────────────────────────────────┤
│                                 │
│  Здесь сообщения из выбранного  │
│  типа чата                      │
│                                 │
├─────────────────────────────────┤
│  Сообщение...            [➤]    │
└─────────────────────────────────┘
```

---

## 🔒 ПРИВАТНЫЙ ЧАТ (Личный)

**API Actions:**
- `action: "history"` - загрузить историю
- `action: "send"` - отправить сообщение

**Видимо:**
- ✅ Создателю задачи
- ✅ Исполнителю задачи
- ❌ Другим участникам

**Случаи использования:**
- Переговоры
- Уточнения
- Конфиденциальные вопросы

---

## 💬 ПУБЛИЧНЫЙ ЧАТ (Общий)

**API Actions:**
- `action: "public_history"` - загрузить историю
- `action: "public_send"` - отправить сообщение

**Видимо:**
- ✅ Всем участникам задачи

**Случаи использования:**
- Общее обсуждение
- Вопросы от других
- Рекомендации

---

## 🧠 КАК РАБОТАЕТ В КОД

### 1️⃣ **Переменная типа чата**
```javascript
let chatType = 'private'; // или 'public'
```

### 2️⃣ **При открытии модали (openChatModal)**
```javascript
chatType = 'private'; // Всегда начинаем с приватного
```

### 3️⃣ **Кликабельные табы**
```javascript
tabs.forEach(tab => {
  tab.addEventListener('click', async () => {
    chatType = tab.dataset.type; // 'private' или 'public'
    // Перезагружаем сообщения
    await loadChatHistory(chatTaskId);
  });
});
```

### 4️⃣ **Динамическая загрузка**
```javascript
const action = chatType === 'public' ? 'public_history' : 'history';
const res = await fetch('/api/app-chat', {
  method: 'POST',
  body: JSON.stringify({ initData, action, taskId })
});
```

### 5️⃣ **Динамическая отправка**
```javascript
const action = chatType === 'public' ? 'public_send' : 'send';
const res = await fetch('/api/app-chat', {
  method: 'POST',
  body: JSON.stringify({ initData, action, taskId, message })
});
```

---

## 🎨 CSS СТИЛИ

### Tab Container
```css
.chat-tabs {
  display: flex;          /* Два кнопки рядом */
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: rgba(0, 0, 0, 0.2);
}
```

### Tab Button
```css
.chat-tab {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.2s ease;
}

/* Нормальное состояние */
.chat-tab:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text);
}

/* АКТИВНОЕ состояние */
.chat-tab.active {
  background: linear-gradient(135deg, var(--accent) 0%, rgba(0, 229, 255, 0.6) 100%);
  border-color: var(--accent);
  color: var(--bg);
  box-shadow: 0 0 12px var(--accent-glow); /* Свечение */
}
```

---

## 📡 API ENDPOINTS

### Приватный чат
```javascript
POST /api/app-chat
{
  initData: "...",
  action: "history" OR "send",
  taskId: 123,
  message: "Hello!" // только для send
}
```

### Публичный чат
```javascript
POST /api/app-chat
{
  initData: "...",
  action: "public_history" OR "public_send",
  taskId: 123,
  message: "Hello!" // только для public_send
}
```

---

## 🔄 ЖИЗНЕННЫЙ ЦИКЛ

```
user clicks "💬 Написать"
           ↓
    openChatModal(123)
           ↓
   chatType = 'private'
           ↓
  render tabs (private ACTIVE)
           ↓
   loadChatHistory(123)  // action: 'history'
           ↓
  user clicks [💬 Общий] tab
           ↓
    chatType = 'public'
           ↓
     tab.classList.add('active')
           ↓
   loadChatHistory(123)  // action: 'public_history'
           ↓
  user types message + send
           ↓
  sendChatMessage()
           ↓
    action = 'public_send' (because chatType === 'public')
           ↓
   message sent to API
           ↓
  reload messages
```

---

## 🔐 БЕЗОПАСНОСТЬ

✅ **Сервер проверяет:**
- Является ли пользователь участником задачи
- Для приватного чата: только создатель + исполнитель
- Для публичного: все участники
- Максимум 2000 символов
- Автоматическое помечание как "прочитано"

---

## 📝 ПРИМЕРЫ

### Открыть чат
```javascript
const taskId = 123;
openChatModal(taskId);
```

### Переключиться на публичный
```javascript
// Клик на таб с data-type="public"
chatType = 'public';
await loadChatHistory(taskId);
```

### Отправить сообщение
```javascript
const message = "Привет!";
// если chatType === 'private', action = 'send'
// если chatType === 'public', action = 'public_send'
```

---

## 📊 ФАЙЛЫ

| Файл | Изменения |
|------|-----------|
| `mini/app.js` | + chatType + tab logic + dynamic actions |
| `mini/style.css` | + .chat-tabs + .chat-tab styles |
| `api/app-chat.js` | Уже поддерживает все actions |
| `lib/chat-public.js` | Уже реализована |

---

## 🚀 ГОТОВО К PRODUCTION

✅ Две кнопки в модали  
✅ Динамическая смена типа чата  
✅ Отдельные API actions  
✅ Красивые CSS стили  
✅ Безопасность на сервере  
✅ Протестировано  

---

**Status**: ✅ COMPLETE  
**Commit**: 9ce3766  
**Date**: 29 Sep 2024
