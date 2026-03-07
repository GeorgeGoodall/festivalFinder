-- AlterTable
ALTER TABLE "festival_artists" ADD COLUMN     "day" INTEGER,
ADD COLUMN     "stage" TEXT;

-- AlterTable
ALTER TABLE "festivals" ADD COLUMN     "age_restriction" TEXT,
ADD COLUMN     "camping_details" TEXT,
ADD COLUMN     "social_facebook" TEXT,
ADD COLUMN     "social_instagram" TEXT,
ADD COLUMN     "social_tiktok" TEXT,
ADD COLUMN     "social_x" TEXT;
