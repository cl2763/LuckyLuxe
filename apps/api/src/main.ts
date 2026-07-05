import 'dotenv/config'
import cors from 'cors'
import express, { Request, Response } from 'express'
import { BookingStatus, PaymentProvider, PaymentStatus, PrismaClient, ServiceType } from '@prisma/client'
import { addMinutes, buildSlotStarts, centsToMoney, localDateTime, minutesFromTime, timeFromMinutes, weekdayFromDate } from './time'
import { cancelBookingSchema, createBookingSchema } from './types'

process.env.TZ = process.env.APP_TIMEZONE || 'America/Toronto'

const prisma = new PrismaClient()
const app = express()
const port = Number(process.env.PORT || 4000)
const holdMinutes = Number(process.env.BOOKING_HOLD_MINUTES || 30)
const ownerToken = process.env.OWNER_DEMO_TOKEN || 'owner-demo-token'

app.use(cors())
app.use(express.json())

type ApiErrorCode = 'BAD_REQUEST' | 'NOT_FOUND' | 'SLOT_UNAVAILABLE' | 'UNAUTHORIZED'

class ApiError extends Error {
  status: number
  code: ApiErrorCode

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const addOnCatalog = [
  { id: 'remove', name: '卸甲/卸睫', priceCents: 3000, durationMin: 30 },
  { id: 'reinforce', name: '甲面加固', priceCents: 4000, durationMin: 15 },
  { id: 'senior', name: '指定资深技师', priceCents: 6000, durationMin: 0 },
  { id: 'extend', name: '延长加项时间', priceCents: 5000, durationMin: 30 }
]

function requireOwner(req: Request) {
  const auth = req.header('authorization') || ''
  if (auth !== `Bearer ${ownerToken}`) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Owner token is required.')
  }
}

function parseJsonArray(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    return []
  }
}

function serializeService(service: any, lang = 'zh') {
  return {
    id: service.id,
    type: service.type.toLowerCase(),
    category: service.category,
    name: lang === 'en' ? service.nameEn : service.nameZh,
    nameZh: service.nameZh,
    nameEn: service.nameEn,
    description: lang === 'en' ? service.descriptionEn : service.descriptionZh,
    descriptionZh: service.descriptionZh,
    descriptionEn: service.descriptionEn,
    imageUrl: service.imageUrl,
    price: centsToMoney(service.priceCents),
    priceCents: service.priceCents,
    deposit: centsToMoney(service.depositCents),
    depositCents: service.depositCents,
    durationMin: service.baseDurationMin,
    process: parseJsonArray(service.processJson),
    notice: parseJsonArray(service.noticeJson),
    sortOrder: service.sortOrder,
    isActive: service.isActive
  }
}

function serializeBooking(booking: any, lang = 'zh') {
  return {
    id: booking.id,
    publicCode: booking.publicCode,
    status: booking.status,
    store: booking.store,
    technician: booking.technician,
    service: booking.service ? serializeService(booking.service, lang) : undefined,
    appointmentStart: booking.appointmentStart,
    appointmentEnd: booking.appointmentEnd,
    addOns: parseJsonArray(booking.addOnsJson),
    notes: booking.notes,
    servicePrice: centsToMoney(booking.servicePriceCents),
    servicePriceCents: booking.servicePriceCents,
    deposit: centsToMoney(booking.depositCents),
    depositCents: booking.depositCents,
    finalDue: centsToMoney(booking.finalDueCents),
    finalDueCents: booking.finalDueCents,
    totalDurationMin: booking.totalDurationMin,
    paymentExpiresAt: booking.paymentExpiresAt,
    payments: booking.payments || [],
    createdAt: booking.createdAt,
    cancellationFeeCents: booking.cancellationFeeCents
  }
}

async function expireOldHolds() {
  const expired = await prisma.booking.findMany({
    where: {
      status: BookingStatus.PENDING_PAYMENT,
      paymentExpiresAt: { lt: new Date() }
    },
    select: { id: true, status: true }
  })

  for (const booking of expired) {
    await prisma.$transaction([
      prisma.bookingSlot.deleteMany({ where: { bookingId: booking.id } }),
      prisma.booking.update({
        where: { id: booking.id },
        data: { status: BookingStatus.EXPIRED }
      }),
      prisma.bookingStatusHistory.create({
        data: {
          bookingId: booking.id,
          fromStatus: booking.status,
          toStatus: BookingStatus.EXPIRED,
          note: 'Payment hold expired automatically.'
        }
      })
    ])
  }
}

function publicCode() {
  return `LL${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 90 + 10)}`
}

