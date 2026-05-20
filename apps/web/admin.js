const owner = {
  token: localStorage.getItem('lucky-owner-token') || 'owner-demo-token',
  bookings: [],
  services: [],
  technicians: [],
  adminView: 'today',
  calendarDate: new Date()
}

const els = {
  tokenInput: document.querySelector('#tokenInput'),
  reloadButton: document.querySelector('#reloadButton'),
  metricGrid: document.querySelector('#metricGrid'),
  bookingList: document.querySelector('#bookingList'),
  adminTabs: [...document.querySelectorAll('.admin-tab')],
  bookingFilters: document.querySelector('#bookingFilters'),
  calendarControls: document.querySelector('#calendarControls'),
  calendarTitle: document.querySelector('#calendarTitle'),
  filterDate: document.querySelector('#filterDate'),
  filterStatus: document.querySelector('#filterStatus'),
  clearFilters: document.querySelector('#clearFilters'),
  prevMonth: document.querySelector('#prevMonth'),
  nextMonth: document.querySelector('#nextMonth'),
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
els.filterDate.value = formatDate(new Date())

function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function money(cents) {
  return `CAD $${Number(cents / 100).toFixed(0)}`
}

function cents(value) {
  return Number(value / 100).toFixed(0)
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
    .reduce((total, item) => total + (item.status === 'COMPLETED' ? item.servicePriceCents : item.depositCents), 0)
  els.metricGrid.innerHTML = `
    <div class="metric"><span class="subtle">Confirmed</span><strong>${confirmed}</strong></div>
    <div class="metric"><span class="subtle">Pending</span><strong>${pending}</strong></div>
    <div class="metric"><span class="subtle">Revenue</span><strong>${money(revenue)}</strong></div>
    <div class="metric"><span class="subtle">Services</span><strong>${owner.services.length}</strong></div>
  `
}

function renderBookings() {
  els.adminTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.adminView === owner.adminView))
  els.bookingFilters.classList.toggle('hidden', owner.adminView === 'today')
  els.calendarControls.classList.toggle('hidden', owner.adminView !== 'calendar')

  if (owner.adminView === 'calendar') {
    renderCalendar()
    return
  }

  const bookings = filteredBookings()
  if (!bookings.length) {
    els.bookingList.innerHTML = '<div class="empty-state"><strong>No bookings found</strong><span>Adjust the date or status filter.</span></div>'
    return
  }
  const grouped = groupByDate(bookings)
  els.bookingList.innerHTML = Object.keys(grouped).sort().map((date) => `
    <section class="booking-date-group">
      <h2>${dateHeading(date)}</h2>
      ${grouped[date].map(renderBookingCard).join('')}
    </section>
  `).join('')
}

function activeStatuses() {
  return ['PENDING_PAYMENT', 'CONFIRMED']
}

function filteredBookings() {
  const status = els.filterStatus.value
  const date = owner.adminView === 'today' ? formatDate(new Date()) : els.filterDate.value
  return owner.bookings
    .filter((booking) => !date || booking.appointmentDate === date)
    .filter((booking) => {
      if (status === 'all') return true
      if (status === 'active') return activeStatuses().includes(booking.status)
      return booking.status === status
    })
    .sort((a, b) => `${a.appointmentDate} ${a.appointmentTime}`.localeCompare(`${b.appointmentDate} ${b.appointmentTime}`))
}

function groupByDate(bookings) {
  return bookings.reduce((groups, booking) => {
    groups[booking.appointmentDate] = groups[booking.appointmentDate] || []
    groups[booking.appointmentDate].push(booking)
    return groups
  }, {})
}

function dateHeading(date) {
  const today = formatDate(new Date())
  return date === today ? `Today · ${date}` : date
}

function renderBookingCard(booking) {
  const needsAttention = activeStatuses().includes(booking.status)
  return `
    <article class="booking-item">
      <img class="booking-image" src="${booking.service.imageUrl}" alt="${booking.service.name}">
      <div class="booking-copy">
        <span class="status ${booking.status}">${statusLabel(booking.status)}</span>
        <h3>${booking.service.name}</h3>
        <p>${booking.appointmentDate} ${booking.appointmentTime}-${booking.appointmentEndTime}</p>
        <p>${booking.technician.name} · ${booking.store.name}</p>
        <p>Deposit ${money(booking.depositCents)} · Final due ${money(booking.finalDueCents)} · ${booking.publicCode}</p>
        ${needsAttention ? '<p class="attention-note">Needs attention until deposit and service completion are settled.</p>' : ''}
      </div>
      <div class="booking-actions">
        <button class="ghost" data-status="COMPLETED" data-booking="${booking.id}" type="button">Complete</button>
        <button class="ghost" data-status="CANCELLED" data-booking="${booking.id}" type="button">Cancel</button>
      </div>
    </article>
  `
}

