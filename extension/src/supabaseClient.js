import { createClient } from "@supabase/supabase-js";
import { DEFAULT_CONFIG, EXTENSION_CONFIG_KEY, SESSION_STORAGE_KEY } from "./constants";

function normalizeConfig(value) {
  const candidate = value ?? {};
  const supabaseUrl = String(candidate.supabaseUrl ?? "").trim();
  const supabaseAnonKey = String(candidate.supabaseAnonKey ?? "").trim();
  return { supabaseUrl, supabaseAnonKey };
}

export async function getExtensionConfig() {
  const stored = await chrome.storage.local.get([EXTENSION_CONFIG_KEY]);
  return normalizeConfig(stored[EXTENSION_CONFIG_KEY] ?? DEFAULT_CONFIG);
}

export async function saveExtensionConfig(config) {
  const normalized = normalizeConfig(config);
  await chrome.storage.local.set({ [EXTENSION_CONFIG_KEY]: normalized });
  return normalized;
}

export function hasValidConfig(config) {
  return Boolean(config?.supabaseUrl && config?.supabaseAnonKey);
}

function buildClient(config) {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

export async function getStoredSession() {
  const stored = await chrome.storage.local.get([SESSION_STORAGE_KEY]);
  return stored[SESSION_STORAGE_KEY] ?? null;
}

export async function clearStoredSession() {
  await chrome.storage.local.remove([SESSION_STORAGE_KEY]);
}

export async function storeSession(session) {
  if (!session?.access_token || !session?.refresh_token) {
    await clearStoredSession();
    return;
  }

  await chrome.storage.local.set({
    [SESSION_STORAGE_KEY]: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at ?? null,
      user: session.user
        ? {
            id: session.user.id,
            email: session.user.email ?? null,
          }
        : null,
    },
  });
}

export async function initializeClientFromStorage() {
  const config = await getExtensionConfig();
  if (!hasValidConfig(config)) {
    return { client: null, config, error: "Missing Supabase URL/anon key." };
  }

  const client = buildClient(config);
  const storedSession = await getStoredSession();
  if (storedSession?.access_token && storedSession?.refresh_token) {
    const { data, error } = await client.auth.setSession({
      access_token: storedSession.access_token,
      refresh_token: storedSession.refresh_token,
    });
    if (error || !data?.session) {
      await clearStoredSession();
    } else {
      await storeSession(data.session);
    }
  }

  return { client, config, error: null };
}

export async function getCurrentUser(client) {
  const { data, error } = await client.auth.getUser();
  if (error) return null;
  return data.user ?? null;
}

export async function signInWithPassword(client, email, password) {
  const { data, error } = await client.auth.signInWithPassword({
    email: String(email ?? "").trim(),
    password: String(password ?? ""),
  });
  if (error) throw error;
  if (data.session) {
    await storeSession(data.session);
  }
  return data.user ?? null;
}

function parseAuthErrorMessage(url) {
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const searchParams = new URLSearchParams(url.search);
  const rawError =
    hashParams.get("error_description") ??
    hashParams.get("error") ??
    searchParams.get("error_description") ??
    searchParams.get("error");
  if (!rawError) return null;
  try {
    return decodeURIComponent(rawError);
  } catch {
    return rawError;
  }
}

function launchWebAuthFlow(url) {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirectUrl) => {
      const runtimeError = chrome.runtime?.lastError?.message;
      if (runtimeError) {
        reject(new Error(runtimeError));
        return;
      }
      if (!redirectUrl) {
        reject(new Error("Google sign-in was cancelled."));
        return;
      }
      resolve(redirectUrl);
    });
  });
}

export async function signInWithGoogle(client, config) {
  const supabaseUrl = String(config?.supabaseUrl ?? "").trim();
  if (!supabaseUrl) {
    throw new Error("Supabase URL is missing in extension config.");
  }

  const redirectTo = chrome.identity.getRedirectURL("supabase-auth");
  const authUrl = new URL(`${supabaseUrl}/auth/v1/authorize`);
  authUrl.searchParams.set("provider", "google");
  authUrl.searchParams.set("redirect_to", redirectTo);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("scopes", "email profile");

  const redirectUrlRaw = await launchWebAuthFlow(authUrl.toString());
  const redirectUrl = new URL(redirectUrlRaw);
  const authError = parseAuthErrorMessage(redirectUrl);
  if (authError) {
    throw new Error(authError);
  }

  const hashParams = new URLSearchParams(redirectUrl.hash.replace(/^#/, ""));
  const accessToken = hashParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token");

  if (accessToken && refreshToken) {
    const { data, error } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error || !data?.session) {
      throw error ?? new Error("Could not establish session after Google sign-in.");
    }
    await storeSession(data.session);
    return data.user ?? null;
  }

  const code = redirectUrl.searchParams.get("code");
  if (code) {
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error || !data?.session) {
      throw error ?? new Error("Could not exchange Google auth code for a session.");
    }
    await storeSession(data.session);
    return data.user ?? null;
  }

  throw new Error(
    `Google sign-in did not return tokens. Add this redirect URL to Supabase Auth: ${redirectTo}`,
  );
}

export async function signOutClient(client) {
  await client.auth.signOut();
  await clearStoredSession();
}

export async function refreshStoredSession(client) {
  const storedSession = await getStoredSession();
  if (!storedSession?.access_token || !storedSession?.refresh_token) {
    return null;
  }

  const { data: setData, error: setError } = await client.auth.setSession({
    access_token: storedSession.access_token,
    refresh_token: storedSession.refresh_token,
  });

  if (setError || !setData?.session) {
    await clearStoredSession();
    return null;
  }

  const { data: refreshData, error: refreshError } = await client.auth.refreshSession();
  if (refreshError || !refreshData?.session) {
    await storeSession(setData.session);
    return setData.session;
  }

  await storeSession(refreshData.session);
  return refreshData.session;
}
