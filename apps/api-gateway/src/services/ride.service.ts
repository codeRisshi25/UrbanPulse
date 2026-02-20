import { Queue } from 'bullmq';
import { QUEUE_NAMES } from 'common';
import logger from '../logger.js';
import prisma from '../utils/db.js';
import type { RideInput } from 'common';

const bullmqConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
} as const;

const rideRequestsQueue = new Queue(QUEUE_NAMES.RIDE_REQUESTS, {
  connection: bullmqConnection,
});

export interface RideResponse {
  success: boolean;
  message: string;
  data?: {
    id: string;
    riderId: string;
    pickupLocation: string;
    dropoffLocation: string;
    status: string;
    createdAt: Date;
  };
}

export const createRide = async (input: RideInput, riderId: string): Promise<RideResponse> => {
  try {
    const { pickupLocation, dropoffLocation } = input;

    // find the rider first then create ride
    const rider = await prisma.rider.findUnique({
      where: { userId: riderId },
    });

    if (!rider) {
      return {
        success: false,
        message: 'Rider not found',
      };
    }

    const result = await prisma.$queryRaw<
      {
        id: string;
        riderId: string;
        pickupLocation: string;
        dropoffLocation: string;
        status: string;
        createdAt: Date;
      }[]
    >`
      INSERT INTO "Trip" ("riderId", "pickupLocation", "dropoffLocation", "status")
      VALUES (
        ${rider.id}, 
        ST_GeomFromText(${`POINT(${pickupLocation[0]} ${pickupLocation[1]})`}, 4326),
        ST_GeomFromText(${`POINT(${dropoffLocation[0]} ${dropoffLocation[1]})`}, 4326),
        'REQUESTED'
      )
      RETURNING 
        id, 
        "riderId", 
        ST_AsText("pickupLocation") as "pickupLocation",
        ST_AsText("dropoffLocation") as "dropoffLocation",
        status, 
        "createdAt"
    `;

    const newRide = result[0];

    // Publish job to ride-requests queue for async processing
    await rideRequestsQueue.add(
      'new-ride',
      {
        tripId: newRide.id,
        riderId: rider.id,
        pickupLng: pickupLocation[0],
        pickupLat: pickupLocation[1],
        dropoffLng: dropoffLocation[0],
        dropoffLat: dropoffLocation[1],
      },
      { jobId: newRide.id },
    );

    logger.info({ tripId: newRide.id }, 'Ride job published to ride-requests queue');

    return {
      success: true,
      message: 'Ride created successfully',
      data: newRide,
    };
  } catch (error) {
    logger.error(error, 'Error creating ride');
    throw new Error('Could not create ride. Please try again.');
  }
};

export const cancelRide = async (userId: string): Promise<RideResponse> => {
  try {
    const riderid = await prisma.rider.findUnique({
      where: {
        userId: userId,
      },
    });

    const ride = await prisma.trip.findFirst({
      where: {
        riderId: riderid?.id,
        status: 'REQUESTED',
      },
    });

    if (!ride) {
      return {
        success: false,
        message: 'No active ride found to cancel',
      };
    }

    await prisma.trip.update({
      where: {
        id: ride.id,
      },
      data: {
        status: 'CANCELLED',
      },
    });

    return {
      success: true,
      message: 'Ride cancelled successfully',
    };
  } catch (error) {
    logger.error(error, 'Error cancelling ride');
    throw new Error('Could not cancel ride. Please try again.');
  }
};