function totalDuration(serviceType: ServiceType, baseDurationMin: number, addOns: Array<{ durationMin: number }>) {
  const addOnDuration = addOns.reduce((total, item) => total + item.durationMin, 0)
  if (serviceType === ServiceType.LASH) return 120
  return Math.max(120, baseDurationMin) + addOnDuration
}

async function assertBookable(input: ReturnType<typeof createBookingSchema.parse>) {
  const service = await prisma.service.findUnique({ where: { id: input.serviceId } })
  if (!service || !service.isActive) throw new ApiError(404, 'NOT_FOUND', 'Service is not available.')

  const technician = await prisma.technician.findFirst({
    where: {
      id: input.technicianId,
      storeId: input.storeId,
      isActive: true,
      services: { some: { serviceId: input.serviceId } }
    }
  })
  if (!technician) throw new ApiError(404, 'NOT_FOUND', 'Technician cannot perform this service at this store.')

  const weekday = weekdayFromDate(input.date)
  const hour = await prisma.businessHour.findUnique({
    where: { storeId_weekday: { storeId: input.storeId, weekday } }
  })
  if (!hour || hour.isClosed) throw new ApiError(400, 'BAD_REQUEST', 'Store is closed on this date.')

  const schedule = await prisma.technicianSchedule.findUnique({
    where: { technicianId_date: { technicianId: input.technicianId, date: input.date } }
  })
  if (schedule && !schedule.isWorking) throw new ApiError(400, 'BAD_REQUEST', 'Technician is not working on this date.')

  const openTime = schedule?.startTime || hour.openTime
  const closeTime = schedule?.endTime || hour.closeTime
  const durationMin = totalDuration(service.type, service.baseDurationMin, input.addOns)
  const start = localDateTime(input.date, input.time)
  const end = addMinutes(start, durationMin)
  const startMinutes = minutesFromTime(input.time)
  const endMinutes = startMinutes + durationMin

  if (startMinutes < minutesFromTime(openTime) || endMinutes > minutesFromTime(closeTime)) {
    throw new ApiError(400, 'BAD_REQUEST', 'Requested time is outside available working hours.')
  }

  return { service, technician, durationMin, start, end }
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'lucky-luxe-api', time: new Date().toISOString() })
})

app.get('/stores', async (_req, res) => {
  const stores = await prisma.store.findMany({
    where: { isActive: true },
    include: { hours: { orderBy: { weekday: 'asc' } } }
  })
  res.json({ stores })
})

app.get('/services', async (req, res) => {
  const lang = String(req.query.lang || 'zh')
  const type = String(req.query.type || '').toUpperCase()
  const services = await prisma.service.findMany({
    where: {
      isActive: true,
      ...(type ? { type: type as ServiceType } : {})
    },
    orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }]
  })
  res.json({ services: services.map((service) => serializeService(service, lang)) })
})

app.get('/technicians', async (req, res) => {
  const storeId = String(req.query.storeId || '')
  const serviceId = String(req.query.serviceId || '')
  const technicians = await prisma.technician.findMany({
    where: {
      isActive: true,
      ...(storeId ? { storeId } : {}),
      ...(serviceId ? { services: { some: { serviceId } } } : {})
    },
    orderBy: { name: 'asc' }
  })
  res.json({ technicians })
})

app.get('/add-ons', (_req, res) => {
  res.json({ addOns: addOnCatalog })
})

app.get('/availability', async (req, res) => {
  await expireOldHolds()
  const storeId = String(req.query.storeId || '')
  const serviceId = String(req.query.serviceId || '')
  const date = String(req.query.date || '')
  const technicianId = req.query.technicianId ? String(req.query.technicianId) : undefined
  if (!storeId || !serviceId || !date) throw new ApiError(400, 'BAD_REQUEST', 'storeId, serviceId and date are required.')

  const service = await prisma.service.findUnique({ where: { id: serviceId } })
  if (!service) throw new ApiError(404, 'NOT_FOUND', 'Service not found.')

  const weekday = weekdayFromDate(date)
  const hour = await prisma.businessHour.findUnique({ where: { storeId_weekday: { storeId, weekday } } })
  if (!hour || hour.isClosed) return res.json({ date, slots: [] })

  const technicians = await prisma.technician.findMany({
    where: {
      storeId,
      isActive: true,
      ...(technicianId ? { id: technicianId } : {}),
      services: { some: { serviceId } }
    },
    include: { schedules: { where: { date } } }
  })

  const durationMin = totalDuration(service.type, service.baseDurationMin, [])
  const result = []
  for (const tech of technicians) {
    const schedule = tech.schedules[0]
    if (schedule && !schedule.isWorking) continue
    const openTime = schedule?.startTime || hour.openTime
    const closeTime = schedule?.endTime || hour.closeTime
    const dayStart = localDateTime(date, '00:00')
    const dayEnd = addMinutes(dayStart, 24 * 60)
    const occupied = await prisma.bookingSlot.findMany({
      where: { technicianId: tech.id, startsAt: { gte: dayStart, lt: dayEnd } },
      select: { startsAt: true }
    })
    const occupiedKeys = new Set(occupied.map((slot) => slot.startsAt.getTime()))
    const slots = []
    for (let startMin = minutesFromTime(openTime); startMin + durationMin <= minutesFromTime(closeTime); startMin += 30) {
      const time = timeFromMinutes(startMin)
      const start = localDateTime(date, time)
      const required = buildSlotStarts(start, durationMin)
      const isAvailable = required.every((slot) => !occupiedKeys.has(slot.getTime()))
      if (isAvailable) slots.push(time)
    }
    result.push({ technician: tech, slots })
  }

  res.json({ date, durationMin, slots: result })
})

