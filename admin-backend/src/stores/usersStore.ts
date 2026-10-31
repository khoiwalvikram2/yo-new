export type User = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  kyc: "unverified" | "pending" | "verified";
  sanctions: boolean;
  segment?: string;
  betAllowed: boolean;
  username?: string;
  active?: boolean;
  sportsBetAllowed?: boolean;
  casinoBetAllowed?: boolean;
  matkaBetAllowed?: boolean;
  bonusAllowed?: boolean;
};
export type Wallet = {
  userId: string;
  currency: string;
  balance: number;
  exposure: number;
  updatedAt: string;
};

const users = new Map<string, User>();
const wallets = new Map<string, Wallet>();

function now() {
  return new Date().toISOString();
}

export function seedUsers() {
  if (users.size) return;
  const demo: User[] = [
    {
      id: "u-100",
      name: "Aditi Sharma",
      email: "aditi@example.com",
      phone: "+91-9000000001",
      kyc: "verified",
      sanctions: false,
      segment: "vip",
      betAllowed: true,
      active: true,
      sportsBetAllowed: true,
      casinoBetAllowed: true,
      matkaBetAllowed: true,
      bonusAllowed: true,
    },
    {
      id: "u-101",
      name: "Ravi Kumar",
      email: "ravi@example.com",
      phone: "+91-9000000002",
      kyc: "pending",
      sanctions: false,
      segment: "standard",
      betAllowed: true,
      active: true,
      sportsBetAllowed: true,
      casinoBetAllowed: true,
      matkaBetAllowed: true,
      bonusAllowed: true,
    },
    {
      id: "u-102",
      name: "Neha Singh",
      email: "neha@example.com",
      phone: "+91-9000000003",
      kyc: "unverified",
      sanctions: false,
      segment: "standard",
      betAllowed: false,
      active: true,
      sportsBetAllowed: false,
      casinoBetAllowed: true,
      matkaBetAllowed: false,
      bonusAllowed: false,
    },
  ];
  demo.forEach((u) => users.set(u.id, u));
  const w: Wallet[] = [
    {
      userId: "u-100",
      currency: "INR",
      balance: 25000,
      exposure: 1200,
      updatedAt: now(),
    },
    {
      userId: "u-101",
      currency: "INR",
      balance: 5400,
      exposure: 0,
      updatedAt: now(),
    },
    {
      userId: "u-102",
      currency: "INR",
      balance: 800,
      exposure: 50,
      updatedAt: now(),
    },
  ];
  w.forEach((x) => wallets.set(x.userId, x));
}

export function listUsers(filter: {
  query?: string;
  kyc?: string;
  segment?: string;
}): User[] {
  const q = (filter.query || "").toLowerCase();
  const arr = Array.from(users.values());
  return arr.filter(
    (u) =>
      (!q ||
        u.id.toLowerCase().includes(q) ||
        (u.phone || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q) ||
        u.name.toLowerCase().includes(q)) &&
      (!filter.kyc || u.kyc === filter.kyc) &&
      (!filter.segment || u.segment === filter.segment)
  );
}

export function getUser(id: string): User | undefined {
  return users.get(id);
}
export function getWallet(userId: string): Wallet | undefined {
  return wallets.get(userId);
}

export function setKyc(id: string, kyc: User["kyc"]): User {
  const u = users.get(id);
  if (!u) throw new Error("User not found");
  u.kyc = kyc;
  users.set(id, u);
  return u;
}
export function setSanctions(id: string, val: boolean): User {
  const u = users.get(id);
  if (!u) throw new Error("User not found");
  u.sanctions = val;
  users.set(id, u);
  return u;
}
export function setBetAllowed(id: string, val: boolean): User {
  const u = users.get(id);
  if (!u) throw new Error("User not found");
  u.betAllowed = val;
  users.set(id, u);
  return u;
}

export function setActive(id: string, val: boolean): User {
  const u = users.get(id);
  if (!u) throw new Error("User not found");
  u.active = val;
  users.set(id, u);
  return u;
}

export function setSportsBetAllowed(id: string, val: boolean): User {
  const u = users.get(id);
  if (!u) throw new Error("User not found");
  u.sportsBetAllowed = val;
  users.set(id, u);
  return u;
}

export function setCasinoBetAllowed(id: string, val: boolean): User {
  const u = users.get(id);
  if (!u) throw new Error("User not found");
  u.casinoBetAllowed = val;
  users.set(id, u);
  return u;
}

export function setMatkaBetAllowed(id: string, val: boolean): User {
  const u = users.get(id);
  if (!u) throw new Error("User not found");
  u.matkaBetAllowed = val;
  users.set(id, u);
  return u;
}

export function setBonusAllowed(id: string, val: boolean): User {
  const u = users.get(id);
  if (!u) throw new Error("User not found");
  u.bonusAllowed = val;
  users.set(id, u);
  return u;
}

export function adjustWallet(userId: string, amount: number): Wallet {
  const w = wallets.get(userId);
  if (!w) throw new Error("Wallet not found");
  w.balance += amount;
  w.updatedAt = now();
  wallets.set(userId, w);
  return w;
}

// Creation helpers for in-memory attributes used by listing
export function createUserMem(user: User): User {
  users.set(user.id, user);
  return user;
}

export function createWalletMem(wallet: Wallet): Wallet {
  wallets.set(wallet.userId, wallet);
  return wallet;
}

