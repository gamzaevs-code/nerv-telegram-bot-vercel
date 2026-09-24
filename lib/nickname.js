// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// lib/nickname.js — установка и валидация никнейма
// Использует существующее поле "displayName" как ник
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const { query } = require('./db');

const NICK_REGEX = /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/;
const COOLDOWN_DAYS = 7;

/**
 * Валидация формата ника
 * @returns {{ ok: boolean, nickname?: string, error?: string }}
 */
const validateNickname = (nick) => {
  if (!nick || typeof nick !== 'string') {
    return { ok: false, error: 'Ник не может быть пустым' };
  }
  nick = nick.trim();
  if (nick.startsWith('@')) nick = nick.slice(1);

  if (nick.length < 3) return { ok: false, error: 'Минимум 3 символа' };
  if (nick.length > 20) return { ok: false, error: 'Максимум 20 символов' };
  if (!NICK_REGEX.test(nick)) {
    return { ok: false, error: 'Только латиница, цифры и `_`. Начинается с буквы.' };
  }
  return { ok: true, nickname: nick };
};

/**
 * Проверка занятости ника (регистронезависимо)
 */
const isNicknameTaken = async (nick, excludeUserId = null) => {
  try {
    const r = excludeUserId
      ? await query(
          `SELECT 1 FROM "User" WHERE LOWER("displayName") = LOWER($1) AND id != $2 LIMIT 1`,
          [nick, excludeUserId]
        )
      : await query(
          `SELECT 1 FROM "User" WHERE LOWER("displayName") = LOWER($1) LIMIT 1`,
          [nick]
        );
    return r.rows.length > 0;
  } catch (e) {
    console.error('isNicknameTaken:', e);
    return false;
  }
};

/**
 * Проверка cooldown
 */
const getNicknameCooldown = async (userId) => {
  try {
    const r = await query(
      `SELECT "nicknameUpdatedAt" FROM "User" WHERE id = $1`,
      [userId]
    );
    if (r.rows.length === 0) return { ok: false, error: 'Юзер не найден' };
    const last = r.rows[0].nicknameUpdatedAt;
    if (!last) return { ok: true, canChange: true };
    const daysSince = (Date.now() - new Date(last).getTime()) / 86400000;
    if (daysSince >= COOLDOWN_DAYS) return { ok: true, canChange: true };
    const daysLeft = Math.ceil(COOLDOWN_DAYS - daysSince);
    return { ok: true, canChange: false, daysLeft };
  } catch (e) {
    console.error('getNicknameCooldown:', e);
    return { ok: false, error: 'Ошибка проверки cooldown' };
  }
};

/**
 * Установить ник. Полная проверка: формат → cooldown → уникальность.
 * @returns {{ ok: boolean, nickname?: string, error?: string }}
 */
const setNickname = async (userId, nick) => {
  // 1) Формат
  const v = validateNickname(nick);
  if (!v.ok) return v;

  // 2) Cooldown
  const cd = await getNicknameCooldown(userId);
  if (!cd.ok) return cd;
  if (!cd.canChange) {
    return { ok: false, error: `Сменить ник можно через ${cd.daysLeft} дн.` };
  }

  // 3) Уникальность
  const taken = await isNicknameTaken(v.nickname, userId);
  if (taken) return { ok: false, error: 'Этот ник уже занят' };

  // 4) Обновляем
  try {
    await query(
      `UPDATE "User" SET "displayName" = $1, "nicknameUpdatedAt" = NOW() WHERE id = $2`,
      [v.nickname, userId]
    );
    return { ok: true, nickname: v.nickname };
  } catch (e) {
    console.error('setNickname UPDATE:', e);
    return { ok: false, error: 'Не удалось сохранить ник' };
  }
};

/**
 * Инфо о нике (для показа в профиле)
 */
const getNicknameInfo = async (userId) => {
  try {
    const r = await query(
      `SELECT COALESCE("displayName", name) AS nick, "nicknameUpdatedAt"
       FROM "User" WHERE id = $1`,
      [userId]
    );
    if (r.rows.length === 0) return null;
    const cd = await getNicknameCooldown(userId);
    return {
      nickname: r.rows[0].nick,
      canChange: cd.canChange,
      daysLeft: cd.daysLeft || 0,
      updatedAt: r.rows[0].nicknameUpdatedAt,
    };
  } catch (e) {
    console.error('getNicknameInfo:', e);
    return null;
  }
};

module.exports = {
  validateNickname,
  isNicknameTaken,
  getNicknameCooldown,
  setNickname,
  getNicknameInfo,
  COOLDOWN_DAYS,
};