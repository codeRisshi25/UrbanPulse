import prisma from '../utils/db.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import { generateToken } from '../utils/jwt.js';
import logger from '../logger.js';
import type { RegistrationInput, LoginInput } from 'common';
import type { Prisma } from '@prisma/client';

export interface AuthResponse {
  success: boolean;
  message: string;
  data?: {
    token: string;
    user: {
      id: string;
      name: string | null;
      number: string;
      role: 'driver' | 'rider';
      createdAt: Date;
    };
  };
}

export const registerUser = async (input: RegistrationInput): Promise<AuthResponse> => {
  try {
    const { name, number, password, role } = input;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { number },
    });

    if (existingUser) {
      return {
        success: false,
        message: 'User with this phone number already exists',
      };
    }

    // Hash the password
    const hashedPassword = await hashPassword(password);

    // Create user in transaction to ensure role-specific record is also created
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Create the base user
      const user = await tx.user.create({
        data: {
          name,
          number,
          password: hashedPassword,
        },
      });

      // Create role-specific record
      if (role === 'driver') {
        await tx.driver.create({
          data: {
            userId: user.id,
            isActive: false,
          },
        });
      } else {
        await tx.rider.create({
          data: {
            userId: user.id,
          },
        });
      }

      return user;
    });

    // Generate JWT token
    const token = generateToken({
      userId: result.id,
      number: result.number,
      role: role,
    });

    logger.info({ userId: result.id, role }, 'User registered successfully');

    return {
      success: true,
      message: 'User registered successfully',
      data: {
        token,
        user: {
          id: result.id,
          name: result.name,
          number: result.number,
          role: role,
          createdAt: result.createdAt,
        },
      },
    };
  } catch (error) {
    logger.error(error, 'Error during user registration');
    throw new Error('Registration failed. Please try again.');
  }
};

/**
 * Login an existing user
 */
export const loginUser = async (input: LoginInput): Promise<AuthResponse> => {
  try {
    const { number, password } = input;

    // Find user by phone number
    const user = await prisma.user.findUnique({
      where: { number },
      include: {
        driver: true,
        rider: true,
      },
    });

    if (!user) {
      return {
        success: false,
        message: 'Invalid credentials',
      };
    }

    // Verify password
    const isPasswordValid = await comparePassword(password, user.password);

    if (!isPasswordValid) {
      return {
        success: false,
        message: 'Invalid credentials',
      };
    }

    // Determine user role
    const role = user.driver ? 'driver' : 'rider';

    // Generate JWT token
    const token = generateToken({
      userId: user.id,
      number: user.number,
      role: role,
    });

    logger.info({ userId: user.id, role }, 'User logged in successfully');

    return {
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user.id,
          name: user.name,
          number: user.number,
          role: role,
          createdAt: user.createdAt,
        },
      },
    };
  } catch (error) {
    logger.error(error, 'Error during user login');
    throw new Error('Login failed. Please try again.');
  }
};

export const getUserProfile = async (userId: string) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        driver: true,
        rider: true,
      },
    });

    if (!user) {
      return null;
    }

    const role = user.driver ? 'driver' : 'rider';

    return {
      id: user.id,
      name: user.name,
      number: user.number,
      role: role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  } catch (error) {
    logger.error(error, 'Error fetching user profile');
    throw new Error('Failed to fetch user profile');
  }
};
