CREATE INDEX "sports_bets_user_created_idx" ON "sports_bets" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "casino_bets_user_created_idx" ON "casino_bets" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "matka_bets_user_created_idx" ON "matka_bets" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "deposit_requests_user_created_idx" ON "deposit_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "withdrawal_requests_user_created_idx" ON "withdrawal_requests" USING btree ("user_id","created_at");