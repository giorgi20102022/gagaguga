import { db } from "./db";
import {
  users,
  products,
  dealers,
  branches,
  type User,
  type InsertUser,
  type Product,
  type InsertProduct,
  type Branch,
  type InsertBranch,
  type Dealer,
  type InsertDealer,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { pool } from "./db";
import bcrypt from "bcryptjs";

const PostgresSessionStore = connectPg(session);

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getDealerIdByKey(key: string): Promise<number | undefined>;
  
  // Dealer management
  getAllDealers(): Promise<Dealer[]>;
  getDealerById(id: number): Promise<Dealer | undefined>;
  getDealerByEmail(email: string): Promise<Dealer | undefined>;
  createDealer(dealer: { key: string; name: string; identificationCode: string; email: string; password: string }): Promise<Dealer>;
  updateDealer(id: number, update: Partial<Dealer>): Promise<Dealer>;
  deleteDealerCascade(id: number): Promise<void>;

  // Product management
  getProducts(dealerId: number): Promise<Product[]>;
  getProduct(dealerId: number, id: number): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(dealerId: number, id: number, product: Partial<Product>): Promise<Product>;
  deleteProduct(dealerId: number, id: number): Promise<void>;

  // Branch management (e.g., for Gorgia branches)
  getBranches(dealerId: number): Promise<Branch[]>;
  getBranch(dealerId: number, id: number): Promise<Branch | undefined>;
  createBranch(branch: InsertBranch): Promise<Branch>;
  updateBranch(dealerId: number, id: number, branch: Partial<Branch>): Promise<Branch>;
  deleteBranch(dealerId: number, id: number): Promise<void>;
  
  sessionStore: session.Store;
}

export class DatabaseStorage implements IStorage {
  sessionStore: session.Store;

  constructor() {
    if (process.env.NODE_ENV === "production") {
      this.sessionStore = new PostgresSessionStore({
        pool,
        createTableIfMissing: true,
      });
    } else {
      this.sessionStore = new session.MemoryStore();
    }
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getDealerIdByKey(key: string): Promise<number | undefined> {
    const [dealer] = await db.select().from(dealers).where(eq(dealers.key, key));
    return dealer?.id;
  }

  async getAllDealers(): Promise<Dealer[]> {
    return await db.select().from(dealers);
  }

  async getDealerById(id: number): Promise<Dealer | undefined> {
    const [dealer] = await db.select().from(dealers).where(eq(dealers.id, id));
    return dealer;
  }

  async getDealerByEmail(email: string): Promise<Dealer | undefined> {
    const [dealer] = await db.select().from(dealers).where(eq(dealers.email, email));
    return dealer;
  }

  async createDealer(dealer: { key: string; name: string; identificationCode: string; email: string; password: string }): Promise<Dealer> {
    const [created] = await db.insert(dealers).values(dealer).returning();
    return created;
  }

  async updateDealer(id: number, update: Partial<Dealer>): Promise<Dealer> {
    const [updated] = await db.update(dealers).set(update).where(eq(dealers.id, id)).returning();
    if (!updated) throw new Error("Dealer not found");
    return updated;
  }

  async deleteDealerCascade(id: number): Promise<void> {
    // Delete all products and branches belonging to this dealer, then the dealer
    await db.delete(products).where(eq(products.dealerId, id));
    await db.delete(branches).where(eq(branches.dealerId, id));
    await db.delete(dealers).where(eq(dealers.id, id));
  }

  // Product implementation
  async getProducts(dealerId: number): Promise<Product[]> {
    return await db.select().from(products).where(eq(products.dealerId, dealerId));
  }

  // Branch implementation
  async getBranches(dealerId: number): Promise<Branch[]> {
    return await db.select().from(branches).where(eq(branches.dealerId, dealerId));
  }

  async getBranch(dealerId: number, id: number): Promise<Branch | undefined> {
    const [branch] = await db
      .select()
      .from(branches)
      .where(and(eq(branches.dealerId, dealerId), eq(branches.id, id)));
    return branch;
  }

  async createBranch(insertBranch: InsertBranch): Promise<Branch> {
    const [branch] = await db.insert(branches).values(insertBranch).returning();
    return branch;
  }

  async updateBranch(dealerId: number, id: number, update: Partial<Branch>): Promise<Branch> {
    const [branch] = await db
      .update(branches)
      .set(update)
      .where(and(eq(branches.dealerId, dealerId), eq(branches.id, id)))
      .returning();
    if (!branch) throw new Error("Branch not found");
    return branch;
  }

  async deleteBranch(dealerId: number, id: number): Promise<void> {
    await db.delete(branches).where(and(eq(branches.dealerId, dealerId), eq(branches.id, id)));
  }

  async getProduct(dealerId: number, id: number): Promise<Product | undefined> {
    const [product] = await db
      .select()
      .from(products)
      .where(and(eq(products.dealerId, dealerId), eq(products.id, id)));
    return product;
  }

  async createProduct(insertProduct: InsertProduct): Promise<Product> {
    const [product] = await db.insert(products).values(insertProduct).returning();
    return product;
  }

  async updateProduct(dealerId: number, id: number, update: Partial<Product>): Promise<Product> {
    const [product] = await db
      .update(products)
      .set(update)
      .where(and(eq(products.dealerId, dealerId), eq(products.id, id)))
      .returning();
    if (!product) throw new Error("Product not found");
    return product;
  }

  async deleteProduct(dealerId: number, id: number): Promise<void> {
    await db.delete(products).where(and(eq(products.dealerId, dealerId), eq(products.id, id)));
  }
}

class InMemoryStorage implements IStorage {
  sessionStore: session.Store;
  private usersById = new Map<number, User>();
  private usersByUsername = new Map<string, User>();
  private dealersById = new Map<number, Dealer>();
  private dealersByKey = new Map<string, Dealer>();
  private dealersByEmail = new Map<string, Dealer>();
  private productsByDealerId = new Map<number, Product[]>();
  private branchesByDealerId = new Map<number, Branch[]>();
  private nextUserId = 1;
  private nextDealerId = 1;

