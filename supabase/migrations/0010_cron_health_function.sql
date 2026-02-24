-- Migration: Create function to query recent cron job runs
-- Used by cron-health-check Edge Function for monitoring
-- Function to get recent cron job runs
-- SECURITY DEFINER allows access to cron schema which is normally restricted
CREATE OR REPLACE FUNCTION public.get_recent_cron_runs (since_time timestamptz) RETURNS TABLE (
  jobname text,
  last_run timestamptz,
  status text,
  return_message text
) LANGUAGE sql SECURITY DEFINER
SET
  search_path = pg_catalog,
  cron AS $$
  SELECT
    j.jobname,
    r.start_time AS last_run,
    r.status,
    r.return_message
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT *
    FROM cron.job_run_details
    WHERE jobid = j.jobid AND start_time > since_time
    ORDER BY start_time DESC
    LIMIT 1
  ) r ON true
  WHERE j.active = true;
$$;
-- Grant execute to service role (used by Edge Functions)
GRANT
EXECUTE ON FUNCTION public.get_recent_cron_runs (timestamptz) TO service_role;
-- Comment for documentation
COMMENT ON FUNCTION public.get_recent_cron_runs IS 'Returns the most recent run for each active cron job since the given timestamp. Used for health monitoring.';
