// Layout overlapping bookings in separate lanes; adjacent intervals share a lane.
function bookingLanes(bookings) {
  const minutes = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const items = bookings.map(b => ({ b, start: minutes(b.startTime), end: Math.max(minutes(b.startTime) + 20, minutes(b.endTime)) })).sort((a,b) => a.start - b.start)
  const clusters = []
  for (const item of items) {
    let cluster = clusters[clusters.length - 1]
    if (!cluster || item.start >= cluster.end) { cluster = { end: item.end, items: [] }; clusters.push(cluster) }
    cluster.items.push(item); cluster.end = Math.max(cluster.end, item.end)
  }
  return clusters.flatMap(cluster => {
    const ends = []
    for (const item of cluster.items) {
      let lane = ends.findIndex(end => end <= item.start)
      if (lane < 0) lane = ends.length
      ends[lane] = item.end; item.lane = lane
    }
    return cluster.items.map(item => ({ ...item.b, lane: item.lane, lanes: ends.length }))
  })
}
module.exports = bookingLanes