  constructor() {
    this.sessionStore = new session.MemoryStore();

    const userPasswordHash = bcrypt.hashSync("Energo123#", 10);
    this.createUser({ username: "demo@example.com", password: userPasswordHash } as InsertUser);
    this.createUser({ username: "info@gorgia.ge", password: userPasswordHash } as InsertUser);

    const dealerPasswordHash = bcrypt.hashSync("Dealer123#", 10);
    void this.createDealer({
      key: "iron",
      name: "Iron+",
      identificationCode: "000000000",
      email: "demo@example.com",
      password: dealerPasswordHash,
    });
    void this.createDealer({
      key: "gorgia",
      name: "Gorgia",
      identificationCode: "000000000",
      email: "info@gorgia.ge",
      password: dealerPasswordHash,
    });
  }

  async getUser(id: number): Promise<User | undefined> {
    return this.usersById.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return this.usersByUsername.get(username);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const record: User = { id: this.nextUserId++, ...insertUser } as User;
    this.usersById.set(record.id, record);
    this.usersByUsername.set(record.username, record);
    return record;
  }

  async getDealerIdByKey(key: string): Promise<number | undefined> {
    return this.dealersByKey.get(key)?.id;
  }

  async getAllDealers(): Promise<Dealer[]> {
    return Array.from(this.dealersById.values());
  }

  async getDealerById(id: number): Promise<Dealer | undefined> {
    return this.dealersById.get(id);
  }

  async getDealerByEmail(email: string): Promise<Dealer | undefined> {
    return this.dealersByEmail.get(email);
  }

  async createDealer(dealer: { key: string; name: string; identificationCode: string; email: string; password: string }): Promise<Dealer> {
    const record: Dealer = {
      id: this.nextDealerId++,
      key: dealer.key,
      name: dealer.name,
      identificationCode: dealer.identificationCode,
      email: dealer.email,
      password: dealer.password,
      createdAt: new Date(),
    } as unknown as Dealer;

    this.dealersById.set(record.id, record);
    this.dealersByKey.set(record.key, record);
    if (record.email) this.dealersByEmail.set(record.email, record);
    return record;
  }

