const { getUser, users } = require('../utils/helper');
const { mainMenu, helpCommand } = require('../utils/menu');
const { saveState } = require('../utils/persist');
const Akun = require('../model/Akun');
const STR = require('../config/strings');
const { Keyboard } = require('grammy');

module.exports = (bot) => {
  const handleLogin = async (ctx) => {
    const u = getUser(ctx.from.id);
    const id = Date.now().toString().slice(-6);
    const acc = new Akun(ctx.from.id);
    acc.id = id;
    u.accounts.set(id, acc);
    ctx.session = { act: 'phone', id };

    // Tambah tombol request contact untuk kirim kontak pribadi
    const kb = new Keyboard().requestContact('📂 Kirim Nomor 📂').row().text(STR.menu.back).resized();
    await ctx.reply(STR.messages.askPhone, { reply_markup: kb });
  };

  // Handler tombol login
  bot.hears(STR.menu.createUserbot, handleLogin);
  bot.hears('➕ Tambah Sesi Baru', handleLogin); // fallback lama bila masih ada

  // Login via kirim kontak pribadi
  function normalizePhoneFromContact(raw) {
    if (!raw) return '';
    let s = String(raw).trim().replace(/[^\d+]/g, '');
    if (!s.startsWith('+')) {
      if (s.startsWith('0')) s = '+62' + s.slice(1);
      else s = '+' + s;
    }
    return s;
  }

  bot.on('message:contact', async (ctx) => {
    try {
      if (!ctx.session || ctx.session.act !== 'phone') return; // hanya saat flow phone
      const c = ctx.message.contact;
      if (!c) return;

      // pastikan kontaknya milik user sendiri
      if (c.user_id && Number(c.user_id) !== Number(ctx.from.id)) {
        await ctx.reply('Kirim kontak pribadi Anda (bukan kontak orang lain).');
        return;
      }

      const u = getUser(ctx.from.id);
      const acc = u.accounts.get(ctx.session.id);
      if (!acc) {
        ctx.session = null;
        await ctx.reply('❌ Sesi login tidak ditemukan, ulangi "Buat Userbot".');
        return;
      }

      const phone = normalizePhoneFromContact(c.phone_number);
      if (!/^\+\d{8,15}$/.test(phone)) {
        return ctx.reply(STR.messages.invalidPhone + '\nContoh: +6281234567890 (atau 081234567890 -> +6281234567890)');
      }

      u.active = ctx.session.id;

      try {
        acc.login(ctx, phone); // sama seperti input manual
        // Tidak mengirim pesan OTP info tambahan di sini (sesuai permintaan)
      } catch (e) {
        console.error('[auth contact] acc.login error:', e && e.stack ? e.stack : e);
        await ctx.reply('❌ Gagal memulai login: ' + (e.message || String(e)));
        ctx.session = null;
      }
    } catch (e) {
      console.error('[auth contact] unexpected error:', e && e.stack ? e.stack : e);
    }
  });

  // Menu akun
  bot.hears('👥 Akun', async (ctx) => {
    const u = getUser(ctx.from.id);
    if (!u.accounts.size) {
      return ctx.reply(`Belum ada sesi. Tekan "${STR.menu.createUserbot}" untuk membuat.`);
    }
    let text = '👥 Daftar Sesi:\n';
    for (const [id, acc] of u.accounts) {
      text += `• ${acc.name || id} ${u.active === id ? '(aktif)' : ''}\n`;
    }
    text += `\nGunakan menu ${STR.menu.tokenMenu} untuk backup/restore data.`;
    await ctx.reply(text);
  });

  bot.hears(STR.menu.help, helpCommand);

  bot.hears(/^(🟢|🔴) Aktifkan: (.+?)( ✅)?$/, async (ctx) => {
    await ctx.reply(`Fitur ganti sesi dinonaktifkan. Gunakan ${STR.menu.tokenMenu} untuk backup/restore data.`);
  });

  // Cancel login
  bot.callbackQuery(/cancel_(.+)/, async (ctx) => {
    const userId = ctx.match[1];
    const u = getUser(userId);
    for (const [id, acc] of u.accounts) {
      if (acc.uid === userId) {
        acc.cancel(ctx);
        u.accounts.delete(id);
        break;
      }
    }
    if (ctx.session?.mid) {
      try { await ctx.api.deleteMessage(userId, ctx.session.mid); } catch {}
    }
    ctx.session = null;
    await ctx.deleteMessage().catch(()=>{});
    const menu = mainMenu(ctx);
    await ctx.reply(STR.messages.loginCancelled, { reply_markup: menu.reply_markup, parse_mode: menu.parse_mode });
    await ctx.answerCallbackQuery('❌ Batal');
    saveState(users);
  });
};
