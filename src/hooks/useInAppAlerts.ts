import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

const IN_APP_ALERT_COLUMNS =
  "id, saved_search_id, job_id, title, body, created_at, read_at, job_external_key, jobs(id, headline, employer_name, source_url)";

export function useInAppAlerts(userId: string | undefined) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["in-app-alerts", userId],
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("in_app_alerts")
        .select(IN_APP_ALERT_COLUMNS)
        .eq("user_id", userId!)
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return data ?? [];
    },
  });

  const markAlertRead = useMutation({
    mutationFn: async (alertId: number) => {
      const { error } = await supabase
        .from("in_app_alerts")
        .update({ read_at: new Date().toISOString() })
        .eq("id", alertId)
        .eq("user_id", userId!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["in-app-alerts", userId] });
    },
  });

  const unreadCount = (query.data ?? []).filter((alert) => !alert.read_at).length;

  return {
    alerts: query.data ?? [],
    unreadCount,
    isLoading: query.isLoading,
    markAlertRead,
  };
}
