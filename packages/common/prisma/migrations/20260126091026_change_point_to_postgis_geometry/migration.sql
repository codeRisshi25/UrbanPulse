-- Enable PostGIS extension if not already enabled
CREATE EXTENSION IF NOT EXISTS postgis;

-- Convert Driver location from point to geometry
ALTER TABLE "Driver" 
  ALTER COLUMN "location" TYPE geometry(Point, 4326) 
  USING CASE 
    WHEN "location" IS NOT NULL 
    THEN ST_SetSRID(ST_MakePoint(("location")[0], ("location")[1]), 4326)
    ELSE NULL 
  END;

-- Convert Trip pickupLocation from point to geometry
ALTER TABLE "Trip" 
  ALTER COLUMN "pickupLocation" TYPE geometry(Point, 4326) 
  USING ST_SetSRID(ST_MakePoint(("pickupLocation")[0], ("pickupLocation")[1]), 4326);

-- Convert Trip dropoffLocation from point to geometry
ALTER TABLE "Trip" 
  ALTER COLUMN "dropoffLocation" TYPE geometry(Point, 4326) 
  USING ST_SetSRID(ST_MakePoint(("dropoffLocation")[0], ("dropoffLocation")[1]), 4326);

-- Create spatial indexes for performance
CREATE INDEX IF NOT EXISTS "idx_driver_location" ON "Driver" USING GIST ("location");
CREATE INDEX IF NOT EXISTS "idx_trip_pickup" ON "Trip" USING GIST ("pickupLocation");
CREATE INDEX IF NOT EXISTS "idx_trip_dropoff" ON "Trip" USING GIST ("dropoffLocation");