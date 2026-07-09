CREATE TABLE "meal_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"meal_id" integer NOT NULL,
	"food_id" integer NOT NULL,
	"quantity" numeric(8, 3) NOT NULL,
	"write_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "foods" ADD COLUMN "one_off" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_overrides" ADD CONSTRAINT "meal_overrides_meal_id_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_overrides" ADD CONSTRAINT "meal_overrides_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE restrict ON UPDATE no action;