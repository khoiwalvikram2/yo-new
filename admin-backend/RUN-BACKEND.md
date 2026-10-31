# Admin backend kaise chalayein (GMAG / GraphQL ke liye)

**Browser me `localhost:4000` "connection refused" isliye aata hai kyunki backend server run nahi ho raha.**

## Steps

1. **Naya terminal kholo** (jahan admin frontend chal raha hai usko band mat karo).

2. **Is folder me aao aur dev server start karo:**
   ```bash
   cd admin-backend
   npm run dev
   ```

3. Jab terminal me dikhe: **"Backend GraphQL server running on http://localhost:XXXX/graphql"** — tab backend chal raha hai. `XXXX` wahi port hai jo `.env` me `PORT` me set hai (default 4000, aapke yahan 4002 ho sakta hai).

4. **Browser me open karo** (port wahi use karo jo terminal me dikha):
   - GMAG game data JSON: **http://localhost:4002/dev/gmag-game-data** (agar PORT=4002 hai)
   - GraphQL: **http://localhost:4002/graphql**

## Zaroori

- **`admin-backend/.env`** me `DATABASE_URL` hona chahiye (PostgreSQL).
- GMAG JSON ke liye same file me ye bhi chahiye: `GMAG_GAME_DATA_URL`, `GMAG_SECRET_KEY`, `GMAG_BRAND_ID` (jaise `shared/.env` me hain).

## Summary

| Terminal 1        | Terminal 2           | Browser URL                        |
|-------------------|----------------------|------------------------------------|
| `admin` → `npm run dev` (Vite, 5174) | `admin-backend` → `npm run dev` (port = PORT in .env, e.g. 4002) | http://localhost:**4002**/dev/gmag-game-data |

Dono servers ek saath chalne chahiye. Backend ka port wahi use karo jo terminal me "Server listening at http://...:PORT" me dikhe.
