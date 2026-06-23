import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json, Tables } from "@/integrations/supabase/types";
import { toDisplayError } from "@/lib/errors";

export type UserProfileRow = Tables<"user_profile">;
export type ProfileFactRow = Tables<"profile_facts">;
export type ProfileFactType = ProfileFactRow["fact_type"];

export type UserProfileInput = {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
  phone?: string;
  headline?: string;
  location?: string;
  linkedin_url?: string;
  portfolio_url?: string;
  about_me?: string;
  autofill_extra?: Record<string, unknown>;
};

const PROFILE_COLUMNS =
  "user_id, first_name, last_name, full_name, email, phone, headline, location, linkedin_url, portfolio_url, about_me, autofill_extra, created_at, updated_at";

const FACT_COLUMNS =
  "id, user_id, fact_type, title, organization, location, start_date, end_date, is_current, description, structured_data, sort_order, created_at, updated_at";

function cleanText(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export function buildFullName(firstName: string, lastName: string, fallback = ""): string {
  const combined = [firstName, lastName].map(cleanText).filter(Boolean).join(" ");
  return combined || cleanText(fallback);
}

export function normalizeUserProfileInput(input: UserProfileInput): UserProfileInput {
  const first_name = cleanText(input.first_name);
  const last_name = cleanText(input.last_name);
  const full_name = cleanText(input.full_name) || buildFullName(first_name, last_name);

  return {
    first_name,
    last_name,
    full_name,
    email: cleanText(input.email),
    phone: cleanText(input.phone),
    headline: cleanText(input.headline),
    location: cleanText(input.location),
    linkedin_url: cleanText(input.linkedin_url),
    portfolio_url: cleanText(input.portfolio_url),
    about_me: cleanText(input.about_me),
    autofill_extra: input.autofill_extra ?? {},
  };
}

export async function getUserProfile(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<UserProfileRow | null> {
  const { data, error } = await supabase
    .from("user_profile")
    .select(PROFILE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw toDisplayError(error, "Could not load your profile.");
  return data ?? null;
}

export async function upsertUserProfile(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: UserProfileInput,
): Promise<UserProfileRow> {
  const normalized = normalizeUserProfileInput(input);
  const payload = {
    user_id: userId,
    ...normalized,
    autofill_extra: (normalized.autofill_extra ?? {}) as Json,
  };

  const { data, error } = await supabase
    .from("user_profile")
    .upsert(payload, { onConflict: "user_id" })
    .select(PROFILE_COLUMNS)
    .single();

  if (error) throw toDisplayError(error, "Could not save your profile.");
  return data;
}

export async function listProfileFacts(
  supabase: SupabaseClient<Database>,
  userId: string,
  factType?: ProfileFactType,
): Promise<ProfileFactRow[]> {
  let query = supabase.from("profile_facts").select(FACT_COLUMNS).eq("user_id", userId);
  if (factType) query = query.eq("fact_type", factType);

  const { data, error } = await query
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw toDisplayError(error, "Could not load profile details.");
  return data ?? [];
}

export async function upsertProfileFact(
  supabase: SupabaseClient<Database>,
  userId: string,
  fact: Omit<ProfileFactRow, "created_at" | "updated_at" | "user_id"> & { user_id?: string },
): Promise<ProfileFactRow> {
  const payload = {
    ...fact,
    user_id: userId,
    structured_data: (fact.structured_data ?? {}) as Json,
  };

  const { data, error } = await supabase
    .from("profile_facts")
    .upsert(payload)
    .select(FACT_COLUMNS)
    .single();

  if (error) throw toDisplayError(error, "Could not save profile detail.");
  return data;
}

export function suggestProfileFieldsFromResumeText(parsedText: string | null | undefined): Partial<UserProfileInput> {
  const text = cleanText(parsedText);
  if (!text) return {};

  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const phoneMatch = text.match(/(?:\+46|0)\s?[\d\s-]{8,}/);

  const firstLine = text.split("\n").map(cleanText).find(Boolean) ?? "";
  const nameParts = firstLine.split(/\s+/).filter(Boolean);
  const first_name = nameParts[0] ?? "";
  const last_name = nameParts.slice(1, 2).join(" ");

  return {
    ...(first_name ? { first_name } : {}),
    ...(last_name ? { last_name } : {}),
    ...(emailMatch ? { email: emailMatch[0] } : {}),
    ...(phoneMatch ? { phone: cleanText(phoneMatch[0]) } : {}),
  };
}
