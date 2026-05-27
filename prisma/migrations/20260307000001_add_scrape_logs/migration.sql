-- CreateTable
CREATE TABLE "scrape_logs" (
    "id" TEXT NOT NULL,
    "festival_id" TEXT,
    "url" TEXT NOT NULL,
    "scraped_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT,
    "status" TEXT NOT NULL,
    "pages_scraped" INTEGER,
    "artists_found" INTEGER,
    "artists_added" INTEGER,
    "lineup_url" TEXT,
    "lineup_pending" BOOLEAN NOT NULL DEFAULT false,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "error_message" TEXT,

    CONSTRAINT "scrape_logs_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "scrape_logs" ADD CONSTRAINT "scrape_logs_festival_id_fkey" FOREIGN KEY ("festival_id") REFERENCES "festivals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
