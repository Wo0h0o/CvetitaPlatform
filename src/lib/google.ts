import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Google (Gmail + Calendar) за модула Оферти. Използва OAuth клиента на GA4
 * (GA4_CLIENT_ID/SECRET), но със собствен refresh_token за акаунта на колежката
 * (cherbal.marketing@gmail.com), пазен в таблица `google_auth`.
 */

const CLIENT_ID = process.env.GA4_CLIENT_ID;
const CLIENT_SECRET = process.env.GA4_CLIENT_SECRET;

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.compose",
].join(" ");

export function authUrl(redirectUri: string): string {
  const p = new URLSearchParams({
    client_id: CLIENT_ID || "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

/** Разменя code за токени и връща refresh_token + email. */
export async function exchangeCode(code: string, redirectUri: string): Promise<{ refresh_token?: string; access_token: string; email?: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: CLIENT_ID!, client_secret: CLIENT_SECRET!, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  if (!res.ok) throw new Error(`token exchange: ${res.status} ${await res.text()}`);
  const data = await res.json();
  let email: string | undefined;
  try {
    const info = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${data.access_token}` } }).then((r) => r.json());
    email = info.email;
  } catch {
    /* ignore */
  }
  return { refresh_token: data.refresh_token, access_token: data.access_token, email };
}

export async function getGoogleAuth(): Promise<{ email: string | null; refresh_token: string | null } | null> {
  const { data } = await supabaseAdmin.from("google_auth").select("email, refresh_token").eq("id", 1).maybeSingle();
  return data ?? null;
}

let cached: { token: string; exp: number } | null = null;
async function getAccessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const auth = await getGoogleAuth();
  if (!auth?.refresh_token) throw new Error("Google не е свързан");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID!, client_secret: CLIENT_SECRET!, refresh_token: auth.refresh_token, grant_type: "refresh_token" }),
  });
  if (!res.ok) throw new Error(`refresh: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cached = { token: data.access_token, exp: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cached.token;
}

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Създава целодневно събитие в основния календар. */
export async function insertCalendarEvent(summary: string, dateISO: string, description: string) {
  const token = await getAccessToken();
  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary,
      description,
      start: { date: dateISO },
      end: { date: addDays(dateISO, 1) },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 540 }] },
    }),
  });
  if (!res.ok) throw new Error(`calendar: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Създава Gmail чернова (текст). */
export async function createGmailDraft(to: string, subject: string, bodyText: string) {
  const token = await getAccessToken();
  const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64");
  const mime =
    `To: ${to}\r\n` +
    `Subject: =?UTF-8?B?${b64(subject)}?=\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: text/plain; charset=UTF-8\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    b64(bodyText);
  const raw = Buffer.from(mime, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw } }),
  });
  if (!res.ok) throw new Error(`gmail draft: ${res.status} ${await res.text()}`);
  return res.json();
}