app.post('/bookings', async (req, res) => {
  await expireOldHolds()
  const input = createBookingSchema.parse(req.body)
  const { service, durationMin, start, end } = await assertBookable(input)
  const slots = buildSlotStarts(start, durationMin)
  const addOnTotalCents = input.addOns.reduce((total, item) => total + item.priceCents, 0)
  const servicePriceCents = service.priceCents + addOnTotalCents
  const depositCents = 5000

  try {
    const booking = await prisma.$transaction(async (tx) => {
      const created = await tx.booking.create({
        data: {
          publicCode: publicCode(),
          userId: input.userId,
          storeId: input.storeId,
          technicianId: input.technicianId,
          serviceId: input.serviceId,
          appointmentStart: start,
          appointmentEnd: end,
          addOnsJson: JSON.stringify(input.addOns),
          notes: input.notes,
          servicePriceCents,
          depositCents,
          finalDueCents: servicePriceCents - depositCents,
          totalDurationMin: durationMin,
          paymentExpiresAt: addMinutes(new Date(), holdMinutes)
        }
      })

      await tx.bookingSlot.createMany({
        data: slots.map((slot) => ({
          bookingId: created.id,
          technicianId: input.technicianId,
          startsAt: slot
        }))
      })

      await tx.payment.create({
        data: {
          bookingId: created.id,
          provider: PaymentProvider.MOCK,
          status: PaymentStatus.REQUIRES_PAYMENT,
          amountCents: depositCents,
          currency: 'CAD'
        }
      })

      await tx.bookingStatusHistory.create({
        data: {
          bookingId: created.id,
          toStatus: BookingStatus.PENDING_PAYMENT,
          note: 'Booking hold created pending deposit payment.'
        }
      })

      return tx.booking.findUniqueOrThrow({
        where: { id: created.id },
        include: { service: true, technician: true, store: true, payments: true }
      })
    })

    res.status(201).json({ booking: serializeBooking(booking) })
  } catch (error: any) {
    if (error?.code === 'P2002') {
      throw new ApiError(409, 'SLOT_UNAVAILABLE', 'This technician and time slot was just taken.')
    }
    throw error
  }
})

app.get('/bookings/:id', async (req, res) => {
  const lang = String(req.query.lang || 'zh')
  const booking = await prisma.booking.findUnique({
    where: { id: req.params.id },
    include: { service: true, technician: true, store: true, payments: true, history: true }
  })
  if (!booking) throw new ApiError(404, 'NOT_FOUND', 'Booking not found.')
  res.json({ booking: serializeBooking(booking, lang) })
})

app.post('/payments/mock/confirm', async (req, res) => {
  const bookingId = String(req.body.bookingId || '')
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { payments: true } })
  if (!booking) throw new ApiError(404, 'NOT_FOUND', 'Booking not found.')
  if (booking.status !== BookingStatus.PENDING_PAYMENT) {
    throw new ApiError(400, 'BAD_REQUEST', 'Only pending bookings can be paid.')
  }
  if (booking.paymentExpiresAt && booking.paymentExpiresAt < new Date()) {
    await expireOldHolds()
    throw new ApiError(400, 'BAD_REQUEST', 'Payment hold has expired.')
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.payment.updateMany({
      where: { bookingId, provider: PaymentProvider.MOCK },
      data: {
        status: PaymentStatus.PAID,
        transactionId: `mock_${Date.now()}`
      }
    })
    await tx.bookingStatusHistory.create({
      data: {
        bookingId,
        fromStatus: BookingStatus.PENDING_PAYMENT,
        toStatus: BookingStatus.CONFIRMED,
        note: 'Mock deposit payment confirmed.'
      }
    })
    return tx.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.CONFIRMED },
      include: { service: true, technician: true, store: true, payments: true }
    })
  })

  res.json({ booking: serializeBooking(updated) })
})

