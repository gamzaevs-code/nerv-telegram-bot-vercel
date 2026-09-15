const { query } = require('./db');

// ========== ХЕЛПЕРЫ ==========

const getEquippedBadge = async (userId) => {
  try {
    const r = await query(
      `SELECT ci.name, ci.type FROM "UserCosmetic" uc
       JOIN "CosmeticItem" ci ON ci.id = uc."itemId"
       WHERE uc."userId"=$1 AND uc.equipped=true AND ci.type='badge' LIMIT 1`,
      [userId]
    );
    return r.rows[0] || null;
  } catch { return null; }
};

const checkVipStatus = async (userId) => {
  try {
    const r = await query(
      `SELECT ci.name, uc."purchasedAt" FROM "UserCosmetic" uc
       JOIN "CosmeticItem" ci ON ci.id = uc."itemId"
       WHERE uc."userId"=$1 AND ci.type='vip'
         AND uc."purchasedAt" >= NOW() - INTERVAL '30 days'
       ORDER BY uc."purchasedAt" DESC LIMIT 1`,
      [userId]
    );
    return r.rows[0] || null;
  } catch { return null; }
};

const applyBoost = async (userId) => {
  try {
    const r = await query(
      `SELECT uc.id, ci.name, ci.price FROM "UserCosmetic" uc
       JOIN "CosmeticItem" ci ON ci.id = uc."itemId"
       WHERE uc."userId"=$1 AND ci.type='boost' AND uc.equipped=false
       ORDER BY uc."purchasedAt" ASC LIMIT 1`,
      [userId]
    );
    if (r.rows.length === 0) return null;

    await query('DELETE FROM "UserCosmetic" WHERE id=$1', [r.rows[0].id]);
    const mult = r.rows[0].name.includes('×3') ? 3 : 2;
    return { mult, name: r.rows[0].name };
  } catch (e) {
    console.error('applyBoost:', e);
    return null;
  }
};

// ========== CALLBACK HANDLERS ==========

