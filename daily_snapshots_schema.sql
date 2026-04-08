-- daily_snapshots table for performance caching
CREATE TABLE IF NOT EXISTS public.daily_snapshots (
  id                     BIGSERIAL PRIMARY KEY,
  user_id                UUID      NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_date          DATE      NOT NULL,
  gross_mv               NUMERIC   NOT NULL DEFAULT 0,
  total_cost             NUMERIC   NOT NULL DEFAULT 0,
  daily_pnl              NUMERIC   NOT NULL DEFAULT 0,
  daily_pnl_pct          NUMERIC   NOT NULL DEFAULT 0,
  realized_pnl           NUMERIC   NOT NULL DEFAULT 0,
  daily_stock_list_json  JSONB     NOT NULL DEFAULT '[]',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, snapshot_date)
);

ALTER TABLE public.daily_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_snapshots" ON public.daily_snapshots
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_snapshot_user_date ON public.daily_snapshots (user_id, snapshot_date DESC);
