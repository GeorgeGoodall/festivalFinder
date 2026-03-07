-- AlterEnum
ALTER TYPE "PosterCategory" ADD VALUE 'logo';

-- AlterTable
ALTER TABLE "festivals" ADD COLUMN     "lineup_pending" BOOLEAN NOT NULL DEFAULT false;
