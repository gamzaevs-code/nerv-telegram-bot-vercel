const { query } = require('./db');

const AI_MODEL = process.env.AI_MODEL || 'GigaChat/GigaChat-2-Max';
const AI_API_URL = 'https://foundation-models.api.cloud.ru/v1/chat/completions';

const aiModerateContent = async (title, description) => {
  try {
    const apiKey = process.env.CLOUD_API_KEY;
    if (!apiKey) {
      console.warn('aiModerateContent: CLOUD_API_KEY не задан');
      return { ok: true, reason: 'no_api_key' };
    }

    const prompt = `Ты — модератор контента на игровой платформе для выполнения заданий.
Проверь текст задания на наличие нарушений:
- Мат и нецензурная лексика
- Оскорбления, угрозы, травля
- Реклама наркотиков, оружия, азартных игр
- Экстремизм, разжигание розни
- Порнография (18+)
- Скам, мошенничество, фишинг
- Ссылки на подозрительные ресурсы

ЗАДАНИЕ:
Название: ${title}
Описание: ${(description || '').slice(0, 500)}

Ответь СТРОГО в формате JSON, без markdown и без пояснений:
{"ok": true, "reason": ""} — если контент безопасен
{"ok": false, "reason": "краткое объяснение на русском"} — если есть нарушение`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(AI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      console.error('aiModerateContent HTTP:', response.status, errText.slice(0, 200));
      return { ok: true, reason: 'service_error' };
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '';
    console.log('aiModerateContent raw:', raw.slice(0, 300));

    const clean = raw.replace(/```json\s*|\s*```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      const match = clean.match(/\{[\s\S]*?\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch { parsed = null; }
      }
    }

    if (!parsed || typeof parsed.ok !== 'boolean') {
      console.error('aiModerateContent: parse error:', clean.slice(0, 200));
      return { ok: true, reason: 'parse_error' };
    }

    return { ok: parsed.ok, reason: (parsed.reason || '').slice(0, 200) };
  } catch (e) {
    if (e.name === 'AbortError') {
      console.error('aiModerateContent: timeout');
    } else {
      console.error('aiModerateContent error:', e);
    }
    return { ok: true, reason: 'exception' };
  }
};

const logModeration = async (userId, taskId, contentType, verdict, finalStatus) => {
  try {
    await query(
      `INSERT INTO "ModerationLog" ("userId", "taskId", "contentType", "aiVerdict", "finalStatus", "createdAt")
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [userId, taskId, contentType, verdict, finalStatus]
    );
  } catch (e) {
    console.error('logModeration:', e);
  }
};

module.exports = { aiModerateContent, logModeration };