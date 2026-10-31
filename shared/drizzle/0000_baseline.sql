CREATE TYPE "public"."otp_purpose" AS ENUM('login', 'register', 'reset');--> statement-breakpoint
CREATE TYPE "public"."player_type" AS ENUM('REGULAR', 'AGENT_CREDIT', 'WHITELABEL_CREDIT', 'SHARING_AGENT_PLAYER', 'COMMISSION_AGENT_PLAYER');--> statement-breakpoint
CREATE TYPE "public"."risk_type" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'inactive', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."commission_cycle_snapshot_status" AS ENUM('OPEN', 'CLOSED_UNSETTLED', 'SETTLED', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."sport_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."sports_result_market_type" AS ENUM('exchange', 'bookmaker', 'fancy');--> statement-breakpoint
CREATE TYPE "public"."sports_bet_side" AS ENUM('back', 'lay');--> statement-breakpoint
CREATE TYPE "public"."sports_bet_status" AS ENUM('matched', 'unmatched', 'cancelled', 'settled', 'won', 'lost', 'void');--> statement-breakpoint
CREATE TYPE "public"."casino_category_type" AS ENUM('general', 'top', 'featured');--> statement-breakpoint
CREATE TYPE "public"."casino_main_category" AS ENUM('live_casino', 'casino', 'slots');--> statement-breakpoint
CREATE TYPE "public"."casino_bet_status" AS ENUM('pending', 'active', 'won', 'lost', 'cancelled', 'void');--> statement-breakpoint
CREATE TYPE "public"."casino_wallet_type" AS ENUM('cash', 'bonus', 'referralBonus');--> statement-breakpoint
CREATE TYPE "public"."matka_bet_status" AS ENUM('pending', 'active', 'won', 'lost', 'cancelled', 'void');--> statement-breakpoint
CREATE TYPE "public"."matka_type" AS ENUM('worli', 'starline', 'jackpot');--> statement-breakpoint
CREATE TYPE "public"."worli_session_side" AS ENUM('OPEN', 'CLOSE');--> statement-breakpoint
CREATE TYPE "public"."worli_status" AS ENUM('SCHEDULED', 'OPENING_SOON', 'OPEN', 'LOCKED', 'CLOSED', 'SETTLING', 'SETTLED', 'PAUSED', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."matka_result_type" AS ENUM('open', 'close');--> statement-breakpoint
CREATE TYPE "public"."amount_type" AS ENUM('fixed', 'percentage');--> statement-breakpoint
CREATE TYPE "public"."bonus_award_status" AS ENUM('pending', 'active', 'completed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."bonus_code_mode" AS ENUM('auto', 'claim', 'code');--> statement-breakpoint
CREATE TYPE "public"."bonus_code_status" AS ENUM('active', 'disabled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."bonus_credit_status" AS ENUM('active', 'redeemed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."bonus_credit_type" AS ENUM('free_bet', 'free_spins', 'casino_credit');--> statement-breakpoint
CREATE TYPE "public"."bonus_domain" AS ENUM('sports', 'casino', 'matka', 'global');--> statement-breakpoint
CREATE TYPE "public"."bonus_status" AS ENUM('draft', 'active', 'paused', 'ended');--> statement-breakpoint
CREATE TYPE "public"."bonus_type" AS ENUM('deposit', 'signup', 'direct_freebet', 'direct_free_spin', 'direct_amount', 'referral_deposit', 'losing_bonus', 'special', 'daily_first_deposit', 'deposit_match', 'cashback_loss', 'direct_event', 'free_bet', 'free_spins', 'casino_credit', 'loyalty', 'reload');--> statement-breakpoint
CREATE TYPE "public"."deposit_condition_type" AS ENUM('greater_than', 'equal_to', 'less_than', 'greater_equal', 'less_equal');--> statement-breakpoint
CREATE TYPE "public"."distribution_type" AS ENUM('instant_otp', 'instant_cash', 'roll_over');--> statement-breakpoint
CREATE TYPE "public"."game_group_domain" AS ENUM('casino', 'matka');--> statement-breakpoint
CREATE TYPE "public"."promotion_status" AS ENUM('draft', 'active', 'paused', 'ended');--> statement-breakpoint
CREATE TYPE "public"."release_type" AS ENUM('bonus_amount_only', 'total_bonus_wallet');--> statement-breakpoint
CREATE TYPE "public"."agent_ledger_line_type" AS ENUM('COMMISSION', 'SHARE', 'ADJUSTMENT', 'SETTLEMENT');--> statement-breakpoint
CREATE TYPE "public"."agent_scheme" AS ENUM('COMMISSION', 'SHARING', 'CREDIT');--> statement-breakpoint
CREATE TYPE "public"."referral_attribution_model" AS ENUM('LAST_CLICK', 'FIRST_CLICK', 'LINEAR', 'TIME_DECAY');--> statement-breakpoint
CREATE TYPE "public"."referral_attribution_status" AS ENUM('pending', 'confirmed', 'rejected', 'reattributed');--> statement-breakpoint
CREATE TYPE "public"."referral_coupon_status" AS ENUM('active', 'used', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."referral_escrow_status" AS ENUM('none', 'pending_kyc', 'pending_fraud_check', 'released', 'held');--> statement-breakpoint
CREATE TYPE "public"."referral_payout_type" AS ENUM('CASH', 'BONUS', 'SPLIT');--> statement-breakpoint
CREATE TYPE "public"."referral_raffle_draw_status" AS ENUM('scheduled', 'running', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."referral_rule_type" AS ENUM('SIGNUP_CPA', 'FIRST_DEPOSIT_PCT', 'RELOAD_DEPOSITS_PCT', 'REVSHARE', 'LOSS_SHARE', 'TURNOVER_MILESTONE', 'DEPOSITS_WINDOW_PCT', 'ACTIVITY_MILESTONE', 'LADDER', 'CASHBACK_SHARE', 'COUPON', 'RAFFLE', 'HYBRID');--> statement-breakpoint
CREATE TYPE "public"."referral_settlement_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."welivepay_order_status" AS ENUM('pending', 'success', 'expired', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."deposit_method" AS ENUM('BANK_TRANSFER', 'UPI');--> statement-breakpoint
CREATE TYPE "public"."deposit_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."otp_provider" AS ENUM('TWILIO', 'AWS_SNS', 'MSG91', 'TWO_FACTOR');--> statement-breakpoint
CREATE TYPE "public"."payout_account_approval" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."payout_method" AS ENUM('BANK', 'UPI');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."advertisement_device_type" AS ENUM('DESKTOP', 'MOBILE', 'BOTH');--> statement-breakpoint
CREATE TYPE "public"."advertisement_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."advertisement_type" AS ENUM('BANNER', 'PROMOTIONAL', 'FEATURED');--> statement-breakpoint
CREATE TYPE "public"."reporting_domain" AS ENUM('sports', 'casino', 'matka', 'agents', 'bonuses', 'global');--> statement-breakpoint
CREATE TYPE "public"."betting_pattern_type" AS ENUM('RAPID_BETTING', 'MULTI_ACCOUNT', 'COORDINATED', 'UNUSUAL_STAKE', 'ODD_TIMING', 'AGENT_COLLUSION');--> statement-breakpoint
CREATE TYPE "public"."pattern_severity" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."pattern_status" AS ENUM('DETECTED', 'INVESTIGATING', 'CONFIRMED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."automation_rule_type" AS ENUM('AUTO_VOID', 'AUTO_SUSPEND', 'MARKET_MAKER');--> statement-breakpoint
CREATE TYPE "public"."credit_entity_type" AS ENUM('agent', 'player', 'whitelabel');--> statement-breakpoint
CREATE TYPE "public"."credit_transaction_type" AS ENUM('ALLOCATION', 'DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'USAGE', 'RELEASE', 'ADJUSTMENT', 'CREDIT_LIMIT_ADJUSTMENT', 'CREDIT_USED_INCREASE', 'CREDIT_USED_DECREASE');--> statement-breakpoint
CREATE TYPE "public"."notification_category" AS ENUM('general', 'task');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('DEPOSIT', 'WITHDRAWAL', 'KYC', 'SYSTEM', 'AGENT', 'PLAYER', 'SETTLEMENT', 'COMMISSION');--> statement-breakpoint
CREATE TABLE "user_otps" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"phone" varchar(32) NOT NULL,
	"code_hash" varchar(120) NOT NULL,
	"purpose" "otp_purpose" DEFAULT 'login' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed" boolean DEFAULT false NOT NULL,
	"last_sent_at" timestamp with time zone,
	"sends_in_window" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"email" varchar(160),
	"name" varchar(120) NOT NULL,
	"username" varchar(120),
	"phone" varchar(32),
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"bonus_allowed" boolean DEFAULT true NOT NULL,
	"require_password_reset" boolean DEFAULT false NOT NULL,
	"sports_visible" boolean DEFAULT true NOT NULL,
	"sports_bet_allowed" boolean DEFAULT true NOT NULL,
	"casino_visible" boolean DEFAULT true NOT NULL,
	"casino_bet_allowed" boolean DEFAULT true NOT NULL,
	"matka_visible" boolean DEFAULT false NOT NULL,
	"matka_bet_allowed" boolean DEFAULT false NOT NULL,
	"withdrawal_lock" boolean DEFAULT false NOT NULL,
	"risk_type" "risk_type",
	"flags" jsonb,
	"vip_tier_id" varchar(64),
	"player_type" "player_type" DEFAULT 'REGULAR' NOT NULL,
	"agent_id" uuid,
	"credit_limit" numeric(18, 2) DEFAULT '0',
	"credit_used" numeric(18, 2) DEFAULT '0',
	"credit_available" numeric(18, 2) DEFAULT '0',
	"settlement_balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"settlement_balance_sports" numeric(18, 2) DEFAULT '0' NOT NULL,
	"settlement_balance_casino" numeric(18, 2) DEFAULT '0' NOT NULL,
	"settlement_balance_matka" numeric(18, 2) DEFAULT '0' NOT NULL,
	"director_mode" varchar(16),
	"director_selected_whitelabel_id" varchar(128),
	"password_hash" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"last_login_at" timestamp with time zone,
	"remark" varchar(512)
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"domain" varchar(64) NOT NULL,
	"action" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"role_id" integer NOT NULL,
	"permission_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"name" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"user_id" integer NOT NULL,
	"role_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_annotations" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"audit_event_id" integer NOT NULL,
	"created_by" integer NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"whitelabel_id" varchar(64) NOT NULL,
	"created_by" integer NOT NULL,
	"filters_json" jsonb NOT NULL,
	"export_format" varchar(16) NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"file_url" varchar(512),
	"file_data" text,
	"error_message" text,
	"scheduled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"actor_id" varchar(64) NOT NULL,
	"domain" varchar(64) NOT NULL,
	"action" varchar(64) NOT NULL,
	"resource_type" varchar(64) NOT NULL,
	"resource_id" varchar(128) NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"domain" varchar(64) NOT NULL,
	"draw_id" varchar(64),
	"value" varchar(64),
	"reason" varchar(256),
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"requested_by" varchar(64) NOT NULL,
	"approved_by" varchar(64),
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "draws" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"type" varchar(32) NOT NULL,
	"open_at" timestamp with time zone NOT NULL,
	"cutoff_at" timestamp with time zone NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"status" varchar(24) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matka_default_rates" (
	"tenant" varchar(128) PRIMARY KEY DEFAULT 'default' NOT NULL,
	"entries" jsonb NOT NULL,
	"updated_by" varchar(64),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matka_rate_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"matka_id" uuid NOT NULL,
	"version_tag" varchar(64) NOT NULL,
	"entries" jsonb NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matkas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"name" varchar(160) NOT NULL,
	"code" varchar(120) NOT NULL,
	"description" text,
	"timezone" varchar(64) NOT NULL,
	"schedule" jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'inactive' NOT NULL,
	"limits" jsonb NOT NULL,
	"visibility" jsonb NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"settings" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" varchar(64),
	"updated_by" varchar(64),
	"reason" varchar(256),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "results" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"draw_id" varchar(64) NOT NULL,
	"value" varchar(64) NOT NULL,
	"entered_by" varchar(64) NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"wallet_id" integer NOT NULL,
	"type" varchar(32) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"balance_before" numeric(18, 2),
	"balance_after" numeric(18, 2),
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"user_id" integer NOT NULL,
	"currency" varchar(8) DEFAULT 'INR' NOT NULL,
	"cash" numeric(18, 2) DEFAULT '0' NOT NULL,
	"bonus" numeric(18, 2) DEFAULT '0' NOT NULL,
	"exposure" numeric(18, 2) DEFAULT '0' NOT NULL,
	"referral_bonus" numeric(18, 2) DEFAULT '0' NOT NULL,
	"referral_balance" numeric(18, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"wallet_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"wallet_type" varchar(32) NOT NULL,
	"category" varchar(64) NOT NULL,
	"direction" varchar(8) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"balance_before" numeric(18, 2),
	"balance_after" numeric(18, 2),
	"description" varchar(256),
	"reference_type" varchar(64),
	"reference_id" varchar(128),
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vip_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(64),
	"actor" varchar(64),
	"action" varchar(64) NOT NULL,
	"tier_id" uuid,
	"message" text NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vip_member_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"from_tier_id" uuid,
	"to_tier_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"points_at_change" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vip_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(64) DEFAULT 'default' NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"user_name" varchar(120) NOT NULL,
	"user_email" varchar(160),
	"tier_id" uuid NOT NULL,
	"current_points" integer DEFAULT 0 NOT NULL,
	"lifetime_points" integer DEFAULT 0 NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"last_activity_at" timestamp DEFAULT now(),
	"status" varchar(16) DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vip_tier_benefits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tier_id" uuid NOT NULL,
	"benefit" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vip_tier_perks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tier_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text NOT NULL,
	"icon" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "vip_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(64) DEFAULT 'default' NOT NULL,
	"name" varchar(120) NOT NULL,
	"level" integer NOT NULL,
	"min_monthly_deposit" integer NOT NULL,
	"color" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vip_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"type" varchar(16) NOT NULL,
	"points" integer NOT NULL,
	"description" text NOT NULL,
	"balance_before" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"user_id" integer NOT NULL,
	"daily_stake_limit" numeric(18, 2),
	"weekly_stake_limit" numeric(18, 2),
	"exposure_cap_override" numeric(18, 2),
	"cooldown_seconds" integer,
	"max_bet_sports" numeric(18, 2),
	"max_bet_casino" numeric(18, 2),
	"max_bet_matka" numeric(18, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whitelabel_sharing_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"whitelabel_id" varchar(64) NOT NULL,
	"domain" varchar(24) NOT NULL,
	"share_rate" numeric(6, 4) NOT NULL,
	"basis" varchar(12) DEFAULT 'GGR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "whitelabels" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"domain" varchar(255) NOT NULL,
	"logo_url" text,
	"favicon_url" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"credit_limit" numeric(18, 2) DEFAULT '0',
	"credit_used" numeric(18, 2) DEFAULT '0',
	"credit_available" numeric(18, 2) DEFAULT '0',
	"credit_alert_threshold" numeric(5, 2) DEFAULT '80.00',
	"settlement_balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"settlement_balance_sports" numeric(18, 2) DEFAULT '0' NOT NULL,
	"settlement_balance_casino" numeric(18, 2) DEFAULT '0' NOT NULL,
	"settlement_balance_matka" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_settlement_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"agent_id" uuid NOT NULL,
	"settlement_type" varchar(20) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"direction" varchar(20) NOT NULL,
	"previous_balance" numeric(18, 2),
	"new_balance" numeric(18, 2),
	"notes" text,
	"settled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(128) DEFAULT 'default' NOT NULL,
	"agent_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"source_cycle_from" timestamp with time zone NOT NULL,
	"source_cycle_to" timestamp with time zone NOT NULL,
	"target_cycle_from" timestamp with time zone,
	"target_cycle_to" timestamp with time zone,
	"reason" varchar(64) NOT NULL,
	"ref_meta" jsonb,
	"status" varchar(24) DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "commission_cycle_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(128) DEFAULT 'default' NOT NULL,
	"agent_id" uuid NOT NULL,
	"cycle_from" timestamp with time zone NOT NULL,
	"cycle_to" timestamp with time zone NOT NULL,
	"calculated_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"posted_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"paid_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"payable_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" "commission_cycle_snapshot_status" DEFAULT 'OPEN' NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"agent_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"period_from" date,
	"period_to" date,
	"turnover" numeric(18, 2),
	"notes" text,
	"paid_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_credit_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"player_id" integer NOT NULL,
	"adjustment_type" varchar(20) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"previous_limit" numeric(18, 2),
	"new_limit" numeric(18, 2),
	"previous_used" numeric(18, 2),
	"new_used" numeric(18, 2),
	"notes" text,
	"adjusted_by" uuid,
	"balance_before" numeric(18, 2),
	"balance_after" numeric(18, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"ggr" numeric(18, 2) DEFAULT '0' NOT NULL,
	"share_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"partner_share_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"settled_at" timestamp with time zone,
	"notes" varchar(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_configs" (
	"whitelabel_id" varchar(64) PRIMARY KEY NOT NULL,
	"support_email" varchar(160),
	"support_phone" varchar(64),
	"whatsapp_support_phone" varchar(64),
	"default_locale" varchar(16),
	"time_zone" varchar(64),
	"base_currency" varchar(16),
	"seo_title" varchar(180),
	"seo_description" varchar(512),
	"og_image_url" varchar(2048),
	"social_links" jsonb,
	"analytics" jsonb,
	"maintenance" boolean DEFAULT false NOT NULL,
	"maintenance_message" varchar(512),
	"news_ticker" varchar(1024),
	"sports_enabled" boolean DEFAULT true NOT NULL,
	"casino_enabled" boolean DEFAULT true NOT NULL,
	"matka_enabled" boolean DEFAULT true NOT NULL,
	"agents_enabled" boolean DEFAULT true NOT NULL,
	"referrals_enabled" boolean DEFAULT true NOT NULL,
	"bonuses_enabled" boolean DEFAULT true NOT NULL,
	"register_enabled" boolean DEFAULT true NOT NULL,
	"deposit_min" numeric(18, 6),
	"deposit_max" numeric(18, 6),
	"withdrawal_min" numeric(18, 6),
	"withdrawal_max" numeric(18, 6),
	"deposit_fee_percent" numeric(9, 6),
	"withdrawal_fee_percent" numeric(9, 6),
	"kyc_required_to_withdraw" boolean DEFAULT false,
	"rounding_strategy" varchar(32),
	"upi_payouts_disabled" boolean DEFAULT false NOT NULL,
	"bank_payouts_disabled" boolean DEFAULT false NOT NULL,
	"hide_add_upi" boolean DEFAULT false NOT NULL,
	"hide_add_bank" boolean DEFAULT false NOT NULL,
	"max_daily_withdrawal_requests" integer,
	"overall_exposure_cap" numeric(18, 6),
	"daily_stake_limit" numeric(18, 6),
	"weekly_stake_limit" numeric(18, 6),
	"cashout_enabled" boolean DEFAULT true,
	"smtp" jsonb,
	"sms" jsonb,
	"admin_ui_notifications" jsonb,
	"webhooks" jsonb,
	"observability" jsonb,
	"pwa" jsonb,
	"theme" jsonb,
	"sports_global_config" jsonb,
	"pre_login_banner_url" text,
	"post_login_banner_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sport_code" varchar(64) NOT NULL,
	"key" varchar(128) NOT NULL,
	"name" varchar(160) NOT NULL,
	"sort" integer DEFAULT 999 NOT NULL,
	"status" "sport_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sports_auto_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(64) DEFAULT 'default' NOT NULL,
	"whitelabel_id" varchar(64) NOT NULL,
	"sport_id" uuid NOT NULL,
	"league_codes" jsonb,
	"frequency_hours" integer DEFAULT 6 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp,
	"last_run_status" varchar(32) DEFAULT 'never',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sports_auto_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(64) DEFAULT 'default' NOT NULL,
	"whitelabel_id" varchar(64) NOT NULL,
	"sport_id" uuid NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"status" varchar(32) DEFAULT 'running' NOT NULL,
	"leagues_added" integer DEFAULT 0 NOT NULL,
	"events_added" integer DEFAULT 0 NOT NULL,
	"markets_added" integer DEFAULT 0 NOT NULL,
	"runners_added" integer DEFAULT 0 NOT NULL,
	"skipped_events_count" integer DEFAULT 0 NOT NULL,
	"skipped_events" jsonb,
	"error_message" varchar(500)
);
--> statement-breakpoint
CREATE TABLE "sports_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"event_code" varchar(64) NOT NULL,
	"key" varchar(128) NOT NULL,
	"name" varchar(200) NOT NULL,
	"start_time" timestamp,
	"status" "sport_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sports_leagues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sport_id" uuid NOT NULL,
	"league_code" varchar(64) NOT NULL,
	"key" varchar(128) NOT NULL,
	"name" varchar(160) NOT NULL,
	"sort" integer DEFAULT 999 NOT NULL,
	"status" "sport_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sports_markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"market_code" varchar(64) NOT NULL,
	"name" varchar(200) NOT NULL,
	"type" varchar(64) DEFAULT 'match_odds' NOT NULL,
	"status" "sport_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sports_runners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"selection_code" varchar(64) NOT NULL,
	"name" varchar(180) NOT NULL,
	"sort" integer DEFAULT 999 NOT NULL,
	"status" "sport_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sports_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(64) DEFAULT 'default' NOT NULL,
	"whitelabel_id" varchar(64) NOT NULL,
	"sport_id" uuid NOT NULL,
	"tier_id" varchar(64) DEFAULT 'default' NOT NULL,
	"exchange_min_stake" numeric(18, 2),
	"exchange_max_stake" numeric(18, 2),
	"bookmaker_min_stake" numeric(18, 2),
	"bookmaker_max_stake" numeric(18, 2),
	"fancy_min_stake" numeric(18, 2),
	"fancy_max_stake" numeric(18, 2),
	"exchange_min_odds" numeric(10, 2),
	"exchange_max_odds" numeric(10, 2),
	"exchange_commission" numeric(6, 2),
	"bookmaker_commission" numeric(6, 2),
	"fancy_commission" numeric(6, 2),
	"exchange_exposure_daily" numeric(18, 2),
	"exchange_exposure_weekly" numeric(18, 2),
	"exchange_exposure_cap" numeric(18, 2),
	"bookmaker_exposure_daily" numeric(18, 2),
	"bookmaker_exposure_weekly" numeric(18, 2),
	"bookmaker_exposure_cap" numeric(18, 2),
	"fancy_exposure_daily" numeric(18, 2),
	"fancy_exposure_weekly" numeric(18, 2),
	"fancy_exposure_cap" numeric(18, 2),
	"exchange_delay" integer,
	"bookmaker_delay" integer,
	"fancy_delay" integer,
	"exchange_cooldown" integer,
	"bookmaker_cooldown" integer,
	"fancy_cooldown" integer,
	"cashout_active" boolean,
	"risk_level" varchar(16),
	"risk_threshold" numeric(6, 2),
	"volatility_threshold" numeric(6, 2),
	"alert_on_breach" boolean,
	"alert_channel" varchar(32),
	"alert_rate_limit" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sports_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"whitelabel_id" varchar(64) NOT NULL,
	"is_global" boolean DEFAULT false NOT NULL,
	"sport_id" uuid NOT NULL,
	"league_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"market_type" "sports_result_market_type" NOT NULL,
	"runner_id" uuid,
	"selection_name" varchar(200),
	"result" numeric(18, 2),
	"declared_by" varchar(64) NOT NULL,
	"declared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" varchar(128),
	"declared_from_ip" varchar(45),
	"declared_user_agent" text,
	"rolled_back_at" timestamp with time zone,
	"rolled_back_by" varchar(64),
	"rollback_reason" text,
	"rollback_tag" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sports_auto_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"whitelabel_id" varchar(64) NOT NULL,
	"sport_id" uuid,
	"league_id" uuid,
	"event_id" uuid,
	"exchange_enabled" boolean DEFAULT false NOT NULL,
	"bookmaker_enabled" boolean DEFAULT false NOT NULL,
	"fancy_enabled" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"auto_declare_enabled" boolean DEFAULT false NOT NULL,
	"rules" jsonb,
	"notify_on_auto_declare" boolean DEFAULT false NOT NULL,
	"notify_channels" jsonb,
	"created_by" varchar(64) NOT NULL,
	"updated_by" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(64) DEFAULT 'default' NOT NULL,
	"whitelabel_id" varchar(64) NOT NULL,
	"league_id" uuid NOT NULL,
	"tier_id" varchar(64) DEFAULT 'default' NOT NULL,
	"exchange_min_stake" numeric(18, 2),
	"exchange_max_stake" numeric(18, 2),
	"bookmaker_min_stake" numeric(18, 2),
	"bookmaker_max_stake" numeric(18, 2),
	"fancy_min_stake" numeric(18, 2),
	"fancy_max_stake" numeric(18, 2),
	"exchange_delay" integer,
	"bookmaker_delay" integer,
	"fancy_delay" integer,
	"exchange_cooldown" integer,
	"bookmaker_cooldown" integer,
	"fancy_cooldown" integer,
	"exchange_min_odds" numeric(10, 2),
	"exchange_max_odds" numeric(10, 2),
	"exchange_commission" numeric(6, 2),
	"bookmaker_commission" numeric(6, 2),
	"fancy_commission" numeric(6, 2),
	"exchange_exposure_daily" numeric(18, 2),
	"exchange_exposure_weekly" numeric(18, 2),
	"exchange_exposure_cap" numeric(18, 2),
	"bookmaker_exposure_daily" numeric(18, 2),
	"bookmaker_exposure_weekly" numeric(18, 2),
	"bookmaker_exposure_cap" numeric(18, 2),
	"fancy_exposure_daily" numeric(18, 2),
	"fancy_exposure_weekly" numeric(18, 2),
	"fancy_exposure_cap" numeric(18, 2),
	"cashout_active" boolean,
	"risk_level" varchar(16),
	"risk_threshold" numeric(6, 2),
	"volatility_threshold" numeric(6, 2),
	"alert_on_breach" boolean,
	"alert_channel" varchar(64),
	"alert_rate_limit" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(64) DEFAULT 'default' NOT NULL,
	"whitelabel_id" varchar(64) NOT NULL,
	"event_id" uuid NOT NULL,
	"tier_id" varchar(64) DEFAULT 'default' NOT NULL,
	"exchange_min_stake" numeric(18, 2),
	"exchange_max_stake" numeric(18, 2),
	"bookmaker_min_stake" numeric(18, 2),
	"bookmaker_max_stake" numeric(18, 2),
	"fancy_min_stake" numeric(18, 2),
	"fancy_max_stake" numeric(18, 2),
	"exchange_delay" integer,
	"bookmaker_delay" integer,
	"fancy_delay" integer,
	"exchange_cooldown" integer,
	"bookmaker_cooldown" integer,
	"fancy_cooldown" integer,
	"exchange_min_odds" numeric(10, 2),
	"exchange_max_odds" numeric(10, 2),
	"exchange_commission" numeric(6, 2),
	"bookmaker_commission" numeric(6, 2),
	"fancy_commission" numeric(6, 2),
	"exchange_exposure_daily" numeric(18, 2),
	"exchange_exposure_weekly" numeric(18, 2),
	"exchange_exposure_cap" numeric(18, 2),
	"bookmaker_exposure_daily" numeric(18, 2),
	"bookmaker_exposure_weekly" numeric(18, 2),
	"bookmaker_exposure_cap" numeric(18, 2),
	"fancy_exposure_daily" numeric(18, 2),
	"fancy_exposure_weekly" numeric(18, 2),
	"fancy_exposure_cap" numeric(18, 2),
	"cashout_active" boolean,
	"risk_level" varchar(16),
	"risk_threshold" numeric(6, 2),
	"volatility_threshold" numeric(6, 2),
	"alert_on_breach" boolean,
	"alert_channel" varchar(64),
	"alert_rate_limit" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sports_bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"whitelabel_id" varchar(64) NOT NULL,
	"user_id" integer NOT NULL,
	"sport_id" uuid NOT NULL,
	"league_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"runner_id" uuid NOT NULL,
	"selection_id" varchar(64) NOT NULL,
	"side" "sports_bet_side" NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"size" numeric(18, 2) NOT NULL,
	"stake" numeric(18, 2) NOT NULL,
	"liability" numeric(18, 2) NOT NULL,
	"odds_size" numeric(10, 2),
	"status" "sports_bet_status" DEFAULT 'unmatched' NOT NULL,
	"matched_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"result" varchar(64),
	"pl" numeric(18, 2),
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"ip_address" varchar(45),
	"user_agent" varchar(512),
	"location" varchar(256),
	"country" varchar(64),
	"device_info" varchar(256),
	"exclude_from_admin_running" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matka_bid_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"matka_id" uuid NOT NULL,
	"matka_type" varchar(32) NOT NULL,
	"market_name" varchar(160) NOT NULL,
	"market_session" varchar(32),
	"bid_type" varchar(48) NOT NULL,
	"percentage" numeric(12, 4) NOT NULL,
	"include_all" boolean DEFAULT true NOT NULL,
	"included_players" jsonb,
	"min_stake" numeric(18, 2),
	"max_stake" numeric(18, 2),
	"exposure_cap" numeric(18, 2),
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"notes" varchar(512),
	"version_id" uuid,
	"version_label" varchar(128),
	"is_active" boolean DEFAULT false NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"created_by" varchar(64),
	"updated_by" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "casino_api_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "casino_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"main_category" "casino_main_category" NOT NULL,
	"type" "casino_category_type" DEFAULT 'general' NOT NULL,
	"subtitle" varchar(200),
	"name" varchar(120) NOT NULL,
	"slug" varchar(160) NOT NULL,
	"icon_data" text,
	"order" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "casino_category_games" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "casino_game_bet_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"game_id" integer NOT NULL,
	"player_id" varchar(64),
	"bet_enabled" boolean DEFAULT true NOT NULL,
	"min_stake" numeric(12, 2),
	"max_stake" numeric(12, 2),
	"max_win" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "casino_games" (
	"id" serial PRIMARY KEY NOT NULL,
	"api_provider_id" integer NOT NULL,
	"vendor_id" integer NOT NULL,
	"main_category" "casino_main_category" NOT NULL,
	"external_id" varchar(128) NOT NULL,
	"table_id" varchar(200),
	"name" varchar(200) NOT NULL,
	"slug" varchar(200) NOT NULL,
	"thumbnail_url" varchar(1000),
	"rtp" numeric(5, 2),
	"volatility" varchar(32),
	"demo_url" varchar(1000),
	"features" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "casino_provider_vendor_shares" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"provider_id" integer NOT NULL,
	"vendor_id" integer NOT NULL,
	"share_percentage" numeric(5, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "casino_vendors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vip_tier_casino_games" (
	"id" serial PRIMARY KEY NOT NULL,
	"tier_id" uuid NOT NULL,
	"game_id" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whitelabel_casino_game_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"game_id" integer NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"order" integer,
	"featured" boolean DEFAULT false,
	"premium_only" boolean DEFAULT false NOT NULL,
	"tags" jsonb,
	"limits" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whitelabel_casino_game_super_admin_override" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"game_id" integer NOT NULL,
	"disabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whitelabel_casino_provider_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"provider_id" integer NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"display_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whitelabel_casino_vendor_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"vendor_id" integer NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"display_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whitelabel_casino_vendor_super_admin_override" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"vendor_id" integer NOT NULL,
	"disabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "casino_bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"whitelabel_id" varchar(64) NOT NULL,
	"user_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"game_name" varchar(200),
	"provider_id" integer,
	"session_id" varchar(128),
	"vendor_id" integer NOT NULL,
	"vendor_name" varchar(120) NOT NULL,
	"table_id" varchar(200),
	"stake" numeric(18, 2) NOT NULL,
	"payout" numeric(18, 2),
	"win_amount" numeric(18, 2),
	"net_amount" numeric(18, 2),
	"status" "casino_bet_status" DEFAULT 'pending' NOT NULL,
	"game_round_id" varchar(128),
	"transaction_id" varchar(128),
	"result_transaction_id" varchar(128),
	"rollback_transaction_id" varchar(128),
	"settled_at" timestamp with time zone,
	"wallet_type" varchar(16) DEFAULT 'cash' NOT NULL,
	"bonus_award_id" integer,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"metadata" jsonb,
	"exclude_from_admin_running" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_casino_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"user_id" integer NOT NULL,
	"provider_key" varchar(64) NOT NULL,
	"token" varchar(256) NOT NULL,
	"wallet_type" "casino_wallet_type" DEFAULT 'cash' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "matka_bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"whitelabel_id" varchar(64) NOT NULL,
	"user_id" integer NOT NULL,
	"matka_id" uuid NOT NULL,
	"matka_type" "matka_type" NOT NULL,
	"market_name" varchar(160) NOT NULL,
	"market_session" varchar(32),
	"bid_type" varchar(48) NOT NULL,
	"bet_numbers" varchar(200) NOT NULL,
	"bet_amount" numeric(18, 2) NOT NULL,
	"payout_multiplier" numeric(10, 4) NOT NULL,
	"potential_win" numeric(18, 2),
	"actual_win" numeric(18, 2),
	"status" "matka_bet_status" DEFAULT 'pending' NOT NULL,
	"result" varchar(64),
	"settled_at" timestamp with time zone,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"instance_id" uuid,
	"side" "worli_session_side",
	"selection_key" varchar(200),
	"selection_json" jsonb,
	"rules_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matka_activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"meta_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matka_worli_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"run_date" date NOT NULL,
	"side" "worli_session_side" NOT NULL,
	"status" "worli_status" DEFAULT 'SCHEDULED' NOT NULL,
	"scheduled_open_at_utc" timestamp with time zone NOT NULL,
	"scheduled_lock_at_utc" timestamp with time zone NOT NULL,
	"scheduled_close_at_utc" timestamp with time zone NOT NULL,
	"actual_open_at_utc" timestamp with time zone,
	"actual_lock_at_utc" timestamp with time zone,
	"actual_close_at_utc" timestamp with time zone,
	"suspend_minutes_override" integer,
	"operator_message" text,
	"total_stake_minor" bigint NOT NULL,
	"bet_count" integer DEFAULT 0 NOT NULL,
	"exposure_total_minor" bigint NOT NULL,
	"worst_outcome_key" text,
	"worst_outcome_pl_minor" bigint,
	"result_value" text,
	"result_published_at_utc" timestamp with time zone,
	"result_actor_id" uuid,
	"bid_rules_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matka_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"matka_id" uuid NOT NULL,
	"date" date NOT NULL,
	"type" "matka_result_type" NOT NULL,
	"result" varchar(64) NOT NULL,
	"declared_by" varchar(64) NOT NULL,
	"declared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" varchar(128),
	"rolled_back_at" timestamp with time zone,
	"rolled_back_by" varchar(64),
	"rollback_reason" text,
	"rollback_tag" varchar(32),
	"declared_from_ip" varchar(45),
	"declared_user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matka_result_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"matka_id" uuid NOT NULL,
	"date" date NOT NULL,
	"type" "matka_result_type" NOT NULL,
	"result" varchar(64) NOT NULL,
	"scheduled_by" varchar(64) NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"executed_at" timestamp with time zone,
	"executed_by" varchar(64),
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"error_message" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bonus_awards" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"domain" "bonus_domain" DEFAULT 'global' NOT NULL,
	"type" "bonus_type" NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(8) DEFAULT 'INR' NOT NULL,
	"wagering_req" numeric(10, 2) DEFAULT '0',
	"current_wagering" numeric(18, 2) DEFAULT '0',
	"status" "bonus_award_status" DEFAULT 'pending' NOT NULL,
	"first_deposit_required" boolean DEFAULT false,
	"first_deposit_unlocked" boolean DEFAULT false,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"trigger_amount" numeric(18, 2),
	"admin_status_updated_at" timestamp with time zone,
	"admin_status_updated_by_name" varchar(256),
	"admin_status_updated_by_phone" varchar(32),
	"admin_status_updated_by_remark" varchar(512),
	"distribution_type" "distribution_type",
	"release_type" "release_type"
);
--> statement-breakpoint
CREATE TABLE "bonus_campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"name" varchar(256) NOT NULL,
	"domain" "bonus_domain" DEFAULT 'global' NOT NULL,
	"type" "bonus_type" NOT NULL,
	"status" "bonus_status" DEFAULT 'draft' NOT NULL,
	"budget_numeric" numeric(18, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(8) DEFAULT 'INR' NOT NULL,
	"rules_json" jsonb,
	"code_mode" "bonus_code_mode" DEFAULT 'auto' NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"limits_json" jsonb,
	"direct_sub_type" varchar(64),
	"deposit_condition_type" "deposit_condition_type",
	"deposit_condition_amount" numeric(18, 2),
	"distribution_type" "distribution_type",
	"amount_type" "amount_type",
	"amount" numeric(18, 2),
	"percentage" numeric(6, 2),
	"number_of_players" integer,
	"usage_per_player" integer,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"wagering" numeric(18, 2),
	"expiry_bonus_days" integer,
	"deposit_required" boolean DEFAULT false,
	"release_type" "release_type",
	"activated_at" timestamp with time zone,
	"distributed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bonus_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"code" varchar(64) NOT NULL,
	"status" "bonus_code_status" DEFAULT 'active' NOT NULL,
	"max_uses" integer DEFAULT 0,
	"used_count" integer DEFAULT 0,
	"per_user_limit" integer DEFAULT 1,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bonus_credits" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"domain" "bonus_domain" NOT NULL,
	"credit_type" "bonus_credit_type" NOT NULL,
	"payload_json" jsonb,
	"expires_at" timestamp with time zone,
	"status" "bonus_credit_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bonus_group_weights" (
	"id" serial PRIMARY KEY NOT NULL,
	"bonus_id" integer NOT NULL,
	"group_id" integer NOT NULL,
	"weight" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bonus_tiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"min_deposit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"bonus_pct" numeric(6, 2),
	"max_bonus" numeric(18, 2),
	"fixed_amount" numeric(18, 2),
	"currency" varchar(8) DEFAULT 'INR' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "casino_game_bundles" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"name" varchar(256) NOT NULL,
	"description" text,
	"domain" varchar(20) DEFAULT 'casino' NOT NULL,
	"game_ids" jsonb NOT NULL,
	"game_weights" jsonb,
	"created_by" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_group_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"member_id" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"name" varchar(256) NOT NULL,
	"domain" "game_group_domain" NOT NULL,
	"default_weight" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"name" varchar(256) NOT NULL,
	"status" "promotion_status" DEFAULT 'draft' NOT NULL,
	"targeting_json" jsonb,
	"schedule_start" timestamp with time zone,
	"schedule_end" timestamp with time zone,
	"content_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_commission_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"domain" varchar(24) NOT NULL,
	"commission_rate" numeric(6, 4) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_credentials" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" varchar(128) DEFAULT 'default' NOT NULL,
	"username" varchar(120) NOT NULL,
	"password_hash" text NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_hierarchy_closure" (
	"ancestor_id" uuid NOT NULL,
	"descendant_id" uuid NOT NULL,
	"depth" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"domain" varchar(24) NOT NULL,
	"period_from" timestamp with time zone NOT NULL,
	"period_to" timestamp with time zone NOT NULL,
	"line_type" "agent_ledger_line_type" NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(8) NOT NULL,
	"ref_key" varchar(128),
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"period_from" timestamp with time zone NOT NULL,
	"period_to" timestamp with time zone NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"currency" varchar(8) NOT NULL,
	"status" varchar(24) DEFAULT 'OPEN' NOT NULL,
	"posted_at" timestamp with time zone,
	"posted_by" uuid,
	"settled_by_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_sharing_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"domain" varchar(24) NOT NULL,
	"share_rate" numeric(6, 4) NOT NULL,
	"basis" varchar(12) DEFAULT 'GGR' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"currency" varchar(8) NOT NULL,
	"balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"locked_balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(128) DEFAULT 'default' NOT NULL,
	"scheme_type" "agent_scheme" NOT NULL,
	"allowed_domains" text[] NOT NULL,
	"status" varchar(24) DEFAULT 'ACTIVE' NOT NULL,
	"phone" varchar(20),
	"parent_agent_id" uuid,
	"level_index" integer,
	"tally_enabled" boolean DEFAULT false NOT NULL,
	"tally_domains" text[],
	"credit_limit" numeric(15, 2) DEFAULT '0',
	"credit_used" numeric(15, 2) DEFAULT '0',
	"credit_available" numeric(15, 2) DEFAULT '0',
	"credit_alert_threshold" numeric(5, 2) DEFAULT '80.00',
	"token_version" integer DEFAULT 0 NOT NULL,
	"settlement_balance" numeric(15, 2) DEFAULT '0' NOT NULL,
	"settlement_balance_sports" numeric(15, 2) DEFAULT '0' NOT NULL,
	"settlement_balance_casino" numeric(15, 2) DEFAULT '0' NOT NULL,
	"settlement_balance_matka" numeric(15, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_ip_allowlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"user_id" integer NOT NULL,
	"cidr" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_attributions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"referrer_id" integer NOT NULL,
	"referee_id" integer NOT NULL,
	"tier" integer DEFAULT 1 NOT NULL,
	"click_id" integer,
	"status" "referral_attribution_status" DEFAULT 'pending' NOT NULL,
	"reason" varchar(512),
	"reattributed_from" integer,
	"attributed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "referral_budgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"program_id" integer,
	"budget_type" varchar(16) NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(8) DEFAULT 'INR' NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"spent" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_clicks" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"link_id" integer NOT NULL,
	"referrer_id" integer NOT NULL,
	"ip_address" varchar(45),
	"user_agent" varchar(512),
	"utm_source" varchar(128),
	"utm_medium" varchar(128),
	"utm_campaign" varchar(128),
	"clicked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_coupons" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"rule_id" integer NOT NULL,
	"referrer_id" integer,
	"referee_id" integer,
	"coupon_code" varchar(64) NOT NULL,
	"bonus_campaign_id" integer,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(8) DEFAULT 'INR' NOT NULL,
	"status" "referral_coupon_status" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_earnings" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"attribution_id" integer NOT NULL,
	"rule_id" integer NOT NULL,
	"referrer_id" integer NOT NULL,
	"referee_id" integer NOT NULL,
	"tier" integer NOT NULL,
	"rule_type" "referral_rule_type" NOT NULL,
	"gross_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(8) DEFAULT 'INR' NOT NULL,
	"event_data" jsonb DEFAULT '{}'::jsonb,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"user_id" integer,
	"agent_id" uuid,
	"code" varchar(64) NOT NULL,
	"qr_code_url" varchar(512),
	"utm_params" jsonb DEFAULT '{}'::jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_programs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"name" varchar(256) NOT NULL,
	"enabled_modes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_depth" integer DEFAULT 4 NOT NULL,
	"attribution_model" "referral_attribution_model" DEFAULT 'LAST_CLICK' NOT NULL,
	"attribution_window_days" integer DEFAULT 30 NOT NULL,
	"deposits_window_days" integer DEFAULT 30 NOT NULL,
	"negative_carryover" boolean DEFAULT false NOT NULL,
	"flags" jsonb DEFAULT '{}'::jsonb,
	"min_referral_balance_for_cash_transfer" numeric(18, 2) DEFAULT '0',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_raffle_draws" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"rule_id" integer NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"drawn_at" timestamp with time zone,
	"status" "referral_raffle_draw_status" DEFAULT 'scheduled' NOT NULL,
	"winners" jsonb DEFAULT '[]'::jsonb,
	"total_entries" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_raffle_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"rule_id" integer NOT NULL,
	"referrer_id" integer,
	"referee_id" integer,
	"entries" integer DEFAULT 1 NOT NULL,
	"reason" varchar(256),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"program_id" integer NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"rule_type" "referral_rule_type" NOT NULL,
	"tier_rates" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fixed_amounts" jsonb DEFAULT '{}'::jsonb,
	"caps" jsonb DEFAULT '{}'::jsonb,
	"thresholds" jsonb DEFAULT '{}'::jsonb,
	"payout_type" "referral_payout_type" DEFAULT 'CASH' NOT NULL,
	"split_ratio" jsonb DEFAULT '{"cash": 100, "bonus": 0}'::jsonb,
	"escrow" jsonb DEFAULT '{"untilKyc": false, "untilFraudClear": false}'::jsonb,
	"config_json" jsonb DEFAULT '{}'::jsonb,
	"reload_deposits_count" integer,
	"reload_min_deposit" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_settlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"earning_id" integer NOT NULL,
	"referrer_id" integer NOT NULL,
	"payout_type" "referral_payout_type" NOT NULL,
	"cash_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"bonus_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(8) DEFAULT 'INR' NOT NULL,
	"status" "referral_settlement_status" DEFAULT 'pending' NOT NULL,
	"escrow_status" "referral_escrow_status" DEFAULT 'none' NOT NULL,
	"wallet_transaction_id" integer,
	"bonus_award_id" integer,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_pages" (
	"id" serial PRIMARY KEY NOT NULL,
	"whitelabel_id" varchar(64) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"title" varchar(255) NOT NULL,
	"locale" varchar(16) DEFAULT 'en' NOT NULL,
	"status" varchar(16) DEFAULT 'DRAFT' NOT NULL,
	"body" varchar(200000),
	"seo_title" varchar(180),
	"seo_description" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "welivepay_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"user_id" integer NOT NULL,
	"orderid" varchar(128) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"status" "welivepay_order_status" DEFAULT 'pending' NOT NULL,
	"txn_ref" varchar(128),
	"payment_link" text,
	"deposit_request_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whitelabel_pg_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"provider" varchar(32) DEFAULT 'WELIVEPAY' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"display_name" varchar(128) DEFAULT 'UPI (Instant)' NOT NULL,
	"secret_site_key_encrypted" text,
	"webhook_token" varchar(64) NOT NULL,
	"min_deposit" numeric(18, 2),
	"max_deposit" numeric(18, 2),
	"redirect_success_url" text,
	"redirect_failure_url" text,
	"updated_by_user_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposit_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"user_id" integer NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'INR' NOT NULL,
	"method" "deposit_method" NOT NULL,
	"utr" varchar(128),
	"reference_id" varchar(128),
	"proof_key" varchar(512) NOT NULL,
	"proof_data" text,
	"status" "deposit_status" DEFAULT 'PENDING' NOT NULL,
	"reviewer_id" integer,
	"reviewed_at" timestamp with time zone,
	"note" varchar(512),
	"wallet_txn_id" integer,
	"balance_before" numeric(18, 2),
	"balance_after" numeric(18, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whitelabel_payment_methods" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"enabled_methods" jsonb DEFAULT '[]' NOT NULL,
	"bank_details" jsonb,
	"upi_details" jsonb,
	"limits" jsonb DEFAULT '{"min": 100, "max": 500000}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" text DEFAULT 'default' NOT NULL,
	"provider" "otp_provider" NOT NULL,
	"account_sid" text,
	"auth_token" text,
	"access_key" text,
	"secret_key" text,
	"region" text,
	"sender_id" text,
	"template_id" text,
	"api_key" text,
	"api_secret" text,
	"base_url" text,
	"active" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_payout_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"user_id" integer NOT NULL,
	"method" "payout_method" DEFAULT 'BANK' NOT NULL,
	"account_number" varchar(64) NOT NULL,
	"ifsc_code" varchar(32),
	"bank_name" varchar(128),
	"account_holder_name" varchar(160) NOT NULL,
	"label" varchar(64),
	"is_primary" boolean DEFAULT false NOT NULL,
	"approval_status" "payout_account_approval" DEFAULT 'PENDING' NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawal_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"user_id" integer NOT NULL,
	"wallet_id" integer,
	"payout_account_id" integer,
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'INR' NOT NULL,
	"status" "payout_status" DEFAULT 'PENDING' NOT NULL,
	"reviewer_id" integer,
	"reviewed_at" timestamp with time zone,
	"note" text,
	"ledger_txn_id" integer,
	"balance_before" numeric(18, 2),
	"balance_after" numeric(18, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "casino_likes" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"user_id" integer NOT NULL,
	"game_id" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "casino_recent" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"user_id" integer NOT NULL,
	"game_id" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sports_bookmarks" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"user_id" integer NOT NULL,
	"event_id" varchar(256) NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sports_recent" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"user_id" integer NOT NULL,
	"event_id" varchar(256) NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advertisements" (
	"id" serial PRIMARY KEY NOT NULL,
	"whitelabel_id" varchar(64) NOT NULL,
	"title" varchar(255) NOT NULL,
	"subtitle" varchar(512),
	"image_url" text,
	"type" "advertisement_type" DEFAULT 'BANNER' NOT NULL,
	"url" varchar(1024),
	"order" integer DEFAULT 0 NOT NULL,
	"status" "advertisement_status" DEFAULT 'ACTIVE' NOT NULL,
	"device_type" "advertisement_device_type" DEFAULT 'BOTH' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reporting_agent_rollups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"whitelabel_id" varchar(64) NOT NULL,
	"agent_id" uuid NOT NULL,
	"period_from" timestamp with time zone NOT NULL,
	"period_to" timestamp with time zone NOT NULL,
	"domain" varchar(24) NOT NULL,
	"total_turnover" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_ggr" numeric(18, 2) DEFAULT '0' NOT NULL,
	"commission_earned" numeric(18, 2) DEFAULT '0' NOT NULL,
	"share_earned" numeric(18, 2) DEFAULT '0' NOT NULL,
	"downline_turnover" numeric(18, 2) DEFAULT '0' NOT NULL,
	"downline_ggr" numeric(18, 2) DEFAULT '0' NOT NULL,
	"player_count" integer DEFAULT 0 NOT NULL,
	"active_player_count" integer DEFAULT 0 NOT NULL,
	"bet_count" integer DEFAULT 0 NOT NULL,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reporting_bonus_ledgers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"whitelabel_id" varchar(64) NOT NULL,
	"campaign_id" integer NOT NULL,
	"ledger_date" timestamp with time zone NOT NULL,
	"issued_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"redeemed_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"expired_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cancelled_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"outstanding_liability" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_wagering" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_revenue" numeric(18, 2) DEFAULT '0' NOT NULL,
	"award_count" integer DEFAULT 0 NOT NULL,
	"redemption_count" integer DEFAULT 0 NOT NULL,
	"player_count" integer DEFAULT 0 NOT NULL,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reporting_daily_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"whitelabel_id" varchar(64) NOT NULL,
	"snapshot_date" timestamp with time zone NOT NULL,
	"domain" "reporting_domain" NOT NULL,
	"sport_id" uuid,
	"league_id" uuid,
	"event_id" uuid,
	"agent_id" uuid,
	"campaign_id" integer,
	"player_id" integer,
	"total_stakes" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_payouts" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_exposure" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_liquidity" numeric(18, 2) DEFAULT '0' NOT NULL,
	"ggr" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net_revenue" numeric(18, 2) DEFAULT '0' NOT NULL,
	"hold_percentage" numeric(6, 4),
	"bet_count" integer DEFAULT 0 NOT NULL,
	"player_count" integer DEFAULT 0 NOT NULL,
	"active_player_count" integer DEFAULT 0 NOT NULL,
	"agent_commission" numeric(18, 2) DEFAULT '0',
	"agent_share" numeric(18, 2) DEFAULT '0',
	"downline_count" integer DEFAULT 0,
	"bonus_issued" numeric(18, 2) DEFAULT '0',
	"bonus_redeemed" numeric(18, 2) DEFAULT '0',
	"bonus_liability" numeric(18, 2) DEFAULT '0',
	"bonus_roi" numeric(6, 4),
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reporting_snapshots_unique" UNIQUE NULLS NOT DISTINCT("tenant","whitelabel_id","snapshot_date","domain","sport_id","league_id","event_id","agent_id","campaign_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "reporting_export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"whitelabel_id" varchar(64) NOT NULL,
	"created_by" integer NOT NULL,
	"report_type" varchar(64) NOT NULL,
	"filters_json" jsonb NOT NULL,
	"export_format" varchar(16) NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"file_url" varchar(512),
	"file_data" text,
	"error_message" text,
	"scheduled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reporting_saved_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"whitelabel_id" varchar(64) NOT NULL,
	"created_by" integer NOT NULL,
	"name" varchar(256) NOT NULL,
	"description" varchar(512),
	"report_type" varchar(64) NOT NULL,
	"filters_json" jsonb NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reporting_snapshot_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"level" varchar(8) DEFAULT 'info' NOT NULL,
	"event_type" varchar(48) NOT NULL,
	"tenant" varchar(128),
	"whitelabel_id" varchar(64),
	"currency" varchar(8),
	"reporting_day" date,
	"snapshot_date_utc" timestamp with time zone,
	"domain" varchar(24),
	"pg_boss_job_id" varchar(64),
	"singleton_key" varchar(256),
	"message" text,
	"detail_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "reporting_snapshot_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"summary_json" jsonb,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "risk_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(64) DEFAULT 'default' NOT NULL,
	"whitelabel_id" varchar(64) NOT NULL,
	"event_id" uuid NOT NULL,
	"percentiles" jsonb,
	"weights" jsonb,
	"amounts" jsonb,
	"alerts" jsonb,
	"pattern_thresholds" jsonb,
	"risk_level_thresholds" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "betting_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"whitelabel_id" varchar(64) NOT NULL,
	"user_id" integer NOT NULL,
	"event_id" uuid,
	"pattern_type" "betting_pattern_type" NOT NULL,
	"severity" "pattern_severity" NOT NULL,
	"metrics" jsonb,
	"status" "pattern_status" DEFAULT 'DETECTED' NOT NULL,
	"notes" varchar(1024),
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"whitelabel_id" varchar(64) NOT NULL,
	"event_id" uuid,
	"rule_type" "automation_rule_type" NOT NULL,
	"config" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_credit_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"alert_type" varchar(32) NOT NULL,
	"threshold" numeric(5, 2),
	"current_value" numeric(18, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(128) DEFAULT 'default' NOT NULL,
	"from_entity_type" "credit_entity_type" NOT NULL,
	"from_entity_id" varchar(128) NOT NULL,
	"to_entity_type" "credit_entity_type" NOT NULL,
	"to_entity_id" varchar(128) NOT NULL,
	"transaction_type" "credit_transaction_type" NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'INR' NOT NULL,
	"balance_before" numeric(18, 2) NOT NULL,
	"balance_after" numeric(18, 2) NOT NULL,
	"reason" text,
	"meta" jsonb,
	"created_by" uuid,
	"bet_id" uuid,
	"settlement_id" uuid,
	"cashout_id" uuid,
	"created_by_type" varchar(32),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_player_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"player_id" integer NOT NULL,
	"credit_limit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"current_balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"open_exposure" numeric(18, 2) DEFAULT '0' NOT NULL,
	"credit_used" numeric(18, 2) DEFAULT '0' NOT NULL,
	"credit_available" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"user_id" integer,
	"agent_id" uuid,
	"whitelabel_id" varchar(64),
	"type" "notification_type" NOT NULL,
	"category" "notification_category" NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb,
	"is_read" boolean DEFAULT false NOT NULL,
	"action_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "casino_callback_rejections" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"provider_key" varchar(64) NOT NULL,
	"endpoint" varchar(64) NOT NULL,
	"error_code" varchar(48) NOT NULL,
	"error_message" text,
	"user_id" integer,
	"player_id" varchar(128),
	"game_code" varchar(128),
	"round_id" varchar(128),
	"trans_id" varchar(128),
	"reference_id" varchar(128),
	"request_id" varchar(128),
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "casino_callback_idempotency" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"provider_key" varchar(64) NOT NULL,
	"operation" varchar(64) NOT NULL,
	"trans_id" varchar(128) NOT NULL,
	"user_id" integer,
	"amount" numeric(18, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_action_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"conversation_id" uuid NOT NULL,
	"admin_user_id" integer NOT NULL,
	"tool_name" varchar(128) NOT NULL,
	"args" jsonb NOT NULL,
	"summary" text NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"consumed" boolean DEFAULT false NOT NULL,
	"result" jsonb,
	"error" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"admin_user_id" integer NOT NULL,
	"title" varchar(200),
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" varchar(16) NOT NULL,
	"content" text,
	"tool_calls" jsonb,
	"tool_call_id" varchar(128),
	"tool_name" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_whitelabel_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"chat_limit" integer DEFAULT 0 NOT NULL,
	"limit_period" varchar(16) DEFAULT 'monthly' NOT NULL,
	"updated_by" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "matka_rate_versions" ADD CONSTRAINT "matka_rate_versions_matka_id_matkas_id_fk" FOREIGN KEY ("matka_id") REFERENCES "public"."matkas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vip_member_history" ADD CONSTRAINT "vip_member_history_member_id_vip_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."vip_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vip_member_history" ADD CONSTRAINT "vip_member_history_to_tier_id_vip_tiers_id_fk" FOREIGN KEY ("to_tier_id") REFERENCES "public"."vip_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vip_members" ADD CONSTRAINT "vip_members_tier_id_vip_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."vip_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vip_tier_benefits" ADD CONSTRAINT "vip_tier_benefits_tier_id_vip_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."vip_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vip_tier_perks" ADD CONSTRAINT "vip_tier_perks_tier_id_vip_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."vip_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vip_transactions" ADD CONSTRAINT "vip_transactions_member_id_vip_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."vip_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whitelabel_sharing_config" ADD CONSTRAINT "whitelabel_sharing_config_whitelabel_id_whitelabels_id_fk" FOREIGN KEY ("whitelabel_id") REFERENCES "public"."whitelabels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_settlement_transactions" ADD CONSTRAINT "agent_settlement_transactions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_adjustments" ADD CONSTRAINT "commission_adjustments_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_cycle_snapshots" ADD CONSTRAINT "commission_cycle_snapshots_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_credit_adjustments" ADD CONSTRAINT "player_credit_adjustments_player_id_users_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_auto_configs" ADD CONSTRAINT "sports_auto_configs_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_auto_runs" ADD CONSTRAINT "sports_auto_runs_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_league_id_sports_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."sports_leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_leagues" ADD CONSTRAINT "sports_leagues_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_markets" ADD CONSTRAINT "sports_markets_event_id_sports_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."sports_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_runners" ADD CONSTRAINT "sports_runners_market_id_sports_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."sports_markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_results" ADD CONSTRAINT "sports_results_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_results" ADD CONSTRAINT "sports_results_league_id_sports_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."sports_leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_results" ADD CONSTRAINT "sports_results_event_id_sports_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."sports_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_results" ADD CONSTRAINT "sports_results_market_id_sports_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."sports_markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_results" ADD CONSTRAINT "sports_results_runner_id_sports_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."sports_runners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_auto_results" ADD CONSTRAINT "sports_auto_results_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_auto_results" ADD CONSTRAINT "sports_auto_results_league_id_sports_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."sports_leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_auto_results" ADD CONSTRAINT "sports_auto_results_event_id_sports_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."sports_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_bets" ADD CONSTRAINT "sports_bets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_bets" ADD CONSTRAINT "sports_bets_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_bets" ADD CONSTRAINT "sports_bets_league_id_sports_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."sports_leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_bets" ADD CONSTRAINT "sports_bets_market_id_sports_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."sports_markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_bets" ADD CONSTRAINT "sports_bets_event_id_sports_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."sports_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_bets" ADD CONSTRAINT "sports_bets_runner_id_sports_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."sports_runners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casino_categories" ADD CONSTRAINT "casino_categories_tenant_id_whitelabels_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."whitelabels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casino_category_games" ADD CONSTRAINT "casino_category_games_category_id_casino_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."casino_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casino_category_games" ADD CONSTRAINT "casino_category_games_game_id_casino_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."casino_games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casino_game_bet_settings" ADD CONSTRAINT "casino_game_bet_settings_tenant_id_whitelabels_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."whitelabels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casino_game_bet_settings" ADD CONSTRAINT "casino_game_bet_settings_game_id_casino_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."casino_games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casino_games" ADD CONSTRAINT "casino_games_api_provider_id_casino_api_providers_id_fk" FOREIGN KEY ("api_provider_id") REFERENCES "public"."casino_api_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casino_games" ADD CONSTRAINT "casino_games_vendor_id_casino_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."casino_vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casino_provider_vendor_shares" ADD CONSTRAINT "casino_provider_vendor_shares_tenant_id_whitelabels_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."whitelabels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casino_provider_vendor_shares" ADD CONSTRAINT "casino_provider_vendor_shares_provider_id_casino_api_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."casino_api_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casino_provider_vendor_shares" ADD CONSTRAINT "casino_provider_vendor_shares_vendor_id_casino_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."casino_vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vip_tier_casino_games" ADD CONSTRAINT "vip_tier_casino_games_tier_id_vip_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."vip_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vip_tier_casino_games" ADD CONSTRAINT "vip_tier_casino_games_game_id_casino_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."casino_games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whitelabel_casino_game_settings" ADD CONSTRAINT "whitelabel_casino_game_settings_tenant_id_whitelabels_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."whitelabels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whitelabel_casino_game_settings" ADD CONSTRAINT "whitelabel_casino_game_settings_game_id_casino_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."casino_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whitelabel_casino_game_super_admin_override" ADD CONSTRAINT "whitelabel_casino_game_super_admin_override_tenant_id_whitelabels_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."whitelabels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whitelabel_casino_game_super_admin_override" ADD CONSTRAINT "whitelabel_casino_game_super_admin_override_game_id_casino_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."casino_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whitelabel_casino_provider_settings" ADD CONSTRAINT "whitelabel_casino_provider_settings_tenant_id_whitelabels_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."whitelabels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whitelabel_casino_provider_settings" ADD CONSTRAINT "whitelabel_casino_provider_settings_provider_id_casino_api_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."casino_api_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whitelabel_casino_vendor_settings" ADD CONSTRAINT "whitelabel_casino_vendor_settings_tenant_id_whitelabels_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."whitelabels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whitelabel_casino_vendor_settings" ADD CONSTRAINT "whitelabel_casino_vendor_settings_vendor_id_casino_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."casino_vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whitelabel_casino_vendor_super_admin_override" ADD CONSTRAINT "whitelabel_casino_vendor_super_admin_override_tenant_id_whitelabels_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."whitelabels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whitelabel_casino_vendor_super_admin_override" ADD CONSTRAINT "whitelabel_casino_vendor_super_admin_override_vendor_id_casino_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."casino_vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casino_bets" ADD CONSTRAINT "casino_bets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casino_bets" ADD CONSTRAINT "casino_bets_game_id_casino_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."casino_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casino_bets" ADD CONSTRAINT "casino_bets_provider_id_casino_api_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."casino_api_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casino_bets" ADD CONSTRAINT "casino_bets_vendor_id_casino_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."casino_vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casino_bets" ADD CONSTRAINT "casino_bets_bonus_award_id_bonus_awards_id_fk" FOREIGN KEY ("bonus_award_id") REFERENCES "public"."bonus_awards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_casino_sessions" ADD CONSTRAINT "user_casino_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matka_bets" ADD CONSTRAINT "matka_bets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matka_bets" ADD CONSTRAINT "matka_bets_matka_id_matkas_id_fk" FOREIGN KEY ("matka_id") REFERENCES "public"."matkas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matka_bets" ADD CONSTRAINT "matka_bets_instance_id_matka_worli_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."matka_worli_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matka_activity_logs" ADD CONSTRAINT "matka_activity_logs_instance_id_matka_worli_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."matka_worli_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matka_worli_instances" ADD CONSTRAINT "matka_worli_instances_market_id_matkas_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."matkas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matka_results" ADD CONSTRAINT "matka_results_matka_id_matkas_id_fk" FOREIGN KEY ("matka_id") REFERENCES "public"."matkas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matka_result_schedules" ADD CONSTRAINT "matka_result_schedules_matka_id_matkas_id_fk" FOREIGN KEY ("matka_id") REFERENCES "public"."matkas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_commission_config" ADD CONSTRAINT "agent_commission_config_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_hierarchy_closure" ADD CONSTRAINT "agent_hierarchy_closure_ancestor_id_agents_id_fk" FOREIGN KEY ("ancestor_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_hierarchy_closure" ADD CONSTRAINT "agent_hierarchy_closure_descendant_id_agents_id_fk" FOREIGN KEY ("descendant_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_ledger" ADD CONSTRAINT "agent_ledger_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_settlements" ADD CONSTRAINT "agent_settlements_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_settlements" ADD CONSTRAINT "agent_settlements_settled_by_agent_id_agents_id_fk" FOREIGN KEY ("settled_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sharing_config" ADD CONSTRAINT "agent_sharing_config_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_wallets" ADD CONSTRAINT "agent_wallets_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_payout_accounts" ADD CONSTRAINT "user_payout_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_payout_accounts" ADD CONSTRAINT "user_payout_accounts_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_payout_account_id_user_payout_accounts_id_fk" FOREIGN KEY ("payout_account_id") REFERENCES "public"."user_payout_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casino_likes" ADD CONSTRAINT "casino_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casino_recent" ADD CONSTRAINT "casino_recent_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_bookmarks" ADD CONSTRAINT "sports_bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_recent" ADD CONSTRAINT "sports_recent_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reporting_agent_rollups" ADD CONSTRAINT "reporting_agent_rollups_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reporting_bonus_ledgers" ADD CONSTRAINT "reporting_bonus_ledgers_campaign_id_bonus_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."bonus_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reporting_daily_snapshots" ADD CONSTRAINT "reporting_daily_snapshots_player_id_users_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reporting_snapshot_events" ADD CONSTRAINT "reporting_snapshot_events_run_id_reporting_snapshot_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reporting_snapshot_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "betting_patterns" ADD CONSTRAINT "betting_patterns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "betting_patterns" ADD CONSTRAINT "betting_patterns_event_id_sports_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."sports_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_event_id_sports_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."sports_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_credit_alerts" ADD CONSTRAINT "agent_credit_alerts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_player_credits" ADD CONSTRAINT "agent_player_credits_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_player_credits" ADD CONSTRAINT "agent_player_credits_player_id_users_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_whitelabel_id_whitelabels_id_fk" FOREIGN KEY ("whitelabel_id") REFERENCES "public"."whitelabels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_action_proposals" ADD CONSTRAINT "ai_action_proposals_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_otps_tenant_idx" ON "user_otps" USING btree ("tenant");--> statement-breakpoint
CREATE UNIQUE INDEX "user_otps_phone_purpose_tenant_unique" ON "user_otps" USING btree ("phone","purpose","tenant");--> statement-breakpoint
CREATE INDEX "users_agent_id_idx" ON "users" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_id_tenant_unique" ON "users" USING btree ("id","tenant");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_email_unique" ON "users" USING btree ("tenant","email");--> statement-breakpoint
CREATE INDEX "permissions_domain_action_idx" ON "permissions" USING btree ("domain","action");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_tenant_domain_action_unique" ON "permissions" USING btree ("tenant","domain","action");--> statement-breakpoint
CREATE INDEX "role_permissions_tenant_idx" ON "role_permissions" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions" USING btree ("permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_role_permission_tenant_unique" ON "role_permissions" USING btree ("role_id","permission_id","tenant");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_tenant_name_unique" ON "roles" USING btree ("tenant","name");--> statement-breakpoint
CREATE INDEX "user_roles_tenant_idx" ON "user_roles" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "user_roles_role_id_idx" ON "user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_user_role_tenant_unique" ON "user_roles" USING btree ("user_id","role_id","tenant");--> statement-breakpoint
CREATE INDEX "audit_annotations_audit_event_id_idx" ON "audit_annotations" USING btree ("audit_event_id");--> statement-breakpoint
CREATE INDEX "audit_annotations_tenant_idx" ON "audit_annotations" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "audit_annotations_created_by_idx" ON "audit_annotations" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "audit_export_jobs_tenant_idx" ON "audit_export_jobs" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "audit_export_jobs_whitelabel_idx" ON "audit_export_jobs" USING btree ("whitelabel_id");--> statement-breakpoint
CREATE INDEX "audit_export_jobs_created_by_idx" ON "audit_export_jobs" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "audit_export_jobs_status_idx" ON "audit_export_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_export_jobs_scheduled_idx" ON "audit_export_jobs" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_idx" ON "audit_logs" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "approvals_tenant_idx" ON "approvals" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "draws_tenant_idx" ON "draws" USING btree ("tenant");--> statement-breakpoint
CREATE UNIQUE INDEX "draws_id_tenant_unique" ON "draws" USING btree ("id","tenant");--> statement-breakpoint
CREATE INDEX "matka_rate_versions_matka_idx" ON "matka_rate_versions" USING btree ("matka_id");--> statement-breakpoint
CREATE UNIQUE INDEX "matka_rate_versions_unique_version" ON "matka_rate_versions" USING btree ("tenant","matka_id","effective_from");--> statement-breakpoint
CREATE INDEX "matkas_status_idx" ON "matkas" USING btree ("status");--> statement-breakpoint
CREATE INDEX "matkas_timezone_idx" ON "matkas" USING btree ("timezone");--> statement-breakpoint
CREATE INDEX "matkas_priority_idx" ON "matkas" USING btree ("priority");--> statement-breakpoint
CREATE UNIQUE INDEX "matkas_tenant_code_unique" ON "matkas" USING btree ("tenant","code");--> statement-breakpoint
CREATE UNIQUE INDEX "matkas_tenant_name_unique" ON "matkas" USING btree ("tenant","name");--> statement-breakpoint
CREATE INDEX "results_tenant_idx" ON "results" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "ledger_entries_tenant_idx" ON "ledger_entries" USING btree ("tenant");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_id_tenant_unique" ON "ledger_entries" USING btree ("id","tenant");--> statement-breakpoint
CREATE INDEX "wallets_tenant_idx" ON "wallets" USING btree ("tenant");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_id_tenant_unique" ON "wallets" USING btree ("id","tenant");--> statement-breakpoint
CREATE INDEX "wallet_ledger_tenant_user_id_idx" ON "wallet_ledger" USING btree ("tenant","user_id");--> statement-breakpoint
CREATE INDEX "wallet_ledger_tenant_wallet_id_type_idx" ON "wallet_ledger" USING btree ("tenant","wallet_id","wallet_type");--> statement-breakpoint
CREATE INDEX "wallet_ledger_created_at_idx" ON "wallet_ledger" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_ledger_id_tenant_unique" ON "wallet_ledger" USING btree ("id","tenant");--> statement-breakpoint
CREATE INDEX "vip_audit_tenant_at_idx" ON "vip_audit" USING btree ("tenant","at");--> statement-breakpoint
CREATE INDEX "vip_member_history_to_tier_id_idx" ON "vip_member_history" USING btree ("to_tier_id");--> statement-breakpoint
CREATE INDEX "vip_member_history_member_id_idx" ON "vip_member_history" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "vip_members_tier_id_idx" ON "vip_members" USING btree ("tier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vip_members_tenant_user_unique" ON "vip_members" USING btree ("tenant","user_id");--> statement-breakpoint
CREATE INDEX "vip_tier_benefits_tier_id_idx" ON "vip_tier_benefits" USING btree ("tier_id");--> statement-breakpoint
CREATE INDEX "vip_tier_perks_tier_id_idx" ON "vip_tier_perks" USING btree ("tier_id");--> statement-breakpoint
CREATE INDEX "vip_transactions_member_id_idx" ON "vip_transactions" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "player_limits_tenant_idx" ON "player_limits" USING btree ("tenant");--> statement-breakpoint
CREATE UNIQUE INDEX "player_limits_user_tenant_unique" ON "player_limits" USING btree ("user_id","tenant");--> statement-breakpoint
CREATE INDEX "whitelabel_sharing_config_whitelabel_id_idx" ON "whitelabel_sharing_config" USING btree ("whitelabel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whitelabels_domain_unique" ON "whitelabels" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "agent_settlement_transactions_agent_id_idx" ON "agent_settlement_transactions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "commission_adjustments_agent_id_idx" ON "commission_adjustments" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commission_cycle_snapshots_agent_cycle_key" ON "commission_cycle_snapshots" USING btree ("agent_id","cycle_from","cycle_to");--> statement-breakpoint
CREATE UNIQUE INDEX "commission_payouts_agent_cycle_key" ON "commission_payouts" USING btree ("agent_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "player_credit_adjustments_player_id_idx" ON "player_credit_adjustments" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sports_code_unique" ON "sports" USING btree ("sport_code");--> statement-breakpoint
CREATE UNIQUE INDEX "sports_key_unique" ON "sports" USING btree ("key");--> statement-breakpoint
CREATE INDEX "sports_auto_configs_sport_id_idx" ON "sports_auto_configs" USING btree ("sport_id");--> statement-breakpoint
CREATE INDEX "sports_auto_cfgs_tenant_idx" ON "sports_auto_configs" USING btree ("tenant");--> statement-breakpoint
CREATE UNIQUE INDEX "sports_auto_cfgs_unique" ON "sports_auto_configs" USING btree ("whitelabel_id","sport_id");--> statement-breakpoint
CREATE INDEX "sports_auto_runs_tenant_idx" ON "sports_auto_runs" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "sports_auto_runs_whitelabel_idx" ON "sports_auto_runs" USING btree ("whitelabel_id");--> statement-breakpoint
CREATE INDEX "sports_auto_runs_sport_idx" ON "sports_auto_runs" USING btree ("sport_id");--> statement-breakpoint
CREATE INDEX "sports_auto_runs_started_idx" ON "sports_auto_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "sports_events_league_idx" ON "sports_events" USING btree ("league_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sports_events_code_unique" ON "sports_events" USING btree ("event_code");--> statement-breakpoint
CREATE INDEX "sports_leagues_sport_idx" ON "sports_leagues" USING btree ("sport_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sports_leagues_code_unique" ON "sports_leagues" USING btree ("league_code");--> statement-breakpoint
CREATE INDEX "sports_markets_event_idx" ON "sports_markets" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sports_markets_code_unique" ON "sports_markets" USING btree ("market_code");--> statement-breakpoint
CREATE UNIQUE INDEX "sports_runners_code_unique" ON "sports_runners" USING btree ("market_id","selection_code");--> statement-breakpoint
CREATE INDEX "sports_settings_tenant_idx" ON "sports_settings" USING btree ("tenant");--> statement-breakpoint
CREATE UNIQUE INDEX "sports_settings_unique" ON "sports_settings" USING btree ("whitelabel_id","sport_id","tier_id");--> statement-breakpoint
CREATE INDEX "sports_results_runner_id_idx" ON "sports_results" USING btree ("runner_id");--> statement-breakpoint
CREATE INDEX "sports_results_tenant_idx" ON "sports_results" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "sports_results_whitelabel_idx" ON "sports_results" USING btree ("whitelabel_id");--> statement-breakpoint
CREATE INDEX "sports_results_sport_idx" ON "sports_results" USING btree ("sport_id");--> statement-breakpoint
CREATE INDEX "sports_results_league_idx" ON "sports_results" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "sports_results_event_idx" ON "sports_results" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "sports_results_market_idx" ON "sports_results" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "sports_results_market_type_idx" ON "sports_results" USING btree ("market_type");--> statement-breakpoint
CREATE INDEX "sports_results_declared_at_idx" ON "sports_results" USING btree ("declared_at");--> statement-breakpoint
CREATE INDEX "sports_results_created_at_idx" ON "sports_results" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sports_results_idempotency_idx" ON "sports_results" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "sports_results_rolled_back_idx" ON "sports_results" USING btree ("rolled_back_at");--> statement-breakpoint
CREATE INDEX "sports_results_is_global_idx" ON "sports_results" USING btree ("is_global");--> statement-breakpoint
CREATE INDEX "sports_auto_results_tenant_idx" ON "sports_auto_results" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "sports_auto_results_whitelabel_idx" ON "sports_auto_results" USING btree ("whitelabel_id");--> statement-breakpoint
CREATE INDEX "sports_auto_results_sport_idx" ON "sports_auto_results" USING btree ("sport_id");--> statement-breakpoint
CREATE INDEX "sports_auto_results_league_idx" ON "sports_auto_results" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "sports_auto_results_event_idx" ON "sports_auto_results" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "sports_auto_results_enabled_idx" ON "sports_auto_results" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "league_settings_tenant_idx" ON "league_settings" USING btree ("tenant");--> statement-breakpoint
CREATE UNIQUE INDEX "league_settings_unique" ON "league_settings" USING btree ("whitelabel_id","league_id","tier_id");--> statement-breakpoint
CREATE INDEX "event_settings_tenant_idx" ON "event_settings" USING btree ("tenant");--> statement-breakpoint
CREATE UNIQUE INDEX "event_settings_unique" ON "event_settings" USING btree ("whitelabel_id","event_id","tier_id");--> statement-breakpoint
CREATE INDEX "sports_bets_event_id_idx" ON "sports_bets" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "sports_bets_tenant_idx" ON "sports_bets" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "sports_bets_whitelabel_idx" ON "sports_bets" USING btree ("whitelabel_id");--> statement-breakpoint
CREATE INDEX "sports_bets_sport_idx" ON "sports_bets" USING btree ("sport_id");--> statement-breakpoint
CREATE INDEX "sports_bets_league_idx" ON "sports_bets" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "sports_bets_market_idx" ON "sports_bets" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "sports_bets_runner_idx" ON "sports_bets" USING btree ("runner_id");--> statement-breakpoint
CREATE INDEX "sports_bets_selection_idx" ON "sports_bets" USING btree ("selection_id");--> statement-breakpoint
CREATE INDEX "sports_bets_status_idx" ON "sports_bets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sports_bets_created_idx" ON "sports_bets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sports_bets_user_status_idx" ON "sports_bets" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "matka_bid_rules_tenant_idx" ON "matka_bid_rules" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "matka_bid_rules_market_idx" ON "matka_bid_rules" USING btree ("market_name");--> statement-breakpoint
CREATE INDEX "matka_bid_rules_bid_type_idx" ON "matka_bid_rules" USING btree ("bid_type");--> statement-breakpoint
CREATE INDEX "matka_bid_rules_active_idx" ON "matka_bid_rules" USING btree ("matka_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "matka_bid_rules_version_scope_unique" ON "matka_bid_rules" USING btree ("matka_id","version_id","bid_type","market_session");--> statement-breakpoint
CREATE UNIQUE INDEX "casino_api_providers_key_unique" ON "casino_api_providers" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "casino_categories_tenant_main_slug_unique" ON "casino_categories" USING btree ("tenant_id","main_category","slug");--> statement-breakpoint
CREATE INDEX "casino_categories_tenant_main_order_idx" ON "casino_categories" USING btree ("tenant_id","main_category","order");--> statement-breakpoint
CREATE INDEX "casino_categories_name_idx" ON "casino_categories" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "casino_category_games_unique" ON "casino_category_games" USING btree ("category_id","game_id");--> statement-breakpoint
CREATE INDEX "casino_category_games_game_idx" ON "casino_category_games" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "casino_category_games_order_idx" ON "casino_category_games" USING btree ("category_id","order");--> statement-breakpoint
CREATE UNIQUE INDEX "casino_game_bet_settings_unique" ON "casino_game_bet_settings" USING btree ("tenant_id","game_id","player_id");--> statement-breakpoint
CREATE INDEX "casino_game_bet_settings_game_idx" ON "casino_game_bet_settings" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "casino_game_bet_settings_player_idx" ON "casino_game_bet_settings" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "casino_games_provider_external_unique" ON "casino_games" USING btree ("api_provider_id","external_id");--> statement-breakpoint
CREATE INDEX "casino_games_provider_category_idx" ON "casino_games" USING btree ("api_provider_id","main_category");--> statement-breakpoint
CREATE INDEX "casino_games_vendor_category_idx" ON "casino_games" USING btree ("vendor_id","main_category");--> statement-breakpoint
CREATE INDEX "casino_games_name_idx" ON "casino_games" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "casino_provider_vendor_shares_unique" ON "casino_provider_vendor_shares" USING btree ("tenant_id","provider_id","vendor_id");--> statement-breakpoint
CREATE INDEX "casino_provider_vendor_shares_provider_idx" ON "casino_provider_vendor_shares" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "casino_provider_vendor_shares_vendor_idx" ON "casino_provider_vendor_shares" USING btree ("vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "casino_vendors_slug_unique" ON "casino_vendors" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "casino_vendors_name_idx" ON "casino_vendors" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "vip_tier_casino_games_unique" ON "vip_tier_casino_games" USING btree ("tier_id","game_id");--> statement-breakpoint
CREATE INDEX "vip_tier_casino_games_game_idx" ON "vip_tier_casino_games" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whitelabel_casino_game_settings_unique" ON "whitelabel_casino_game_settings" USING btree ("tenant_id","game_id");--> statement-breakpoint
CREATE INDEX "whitelabel_casino_game_settings_game_idx" ON "whitelabel_casino_game_settings" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wl_casino_game_sa_override_unique" ON "whitelabel_casino_game_super_admin_override" USING btree ("tenant_id","game_id");--> statement-breakpoint
CREATE INDEX "wl_casino_game_sa_override_game_idx" ON "whitelabel_casino_game_super_admin_override" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wl_casino_provider_settings_unique" ON "whitelabel_casino_provider_settings" USING btree ("tenant_id","provider_id");--> statement-breakpoint
CREATE INDEX "wl_casino_provider_settings_provider_idx" ON "whitelabel_casino_provider_settings" USING btree ("provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whitelabel_casino_vendor_settings_unique" ON "whitelabel_casino_vendor_settings" USING btree ("tenant_id","vendor_id");--> statement-breakpoint
CREATE INDEX "whitelabel_casino_vendor_settings_vendor_idx" ON "whitelabel_casino_vendor_settings" USING btree ("vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wl_casino_vendor_sa_override_unique" ON "whitelabel_casino_vendor_super_admin_override" USING btree ("tenant_id","vendor_id");--> statement-breakpoint
CREATE INDEX "wl_casino_vendor_sa_override_vendor_idx" ON "whitelabel_casino_vendor_super_admin_override" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "casino_bets_provider_id_idx" ON "casino_bets" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "casino_bets_bonus_award_id_idx" ON "casino_bets" USING btree ("bonus_award_id");--> statement-breakpoint
CREATE INDEX "casino_bets_tenant_idx" ON "casino_bets" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "casino_bets_whitelabel_idx" ON "casino_bets" USING btree ("whitelabel_id");--> statement-breakpoint
CREATE INDEX "casino_bets_game_idx" ON "casino_bets" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "casino_bets_vendor_idx" ON "casino_bets" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "casino_bets_table_idx" ON "casino_bets" USING btree ("table_id");--> statement-breakpoint
CREATE INDEX "casino_bets_status_idx" ON "casino_bets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "casino_bets_created_idx" ON "casino_bets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "casino_bets_user_status_idx" ON "casino_bets" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "casino_bets_user_transaction_key" ON "casino_bets" USING btree ("user_id","transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_casino_sessions_provider_token_unique" ON "user_casino_sessions" USING btree ("provider_key","token");--> statement-breakpoint
CREATE INDEX "user_casino_sessions_user_idx" ON "user_casino_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_casino_sessions_tenant_idx" ON "user_casino_sessions" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "matka_bets_tenant_idx" ON "matka_bets" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "matka_bets_whitelabel_idx" ON "matka_bets" USING btree ("whitelabel_id");--> statement-breakpoint
CREATE INDEX "matka_bets_matka_idx" ON "matka_bets" USING btree ("matka_id");--> statement-breakpoint
CREATE INDEX "matka_bets_status_idx" ON "matka_bets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "matka_bets_created_idx" ON "matka_bets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "matka_bets_user_status_idx" ON "matka_bets" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "matka_bets_instance_created_idx" ON "matka_bets" USING btree ("instance_id","created_at");--> statement-breakpoint
CREATE INDEX "matka_bets_instance_status_idx" ON "matka_bets" USING btree ("instance_id","status");--> statement-breakpoint
CREATE INDEX "matka_bets_instance_selection_idx" ON "matka_bets" USING btree ("instance_id","selection_key");--> statement-breakpoint
CREATE INDEX "i_matka_activity_instance" ON "matka_activity_logs" USING btree ("instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "u_worli_market_date_side" ON "matka_worli_instances" USING btree ("market_id","run_date","side");--> statement-breakpoint
CREATE INDEX "i_worli_market_status" ON "matka_worli_instances" USING btree ("market_id","status");--> statement-breakpoint
CREATE INDEX "i_worli_close_time" ON "matka_worli_instances" USING btree ("scheduled_close_at_utc");--> statement-breakpoint
CREATE UNIQUE INDEX "matka_results_unique" ON "matka_results" USING btree ("tenant","matka_id","date","type");--> statement-breakpoint
CREATE INDEX "matka_results_matka_date_idx" ON "matka_results" USING btree ("matka_id","date");--> statement-breakpoint
CREATE INDEX "matka_results_created_at_idx" ON "matka_results" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "matka_results_idempotency_idx" ON "matka_results" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "matka_result_schedules_matka_id_idx" ON "matka_result_schedules" USING btree ("matka_id");--> statement-breakpoint
CREATE UNIQUE INDEX "matka_result_schedules_unique" ON "matka_result_schedules" USING btree ("tenant","matka_id","date","type");--> statement-breakpoint
CREATE INDEX "matka_result_schedules_scheduled_at_idx" ON "matka_result_schedules" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "matka_result_schedules_status_idx" ON "matka_result_schedules" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bonus_awards_campaign_idx" ON "bonus_awards" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "bonus_awards_campaign_awarded_idx" ON "bonus_awards" USING btree ("campaign_id","awarded_at");--> statement-breakpoint
CREATE INDEX "bonus_awards_user_idx" ON "bonus_awards" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bonus_campaigns_tenant_idx" ON "bonus_campaigns" USING btree ("tenant");--> statement-breakpoint
CREATE UNIQUE INDEX "bonus_campaigns_id_tenant_unique" ON "bonus_campaigns" USING btree ("id","tenant");--> statement-breakpoint
CREATE INDEX "bonus_codes_campaign_idx" ON "bonus_codes" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bonus_codes_code_unique" ON "bonus_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "bonus_credits_campaign_idx" ON "bonus_credits" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "bonus_credits_user_idx" ON "bonus_credits" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bonus_group_weights_group_idx" ON "bonus_group_weights" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bonus_group_weights_bonus_group_unique" ON "bonus_group_weights" USING btree ("bonus_id","group_id");--> statement-breakpoint
CREATE INDEX "bonus_tiers_campaign_idx" ON "bonus_tiers" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "casino_game_bundles_tenant_idx" ON "casino_game_bundles" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "casino_game_bundles_domain_idx" ON "casino_game_bundles" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "casino_game_bundles_name_tenant_unique" ON "casino_game_bundles" USING btree ("name","tenant");--> statement-breakpoint
CREATE INDEX "game_group_members_member_idx" ON "game_group_members" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_group_members_group_member_unique" ON "game_group_members" USING btree ("group_id","member_id");--> statement-breakpoint
CREATE INDEX "game_groups_tenant_idx" ON "game_groups" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "game_groups_domain_idx" ON "game_groups" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "game_groups_id_tenant_unique" ON "game_groups" USING btree ("id","tenant");--> statement-breakpoint
CREATE INDEX "promotions_tenant_idx" ON "promotions" USING btree ("tenant");--> statement-breakpoint
CREATE UNIQUE INDEX "promotions_id_tenant_unique" ON "promotions" USING btree ("id","tenant");--> statement-breakpoint
CREATE INDEX "agent_commission_config_agent_id_idx" ON "agent_commission_config" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_credentials_tenant_username_key" ON "agent_credentials" USING btree ("tenant_id",lower("username"));--> statement-breakpoint
CREATE INDEX "agent_hierarchy_closure_descendant_id_idx" ON "agent_hierarchy_closure" USING btree ("descendant_id");--> statement-breakpoint
CREATE INDEX "agent_hierarchy_closure_ancestor_id_idx" ON "agent_hierarchy_closure" USING btree ("ancestor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_ledger_commission_unique" ON "agent_ledger" USING btree ("agent_id","domain","period_from","period_to") WHERE line_type = 'COMMISSION';--> statement-breakpoint
CREATE INDEX "agent_settlements_settled_by_agent_id_idx" ON "agent_settlements" USING btree ("settled_by_agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_settlements_agent_period_open_key" ON "agent_settlements" USING btree ("agent_id","period_from","period_to") WHERE status = 'OPEN';--> statement-breakpoint
CREATE INDEX "agent_sharing_config_agent_id_idx" ON "agent_sharing_config" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_wallets_agent_id_idx" ON "agent_wallets" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "admin_ip_allowlist_tenant_idx" ON "admin_ip_allowlist" USING btree ("tenant");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_ip_allowlist_user_cidr_tenant_unique" ON "admin_ip_allowlist" USING btree ("user_id","cidr","tenant");--> statement-breakpoint
CREATE INDEX "referral_attributions_tenant_idx" ON "referral_attributions" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "referral_attributions_referrer_idx" ON "referral_attributions" USING btree ("referrer_id");--> statement-breakpoint
CREATE INDEX "referral_attributions_tier_idx" ON "referral_attributions" USING btree ("tier");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_attributions_referee_unique" ON "referral_attributions" USING btree ("referee_id");--> statement-breakpoint
CREATE INDEX "referral_budgets_tenant_idx" ON "referral_budgets" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "referral_budgets_program_idx" ON "referral_budgets" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "referral_budgets_period_idx" ON "referral_budgets" USING btree ("period_start","period_end");--> statement-breakpoint
CREATE INDEX "referral_clicks_tenant_idx" ON "referral_clicks" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "referral_clicks_link_idx" ON "referral_clicks" USING btree ("link_id");--> statement-breakpoint
CREATE INDEX "referral_clicks_referrer_idx" ON "referral_clicks" USING btree ("referrer_id");--> statement-breakpoint
CREATE INDEX "referral_clicks_clicked_at_idx" ON "referral_clicks" USING btree ("clicked_at");--> statement-breakpoint
CREATE INDEX "referral_coupons_tenant_idx" ON "referral_coupons" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "referral_coupons_rule_idx" ON "referral_coupons" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "referral_coupons_referrer_idx" ON "referral_coupons" USING btree ("referrer_id");--> statement-breakpoint
CREATE INDEX "referral_coupons_referee_idx" ON "referral_coupons" USING btree ("referee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_coupons_code_unique" ON "referral_coupons" USING btree ("coupon_code");--> statement-breakpoint
CREATE INDEX "referral_earnings_tenant_idx" ON "referral_earnings" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "referral_earnings_attribution_idx" ON "referral_earnings" USING btree ("attribution_id");--> statement-breakpoint
CREATE INDEX "referral_earnings_rule_idx" ON "referral_earnings" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "referral_earnings_referrer_idx" ON "referral_earnings" USING btree ("referrer_id");--> statement-breakpoint
CREATE INDEX "referral_earnings_referee_idx" ON "referral_earnings" USING btree ("referee_id");--> statement-breakpoint
CREATE INDEX "referral_links_tenant_idx" ON "referral_links" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "referral_links_agent_id_idx" ON "referral_links" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_links_code_unique" ON "referral_links" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_links_user_tenant_unique" ON "referral_links" USING btree ("user_id","tenant");--> statement-breakpoint
CREATE INDEX "referral_programs_tenant_idx" ON "referral_programs" USING btree ("tenant");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_programs_id_tenant_unique" ON "referral_programs" USING btree ("id","tenant");--> statement-breakpoint
CREATE INDEX "referral_raffle_draws_tenant_idx" ON "referral_raffle_draws" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "referral_raffle_draws_rule_idx" ON "referral_raffle_draws" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "referral_raffle_draws_scheduled_at_idx" ON "referral_raffle_draws" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "referral_raffle_entries_tenant_idx" ON "referral_raffle_entries" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "referral_raffle_entries_rule_idx" ON "referral_raffle_entries" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "referral_raffle_entries_referrer_idx" ON "referral_raffle_entries" USING btree ("referrer_id");--> statement-breakpoint
CREATE INDEX "referral_raffle_entries_referee_idx" ON "referral_raffle_entries" USING btree ("referee_id");--> statement-breakpoint
CREATE INDEX "referral_rules_program_idx" ON "referral_rules" USING btree ("program_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_rules_tenant_rule_type_unique" ON "referral_rules" USING btree ("tenant","rule_type");--> statement-breakpoint
CREATE INDEX "referral_settlements_tenant_idx" ON "referral_settlements" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "referral_settlements_earning_idx" ON "referral_settlements" USING btree ("earning_id");--> statement-breakpoint
CREATE INDEX "referral_settlements_referrer_idx" ON "referral_settlements" USING btree ("referrer_id");--> statement-breakpoint
CREATE INDEX "referral_settlements_status_idx" ON "referral_settlements" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_pages_wl_slug_locale_unique" ON "cms_pages" USING btree ("whitelabel_id","slug","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "welivepay_orders_orderid_unique" ON "welivepay_orders" USING btree ("orderid");--> statement-breakpoint
CREATE INDEX "welivepay_orders_tenant_idx" ON "welivepay_orders" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "welivepay_orders_user_id_idx" ON "welivepay_orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "welivepay_orders_status_idx" ON "welivepay_orders" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "whitelabel_pg_settings_tenant_unique" ON "whitelabel_pg_settings" USING btree ("tenant");--> statement-breakpoint
CREATE UNIQUE INDEX "whitelabel_pg_settings_webhook_token_unique" ON "whitelabel_pg_settings" USING btree ("webhook_token");--> statement-breakpoint
CREATE INDEX "deposit_requests_tenant_idx" ON "deposit_requests" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "deposit_requests_user_id_idx" ON "deposit_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "deposit_requests_status_idx" ON "deposit_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deposit_requests_created_at_idx" ON "deposit_requests" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_requests_id_tenant_unique" ON "deposit_requests" USING btree ("id","tenant");--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_requests_wallet_txn_id_unique" ON "deposit_requests" USING btree ("wallet_txn_id") WHERE wallet_txn_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "whitelabel_payment_methods_tenant_unique" ON "whitelabel_payment_methods" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "user_payout_accounts_approved_by_idx" ON "user_payout_accounts" USING btree ("approved_by");--> statement-breakpoint
CREATE INDEX "user_payout_accounts_tenant_idx" ON "user_payout_accounts" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "user_payout_accounts_user_idx" ON "user_payout_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_payout_accounts_approval_status_idx" ON "user_payout_accounts" USING btree ("approval_status");--> statement-breakpoint
CREATE UNIQUE INDEX "user_payout_accounts_primary_unique" ON "user_payout_accounts" USING btree ("user_id","tenant","is_primary") WHERE "user_payout_accounts"."is_primary";--> statement-breakpoint
CREATE INDEX "withdrawal_requests_wallet_id_idx" ON "withdrawal_requests" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "withdrawal_requests_payout_account_id_idx" ON "withdrawal_requests" USING btree ("payout_account_id");--> statement-breakpoint
CREATE INDEX "withdrawal_requests_tenant_idx" ON "withdrawal_requests" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "withdrawal_requests_user_idx" ON "withdrawal_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "withdrawal_requests_status_idx" ON "withdrawal_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "withdrawal_requests_created_idx" ON "withdrawal_requests" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "casino_likes_user_game_unique" ON "casino_likes" USING btree ("user_id","tenant","game_id");--> statement-breakpoint
CREATE INDEX "casino_likes_tenant_idx" ON "casino_likes" USING btree ("tenant");--> statement-breakpoint
CREATE UNIQUE INDEX "casino_recent_user_game_unique" ON "casino_recent" USING btree ("user_id","tenant","game_id");--> statement-breakpoint
CREATE INDEX "casino_recent_tenant_idx" ON "casino_recent" USING btree ("tenant");--> statement-breakpoint
CREATE UNIQUE INDEX "sports_bookmarks_user_event_unique" ON "sports_bookmarks" USING btree ("user_id","tenant","event_id");--> statement-breakpoint
CREATE INDEX "sports_bookmarks_tenant_idx" ON "sports_bookmarks" USING btree ("tenant");--> statement-breakpoint
CREATE UNIQUE INDEX "sports_recent_user_event_unique" ON "sports_recent" USING btree ("user_id","tenant","event_id");--> statement-breakpoint
CREATE INDEX "sports_recent_tenant_idx" ON "sports_recent" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "sports_recent_created_idx" ON "sports_recent" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "advertisements_wl_idx" ON "advertisements" USING btree ("whitelabel_id");--> statement-breakpoint
CREATE INDEX "advertisements_status_idx" ON "advertisements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "advertisements_order_idx" ON "advertisements" USING btree ("order");--> statement-breakpoint
CREATE INDEX "reporting_agent_rollups_whitelabel_idx" ON "reporting_agent_rollups" USING btree ("whitelabel_id");--> statement-breakpoint
CREATE INDEX "reporting_agent_rollups_agent_idx" ON "reporting_agent_rollups" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "reporting_agent_rollups_period_idx" ON "reporting_agent_rollups" USING btree ("period_from","period_to");--> statement-breakpoint
CREATE INDEX "reporting_agent_rollups_domain_idx" ON "reporting_agent_rollups" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "reporting_agent_rollups_unique" ON "reporting_agent_rollups" USING btree ("tenant","whitelabel_id","agent_id","period_from","period_to","domain");--> statement-breakpoint
CREATE INDEX "reporting_bonus_ledgers_whitelabel_idx" ON "reporting_bonus_ledgers" USING btree ("whitelabel_id");--> statement-breakpoint
CREATE INDEX "reporting_bonus_ledgers_campaign_idx" ON "reporting_bonus_ledgers" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "reporting_bonus_ledgers_date_idx" ON "reporting_bonus_ledgers" USING btree ("ledger_date");--> statement-breakpoint
CREATE UNIQUE INDEX "reporting_bonus_ledgers_unique" ON "reporting_bonus_ledgers" USING btree ("tenant","whitelabel_id","campaign_id","ledger_date");--> statement-breakpoint
CREATE INDEX "reporting_snapshots_whitelabel_idx" ON "reporting_daily_snapshots" USING btree ("whitelabel_id");--> statement-breakpoint
CREATE INDEX "reporting_snapshots_date_idx" ON "reporting_daily_snapshots" USING btree ("snapshot_date");--> statement-breakpoint
CREATE INDEX "reporting_snapshots_domain_idx" ON "reporting_daily_snapshots" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "reporting_snapshots_sport_idx" ON "reporting_daily_snapshots" USING btree ("sport_id");--> statement-breakpoint
CREATE INDEX "reporting_snapshots_league_idx" ON "reporting_daily_snapshots" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "reporting_snapshots_event_idx" ON "reporting_daily_snapshots" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "reporting_snapshots_agent_idx" ON "reporting_daily_snapshots" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "reporting_snapshots_campaign_idx" ON "reporting_daily_snapshots" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "reporting_snapshots_player_idx" ON "reporting_daily_snapshots" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "reporting_export_jobs_tenant_idx" ON "reporting_export_jobs" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "reporting_export_jobs_whitelabel_idx" ON "reporting_export_jobs" USING btree ("whitelabel_id");--> statement-breakpoint
CREATE INDEX "reporting_export_jobs_created_by_idx" ON "reporting_export_jobs" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "reporting_export_jobs_status_idx" ON "reporting_export_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reporting_export_jobs_scheduled_idx" ON "reporting_export_jobs" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "reporting_saved_reports_tenant_idx" ON "reporting_saved_reports" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "reporting_saved_reports_whitelabel_idx" ON "reporting_saved_reports" USING btree ("whitelabel_id");--> statement-breakpoint
CREATE INDEX "reporting_saved_reports_created_by_idx" ON "reporting_saved_reports" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "reporting_saved_reports_type_idx" ON "reporting_saved_reports" USING btree ("report_type");--> statement-breakpoint
CREATE INDEX "reporting_snapshot_events_occurred_idx" ON "reporting_snapshot_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "reporting_snapshot_events_tenant_wl_idx" ON "reporting_snapshot_events" USING btree ("tenant","whitelabel_id","occurred_at");--> statement-breakpoint
CREATE INDEX "reporting_snapshot_events_type_level_idx" ON "reporting_snapshot_events" USING btree ("event_type","level");--> statement-breakpoint
CREATE INDEX "reporting_snapshot_events_run_idx" ON "reporting_snapshot_events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "reporting_snapshot_runs_started_idx" ON "reporting_snapshot_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "reporting_snapshot_runs_trigger_idx" ON "reporting_snapshot_runs" USING btree ("trigger");--> statement-breakpoint
CREATE INDEX "reporting_snapshot_runs_status_idx" ON "reporting_snapshot_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "risk_config_tenant_idx" ON "risk_config" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "risk_config_event_idx" ON "risk_config" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "risk_config_unique" ON "risk_config" USING btree ("whitelabel_id","event_id");--> statement-breakpoint
CREATE INDEX "betting_patterns_tenant_idx" ON "betting_patterns" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "betting_patterns_wl_idx" ON "betting_patterns" USING btree ("whitelabel_id");--> statement-breakpoint
CREATE INDEX "betting_patterns_user_idx" ON "betting_patterns" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "betting_patterns_event_idx" ON "betting_patterns" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "betting_patterns_type_idx" ON "betting_patterns" USING btree ("pattern_type");--> statement-breakpoint
CREATE INDEX "betting_patterns_severity_idx" ON "betting_patterns" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "betting_patterns_status_idx" ON "betting_patterns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "betting_patterns_detected_at_idx" ON "betting_patterns" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX "automation_rules_tenant_idx" ON "automation_rules" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "automation_rules_wl_idx" ON "automation_rules" USING btree ("whitelabel_id");--> statement-breakpoint
CREATE INDEX "automation_rules_event_idx" ON "automation_rules" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "automation_rules_type_idx" ON "automation_rules" USING btree ("rule_type");--> statement-breakpoint
CREATE INDEX "automation_rules_enabled_idx" ON "automation_rules" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "automation_rules_priority_idx" ON "automation_rules" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "agent_credit_alerts_agent_idx" ON "agent_credit_alerts" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_credit_alerts_active_idx" ON "agent_credit_alerts" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "agent_credit_ledger_tenant_idx" ON "agent_credit_ledger" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "agent_credit_ledger_from_entity_idx" ON "agent_credit_ledger" USING btree ("from_entity_type","from_entity_id");--> statement-breakpoint
CREATE INDEX "agent_credit_ledger_to_entity_idx" ON "agent_credit_ledger" USING btree ("to_entity_type","to_entity_id");--> statement-breakpoint
CREATE INDEX "agent_credit_ledger_transaction_type_idx" ON "agent_credit_ledger" USING btree ("transaction_type");--> statement-breakpoint
CREATE INDEX "agent_credit_ledger_created_at_idx" ON "agent_credit_ledger" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "agent_credit_ledger_bet_id_idx" ON "agent_credit_ledger" USING btree ("bet_id");--> statement-breakpoint
CREATE INDEX "agent_credit_ledger_settlement_id_idx" ON "agent_credit_ledger" USING btree ("settlement_id");--> statement-breakpoint
CREATE INDEX "agent_credit_ledger_cashout_id_idx" ON "agent_credit_ledger" USING btree ("cashout_id");--> statement-breakpoint
CREATE INDEX "agent_credit_ledger_created_by_type_idx" ON "agent_credit_ledger" USING btree ("created_by_type");--> statement-breakpoint
CREATE INDEX "agent_player_credits_player_idx" ON "agent_player_credits" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_player_credits_agent_player_key" ON "agent_player_credits" USING btree ("agent_id","player_id");--> statement-breakpoint
CREATE INDEX "notifications_tenant_idx" ON "notifications" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "notifications_user_id_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_agent_id_idx" ON "notifications" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "notifications_whitelabel_id_idx" ON "notifications" USING btree ("whitelabel_id");--> statement-breakpoint
CREATE INDEX "notifications_is_read_idx" ON "notifications" USING btree ("is_read");--> statement-breakpoint
CREATE INDEX "notifications_category_idx" ON "notifications" USING btree ("category");--> statement-breakpoint
CREATE INDEX "notifications_created_at_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "casino_callback_rejections_tenant_idx" ON "casino_callback_rejections" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "casino_callback_rejections_provider_idx" ON "casino_callback_rejections" USING btree ("provider_key");--> statement-breakpoint
CREATE INDEX "casino_callback_rejections_error_code_idx" ON "casino_callback_rejections" USING btree ("error_code");--> statement-breakpoint
CREATE INDEX "casino_callback_rejections_created_idx" ON "casino_callback_rejections" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "casino_callback_rejections_user_idx" ON "casino_callback_rejections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "casino_callback_rejections_round_idx" ON "casino_callback_rejections" USING btree ("round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "casino_callback_idempotency_key" ON "casino_callback_idempotency" USING btree ("provider_key","operation","trans_id");--> statement-breakpoint
CREATE INDEX "casino_callback_idempotency_user_idx" ON "casino_callback_idempotency" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "casino_callback_idempotency_created_idx" ON "casino_callback_idempotency" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_action_proposals_conversation_idx" ON "ai_action_proposals" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "ai_action_proposals_status_idx" ON "ai_action_proposals" USING btree ("tenant","status");--> statement-breakpoint
CREATE INDEX "ai_conversations_tenant_admin_idx" ON "ai_conversations" USING btree ("tenant","admin_user_id");--> statement-breakpoint
CREATE INDEX "ai_conversations_updated_idx" ON "ai_conversations" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "ai_messages_conversation_idx" ON "ai_messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_whitelabel_settings_tenant_key" ON "ai_whitelabel_settings" USING btree ("tenant");