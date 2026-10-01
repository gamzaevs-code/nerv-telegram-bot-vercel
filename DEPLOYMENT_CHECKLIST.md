# ✅ ЧЕКЛИСТ РАЗВЕРТЫВАНИЯ НА VERCEL

## 🚨 КРИТИЧНАЯ ЗАДАЧА: МИГРАЦИЯ БД

**ПЕРЕД ДЕПЛОЕМ НУЖНО:**

Создать Prisma миграцию для добавления полей премиума в User:

```bash
npx prisma migrate dev --name add_premium_subscription
```

Это добавит:
```sql
ALTER TABLE "User" ADD COLUMN "premiumPlan" VARCHAR(20) DEFAULT 'free';
ALTER TABLE "User" ADD COLUMN "premiumExpireAt" TIMESTAMP NULL;
```

---

## 📋 ФИНАЛЬНЫЙ ЧЕКЛИСТ

### Git & Код
- ✅ git status - рабочая директория чистая
- ✅ git log - все коммиты видны
- ✅ Синтаксис проверен (node --check)
- ✅ Все файлы на main ветке

### Новый Функционал
- ✅ lib/user-messages.js (6 функций для ДМ)
- ✅ api/app-messages.js (5 endpoints)
- ✅ lib/premium.js (10 функций)
- ✅ api/app-premium.js (7 endpoints)
- ✅ mini/app.js (UI обновлена)

### Database
- ⚠️ **НУЖНО СДЕЛАТЬ:** npx prisma migrate dev --name add_premium_subscription
- [ ] Закоммитить миграцию
- [ ] Запушить миграцию

### Environment
- ✅ DATABASE_URL (в Vercel)
- ✅ TELEGRAM_BOT_TOKEN (в Vercel)
- ✅ package.json актуален

---

## 🚀 STEP-BY-STEP

### 1. Создать миграцию
```bash
npx prisma migrate dev --name add_premium_subscription
```

### 2. Закоммитить
```bash
git add prisma/migrations/
git commit -m "MIGRATION: Add premium subscription fields"
git push origin main
```

### 3. Vercel автоматически:
- Получит новый commit
- Запустит npm install
- Запустит миграции
- Задеплоит

### 4. Проверить
```
1. Зайти на https://vercel.com/dashboard
2. Проверить последний Deployment (✅ зелёный)
3. Посмотреть Logs
4. Протестировать в мини-приложении
```

---

## ✅ ГОТОВО К ДЕПЛОЮ?

| Компонент | Статус |
|-----------|--------|
| Git commits | ✅ |
| Node.js | ✅ |
| Dependencies | ✅ |
| API endpoints | ✅ |
| UI components | ✅ |
| **Database migration** | ⏳ НУЖНО |
| Environment vars | ✅ |

---

**Status**: READY (после создания миграции)  
**Next**: Создать миграцию и запушить!
