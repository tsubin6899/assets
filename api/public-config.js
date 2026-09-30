export default function handler(req, res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
    pushPublicKey: process.env.VAPID_PRIVATE_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.CRON_SECRET ? process.env.VAPID_PUBLIC_KEY || "" : ""
  });
}
