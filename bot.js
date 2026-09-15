const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

require('dotenv').config();
console.log('1. .env загружен');

// Простой HTTP-сервер для health-check Cloud.ru
const http = require('http');
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK');
}).listen(process.env.PORT || 3000, () => {
  console.log(`🌐 Health-check сервер слушает порт ${process.env.PORT || 3000}`);
});

const { Telegraf } = require('telegraf');
const https = require('https');
console.log('2. telegraf загружен');

const webhookHandler = require('./api/webhook.js');
console.log('3. webhook.js загружен');

const token = process.env.BOT_TOKEN;
console.log('4. Токен:', token ? 'есть' : 'нет');

async function startPolling() {
  console.log('5. Создаю бота...');

  const bot = new Telegraf(token, {
    telegram: {
      agent: new https.Agent({
        family: 4,
        keepAlive: true,
        timeout: 30000,
      }),
    },
  });

  // Проверим, что getMe отвечает, до любых других действий
  console.log('5.1. Проверяю getMe...');
  try {
    const me = await bot.telegram.getMe();
    console.log('5.2. getMe OK, бот:', me.username);
  } catch (e) {
    console.error('❌ getMe не работает:', e.message);
    console.error('   Проверь сеть/прокси/файрвол.');
    return;
  }

  bot.on('message', async (ctx) => {
    console.log('📩 Сообщение:', ctx.message.text || '[media]');
    const fakeReq = { method: 'POST', body: { message: ctx.message } };
    const fakeRes = { status: () => ({ send: () => {} }), send: () => {} };
    try {
      await webhookHandler(fakeReq, fakeRes);
    } catch (e) {
      console.error('Ошибка message:', e);
    }
  });

  bot.on('callback_query', async (ctx) => {
    console.log('🔘 Callback:', ctx.callbackQuery.data);
    const fakeReq = { method: 'POST', body: { callback_query: ctx.callbackQuery } };
    const fakeRes = { status: () => ({ send: () => {} }), send: () => {} };
    try {
      await webhookHandler(fakeReq, fakeRes);
    } catch (e) {
      console.error('Ошибка callback:', e);
    }
  });

  console.log('6. Удаляю вебхук...');
  try {
    await Promise.race([
      bot.telegram.deleteWebhook({ drop_pending_updates: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('deleteWebhook timeout 15s')), 15000)),
    ]);
    console.log('7. Вебхук удалён');
  } catch (e) {
    console.error('⚠️ Ошибка удаления вебхука:', e.message);
    console.log('   Пробую запустить polling без удаления...');
  }

  console.log('8. Запускаю polling...');
  await bot.launch({ dropPendingUpdates: true });
  console.log('✅ Бот запущен!');
}

startPolling().catch((e) => {
  console.error('❌ Ошибка запуска:', e.message);
});