function renderCalendar() {
  const year = owner.calendarDate.getFullYear()
  const month = owner.calendarDate.getMonth()
  els.calendarTitle.textContent = owner.calendarDate.toLocaleString('en-CA', { month: 'long', year: 'numeric' })
  const first = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const leading = first.getDay()
  const cells = []
  for (let i = 0; i < leading; i += 1) cells.push(null)
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(new Date(year, month, day))
  while (cells.length % 7 !== 0) cells.push(null)

  els.bookingList.innerHTML = `
    <div class="calendar-grid calendar-weekdays">
      ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => `<strong>${day}</strong>`).join('')}
    </div>
    <div class="calendar-grid">
      ${cells.map((date) => renderCalendarCell(date)).join('')}
    </div>
  `
}

function renderCalendarCell(date) {
  if (!date) return '<div class="calendar-cell muted-cell"></div>'
  const key = formatDate(date)
  const status = els.filterStatus.value
  const dayBookings = owner.bookings
    .filter((booking) => booking.appointmentDate === key)
    .filter((booking) => {
      if (status === 'all') return true
      if (status === 'active') return activeStatuses().includes(booking.status)
      return booking.status === status
    })
    .sort((a, b) => a.appointmentTime.localeCompare(b.appointmentTime))
  return `
    <button class="calendar-cell ${key === formatDate(new Date()) ? 'today-cell' : ''}" data-calendar-date="${key}" type="button">
      <span class="calendar-day">${date.getDate()}</span>
      ${dayBookings.slice(0, 4).map((booking) => `
        <span class="calendar-event ${booking.status}">
          ${booking.appointmentTime} ${booking.service.name}
        </span>
      `).join('')}
      ${dayBookings.length > 4 ? `<span class="calendar-more">+${dayBookings.length - 4} more</span>` : ''}
    </button>
  `
}

function renderServices() {
  els.serviceAdminList.innerHTML = owner.services.map((service) => `
    <div class="service-admin-row">
      <div>
        <h3>${service.nameZh}</h3>
        <p>${service.nameEn} · ${service.type} · ${money(service.priceCents)} · ${service.durationMin} min</p>
        <div class="inline-edit">
          <label>
            <span>Price CAD</span>
            <input value="${cents(service.priceCents)}" data-price="${service.id}" inputmode="decimal">
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
  const price = Math.round(Number(document.querySelector(`[data-price="${id}"]`).value) * 100)
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
els.adminTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    owner.adminView = tab.dataset.adminView
    if (owner.adminView === 'today') {
      els.filterDate.value = formatDate(new Date())
      els.filterStatus.value = 'active'
    } else if (owner.adminView === 'all') {
      els.filterDate.value = ''
      els.filterStatus.value = 'active'
    } else if (owner.adminView === 'calendar' && els.filterDate.value) {
      owner.calendarDate = new Date(`${els.filterDate.value}T12:00:00`)
    }
    renderBookings()
  })
})
els.filterDate.addEventListener('change', () => {
  if (owner.adminView === 'calendar' && els.filterDate.value) {
    owner.calendarDate = new Date(`${els.filterDate.value}T12:00:00`)
  }
  renderBookings()
})
els.filterStatus.addEventListener('change', renderBookings)
els.clearFilters.addEventListener('click', () => {
  els.filterDate.value = ''
  els.filterStatus.value = 'active'
  owner.adminView = 'all'
  renderBookings()
})
els.prevMonth.addEventListener('click', () => {
  owner.calendarDate = new Date(owner.calendarDate.getFullYear(), owner.calendarDate.getMonth() - 1, 1)
  renderBookings()
})
els.nextMonth.addEventListener('click', () => {
  owner.calendarDate = new Date(owner.calendarDate.getFullYear(), owner.calendarDate.getMonth() + 1, 1)
  renderBookings()
})
els.saveSchedule.addEventListener('click', () => saveSchedule().catch((error) => toast(error.message)))
els.bookingList.addEventListener('click', (event) => {
  const dateCell = event.target.closest('[data-calendar-date]')
  if (dateCell) {
    owner.adminView = 'all'
    els.filterDate.value = dateCell.dataset.calendarDate
    els.filterStatus.value = 'active'
    renderBookings()
    return
  }
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
