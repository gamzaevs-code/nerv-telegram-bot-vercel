require('dotenv').config();

(async () => {
  const apiKey = process.env.CLOUD_API_KEY;
  console.log('Ключ:', apiKey ? apiKey.slice(0, 10) + '...' : 'НЕ НАЙДЕН');
  if (!apiKey) return;

  try {
    const res = await fetch('https://foundation-models.api.cloud.ru/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'GigaChat/GigaChat-2-Max',
        messages: [{ role: 'user', content: 'Привет' }],
        max_tokens: 30,
      }),
    });
    const status = res.status;
    const text = await res.text();
    console.log('HTTP статус:', status);
    console.log('Ответ:', text.slice(0, 500));
  } catch (e) {
    console.error('Ошибка:', e.message);
  }
})();