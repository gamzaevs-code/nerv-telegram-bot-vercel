// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// API: ЮKassa — создание платежа + вебхук + история
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const crypto = require('crypto');
const { query } = require('../lib/db');
const { createPayment, handleWebhook, getUserPayments, fetchPaymentStatus } = require('../lib/yookassa');

const verifyInitData = (initData) => {
  const botToken = process.env.BOT_TOKEN;
  if (!botToken) throw new Error('BOT_TOKEN не задан');
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('hash отсутствует');
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calcHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (calcHash !== hash) throw new Error('Неверная подпись');
  const authDate = parseInt(params.get('auth_date') || '0', 10);
  if (Math.floor(Date.now() / 1000) - authDate > 86400) throw new Error('Устарело');
  return JSON.parse(params.get('user'));
};

// Проверка IP ЮKassa
const YOOKASSA_IPS = [
  '185.71.76.', '185.71.77.',
  '77.75.153.', '77.75.154.',
  '77.75.156.', '77.75.157.',
];

const isYooKassaIP = (ip) => {
  if (process.env.YOOKASSA_WEBHOOK_IP_CHECK !== 'true') return true;
  if (!ip) return false;
  return YOOKASSA_IPS.some(prefix => ip.startsWith(prefix));
};

module.exports = async (req, res) => {
  // ═══════════ WEBHOOK (POST от ЮKassa) ═══════════
  if (req.method === 'POST' && req.query?.action === 'webhook') {
    try {
      const clientIP = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress;
      if (!isYooKassaIP(clientIP)) {
        console.error('webhook: bad IP', clientIP);
        return res.status(403).json({ ok: false, error: 'Forbidden IP' });
      }

      const event = req.body;
      console.log('ЮKassa webhook:', event?.event, event?.object?.id);

      const result = await handleWebhook(event);
      if (!result.ok) return res.status(400).json(result);

      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('webhook error:', e);
      return res.status(200).json({ ok: true });
    }
  }

  // ═══════════ ЗАЩИЩЁННЫЕ ОПЕРАЦИИ ═══════════
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { initData, action } = req.body;
    if (!initData) return res.status(400).json({ ok: false, error: 'initData обязателен' });

    const tgUser = verifyInitData(initData);
    const chatId = String(tgUser.id);

    const meRes = await query(
      `SELECT id, balance FROM "User" WHERE "telegramChatId" = $1`,
      [chatId]
    );
    if (meRes.rows.length === 0) return res.status(403).json({ ok: false, error: 'Аккаунт не привязан' });
    const me = meRes.rows[0];

    // ═══ Создать платёж ═══
    if (action === 'create') {
      const amount = parseInt(req.body.amount, 10);
      if (isNaN(amount) || amount < 100) {
        return res.status(400).json({ ok: false, error: 'Минимум 100 ₽' });
      }
      if (amount > 100000) {
        return res.status(400).json({ ok: false, error: 'Максимум 100 000 ₽' });
      }

      const result = await createPayment({
        userId: me.id,
        amount,
        description: `Пополнение баланса NERV`,
      });

      if (!result.ok) return res.status(400).json(result);
      return res.status(200).json({
        ok: true,
        confirmationUrl: result.confirmationUrl,
        paymentId: result.paymentId,
        yookassaId: result.yookassaId,
      });
    }

    // ═══ Проверить статус ═══
    if (action === 'check') {
      const yookassaId = req.body.yookassaId;
      if (!yookassaId) return res.status(400).json({ ok: false, error: 'yookassaId обязателен' });

      const statusRes = await fetchPaymentStatus(yookassaId);
      if (!statusRes.ok) return res.status(400).json(statusRes);

      const yPayment = statusRes.payment;
      const pRes = await query(
        `SELECT id, status, amount FROM "Payment" WHERE "yookassaId" = $1 AND "userId" = $2`,
        [yookassaId, me.id]
      );
      if (pRes.rows.length === 0) return res.status(404).json({ ok: false, error: 'Платёж не найден' });

      return res.status(200).json({
        ok: true,
        status: yPayment.status,
        localStatus: pRes.rows[0].status,
        amount: Number(pRes.rows[0].amount),
      });
    }

    // ═══ История платежей ═══
    if (action === 'history') {
      const payments = await getUserPayments(me.id, 20);
      return res.status(200).json({
        ok: true,
        payments: payments.map(p => ({
          id: p.id,
          amount: Number(p.amount),
          status: p.status,
          createdAt: p.createdAt,
          yookassaId: p.yookassaId,
        })),
      });
    }

    return res.status(400).json({ ok: false, error: 'Неизвестное действие' });
  } catch (e) {
    console.error('app-payment error:', e);
    return res.status(401).json({ ok: false, error: e.message });
  }
};