-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- AlterTable: add otp, fare, distance to Trip
ALTER TABLE "Trip" ADD COLUMN "otp" TEXT,
ADD COLUMN "fare" DOUBLE PRECISION,
ADD COLUMN "distance" DOUBLE PRECISION;

-- CreateTable: RideOffer
CREATE TABLE "RideOffer" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RideOffer_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "RideOffer" ADD CONSTRAINT "RideOffer_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideOffer" ADD CONSTRAINT "RideOffer_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "RideOffer_tripId_idx" ON "RideOffer"("tripId");
CREATE INDEX "RideOffer_driverId_idx" ON "RideOffer"("driverId");
