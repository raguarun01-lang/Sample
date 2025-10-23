import React, { useEffect, useMemo, useRef, useState } from 'react';

/*
  TimeFilterApp: React conversion of the provided jQuery scheduling script
  - Timezone dropdown with live time previews
  - Monthly calendar with disabled days (past days, holidays, unavailable days, per-day booking cap)
  - Time slot generation honoring availability windows, booked slots, min notice, and interval
  - Booking confirmation and delete flows via fetch() API calls
*/

// US Federal Holidays subset from the original script
const US_HOLIDAYS = new Set([
  '2024-12-25','2025-01-01','2025-01-20','2025-02-17','2025-05-26','2025-06-19','2025-07-04','2025-09-01','2025-10-13','2025-11-11','2025-11-27','2025-12-25','2026-01-01','2026-01-19','2026-02-16','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-10-12','2026-11-11','2026-11-26','2026-12-25','2027-01-01','2027-01-18','2027-02-15','2027-05-31','2027-06-18','2027-07-05','2027-09-06','2027-10-11','2027-11-11','2027-11-25','2027-12-24','2027-12-31','2028-01-17','2028-02-21','2028-05-29','2028-06-19','2028-07-04','2028-09-04','2028-10-09','2028-11-10','2028-11-23','2028-12-25','2029-01-01','2029-01-15','2029-02-19','2029-05-28','2029-06-19','2029-07-04','2029-09-03','2029-10-08','2029-11-12','2029-11-22','2029-12-25','2030-01-01','2030-01-21','2030-02-18','2030-05-27','2030-06-19','2030-07-04','2030-09-02','2030-10-14','2030-11-11','2030-11-28','2030-12-25'
]);

const DEFAULT_AVAILABLE_TIMES = {"weektime_limits_appointment_timezone":"Mon 08:00-16:00,Tue 08:00-16:00,Wed 08:00-16:00,Thu 08:00-16:00,Fri 08:00-16:00,Sat 08:00-16:00","time_zone_app":"America/Chicago","id":"216","buyer":"Freedom Solar Power","refund_range":"7","budgetcaps_d":"0.00","budgetcaps_w":"0.00","budgetcaps_m":"0.00","isprepaid":"1","total_d":"0.00","total_w":"0.00","total_m":"2100.00","total_qtd_amount":"2100.00","total_qtd_leadcount":"6","balance":"-13507.75","weektime_limits":"","invoice_by":"0","invoice_name":"Freedom Solar Power","email":"maricruz@freedomsolarpower.com","timezone":"America/Chicago","isactive":"1","stripe_email":"maricruz@freedomsolarpower.com","stripe_id":"cus_AlsijuTPklnC5t","external_status":"{}","isbigbuyer":"1","invoice_duedate":"0","csvemail":"","isapi":"0","apikey":"","salesperson":"648","auto_charge":"1","auto_charge_low":"100.00","auto_charge_to":"1000.00","ac_id":"2617","ltvalue":"2726250.00","avgvalue":"26992.57","monthly_budget":"0.00","bgroup":"1","buyer_created":"2017-06-15 13:16:52","test_budget":"0.00","contact_name":"Amy","invoice_attach_list":"0","auto_invoice_on":"0","refund_not_allowed":"","b_qbucket_min":"0","return_rate":"","refund_notify":"0","isuccessperson":"644","financial_targets":"0.00","invoice_attach_credit_list":"0","auto_invoice_on_day":"0","budgetcap_group":"{}","dynamic_rule2_buyer":"0","b_pabucket_min":"0","invoice_dont_show_state":"0","is_tos_accepted":"1","is_enphase_exclusive":"1","is_price_change_accepted":"1","invoice_address":"4801 Freidrich Ln Ste 100","invoice_city":"Austin","invoice_state":"TX","invoice_zip":"78744","invoice_contact":"Sherren","tiers":"Megawatt","api_lead_status":"0","isppsbuyer":"0","pps_price_per_sale":"0.00","pps_number_of_sale":"0","pps_lead_count_cap":"0","pps_action":"0","turned_off_on":null,"enlighten_id":"0"};