// Возвращает true, если обработал callback, иначе false
const handleShopCallback = async (data, ctx) => {
  const { edit, user, chatId } = ctx;

  if (data === 'shop') {
    await edit(
      '🛒 *Магазин NERV*\n\nВыбери категорию:',
      'Markdown',
      {
        inline_keyboard: [
          [{ text: '🎖 Значки', callback_data: 'shop_cat_badge' }, { text: '💎 VIP', callback_data: 'shop_cat_vip' }],
          [{ text: '⚡ Бусты', callback_data: 'shop_cat_boost' }, { text: '🎨 Другое', callback_data: 'shop_cat_other' }],
          [{ text: '🎒 Мои покупки', callback_data: 'my_items' }],
          [{ text: '🔙 Назад', callback_data: 'menu' }],
        ],
      }
    );
    return true;
  }

  if (data.startsWith('shop_cat_')) {
    const cat = data.replace('shop_cat_', '');
    let items;
    if (cat === 'badge') items = await query(`SELECT id, name, description, price FROM "CosmeticItem" WHERE type='badge' ORDER BY price ASC`);
    else if (cat === 'vip') items = await query(`SELECT id, name, description, price FROM "CosmeticItem" WHERE type='vip' ORDER BY price ASC`);
    else if (cat === 'boost') items = await query(`SELECT id, name, description, price FROM "CosmeticItem" WHERE type='boost' ORDER BY price ASC`);
    else items = await query(`SELECT id, name, description, price FROM "CosmeticItem" WHERE type NOT IN ('badge','vip','boost') ORDER BY price ASC`);

    if (items.rows.length === 0) {
      await edit('📭 *Пусто.*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'shop' }]] });
      return true;
    }

    const buttons = items.rows.map(i => [{ text: `${i.name} — ${i.price} ₽`, callback_data: `shop_item_${i.id}` }]);
    buttons.push([{ text: '🔙 Назад', callback_data: 'shop' }]);

    const title = cat === 'badge' ? '🎖 Значки' : cat === 'vip' ? '💎 VIP' : cat === 'boost' ? '⚡ Бусты' : '🎨 Другое';
    await edit(`🛒 *${title}*`, 'Markdown', { inline_keyboard: buttons });
    return true;
  }

  if (data.startsWith('shop_item_')) {
    const itemId = parseInt(data.split('_')[2]);
    const r = await query(`SELECT id, name, description, price, type FROM "CosmeticItem" WHERE id=$1`, [itemId]);
    if (r.rows.length === 0) {
      await edit('❌ *Не найдено*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'shop' }]] });
      return true;
    }
    const item = r.rows[0];
    const owned = user
      ? await query(`SELECT id, equipped FROM "UserCosmetic" WHERE "userId"=$1 AND "itemId"=$2`, [user.id, itemId])
      : { rows: [] };

    let text = `🛒 *${item.name}*\n\n📝 ${item.description || '—'}\n💰 Цена: *${item.price} ₽*`;
    const buttons = [];

    if (owned.rows.length > 0) {
      text += `\n\n✅ *Уже куплено*`;
      if (item.type === 'badge' && !owned.rows[0].equipped) {
        buttons.push([{ text: '🎖 Надеть значок', callback_data: `equip_badge_${itemId}` }]);
      }
      if (item.type === 'badge' && owned.rows[0].equipped) {
        buttons.push([{ text: '❌ Снять значок', callback_data: `unequip_badge_${itemId}` }]);
      }
    } else {
      if (!user) {
        text += '\n\n_Привяжи аккаунт: /link email_';
      } else {
        buttons.push([{ text: '💳 Купить', callback_data: `shop_buy_${itemId}` }]);
      }
    }
    buttons.push([{ text: '🔙 Назад', callback_data: `shop_cat_${item.type}` }]);
    await edit(text, 'Markdown', { inline_keyboard: buttons });
    return true;
  }

  if (data.startsWith('shop_buy_')) {
    const itemId = parseInt(data.split('_')[2]);
    if (!user) {
      await edit('❌ *Привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'shop' }]] });
      return true;
    }
    const r = await query(`SELECT id, name, price, type FROM "CosmeticItem" WHERE id=$1`, [itemId]);
    if (r.rows.length === 0) {
      await edit('❌ *Не найдено*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'shop' }]] });
      return true;
    }
    const item = r.rows[0];
    const owned = await query(`SELECT id FROM "UserCosmetic" WHERE "userId"=$1 AND "itemId"=$2`, [user.id, itemId]);
    if (owned.rows.length > 0) {
      await edit('❌ *Уже куплено*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: `shop_item_${itemId}` }]] });
      return true;
    }
    if (user.balance < item.price) {
      await edit(`❌ *Недостаточно.*\nНужно: ${item.price} ₽\nУ тебя: ${user.balance} ₽`, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: `shop_item_${itemId}` }]] });
      return true;
    }

    await query('UPDATE "User" SET balance = balance - $1 WHERE id=$2', [item.price, user.id]);
    await query('INSERT INTO "UserCosmetic" ("userId","itemId",equipped,"purchasedAt") VALUES ($1,$2,false,NOW())', [user.id, itemId]);
    await query('INSERT INTO "ShopTransaction" ("userId","itemId","amountPaid","purchasedAt") VALUES ($1,$2,$3,NOW())', [user.id, itemId, item.price]);
    await query(
      `INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt")
       VALUES ($1,'shop_purchase',$2,'completed',$3,NOW())`,
      [user.id, -item.price, `Покупка "${item.name}"`]
    );

    await edit(
      `✅ *Куплено!*\n\n🛒 ${item.name}\n💰 -${item.price} ₽\n\n_Осталось: ${user.balance - item.price} ₽_`,
      'Markdown',
      { inline_keyboard: [[{ text: '🎒 Мои покупки', callback_data: 'my_items' }], [{ text: '🛒 В магазин', callback_data: 'shop' }]] }
    );
    return true;
  }

  if (data.startsWith('equip_badge_')) {
    const itemId = parseInt(data.split('_')[2]);
    if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return true; }
    await query(
      `UPDATE "UserCosmetic" SET equipped=false
       WHERE "userId"=$1 AND "itemId" IN (SELECT id FROM "CosmeticItem" WHERE type='badge')`,
      [user.id]
    );
    await query(`UPDATE "UserCosmetic" SET equipped=true WHERE "userId"=$1 AND "itemId"=$2`, [user.id, itemId]);
    await edit('✅ *Значок надет!*', 'Markdown', { inline_keyboard: [[{ text: '🎒 Мои покупки', callback_data: 'my_items' }]] });
    return true;
  }

  if (data.startsWith('unequip_badge_')) {
    const itemId = parseInt(data.split('_')[2]);
    if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return true; }
    await query(`UPDATE "UserCosmetic" SET equipped=false WHERE "userId"=$1 AND "itemId"=$2`, [user.id, itemId]);
    await edit('✅ *Значок снят*', 'Markdown', { inline_keyboard: [[{ text: '🎒 Мои покупки', callback_data: 'my_items' }]] });
    return true;
  }

  if (data === 'my_items') {
    if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return true; }
    const r = await query(
      `SELECT uc.id, uc.equipped, ci.name, ci.type, ci.price FROM "UserCosmetic" uc
       JOIN "CosmeticItem" ci ON ci.id = uc."itemId"
       WHERE uc."userId"=$1 ORDER BY uc."purchasedAt" DESC`,
      [user.id]
    );
    if (r.rows.length === 0) {
      await edit('🎒 *Пока ничего не куплено.*', 'Markdown', {
        inline_keyboard: [[{ text: '🛒 В магазин', callback_data: 'shop' }], [{ text: '🔙 Назад', callback_data: 'menu' }]],
      });
      return true;
    }
    let text = '🎒 *Мои покупки:*\n\n';
    const buttons = [];
    r.rows.forEach(it => {
      const eq = it.equipped ? ' ✅' : '';
      text += `${eq} *${it.name}* · ${it.type} · ${it.price} ₽\n`;
      if (it.type === 'badge') {
        buttons.push([{
          text: `${it.equipped ? '❌ Снять' : '🎖 Надеть'} ${it.name.slice(0, 20)}`,
          callback_data: it.equipped ? `unequip_badge_${it.id}` : `shop_item_${it.id}`,
        }]);
      }
    });
    buttons.push([{ text: '🛒 В магазин', callback_data: 'shop' }]);
    buttons.push([{ text: '🔙 Назад', callback_data: 'menu' }]);
    await edit(text, 'Markdown', { inline_keyboard: buttons });
    return true;
  }

  return false; // не наш callback
};

module.exports = {
  getEquippedBadge,
  checkVipStatus,
  applyBoost,
  handleShopCallback,
};