  async updateDealer(id: number, update: Partial<Dealer>): Promise<Dealer> {
    const existing = this.dealersById.get(id);
    if (!existing) throw new Error("Dealer not found");
    const merged = { ...existing, ...update } as Dealer;
    this.dealersById.set(id, merged);
    this.dealersByKey.set(merged.key, merged);
    if (merged.email) this.dealersByEmail.set(merged.email, merged);
    return merged;
  }

  async deleteDealerCascade(id: number): Promise<void> {
    const existing = this.dealersById.get(id);
    if (!existing) return;
    this.dealersById.delete(id);
    this.dealersByKey.delete(existing.key);
    if (existing.email) this.dealersByEmail.delete(existing.email);
    this.productsByDealerId.delete(id);
    this.branchesByDealerId.delete(id);
  }

  async getProducts(dealerId: number): Promise<Product[]> {
    return this.productsByDealerId.get(dealerId) ?? [];
  }

  async getProduct(dealerId: number, id: number): Promise<Product | undefined> {
    const list = this.productsByDealerId.get(dealerId) ?? [];
    return list.find((p) => p.id === id);
  }

  async createProduct(product: InsertProduct): Promise<Product> {
    const dealerId = (product as any).dealerId as number;
    const list = this.productsByDealerId.get(dealerId) ?? [];
    const nextId = list.reduce((m, p) => Math.max(m, p.id), 0) + 1;
    const record = { id: nextId, ...product } as Product;
    list.push(record);
    this.productsByDealerId.set(dealerId, list);
    return record;
  }

  async updateProduct(dealerId: number, id: number, update: Partial<Product>): Promise<Product> {
    const list = this.productsByDealerId.get(dealerId) ?? [];
    const idx = list.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error("Product not found");
    list[idx] = { ...list[idx], ...update } as Product;
    this.productsByDealerId.set(dealerId, list);
    return list[idx];
  }

  async deleteProduct(dealerId: number, id: number): Promise<void> {
    const list = this.productsByDealerId.get(dealerId) ?? [];
    this.productsByDealerId.set(dealerId, list.filter((p) => p.id !== id));
  }

  async getBranches(dealerId: number): Promise<Branch[]> {
    return this.branchesByDealerId.get(dealerId) ?? [];
  }

  async getBranch(dealerId: number, id: number): Promise<Branch | undefined> {
    const list = this.branchesByDealerId.get(dealerId) ?? [];
    return list.find((b) => b.id === id);
  }

  async createBranch(branch: InsertBranch): Promise<Branch> {
    const dealerId = (branch as any).dealerId as number;
    const list = this.branchesByDealerId.get(dealerId) ?? [];
    const nextId = list.reduce((m, b) => Math.max(m, b.id), 0) + 1;
    const record = { id: nextId, ...branch } as Branch;
    list.push(record);
    this.branchesByDealerId.set(dealerId, list);
    return record;
  }

  async updateBranch(dealerId: number, id: number, update: Partial<Branch>): Promise<Branch> {
    const list = this.branchesByDealerId.get(dealerId) ?? [];
    const idx = list.findIndex((b) => b.id === id);
    if (idx === -1) throw new Error("Branch not found");
    list[idx] = { ...list[idx], ...update } as Branch;
    this.branchesByDealerId.set(dealerId, list);
    return list[idx];
  }

  async deleteBranch(dealerId: number, id: number): Promise<void> {
    const list = this.branchesByDealerId.get(dealerId) ?? [];
    this.branchesByDealerId.set(dealerId, list.filter((b) => b.id !== id));
  }
}

 let _storage: IStorage | undefined;
 export function getStorage(): IStorage {
   if (!_storage) _storage = new DatabaseStorage();
   return _storage;
 }
