// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// API: ЮKassa — создание платежа + вебхук + история + вывод
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
      const localPayment = pRes.rows[0];

      // ДОЖИМ: если в ЮKassa succeeded, а у нас pending — применяем вебхук вручную
      if (yPayment.status === 'succeeded' && localPayment.status !== 'succeeded') {
        console.log('[check] дожим платежа', yookassaId);
        await handleWebhook({
          event: 'payment.succeeded',
          object: yPayment,
        });
        const recheck = await query(
          `SELECT status FROM "Payment" WHERE id = $1`,
          [localPayment.id]
        );
        localPayment.status = recheck.rows[0]?.status || 'succeeded';
      }

      return res.status(200).json({
        ok: true,
        status: yPayment.status,
        localStatus: localPayment.status,
        amount: Number(localPayment.amount),
      });
    }

    // ═══ Создать запрос на вывод ═══
    if (action === 'withdraw_create') {
      const amount = parseInt(req.body.amount, 10);
      const card = String(req.body.card || '').trim();

      if (isNaN(amount) || amount < 500) {
        return res.status(400).json({ ok: false, error: 'Минимум 500 ₽' });
      }
      if (amount > 100000) {
        return res.status(400).json({ ok: false, error: 'Максимум 100 000 ₽' });
      }
      if (card.length < 8 || card.length > 100) {
        return res.status(400).json({ ok: false, error: 'Введите карту или телефон (8-100 символов)' });
      }

      const uRes = await query(`SELECT balance FROM "User" WHERE id = $1`, [me.id]);
      if (uRes.rows[0].balance < amount) {
        return res.status(400).json({ ok: false, error: `Недостаточно. Баланс: ${uRes.rows[0].balance} ₽` });
      }

      const existRes = await query(
        `SELECT id FROM "WithdrawalRequest" WHERE "userId" = $1 AND status IN ('pending', 'approved') LIMIT 1`,
        [me.id]
      );
      if (existRes.rows.length > 0) {
        return res.status(400).json({ ok: false, error: 'У тебя уже есть активный запрос на вывод' });
      }

      await query(`UPDATE "User" SET balance = balance - $1 WHERE id = $2`, [amount, me.id]);
      await query(
        `INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt")
         VALUES ($1,'withdraw_hold',$2,'pending',$3,NOW())`,
        [me.id, -amount, `Запрос на вывод ${amount} ₽`]
      );

      const ins = await query(
        `INSERT INTO "WithdrawalRequest" ("userId",amount,card,status,"createdAt")
         VALUES ($1,$2,$3,'pending',NOW()) RETURNING id`,
        [me.id, amount, card]
      );

      // Уведомление админам
      try {
        const { notifyUser } = require('../lib/notify');
        const admins = await query(`SELECT id FROM "User" WHERE role = 'admin' AND "isBanned" = false`);
        const uInfo = await query(`SELECT COALESCE("displayName", name) AS name FROM "User" WHERE id = $1`, [me.id]);
        const uname = uInfo.rows[0]?.name || 'Юзер';
        for (const a of admins.rows) {
          await notifyUser(a.id, {
            message: `💸 Запрос на вывод ${amount} ₽ от @${uname}`,
            pushText:
              `💸 *Запрос на вывод*\n\n` +
              `👤 @${uname}\n` +
              `💰 Сумма: *${amount} ₽*\n` +
              `💳 Карта: \`${card}\`\n\n` +
              `Открой \`/withdrawals\` чтобы обработать.`,
            type: 'system',
            icon: '💸',
            force: true,
          });
        }
      } catch (e) { console.error('notify admins:', e); }

      return res.status(200).json({ ok: true, requestId: ins.rows[0].id });
    }

    // ═══ История выводов ═══
    if (action === 'withdraw_history') {
      const r = await query(
        `SELECT id, amount, card, status, "createdAt", "processedAt", "adminComment"
         FROM "WithdrawalRequest" WHERE "userId" = $1
         ORDER BY "createdAt" DESC LIMIT 20`,
        [me.id]
      );
      return res.status(200).json({
        ok: true,
        withdrawals: r.rows.map(w => ({
          id: w.id,
          amount: w.amount,
          card: w.card,
          status: w.status,
          createdAt: w.createdAt,
          processedAt: w.processedAt,
          adminComment: w.adminComment,
        })),
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