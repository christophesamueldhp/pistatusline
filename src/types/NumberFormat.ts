import { z } from 'zod';

export const NUMBER_STYLES = ['precise', 'compact', 'whole'] as const;
export type NumberStyle = (typeof NUMBER_STYLES)[number];

export const NUMBER_KINDS = ['token', 'speed', 'percent', 'memory', 'cost'] as const;
export type NumberKind = (typeof NUMBER_KINDS)[number];

export const NumberFormatSchema = z.object({
    style: z.enum(NUMBER_STYLES).optional(),
    decimals: z.number().int().min(0).max(6).optional()
});
export type NumberFormat = z.infer<typeof NumberFormatSchema>;

export const GlobalNumberFormatSchema = z.object({
    token: NumberFormatSchema.optional(),
    speed: NumberFormatSchema.optional(),
    percent: NumberFormatSchema.optional(),
    memory: NumberFormatSchema.optional(),
    cost: NumberFormatSchema.optional()
});
export type GlobalNumberFormat = z.infer<typeof GlobalNumberFormatSchema>;
