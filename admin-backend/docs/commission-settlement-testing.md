# Commission Settlement – Testing (e.g. on Saturday)

Commission settlement is **week-wise, Monday 00:00 IST → next Monday 00:00 IST**. On Saturday the current week is still **OPEN**, so you only see **Pay** for **past closed weeks** (e.g. last week) that are **CLOSED_UNSETTLED**.

---

## Option 1: Test with last week (no code change)

1. **Ensure you have**
   - At least one COMMISSION agent (parent) with a COMMISSION sub-agent.
   - Some commission data for **last week** (e.g. 17 Feb–24 Feb IST).  
     If there’s no data, run commission backfill for that period:
     ```bash
     cd admin-backend
     # Backfill last week (adjust dates to last Monday–Monday IST)
     npm run backfill:commission
     # When prompted, use from = last Monday, to = this Monday (e.g. 2025-02-17, 2025-02-24)
     ```

2. **In the app**
   - Log in as the **parent commission agent**.
   - Open **Commission Dashboard**.
   - In **Sub-Agent Commission**, that sub-agent should show **Total Pending**.
   - Click **Pay** → you should see a tab for the **closed week** (e.g. 17 Feb – 24 Feb) with domain breakdown and **View Bet** / **Pay** flow.

3. **If “Pay” is disabled**  
   Pending commission is 0 for that sub-agent. Either:
   - Run backfill for last week for that tenant/agent, or  
   - Use Option 2 to force the previous week to appear as the one to settle.

---

## Option 2: Override “current” date (test any day as if it’s next Monday)

So that the system treats **next Monday** as “today”, the **previous** week becomes **CLOSED_UNSETTLED** and you can test **Pay** even on Saturday.

1. **Set env in `admin-backend/.env`:**
   ```env
   # Use next Monday (IST). Replace with the actual next Monday date.
   COMMISSION_CYCLE_NOW_OVERRIDE=2025-03-03
   ```
   Use a **Monday** date in `YYYY-MM-DD` (or full ISO string).  
   Example: if today is Saturday 1 Mar 2025, use `2025-03-03`.

2. **Restart admin-backend** so the env is picked up.

3. **Ensure commission data exists for the week that will become “last closed”**  
   With override `2025-03-03`, “current” cycle = 24 Feb–3 Mar. So the week **17 Feb–24 Feb** is the closed week. Run backfill for 17–24 Feb if needed.

4. **In the app**
   - Commission Dashboard → **Pay** for a sub-agent.
   - You should see the **17 Feb – 24 Feb** (or similar) tab as **CLOSED_UNSETTLED** and can complete settlement.

5. **After testing, remove or comment out** `COMMISSION_CYCLE_NOW_OVERRIDE` and restart.  
   **Do not use this in production.**

---

## Quick checklist

- [ ] COMMISSION parent + COMMISSION sub-agent exist.
- [ ] Commission accrual/backfill run for the **closed** week you want to pay.
- [ ] (Optional) `COMMISSION_CYCLE_NOW_OVERRIDE` set to next Monday and backend restarted.
- [ ] Pay modal shows at least one week tab with amount and **Pay** enabled.
- [ ] After Pay, amount matches readiness; payout appears in Commission History.
