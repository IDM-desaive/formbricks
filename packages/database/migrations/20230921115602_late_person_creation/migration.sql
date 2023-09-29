-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "transPerson" JSONB,
ALTER COLUMN "personId" DROP NOT NULL;
