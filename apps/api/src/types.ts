import { z } from 'zod'

export const addOnSchema = z.object({
  id: z.enum(['remove', 'reinforce', 'senior', 'extend']),
  name: z.string(),
  priceCents: z.number().int().nonnegative(),
  durationMin: z.number().int().nonnegative()
})

export const createBookingSchema = z.object({
  userId: z.string().optional(),
  storeId: z.string(),
  serviceId: z.string(),
  technicianId: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  addOns: z.array(addOnSchema).default([]),
  notes: z.string().max(1000).optional()
})

export const cancelBookingSchema = z.object({
  reason: z.string().max(500).optional()
})
