import type { SupabaseClient } from "@supabase/supabase-js";

/** After removing an application, drop the Explore "applied" mark but keep saved notes. */
export async function resetTrackedJobAfterApplicationDelete(
  supabase: SupabaseClient,
  userId: string,
  jobIds: number[],
): Promise<void> {
  const uniqueJobIds = [...new Set(jobIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (uniqueJobIds.length === 0) return;

  const { error } = await supabase
    .from("tracked_jobs")
    .update({ status: "saved" })
    .eq("user_id", userId)
    .in("job_id", uniqueJobIds)
    .eq("status", "applied");

  if (error) throw error;
}
