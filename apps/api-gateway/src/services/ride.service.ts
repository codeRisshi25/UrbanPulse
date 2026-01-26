import logger from '../logger.js';
import prisma from '../utils/db.js';
import type { RideInput } from 'common';

export interface RideResponse {
  success: boolean;
  message: string;
  data?: {
    id: string;
    riderId: string;
    pickupLocation: any;
    dropoffLocation: any;
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

    // const newRide = await (prisma as any).trip.create({
    //   data: {
    //     riderId: rider.id,
    //     pickupLocation: `POINT(${pickupLocation[0]} ${pickupLocation[1]})` as any,
    //     dropoffLocation: `POINT(${dropoffLocation[0]} ${dropoffLocation[1]})` as any,
    //     status: 'REQUESTED',
    //   },
    // });

    const result = await prisma.$queryRaw<
      {
        id: string;
        riderId: string;
        pickupLocation: any;
        dropoffLocation: any;
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
  RETURNING id, "riderId", "pickupLocation", "dropoffLocation", status, "createdAt"
`;

    const newRide = result[0];

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
