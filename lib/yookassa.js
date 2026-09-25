// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// lib/yookassa.js — API-клиент ЮKassa
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const crypto = require('crypto');
const { query } = require('./db');
const { notifyUser } = require('./notify');

const API_URL = 'https://api.yookassa.ru/v3';

const getAuth = () => {
  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secretKey = process.env.YOOKASSA_SECRET_KEY;
  if (!shopId || !secretKey) throw new Error('ЮKassa: не заданы YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY');
  return 'Basic ' + Buffer.from(`${shopId}:${secretKey}`).toString('base64');
};

/**
 * Создать платёж в ЮKassa + запись в БД
 */
const createPayment = async ({ userId, amount, description }) => {
  try {
    const idempotenceKey = crypto.randomUUID();

    const body = {
      amount: { value: amount.toFixed(2), currency: 'RUB' },
      capture: true,
      confirmation: {
        type: 'redirect',
        return_url: process.env.YOOKASSA_RETURN_URL || 'https://nerv-telegram-bot-vercel.vercel.app',
      },
      description: description || `Пополнение баланса NERV #${userId}`,
      metadata: { userId: String(userId) },
    };

    const res = await fetch(`${API_URL}/payments`, {
      method: 'POST',
      headers: {
        'Authorization': getAuth(),
        'Idempotence-Key': idempotenceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('yookassa createPayment:', data);
      return { ok: false, error: data.description || 'Ошибка создания платежа' };
    }

    const ins = await query(
      `INSERT INTO "Payment" ("userId","yookassaId",amount,currency,status,"confirmationUrl",description,"idempotenceKey","createdAt","updatedAt")
       VALUES ($1,$2,$3,'RUB',$4,$5,$6,$7,NOW(),NOW()) RETURNING id`,
      [
        userId,
        data.id,
        amount,
        data.status,
        data.confirmation?.confirmation_url || null,
        body.description,
        idempotenceKey,
      ]
    );

    return {
      ok: true,
      paymentId: ins.rows[0].id,
      yookassaId: data.id,
      confirmationUrl: data.confirmation?.confirmation_url,
      status: data.status,
    };
  } catch (e) {
    console.error('createPayment:', e);
    return { ok: false, error: e.message };
  }
};

/**
 * Проверить статус платежа в ЮKassa
 */
const fetchPaymentStatus = async (yookassaId) => {
  try {
    const res = await fetch(`${API_URL}/payments/${yookassaId}`, {
      method: 'GET',
      headers: { 'Authorization': getAuth() },
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.description || 'Ошибка' };
    return { ok: true, payment: data };
  } catch (e) {
    console.error('fetchPaymentStatus:', e);
    return { ok: false, error: e.message };
  }
};

/**
 * Обработка вебхука ЮKassa
 */
const handleWebhook = async (event) => {
  try {
    const { event: eventType, object } = event;
    if (!eventType || !object) return { ok: false, error: 'Invalid event' };

    if (eventType === 'payment.succeeded') {
      const yookassaId = object.id;

      const pRes = await query(
        `SELECT id, "userId", amount, status FROM "Payment" WHERE "yookassaId" = $1`,
        [yookassaId]
      );
      if (pRes.rows.length === 0) {
        console.error('webhook: payment not found', yookassaId);
        return { ok: false, error: 'Payment not found' };
      }
      const payment = pRes.rows[0];

      // Идемпотентность: если уже succeeded — выходим
      if (payment.status === 'succeeded') {
        console.log('webhook: уже succeeded, пропускаем', yookassaId);
        return { ok: true, applied: false };
      }

      const userId = payment.userId;
      const amount = Number(payment.amount);

      // 1) Обновить статус платежа
      await query(
        `UPDATE "Payment" SET status = 'succeeded', "updatedAt" = NOW() WHERE id = $1`,
        [payment.id]
      );

      // 2) Начислить баланс
      await query(
        `UPDATE "User" SET balance = balance + $1 WHERE id = $2`,
        [amount, userId]
      );

      // 3) Транзакция (ручная идемпотентность — без ON CONFLICT)
      const exTx = await query(
        `SELECT id FROM "Transaction" WHERE "paymentId" = $1 LIMIT 1`,
        [payment.id]
      );
      if (exTx.rows.length === 0) {
        await query(
          `INSERT INTO "Transaction" ("userId",type,amount,status,reason,"paymentId","createdAt")
           VALUES ($1,'deposit',$2,'completed',$3,$4,NOW())`,
          [userId, amount, `Пополнение через ЮKassa #${yookassaId}`, payment.id]
        );
        console.log('webhook: транзакция создана для payment.id =', payment.id);
      } else {
        console.log('webhook: транзакция уже существует для payment.id =', payment.id);
      }

      // 4) Уведомление юзеру (в колокольчик + push)
      await notifyUser(userId, {
        message: `💰 Баланс пополнен на ${amount} ₽ (ЮKassa)`,
        pushText:
          `💰 *Пополнение прошло!*\n\n` +
          `Сумма: *+${amount} ₽*\n` +
          `Способ: ЮKassa\n\n` +
          `_Баланс обновлён._`,
        type: 'system',
        icon: '💰',
        linkType: 'profile',
        force: true,
      });

      console.log('webhook: успех для userId =', userId, '+', amount, '₽');
      return { ok: true, applied: true };
    }

    if (eventType === 'payment.canceled') {
      const yookassaId = object.id;
      await query(
        `UPDATE "Payment" SET status = 'canceled', "updatedAt" = NOW() WHERE "yookassaId" = $1`,
        [yookassaId]
      );
      console.log('webhook: payment.canceled', yookassaId);
      return { ok: true, applied: true };
    }

    return { ok: true, applied: false };
  } catch (e) {
    console.error('handleWebhook:', e);
    return { ok: false, error: e.message };
  }
};

/**
 * Список платежей юзера
 */
const getUserPayments = async (userId, limit = 10) => {
  const r = await query(
    `SELECT id, amount, status, "createdAt", "yookassaId"
     FROM "Payment" WHERE "userId" = $1
     ORDER BY "createdAt" DESC LIMIT $2`,
    [userId, limit]
  );
  return r.rows;
};

module.exports = {
  createPayment,
  fetchPaymentStatus,
  handleWebhook,
  getUserPayments,
};