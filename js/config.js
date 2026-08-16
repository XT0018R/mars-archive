/* ============================================================
   共享功能配置 —— 仅需填两行，其余不用动
   ------------------------------------------------------------
   开启「火星回忆墙 / 共享」功能需要接一个免费后端。
   步骤见 README.md 的「开启共享功能」一节：
     1) 注册免费 Supabase 账号并新建项目
     2) 在 SQL Editor 里跑 README 提供的建表语句
     3) 把下面两行填上（Project URL 和 anon public key）
   不填 = 共享功能关闭，但「私藏」记忆照常可用。
   ============================================================ */
window.APP_CONFIG = {
  SUPABASE_URL: '',          // 你的 Supabase Project URL，形如 https://xxxx.supabase.co
  SUPABASE_ANON_KEY: '',     // 你的 anon public key（Project Settings → API → anon public key）
  ADMIN_DEVICE_IDS: []       // 管理员设备 ID（字符串数组）；填完后回忆墙照片出现删除按钮；留空则无管理功能
};