app.post('/bookings/:id/cancel', async (req, res) => {
  const input = cancelBookingSchema.parse(req.body)
  const booking = await prisma.booking.findUnique({ where: { id: req.params.id } })
  if (!booking) throw new ApiError(404, 'NOT_FOUND', 'Booking not found.')
  if (![BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED].includes(booking.status)) {
    throw new ApiError(400, 'BAD_REQUEST', 'This booking cannot be cancelled.')
  }

  const hoursBefore = (booking.appointmentStart.getTime() - Date.now()) / 3_600_000
  const cancellationFeeCents = hoursBefore >= 24 ? 0 : Math.floor(booking.depositCents / 2)
  const updated = await prisma.$transaction(async (tx) => {
    await tx.bookingSlot.deleteMany({ where: { bookingId: booking.id } })
    await tx.bookingStatusHistory.create({
      data: {
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: BookingStatus.CANCELLED,
        note: input.reason || (hoursBefore >= 24 ? 'Cancelled outside 24-hour window.' : 'Cancelled within 24-hour window.')
      }
    })
    return tx.booking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.CANCELLED,
        cancelledAt: new Date(),
        cancellationFeeCents
      },
      include: { service: true, technician: true, store: true, payments: true }
    })
  })

  res.json({
    booking: serializeBooking(updated),
    refundPolicy: {
      hoursBefore,
      cancellationFeeCents,
      refundableDepositCents: booking.depositCents - cancellationFeeCents
    }
  })
})

app.get('/admin/bookings', async (req, res) => {
  requireOwner(req)
  const bookings = await prisma.booking.findMany({
    orderBy: { appointmentStart: 'desc' },
    include: { service: true, technician: true, store: true, payments: true }
  })
  res.json({ bookings: bookings.map((booking) => serializeBooking(booking)) })
})

app.patch('/admin/bookings/:id/status', async (req, res) => {
  requireOwner(req)
  const status = String(req.body.status || '') as BookingStatus
  if (!Object.values(BookingStatus).includes(status)) throw new ApiError(400, 'BAD_REQUEST', 'Invalid status.')
  const existing = await prisma.booking.findUnique({ where: { id: req.params.id } })
  if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Booking not found.')

  const booking = await prisma.$transaction(async (tx) => {
    if ([BookingStatus.CANCELLED, BookingStatus.EXPIRED].includes(status)) {
      await tx.bookingSlot.deleteMany({ where: { bookingId: existing.id } })
    }
    await tx.bookingStatusHistory.create({
      data: {
        bookingId: existing.id,
        fromStatus: existing.status,
        toStatus: status,
        note: 'Owner updated booking status.'
      }
    })
    return tx.booking.update({
      where: { id: existing.id },
      data: { status },
      include: { service: true, technician: true, store: true, payments: true }
    })
  })
  res.json({ booking: serializeBooking(booking) })
})

app.get('/admin/services', async (req, res) => {
  requireOwner(req)
  const services = await prisma.service.findMany({ orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }] })
  res.json({ services: services.map((service) => serializeService(service)) })
})

app.patch('/admin/services/:id', async (req, res) => {
  requireOwner(req)
  const allowed = ['nameZh', 'nameEn', 'descriptionZh', 'descriptionEn', 'priceCents', 'baseDurationMin', 'isActive', 'sortOrder']
  const data = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)))
  const service = await prisma.service.update({ where: { id: req.params.id }, data })
  res.json({ service: serializeService(service) })
})

app.get('/admin/technicians', async (req, res) => {
  requireOwner(req)
  const technicians = await prisma.technician.findMany({ include: { services: true, schedules: true } })
  res.json({ technicians })
})

app.patch('/admin/technicians/:id/schedule', async (req, res) => {
  requireOwner(req)
  const date = String(req.body.date || '')
  const startTime = String(req.body.startTime || '10:00')
  const endTime = String(req.body.endTime || '19:00')
  const isWorking = Boolean(req.body.isWorking ?? true)
  if (!date) throw new ApiError(400, 'BAD_REQUEST', 'date is required.')
  const schedule = await prisma.technicianSchedule.upsert({
    where: { technicianId_date: { technicianId: req.params.id, date } },
    update: { startTime, endTime, isWorking },
    create: { technicianId: req.params.id, date, startTime, endTime, isWorking }
  })
  res.json({ schedule })
})

app.use((error: any, _req: Request, res: Response, _next: unknown) => {
  if (error instanceof ApiError) {
    return res.status(error.status).json({ error: { code: error.code, message: error.message } })
  }
  if (error?.name === 'ZodError') {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid request body.', details: error.errors } })
  }
  console.error(error)
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' } })
})

app.listen(port, () => {
  console.log(`Lucky Luxe API running on http://localhost:${port}`)
})
