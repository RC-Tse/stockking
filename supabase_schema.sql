-- ══════════════════════════════════════════════════════════════
--  少年存股王 — Supabase SQL Schema
--  在 Supabase > SQL Editor 執行此腳本
-- ══════════════════════════════════════════════════════════════

-- 1. transactions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.transactions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID      NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol      TEXT      NOT NULL,
  action      TEXT      NOT NULL CHECK (action IN ('BUY','SELL','DCA')),
  trade_date  DATE      NOT NULL,
  shares      NUMERIC   NOT NULL,
  price       NUMERIC   NOT NULL,
  amount      NUMERIC   NOT NULL,
  fee         NUMERIC   NOT NULL DEFAULT 0,
  tax         NUMERIC   NOT NULL DEFAULT 0,
  net_amount  NUMERIC   NOT NULL,
  trade_type  TEXT      NOT NULL DEFAULT 'FULL',
  note        TEXT      DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_transactions" ON public.transactions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_tx_user_date ON public.transactions (user_id, trade_date DESC);

-- 2. calendar_entries ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.calendar_entries (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID      NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_date  DATE      NOT NULL,
  pnl         NUMERIC   NOT NULL DEFAULT 0,
  note        TEXT      DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, entry_date)
);

ALTER TABLE public.calendar_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_calendar" ON public.calendar_entries
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_cal_user_date ON public.calendar_entries (user_id, entry_date DESC);

-- 3. settings ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.settings (
  user_id       UUID    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  broker_name   TEXT    NOT NULL DEFAULT '國泰證券',
  buy_fee_rate  NUMERIC NOT NULL DEFAULT 0.001425,
  buy_discount  NUMERIC NOT NULL DEFAULT 0.285,
  sell_fee_rate NUMERIC NOT NULL DEFAULT 0.001425,
  sell_discount NUMERIC NOT NULL DEFAULT 0.285,
  fee_min       NUMERIC NOT NULL DEFAULT 20,
  tax_stock     NUMERIC NOT NULL DEFAULT 0.003,
  tax_etf       NUMERIC NOT NULL DEFAULT 0.001,
  max_holdings  INT     NOT NULL DEFAULT 7,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_settings" ON public.settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4. schema updates (2026-04) ─────────────────────────────────
-- 請在 Supabase SQL Editor 執行以下指令以新增欄位
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS year_goal NUMERIC DEFAULT 0;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS total_goal NUMERIC DEFAULT 0;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS dca_fee_rate NUMERIC DEFAULT 0.001425;

-- 5. dca_plans ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dca_plans (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  days_of_month INTEGER[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.dca_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_dca" ON public.dca_plans FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
