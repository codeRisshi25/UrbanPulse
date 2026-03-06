import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the logger before importing the module
vi.mock('../logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { validateTransition, isValidTransition } from '../state-machine.js';

describe('Ride State Machine', () => {
    beforeEach(() => vi.clearAllMocks());

    // ─── Valid transitions ─────────────────────────────────────────────────

    it('allows REQUESTED → ACCEPTED', () => {
        expect(() => validateTransition('REQUESTED', 'ACCEPTED')).not.toThrow();
    });

    it('allows REQUESTED → CANCELLED', () => {
        expect(() => validateTransition('REQUESTED', 'CANCELLED')).not.toThrow();
    });

    it('allows ACCEPTED → STARTED', () => {
        expect(() => validateTransition('ACCEPTED', 'STARTED')).not.toThrow();
    });

    it('allows ACCEPTED → CANCELLED', () => {
        expect(() => validateTransition('ACCEPTED', 'CANCELLED')).not.toThrow();
    });

    it('allows STARTED → COMPLETED', () => {
        expect(() => validateTransition('STARTED', 'COMPLETED')).not.toThrow();
    });

    // ─── Invalid transitions ───────────────────────────────────────────────

    it('rejects REQUESTED → STARTED', () => {
        expect(() => validateTransition('REQUESTED', 'STARTED')).toThrow('Invalid ride transition');
    });

    it('rejects REQUESTED → COMPLETED', () => {
        expect(() => validateTransition('REQUESTED', 'COMPLETED')).toThrow('Invalid ride transition');
    });

    it('rejects ACCEPTED → COMPLETED (skip STARTED)', () => {
        expect(() => validateTransition('ACCEPTED', 'COMPLETED')).toThrow('Invalid ride transition');
    });

    it('rejects STARTED → CANCELLED', () => {
        expect(() => validateTransition('STARTED', 'CANCELLED')).toThrow('Invalid ride transition');
    });

    it('rejects COMPLETED → anything', () => {
        expect(() => validateTransition('COMPLETED', 'CANCELLED')).toThrow('Invalid ride transition');
        expect(() => validateTransition('COMPLETED', 'STARTED')).toThrow('Invalid ride transition');
    });

    it('rejects CANCELLED → anything', () => {
        expect(() => validateTransition('CANCELLED', 'REQUESTED')).toThrow('Invalid ride transition');
        expect(() => validateTransition('CANCELLED', 'ACCEPTED')).toThrow('Invalid ride transition');
    });

    // ─── isValidTransition (non-throwing) ──────────────────────────────────

    it('isValidTransition returns true for valid transitions', () => {
        expect(isValidTransition('REQUESTED', 'ACCEPTED')).toBe(true);
        expect(isValidTransition('ACCEPTED', 'STARTED')).toBe(true);
        expect(isValidTransition('STARTED', 'COMPLETED')).toBe(true);
    });

    it('isValidTransition returns false for invalid transitions', () => {
        expect(isValidTransition('REQUESTED', 'STARTED')).toBe(false);
        expect(isValidTransition('COMPLETED', 'CANCELLED')).toBe(false);
        expect(isValidTransition('CANCELLED', 'ACCEPTED')).toBe(false);
    });
});
