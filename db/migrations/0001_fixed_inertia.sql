ALTER TABLE "foods" ADD COLUMN "store" text;--> statement-breakpoint
ALTER TABLE "foods" ADD COLUMN "link" text;--> statement-breakpoint
ALTER TABLE "foods" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "foods" ADD COLUMN "serving_grams" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "foods" ADD COLUMN "is_estimated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "foods" ADD COLUMN "purchase_weight" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "foods" ADD COLUMN "price" numeric(8, 2);