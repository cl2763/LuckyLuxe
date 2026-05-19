const mock = require('./mock-data')

const API_BASE = 'http://127.0.0.1:4000'
const DEMO_USER_ID = 'user-demo'
const STORE_ID = 'store-ontario-01'

function request(path, method = 'GET', data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE}${path}`,
      method,
      data,
      header: { 'content-type': 'application/json' },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data)
        else reject(res.data && res.data.error ? res.data.error : new Error('API request failed'))
      },
      fail: reject
    })
  })
}

function toMiniService(service) {
  return {
    _id: service.id,
    type: service.type,
    category: service.category,
    name: service.name,
    description: service.description,
    price: service.price,
    depositAmount: 50,
    duration: service.durationMin,
    suitableFor: service.suitableFor || '',
    imageLabel: `${service.type} · ${service.category}`,
    image: service.imageUrl,
    process: service.process || [],
    notice: service.notice || [],
    isRecommended: service.sortOrder <= 3,
    sort: service.sortOrder,
    status: service.isActive ? 'active' : 'hidden'
  }
}

function addOnById(id) {
  return mock.addOns.find((item) => item.id === id)
}

function selectedAddOns(ids) {
  return (ids || []).map((id) => {
    const item = addOnById(id)
    return item ? {
      id: item.id,
      name: item.name,
      priceCents: item.price * 100,
      durationMin: item.id === 'reinforce' ? 15 : item.id === 'senior' ? 0 : 30
    } : null
  }).filter(Boolean)
}

async function getServices(type, lang) {
  try {
    const data = await request(`/services?type=${type}&lang=${lang}`)
    return data.services.map(toMiniService)
  } catch (error) {
    return mock.services.filter((item) => item.type === type)
  }
}

async function getService(id, lang) {
  const type = id.indexOf('lash') === 0 ? 'lash' : 'nail'
  const services = await getServices(type, lang)
  return services.find((item) => item._id === id) || mock.findService(id)
}

async function getAvailability(serviceId, date, addOnIds) {
  const extraDurationMin = selectedAddOns(addOnIds).reduce((total, item) => total + item.durationMin, 0)
  try {
    const data = await request(`/availability?storeId=${STORE_ID}&serviceId=${serviceId}&date=${date}&extraDurationMin=${extraDurationMin}`)
    const firstGroup = data.slots && data.slots[0]
    return {
      technician: firstGroup ? firstGroup.technician : null,
      slots: firstGroup ? firstGroup.slots : [],
      durationMin: data.durationMin
    }
  } catch (error) {
    return { technician: { id: 'tech-mia', name: 'Mia Chen' }, slots: mock.timeSlots, durationMin: 120 }
  }
}

async function createBooking(cartItem, remark) {
  const service = cartItem.service
  const appointment = cartItem.appointmentInfo
  const technicianId = appointment.technicianId || 'tech-mia'
  const data = await request('/bookings', 'POST', {
    userId: DEMO_USER_ID,
    storeId: STORE_ID,
    serviceId: cartItem.serviceId,
    technicianId,
    date: appointment.date,
    time: appointment.time,
    addOns: selectedAddOns(appointment.addOns),
    notes: remark || appointment.remark || ''
  })
  return data.booking || {
    service,
    technician: { id: technicianId, name: appointment.technicianName || 'Mia Chen' },
    depositCents: 5000,
    finalDueCents: Math.max(0, service.price * 100 - 5000)
  }
}

async function confirmMockPayment(bookingId) {
  const data = await request('/payments/mock/confirm', 'POST', { bookingId })
  return data.booking
}

module.exports = {
  API_BASE,
  DEMO_USER_ID,
  STORE_ID,
  getServices,
  getService,
  getAvailability,
  createBooking,
  confirmMockPayment
}
