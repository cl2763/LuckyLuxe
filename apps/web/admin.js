const owner = {
  token: localStorage.getItem('lucky-owner-token') || 'owner-demo-token',
  bookings: [],
  services: [],
  technicians: []
}

const els = {
  tokenInput: document.querySelector('#tokenInput'),
  reloadButton: document.querySelector('#reloadButton'),
  metricGrid: document.querySelector('#metricGrid'),
  bookingList: document.querySelector('#bookingList'),
  serviceAdminList: document.querySelector('#serviceAdminList'),
  scheduleTech: document.querySelector('#scheduleTech'),
  scheduleDate: document.querySelector('#scheduleDate'),
  scheduleStart: document.querySelector('#scheduleStart'),
  scheduleEnd: document.querySelector('#scheduleEnd'),
  scheduleWorking: document.querySelector('#scheduleWorking'),
  saveSchedule: document.querySelector('#saveSchedule'),
  toast: document.querySelector('#toast')
}

els.tokenInput.value = owner.token
els.scheduleDate.value = formatDate(new Date())

function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function money(cents) {
  return `CAD $${Number(cents / 100).toFixed(0)}`
}

function toast(message) {
  els.toast.textContent = message
  els.toast.classList.add('show')
  setTimeout(() => els.toast.classList.remove('show'), 2200)
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${owner.token}`,
      ...(options.headers || {})
    },
    ...options
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error?.message || 'Request failed')
  return data
}

function statusLabel(status) {
  const labels = {
    PENDING_PAYMENT: 'Pending',
    CONFIRMED: 'Confirmed',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
    EXPIRED: 'Expired'
  }
  return labels[status] || status
}

async function loadAll() {
  owner.token = els.tokenInput.value.trim()
  localStorage.setItem('lucky-owner-token', owner.token)
  const [bookingData, serviceData, techData] = await Promise.all([
    request('/admin/bookings'),
    request('/admin/services'),
    request('/admin/technicians')
  ])
  owner.bookings = bookingData.bookings
  owner.services = serviceData.services
  owner.technicians = techData.technicians
  render()
}

function render() {
  renderMetrics()
  renderBookings()
  renderServices()
  renderTechnicians()
}

function renderMetrics() {
  const confirmed = owner.bookings.filter((item) => item.status === 'CONFIRMED').length
  const pending = owner.bookings.filter((item) => item.status === 'PENDING_PAYMENT').length
  const revenue = owner.bookings
    .filter((item) => ['CONFIRMED', 'COMPLETED'].includes(item.status))
    .reduce((total, item) => total + item.depositCents, 0)
  els.metricGrid.innerHTML = `
    <div class="metric"><span class="subtle">Confirmed</span><strong>${confirmed}</strong></div>
    <div class="metric"><span class="subtle">Pending</span><strong>${pending}</strong></div>
    <div class="metric"><span class="subtle">Deposit Revenue</span><strong>${money(revenue)}</strong></div>
    <div class="metric"><span class="subtle">Services</span><strong>${owner.services.length}</strong></div>
  `
}

function renderBookings() {
  if (!owner.bookings.length) {
    els.bookingList.innerHTML = '<div class="empty-state"><strong>No bookings yet</strong><span>Create one from the customer app.</span></div>'
    return
  }
  els.bookingList.innerHTML = owner.bookings.map((booking) => `
    <article class="booking-item">
      <img class="booking-image" src="${booking.service.imageUrl}" alt="${booking.service.name}">
      <div class="booking-copy">
        <span class="status ${booking.status}">${statusLabel(booking.status)}</span>
        <h3>${booking.service.name}</h3>
        <p>${booking.appointmentDate} ${booking.appointmentTime}-${booking.appointmentEndTime}</p>
        <p>${booking.technician.name} · ${booking.store.name}</p>
        <p>Deposit ${money(booking.depositCents)} · Final due ${money(booking.finalDueCents)} · ${booking.publicCode}</p>
      </div>
      <div class="booking-actions">
        <button class="ghost" data-status="COMPLETED" data-booking="${booking.id}" type="button">Complete</button>
        <button class="ghost" data-status="CANCELLED" data-booking="${booking.id}" type="button">Cancel</button>
      </div>
    </article>
  `).join('')
}

function renderServices() {
  els.serviceAdminList.innerHTML = owner.services.map((service) => `
    <div class="service-admin-row">
      <div>
        <h3>${service.nameZh}</h3>
        <p>${service.nameEn} · ${service.type} · ${money(service.priceCents)} · ${service.durationMin} min</p>
        <div class="inline-edit">
          <label>
            <span>Price cents</span>
            <input value="${service.priceCents}" data-price="${service.id}">
          </label>
          <label>
            <span>Duration min</span>
            <input value="${service.durationMin}" data-duration="${service.id}">
          </label>
          <button class="primary slim" data-save-service="${service.id}" type="button">Save</button>
        </div>
      </div>
      <span class="status ${service.isActive ? 'CONFIRMED' : 'CANCELLED'}">${service.isActive ? 'Active' : 'Hidden'}</span>
    </div>
  `).join('')
}

function renderTechnicians() {
  els.scheduleTech.innerHTML = owner.technicians.map((tech) => `
    <option value="${tech.id}">${tech.name} · ${tech.title}</option>
  `).join('')
}

async function updateBookingStatus(id, status) {
  await request(`/admin/bookings/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
  })
  toast(`Booking marked ${status.toLowerCase()}.`)
  await loadAll()
}

async function saveService(id) {
  const price = Number(document.querySelector(`[data-price="${id}"]`).value)
  const duration = Number(document.querySelector(`[data-duration="${id}"]`).value)
  await request(`/admin/services/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ priceCents: price, baseDurationMin: duration })
  })
  toast('Service saved.')
  await loadAll()
}

async function saveSchedule() {
  const techId = els.scheduleTech.value
  await request(`/admin/technicians/${techId}/schedule`, {
    method: 'PATCH',
    body: JSON.stringify({
      date: els.scheduleDate.value,
      startTime: els.scheduleStart.value,
      endTime: els.scheduleEnd.value,
      isWorking: els.scheduleWorking.checked
    })
  })
  toast('Schedule saved.')
}

els.reloadButton.addEventListener('click', () => loadAll().catch((error) => toast(error.message)))
els.saveSchedule.addEventListener('click', () => saveSchedule().catch((error) => toast(error.message)))
els.bookingList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-booking]')
  if (!button) return
  updateBookingStatus(button.dataset.booking, button.dataset.status).catch((error) => toast(error.message))
})
els.serviceAdminList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-save-service]')
  if (!button) return
  saveService(button.dataset.saveService).catch((error) => toast(error.message))
})

loadAll().catch((error) => toast(error.message))
