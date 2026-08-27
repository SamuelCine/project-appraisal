import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  currency: text("currency").notNull(),
  modelJson: text("model_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const newsItems = sqliteTable("news_items", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  keyword: text("keyword").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  domain: text("domain").notNull(),
  language: text("language").notNull(),
  publishedAt: text("published_at").notNull(),
  fetchedAt: text("fetched_at").notNull(),
});
