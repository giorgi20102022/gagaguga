import { pgTable, text, serial, boolean, jsonb, integer, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const dealers = pgTable("dealers", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  identificationCode: varchar("identification_code", { length: 32 }).notNull(),
  email: text("email").unique(),
  whatsappNumber: text("whatsapp_number"),
  sendToRda: boolean("send_to_rda").default(false),
  password: text("password"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    dealerId: integer("dealer_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    price: integer("price").notNull(), // stored in cents/base units
    category: text("category").notNull(),
    imageUrl: text("image_url"),
    stock: integer("stock").notNull().default(0),
    discountPrice: integer("discount_price"),
    discountPercentage: integer("discount_percentage"),
    discountExpiry: timestamp("discount_expiry"),
  },
  (table) => ({
    dealerNameUnique: uniqueIndex("products_dealer_id_name_unique").on(
      table.dealerId,
      table.name,
    ),
  }),
);

export const branches = pgTable(
  "branches",
  {
    id: serial("id").primaryKey(),
    dealerId: integer("dealer_id").notNull(),
    name: text("name").notNull(),
    branch_email: text("branch_email"), // Nullable email
    whatsapp_number: text("whatsapp_number"), // Nullable WhatsApp number
    send_to_rda: boolean("send_to_rda").default(false), // Notification toggle
  },
  (table) => ({
    dealerNameUnique: uniqueIndex("branches_dealer_id_name_unique").on(
      table.dealerId,
      table.name,
    ),
  }),
);
export const upload_sessions = pgTable(
  "upload_sessions",
  {
    id: serial("id").primaryKey(),
    dealerId: integer("dealer_id").notNull(),
    fileName: text("file_name"),
    status: text("status").default("pending"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
);

export type UploadSession = typeof upload_sessions.$inferSelect;

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertProductSchema = createInsertSchema(products).omit({
  id: true,
});

export const insertBranchSchema = createInsertSchema(branches).omit({
  id: true,
});

export const insertDealerSchema = createInsertSchema(dealers).omit({
  id: true,
  createdAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Branch = typeof branches.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type InsertBranch = z.infer<typeof insertBranchSchema>;
export type Dealer = typeof dealers.$inferSelect;
export type InsertDealer = z.infer<typeof insertDealerSchema>;
