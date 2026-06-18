CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foods" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"serving_desc" text NOT NULL,
	"kcal" integer NOT NULL,
	"protein_g" numeric(6, 2) NOT NULL,
	"carbs_g" numeric(6, 2) NOT NULL,
	"fat_g" numeric(6, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "log_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"meal_id" integer,
	"food_id" integer NOT NULL,
	"quantity" numeric(8, 3) NOT NULL,
	"kcal" integer NOT NULL,
	"protein_g" numeric(6, 2) NOT NULL,
	"carbs_g" numeric(6, 2) NOT NULL,
	"fat_g" numeric(6, 2) NOT NULL,
	"source" text NOT NULL,
	"write_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"meal_id" integer NOT NULL,
	"food_id" integer NOT NULL,
	"quantity" numeric(8, 3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_status" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"meal_id" integer NOT NULL,
	"status" text NOT NULL,
	"write_batch_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_status_date_meal_unique" UNIQUE("date","meal_id")
);
--> statement-breakpoint
CREATE TABLE "meals" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"time_hint" text
);
--> statement-breakpoint
CREATE TABLE "memory_facts" (
	"id" serial PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"height_cm" integer NOT NULL,
	"weight_lb" numeric(6, 2) NOT NULL,
	"age" integer NOT NULL,
	"sex" text NOT NULL,
	"body_fat_pct" numeric(4, 1),
	"goal_weight_lb" numeric(6, 2),
	"goal_date" date,
	"activity_level" text,
	"target_kcal" integer NOT NULL,
	"target_protein_g" integer NOT NULL,
	"target_carbs_g" integer NOT NULL,
	"target_fat_g" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weigh_ins" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"weight_lb" numeric(6, 2) NOT NULL,
	"note" text,
	CONSTRAINT "weigh_ins_date_unique" UNIQUE("date")
);
--> statement-breakpoint
ALTER TABLE "log_entries" ADD CONSTRAINT "log_entries_meal_id_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_entries" ADD CONSTRAINT "log_entries_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_meal_id_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_status" ADD CONSTRAINT "meal_status_meal_id_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meals"("id") ON DELETE cascade ON UPDATE no action;