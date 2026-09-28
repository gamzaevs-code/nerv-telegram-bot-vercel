// в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬
// API: Р®Kassa вЂ” СЃРѕР·РґР°РЅРёРµ РїР»Р°С‚РµР¶Р° + РІРµР±С…СѓРє + РёСЃС‚РѕСЂРёСЏ + РІС‹РІРѕРґ (РєРѕРјРёСЃСЃРёСЏ 20%)
// в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬
const crypto = require('crypto');
const { query } = require('../lib/db');
const { createPayment, handleWebhook, getUserPayments, fetchPaymentStatus } = require('../lib/yookassa');

const verifyInitData = (initData) => {
  const botToken = process.env.BOT_TOKEN;
  if (!botToken) throw new Error('BOT_TOKEN РЅРµ Р·Р°РґР°РЅ');
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('hash РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚');
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calcHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (calcHash !== hash) throw new Error('РќРµРІРµСЂРЅР°СЏ РїРѕРґРїРёСЃСЊ');
  const authDate = parseInt(params.get('auth_date') || '0', 10);
  if (Math.floor(Date.now() / 1000) - authDate > 86400) throw new Error('РЈСЃС‚Р°СЂРµР»Рѕ');
  return JSON.parse(params.get('user'));
};

// РџСЂРѕРІРµСЂРєР° IP Р®Kassa
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

// РљРѕРјРёСЃСЃРёСЏ РЅР° РІС‹РІРѕРґ вЂ” 20%
const WITHDRAW_COMMISSION_RATE = 0.20;