const DEFAULT_TIMEZONES = [
  { name: 'Pacific Time - US & Canada', zone: 'America/Los_Angeles' },
  { name: 'Central Time - US & Canada', zone: 'America/Chicago' },
  { name: 'Eastern Time - US & Canada', zone: 'America/New_York' },
  { name: 'Mountain Time - US & Canada', zone: 'America/Denver' },
];

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_LONG = [
  'January','February','March','April','May','June','July','August','September','October','November','December'
];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateYYYYMMDD(date) {
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  return `${y}-${m}-${d}`;
}

function parseTimeLabelToDate(baseDate, label) {
  // label example: "1:15 PM"
  const [hh, rest] = label.split(':');
  const [mm, period] = rest.split(' ');
  let h = parseInt(hh, 10);
  const m = parseInt(mm, 10);
  if (period === 'PM' && h !== 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;
  const dt = new Date(baseDate);
  dt.setHours(h, m, 0, 0);
  return dt;
}

function formatTimeLabel(date) {
  let h = date.getHours();
  const m = date.getMinutes();
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m === 0 ? '00' : pad2(m)} ${period}`;
}

function roundUpToNearest(date, minutes) {
  const d = new Date(date);
  const ms = minutes * 60 * 1000;
  const rounded = new Date(Math.ceil(d.getTime() / ms) * ms);
  rounded.setSeconds(0, 0);
  return rounded;
}

function getTimeZoneAbbrev(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date());
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    return tzPart ? tzPart.value : '';
  } catch (e) {
    return '';
  }
}

function useTicker(ms = 1000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function parseWeektimeLimits(limitsStr) {
  // Returns map: { Mon: [{start:'08:00', end:'16:00'}], ... }
  const map = { Sun: [], Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [] };
  if (!limitsStr) return map;
  const items = limitsStr.split(',');
  items.forEach(item => {
    const [day, timeRange] = item.trim().split(' ');
    if (!day) return;
    const [start, end] = (timeRange || '').split('-');
    if (typeof start === 'string' && typeof end === 'string') {
      map[day] = map[day] || [];
      map[day].push({ start, end });
    } else {
      map[day] = map[day] || [];
      map[day].push({ start: '', end: '' }); // full-day block marker from legacy
    }
  });
  return map;
}

function isWithinAnyWindow(slotStart, slotEnd, windows, dateLocal) {
  if (!windows || windows.length === 0) return false;
  for (const w of windows) {
    if (!w.start && !w.end) return false; // legacy full-day block means no availability
    const [sh, sm] = w.start.split(':').map(Number);
    const [eh, em] = w.end.split(':').map(Number);
    const winStart = new Date(dateLocal);
    winStart.setHours(sh, sm, 0, 0);
    const winEnd = new Date(dateLocal);
    winEnd.setHours(eh, em, 0, 0);
    if (slotStart >= winStart && slotEnd <= winEnd) {
      return true;
    }
  }
  return false;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function computeBookingCountByDate(bookedData) {
  const counts = new Map();
  if (!Array.isArray(bookedData)) return counts;
  for (const b of bookedData) {
    const key = b.booking_date; // expecting YYYY-MM-DD
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

export default function TimeFilterApp({
  phpTimeZone = 'America/Chicago',
  timeZones = DEFAULT_TIMEZONES,
  availableTimes = DEFAULT_AVAILABLE_TIMES,
  bookedData = [],
  perDayLimit = 3,
  minNoticeHours: minNoticeApp = 24,
  defaultIntervalMinutes = 30,
  defaultBufferMinutes = 15,
  apiSaveUrl = '/admin/isr/time_filter_app_save',
  apiDeleteUrl = '/admin/isr/delete_booking',
  initialBid,
  initialLeadId,
  initialScheduleHrs,
}) {
  useTicker(1000); // re-render once a second for live clocks in timezone options

  const [selectedTimeZone, setSelectedTimeZone] = useState(phpTimeZone);
  const [intervalMinutes, setIntervalMinutes] = useState(defaultIntervalMinutes);
  const [bufferMinutes] = useState(defaultBufferMinutes);

  const [selectedDate, setSelectedDate] = useState(null); // 'YYYY-MM-DD'
  const [generatedSlots, setGeneratedSlots] = useState([]);
  const [selectedTimeLabel, setSelectedTimeLabel] = useState(null);

  const [isLoading, setIsLoading] = useState(false);
  const [alertMessage, setAlertMessage] = useState(null);

  const [modalConfirmOpen, setModalConfirmOpen] = useState(false);
  const [modalDeleteOpen, setModalDeleteOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null); // { id, lead_id }

  const [bid, setBid] = useState(initialBid || '');
  const [leadId, setLeadId] = useState(initialLeadId || '');
  const [scheduleHrs, setScheduleHrs] = useState(initialScheduleHrs || '');

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const bidEl = document.getElementById('bid');
    const leadEl = document.getElementById('lead_id');
    const schEl = document.getElementById('scheduleHrs');
    if (!initialBid && bidEl && bidEl.value) setBid(bidEl.value);
    if (!initialLeadId && leadEl && leadEl.value) setLeadId(leadEl.value);
    if (!initialScheduleHrs && schEl && schEl.value) setScheduleHrs(schEl.value);
  }, [initialBid, initialLeadId, initialScheduleHrs]);

  const availabilityByDay = useMemo(() => parseWeektimeLimits(availableTimes.weektime_limits_appointment_timezone), [availableTimes]);
  const bookingCountByDate = useMemo(() => computeBookingCountByDate(bookedData), [bookedData]);

  const now = new Date();
  const [currentMonth, setCurrentMonth] = useState(now.getMonth());
  const [currentYear, setCurrentYear] = useState(now.getFullYear());

  const calendarRef = useRef(null);

  useEffect(() => {
    if (!selectedDate) return;
    const slots = generateTimeSlots(selectedDate);
    setGeneratedSlots(slots);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, intervalMinutes, selectedTimeZone, minNoticeApp, availabilityByDay, bookedData]);

  function generateTimeSlots(dateYMD) {
    const slots = [];
    const dayDateLocal = new Date(`${dateYMD}T00:00:00`);
    const dayName = DAYS_SHORT[dayDateLocal.getDay()];

    const windows = availabilityByDay[dayName] || [];
    if (!windows || windows.length === 0) return slots;

    const startOfDay = new Date(dayDateLocal);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(dayDateLocal);
    endOfDay.setHours(23, 59, 0, 0);

    const minNoticeMs = Number(minNoticeApp) * 60 * 60 * 1000;
    const futureTime = new Date(now.getTime() + (isNaN(minNoticeMs) ? 0 : minNoticeMs));

    let cursor = new Date(startOfDay);
    if (sameDay(now, dayDateLocal) && futureTime > cursor) {
      cursor = roundUpToNearest(futureTime, bufferMinutes);
    }

    while (cursor <= endOfDay) {
      const slotStart = new Date(cursor);
      const slotEnd = new Date(slotStart);
      slotEnd.setMinutes(slotEnd.getMinutes() + Number(intervalMinutes));

      const withinWindow = isWithinAnyWindow(slotStart, slotEnd, windows, dayDateLocal);

      let conflictsBooked = false;
      if (!conflictsBooked && Array.isArray(bookedData) && bookedData.length > 0) {
        for (const b of bookedData) {
          if (b.booking_date !== dateYMD) continue;
          const bStart = parseTimeLabelToDate(dayDateLocal, b.booking_slot);
          const bEnd = new Date(bStart);
          bEnd.setMinutes(bEnd.getMinutes() + Number(intervalMinutes));
          const overlaps = Math.max(0, Math.min(slotEnd.getTime(), bEnd.getTime()) - Math.max(slotStart.getTime(), bStart.getTime())) > 0;
          if (overlaps) { conflictsBooked = true; break; }
        }
      }

      if (withinWindow && !conflictsBooked && (!sameDay(now, dayDateLocal) || slotStart >= futureTime)) {
        slots.push(formatTimeLabel(slotStart));
      }

      cursor.setMinutes(cursor.getMinutes() + Number(bufferMinutes));
    }

    return slots;
  }

  function formatDateForHeader(dateYMD) {
    const [y, m, d] = dateYMD.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const opts = { day: '2-digit', month: 'long', year: 'numeric' };
    return date.toLocaleDateString('en-US', opts);
  }

  function isDateDisabled(y, m, d) {
    const date = new Date(y, m, d);
    const ymd = `${y}-${pad2(m + 1)}-${pad2(d)}`;

    if (US_HOLIDAYS.has(ymd)) return true;
    if (date < new Date(new Date().setHours(0, 0, 0, 0))) return true;

    const dayName = DAYS_SHORT[date.getDay()];
    const windows = availabilityByDay[dayName] || [];
    if (!windows || windows.length === 0) return true;

    const fullDayBlocked = windows.some(w => !w.start && !w.end);
    if (fullDayBlocked) return true;

    const count = bookingCountByDate.get(ymd) || 0;
    if (Number(count) >= Number(perDayLimit)) return true;

    return false;
  }

  function onDayClick(ymd) {
    setSelectedDate(ymd);
    setSelectedTimeLabel(null);
  }

  function renderCalendarGrid() {
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    const cells = [];
    const dayHeaders = DAYS_SHORT.map(d => (
      <div key={`head-${d}`} className="day-header">{d}</div>
    ));
    for (let i = 0; i < firstDay; i++) cells.push(<div key={`pad-${i}`} className="day" />);

    for (let day = 1; day <= daysInMonth; day++) {
      const ymd = `${currentYear}-${pad2(currentMonth + 1)}-${pad2(day)}`;
      const classes = ['day'];
      const isToday = sameDay(new Date(), new Date(currentYear, currentMonth, day));
      if (isToday) classes.push('current-day');
      const disabled = isDateDisabled(currentYear, currentMonth, day);
      if (disabled) classes.push('disabled');
      if (selectedDate === ymd) classes.push('active');

      cells.push(
        <div
          key={`day-${day}`}
          className={classes.join(' ')}
          data-date={ymd}
          onClick={() => !disabled && onDayClick(ymd)}
          role="button"
          tabIndex={disabled ? -1 : 0}
        >
          {day}
        </div>
      );
    }

    return (
      <div className="calendar" ref={calendarRef}>
        {dayHeaders}
        {cells}
      </div>
    );
  }

  function onPrevMonth() {
    const today = new Date();
    const viewingIsCurrent = currentMonth === today.getMonth() && currentYear === today.getFullYear();
    if (viewingIsCurrent) return;
    let m = currentMonth - 1;
    let y = currentYear;
    if (m < 0) { m = 11; y -= 1; }
    setCurrentMonth(m);
    setCurrentYear(y);
  }

  function onNextMonth() {
    const today = new Date();
    const limitMonth = (today.getMonth() + 2) % 12;
    const limitYear = today.getFullYear() + Math.floor((today.getMonth() + 2) / 12);
    if (currentYear > limitYear || (currentYear === limitYear && currentMonth >= limitMonth)) return;
    let m = currentMonth + 1;
    let y = currentYear;
    if (m > 11) { m = 0; y += 1; }
    setCurrentMonth(m);
    setCurrentYear(y);
  }

  async function confirmBooking() {
    if (!selectedDate || !selectedTimeLabel) return;
    setIsLoading(true);
    setAlertMessage(null);
    try {
      const payload = {
        date: selectedDate,
        bid: bid,
        lead_id: leadId,
        schedule_hrs: scheduleHrs,
        timeZoneOnly: selectedTimeZone,
        time: selectedTimeLabel,
      };
      const res = await fetch(apiSaveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: new URLSearchParams(payload).toString(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAlertMessage('Your time slot has been saved successfully!');
      setModalConfirmOpen(false);
      // Reload to reflect booking count/slots if host expects it
      if (typeof window !== 'undefined') {
        setTimeout(() => window.location.reload(), 250);
      }
    } catch (e) {
      setAlertMessage(`An error occurred: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setIsLoading(true);
    setAlertMessage(null);
    try {
      const res = await fetch(apiDeleteUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: new URLSearchParams({ id: pendingDelete.id, lead_id: pendingDelete.lead_id }).toString(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setModalDeleteOpen(false);
      setPendingDelete(null);
      if (typeof window !== 'undefined') {
        setTimeout(() => window.location.reload(), 250);
      }
    } catch (e) {
      setAlertMessage(`Error occurred while deleting the booking: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  }

  const liveTimeOptions = useMemo(() => {
    const nowDt = new Date();
    return timeZones.map(tz => {
      const dateStr = nowDt.toLocaleDateString('en-US', { timeZone: tz.zone });
      const timeStr = nowDt.toLocaleTimeString('en-US', { timeZone: tz.zone });
      const abbr = getTimeZoneAbbrev(tz.zone);
      return {
        value: tz.zone,
        label: `${tz.name} (${dateStr} ${timeStr} ${abbr || ''})`,
      };
    });
  }, [timeZones]);

  const selectedDateHeader = selectedDate ? `${formatDateForHeader(selectedDate)}` : '';

  return (
    <div className="time-filter-app">
      {isLoading && (
        <div id="loader-wrapper" className="loader-overlay" aria-live="polite">
          Loading...
        </div>
      )}

      {alertMessage && (
        <div id="alertContainer" className="alert alert-success" role="alert">
          {alertMessage}
        </div>
      )}

      <div className="controls">
        <label htmlFor="time-zone-select">Time zone</label>
        <select
          id="time-zone-select"
          value={selectedTimeZone}
          onChange={(e) => {
            setSelectedTimeZone(e.target.value);
            setSelectedTimeLabel(null);
            if (selectedDate) setGeneratedSlots(generateTimeSlots(selectedDate));
          }}
        >
          {liveTimeOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <label htmlFor="interval-select">Interval (minutes)</label>
        <select
          id="interval-select"
          value={intervalMinutes}
          onChange={(e) => setIntervalMinutes(Number(e.target.value))}
        >
          {[15, 20, 30, 45, 60].map(v => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </div>

      <div className="calendar-header">
        <button id="prev-month" onClick={onPrevMonth} aria-label="Previous month">Prev</button>
        <div id="calendar-title">{MONTHS_LONG[currentMonth]} {currentYear}</div>
        <button id="next-month" onClick={onNextMonth} aria-label="Next month">Next</button>
      </div>

      {renderCalendarGrid()}

      <div id="time-slots" style={{ display: selectedDate ? 'block' : 'none' }}>
        <div className="date_mont_time">{selectedDate ? selectedDateHeader : ''}</div>
        <div id="no-data" style={{ display: generatedSlots.length === 0 ? 'block' : 'none' }}>
          {selectedDate && generatedSlots.length === 0 ? (
            <div className="no-slots">No available time slots for this day.</div>
          ) : null}
        </div>
        <div id="slots-container" className="slots-container" style={{ maxHeight: 300, overflowY: 'auto' }}>
          {generatedSlots.map(slot => (
            <div
              key={slot}
              className={`time-slot list-group-item list-group-item-action${selectedTimeLabel === slot ? ' active' : ''}`}
              data-time={slot}
              onClick={() => {
                setSelectedTimeLabel(slot);
                setModalConfirmOpen(true);
              }}
            >
              {slot}
            </div>
          ))}
        </div>
      </div>

      {modalConfirmOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-body">
              {selectedDate && selectedTimeLabel ? (
                <>Do you want to book the slot on {formatDateForHeader(selectedDate)} at {selectedTimeLabel} in the {getTimeZoneAbbrev(selectedTimeZone)} timezone?</>
              ) : null}
            </div>
            <div className="modal-footer">
              <button id="confirmButton" onClick={confirmBooking}>Confirm</button>
              <button onClick={() => setModalConfirmOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {modalDeleteOpen && (
        <div id="dateModal1" className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-body">Are you sure you want to delete the booking?</div>
            <div className="modal-footer">
              <button id="DeleteButton" onClick={confirmDelete}>Delete</button>
              <button onClick={() => setModalDeleteOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Optional helpers to open delete modal from parent list items
export function openDeleteModalHelper(setModalDeleteOpen, setPendingDelete, id, lead_id) {
  setPendingDelete({ id, lead_id });
  setModalDeleteOpen(true);
}
