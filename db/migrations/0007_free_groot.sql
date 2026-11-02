CREATE TABLE "replaced_writes" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"meal_id" integer NOT NULL,
	"batch_id" uuid,
	"replaced_batch_id" uuid,
	"food_ids" integer[] NOT NULL,
	"rows" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "replaced_writes" ADD CONSTRAINT "replaced_writes_meal_id_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meals"("id") ON DELETE cascade ON UPDATE no action;