module.exports = async (req, res) => {
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ WEBHOOK (POST РѕС‚ Р®Kassa) в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  if (req.method === 'POST' && req.query?.action === 'webhook') {
    try {
      const clientIP = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress;
      if (!isYooKassaIP(clientIP)) {
        console.error('webhook: bad IP', clientIP);
        return res.status(403).json({ ok: false, error: 'Forbidden IP' });
      }

      const event = req.body;
      const signature = req.headers['x-yookassa-signature']; // FIXED: РґРѕСЃС‚Р°С‚СЊ РїРѕРґРїРёСЃСЊ РёР· headers
      const rawBody = JSON.stringify(event); // FIXED: СЃРѕС…СЂР°РЅРёС‚СЊ raw body РґР»СЏ РїСЂРѕРІРµСЂРєРё РїРѕРґРїРёСЃРё
      console.log('Р®Kassa webhook:', event?.event, event?.object?.id);

      const result = await handleWebhook(event, rawBody, signature);
      if (!result.ok) return res.status(400).json(result);

      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('webhook error:', e);
      return res.status(200).json({ ok: true });
    }
  }

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ Р—РђР©РР©РЃРќРќР«Р• РћРџР•Р РђР¦РР в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { initData, action } = req.body;
    if (!initData) return res.status(400).json({ ok: false, error: 'initData РѕР±СЏР·Р°С‚РµР»РµРЅ' });

    const tgUser = verifyInitData(initData);
    const chatId = String(tgUser.id);

    const meRes = await query(
      `SELECT id, balance FROM "User" WHERE "telegramChatId" = $1`,
      [chatId]
    );
    if (meRes.rows.length === 0) return res.status(403).json({ ok: false, error: 'РђРєРєР°СѓРЅС‚ РЅРµ РїСЂРёРІСЏР·Р°РЅ' });
    const me = meRes.rows[0];

    // в•ђв•ђв•ђ РЎРѕР·РґР°С‚СЊ РїР»Р°С‚С‘Р¶ в•ђв•ђв•ђ
    if (action === 'create') {
      const amount = parseInt(req.body.amount, 10);
      if (isNaN(amount) || amount < 100) {
        return res.status(400).json({ ok: false, error: 'РњРёРЅРёРјСѓРј 100 в‚Ѕ' });
      }
      if (amount > 100000) {
        return res.status(400).json({ ok: false, error: 'РњР°РєСЃРёРјСѓРј 100 000 в‚Ѕ' });
      }

      const result = await createPayment({
        userId: me.id,
        amount,
        description: `РџРѕРїРѕР»РЅРµРЅРёРµ Р±Р°Р»Р°РЅСЃР° NERV`,
      });

      if (!result.ok) return res.status(400).json(result);
      return res.status(200).json({
        ok: true,
        confirmationUrl: result.confirmationUrl,
        paymentId: result.paymentId,
        yookassaId: result.yookassaId,
      });
    }

    // в•ђв•ђв•ђ РџСЂРѕРІРµСЂРёС‚СЊ СЃС‚Р°С‚СѓСЃ в•ђв•ђв•ђ
    if (action === 'check') {
      const yookassaId = req.body.yookassaId;
      if (!yookassaId) return res.status(400).json({ ok: false, error: 'yookassaId РѕР±СЏР·Р°С‚РµР»РµРЅ' });

      const statusRes = await fetchPaymentStatus(yookassaId);
      if (!statusRes.ok) return res.status(400).json(statusRes);

      const yPayment = statusRes.payment;
      const pRes = await query(
        `SELECT id, status, amount FROM "Payment" WHERE "yookassaId" = $1 AND "userId" = $2`,
        [yookassaId, me.id]
      );
      if (pRes.rows.length === 0) return res.status(404).json({ ok: false, error: 'РџР»Р°С‚С‘Р¶ РЅРµ РЅР°Р№РґРµРЅ' });
      const localPayment = pRes.rows[0];

      // Р”РћР–РРњ: РµСЃР»Рё РІ Р®Kassa succeeded, Р° Сѓ РЅР°СЃ pending вЂ” РїСЂРёРјРµРЅСЏРµРј РІРµР±С…СѓРє РІСЂСѓС‡РЅСѓСЋ
      if (yPayment.status === 'succeeded' && localPayment.status !== 'succeeded') {
        console.log('[check] РґРѕР¶РёРј РїР»Р°С‚РµР¶Р°', yookassaId);
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

    // в•ђв•ђв•ђ РЎРѕР·РґР°С‚СЊ Р·Р°РїСЂРѕСЃ РЅР° РІС‹РІРѕРґ (РєРѕРјРёСЃСЃРёСЏ 20%) в•ђв•ђв•ђ
    if (action === 'withdraw_create') {
      const amount = parseInt(req.body.amount, 10);
      const card = String(req.body.card || '').trim();

      if (isNaN(amount) || amount < 500) {
        return res.status(400).json({ ok: false, error: 'РњРёРЅРёРјСѓРј 500 в‚Ѕ' });
      }
      if (amount > 100000) {
        return res.status(400).json({ ok: false, error: 'РњР°РєСЃРёРјСѓРј 100 000 в‚Ѕ' });
      }
      if (card.length < 8 || card.length > 100) {
        return res.status(400).json({ ok: false, error: 'Р’РІРµРґРёС‚Рµ РєР°СЂС‚Сѓ РёР»Рё С‚РµР»РµС„РѕРЅ (8-100 СЃРёРјРІРѕР»РѕРІ)' });
      }

      // РљРѕРјРёСЃСЃРёСЏ 20%
      const commission = Math.max(Math.round(amount * WITHDRAW_COMMISSION_RATE), 1);
      const payout = amount - commission;

      const uRes = await query(`SELECT balance FROM "User" WHERE id = $1`, [me.id]);
      if (uRes.rows[0].balance < amount) {
        return res.status(400).json({ ok: false, error: `РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ. Р‘Р°Р»Р°РЅСЃ: ${uRes.rows[0].balance} в‚Ѕ` });
      }

      const existRes = await query(
        `SELECT id FROM "WithdrawalRequest" WHERE "userId" = $1 AND status IN ('pending', 'approved') LIMIT 1`,
        [me.id]
      );
      if (existRes.rows.length > 0) {
        return res.status(400).json({ ok: false, error: 'РЈ С‚РµР±СЏ СѓР¶Рµ РµСЃС‚СЊ Р°РєС‚РёРІРЅС‹Р№ Р·Р°РїСЂРѕСЃ РЅР° РІС‹РІРѕРґ' });
      }

      await query(`UPDATE "User" SET balance = balance - $1 WHERE id = $2`, [amount, me.id]);
      await query(
        `INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt")
         VALUES ($1,'withdraw_hold',$2,'pending',$3,NOW())`,
        [me.id, -amount, `Р—Р°РїСЂРѕСЃ РЅР° РІС‹РІРѕРґ ${amount} в‚Ѕ (РєРѕРјРёСЃСЃРёСЏ ${commission} в‚Ѕ)`]
      );

      const ins = await query(
        `INSERT INTO "WithdrawalRequest" ("userId",amount,commission,payout,card,status,"createdAt")
         VALUES ($1,$2,$3,$4,$5,'pending',NOW()) RETURNING id`,
        [me.id, amount, commission, payout, card]
      );

      // РЈРІРµРґРѕРјР»РµРЅРёРµ Р°РґРјРёРЅР°Рј
      try {
        const { notifyUser } = require('../lib/notify');
        const admins = await query(`SELECT id FROM "User" WHERE role = 'admin' AND "isBanned" = false`);
        const uInfo = await query(`SELECT COALESCE("displayName", name) AS name FROM "User" WHERE id = $1`, [me.id]);
        const uname = uInfo.rows[0]?.name || 'Р®Р·РµСЂ';
        for (const a of admins.rows) {
          await notifyUser(a.id, {
            message: `рџ’ё Р—Р°РїСЂРѕСЃ РЅР° РІС‹РІРѕРґ ${amount} в‚Ѕ РѕС‚ @${uname} (Рє РІС‹РїР»Р°С‚Рµ: ${payout} в‚Ѕ)`,
            pushText:
              `рџ’ё *Р—Р°РїСЂРѕСЃ РЅР° РІС‹РІРѕРґ*\n\n` +
              `рџ‘¤ @${uname}\n` +
              `рџ’° РЎСѓРјРјР°: *${amount} в‚Ѕ*\n` +
              `рџ’ё РљРѕРјРёСЃСЃРёСЏ (20%): *${commission} в‚Ѕ*\n` +
              `вњ… Рљ РІС‹РїР»Р°С‚Рµ: *${payout} в‚Ѕ*\n` +
              `рџ’і РљР°СЂС‚Р°: \`${card}\`\n\n` +
              `РћС‚РєСЂРѕР№ \`/withdrawals\` С‡С‚РѕР±С‹ РѕР±СЂР°Р±РѕС‚Р°С‚СЊ.`,
            type: 'system',
            icon: 'рџ’ё',
            force: true,
          });
        }
      } catch (e) { console.error('notify admins:', e); }

      return res.status(200).json({
        ok: true,
        requestId: ins.rows[0].id,
        commission,
        payout,
      });
    }

    // в•ђв•ђв•ђ РСЃС‚РѕСЂРёСЏ РІС‹РІРѕРґРѕРІ в•ђв•ђв•ђ
    if (action === 'withdraw_history') {
      const r = await query(
        `SELECT id, amount, commission, payout, card, status, "createdAt", "processedAt", "adminComment"
         FROM "WithdrawalRequest" WHERE "userId" = $1
         ORDER BY "createdAt" DESC LIMIT 20`,
        [me.id]
      );
      return res.status(200).json({
        ok: true,
        withdrawals: r.rows.map(w => ({
          id: w.id,
          amount: w.amount,
          commission: w.commission || 0,
          payout: w.payout || w.amount,
          card: w.card,
          status: w.status,
          createdAt: w.createdAt,
          processedAt: w.processedAt,
          adminComment: w.adminComment,
        })),
      });
    }

    // в•ђв•ђв•ђ РСЃС‚РѕСЂРёСЏ РїР»Р°С‚РµР¶РµР№ в•ђв•ђв•ђ
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

    return res.status(400).json({ ok: false, error: 'РќРµРёР·РІРµСЃС‚РЅРѕРµ РґРµР№СЃС‚РІРёРµ' });
  } catch (e) {
    // SECURITY: Log auth failures
    if (e.message.includes('подпись') || e.message.includes('устарел')) {
      console.warn(`[SECURITY] Auth error in app-payment: ${e.message}`);
    } else {
      console.error('app-payment error:', e);
    }
    return res.status(401).json({ ok: false, error: e.message });
  }
};