const SUPABASE_URL = "https://ynebefrxndpmegdlgnvc.supabase.co"; // e.g. https://xyzcompany.supabase.co
const SUPABASE_ANON_KEY = "sb_publishable_HrQJWZ27IlogHw7XMgOr6Q_oXKmb5vF";

const state = {
  currentMonth: startOfMonth(new Date()),
  selectedDate: "",
  selectedSlot: "",
  availabilityByDate: new Map(),
  loadedMonths: new Set(),
  todayISO: dateToISO(new Date())
};

const monthLabel = document.getElementById("monthLabel");
const calendarGrid = document.getElementById("calendarGrid");
const prevMonthBtn = document.getElementById("prevMonthBtn");
const nextMonthBtn = document.getElementById("nextMonthBtn");

const selectedDateText = document.getElementById("selectedDateText");
const selectedDateHelper = document.getElementById("selectedDateHelper");
const selectedDateDisplay = document.getElementById("selectedDateDisplay");

const slotOptions = document.getElementById("slotOptions");
const slotHelper = document.getElementById("slotHelper");

const bookingForm = document.getElementById("bookingForm");
const submitBtn = document.getElementById("submitBtn");
const formMessage = document.getElementById("formMessage");

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  await loadAvailabilityForMonth(state.currentMonth);
  autoSelectFirstAvailableDate();
  renderCalendar();
  updateSelectedDateUI();
  renderSlotOptions();
}

function bindEvents() {
  prevMonthBtn.addEventListener("click", async () => {
    state.currentMonth = addMonths(state.currentMonth, -1);
    await loadAvailabilityForMonth(state.currentMonth);
    renderCalendar();
  });

  nextMonthBtn.addEventListener("click", async () => {
    state.currentMonth = addMonths(state.currentMonth, 1);
    await loadAvailabilityForMonth(state.currentMonth);
    renderCalendar();
  });

  bookingForm.addEventListener("submit", submitBooking);
}

async function loadAvailabilityForMonth(monthDate, forceReload = false) {
  const { startISO, endISO, cacheKey } = getMonthBounds(monthDate);

  if (!forceReload && state.loadedMonths.has(cacheKey)) {
    return;
  }

  try {
    const rows = await fetchSupabaseJson("/rest/v1/rpc/get_public_availability", {
      method: "POST",
      body: JSON.stringify({
        start_date: startISO,
        end_date: endISO
      })
    });

    rows.forEach((row) => {
      state.availabilityByDate.set(row.booking_date, {
        booking_date: row.booking_date,
        day_status: row.day_status,
        am_available: Boolean(row.am_available),
        pm_available: Boolean(row.pm_available),
        whole_day_available: Boolean(row.whole_day_available)
      });
    });

    state.loadedMonths.add(cacheKey);
  } catch (error) {
    showMessage(error.message || "Could not load availability.", "error");
  }
}

function renderCalendar() {
  const year = state.currentMonth.getFullYear();
  const month = state.currentMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const firstWeekday = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  monthLabel.textContent = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric"
  }).format(firstDay);

  const parts = [];

  for (let i = 0; i < firstWeekday; i += 1) {
    parts.push('<div class="calendar-empty"></div>');
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    const iso = dateToISO(date);
    const availability = getAvailabilityForDate(iso);
    const isPast = iso < state.todayISO;
    const isFull = availability.day_status === "full";
    const isSelected = state.selectedDate === iso;

    let statusClass = "available";
    let statusText = "OPEN";

    if (isPast) {
      statusClass = "past";
      statusText = "PAST";
    } else if (availability.day_status === "partial") {
      statusClass = "partial";
      statusText = "PARTIAL";
    } else if (availability.day_status === "full") {
      statusClass = "full";
      statusText = "FULL";
    }

    const selectedClass = isSelected ? " selected" : "";
    const disabledAttr = isPast || isFull ? "disabled" : "";

    parts.push(`
      <button
        type="button"
        class="calendar-day ${statusClass}${selectedClass}"
        data-date="${iso}"
        ${disabledAttr}
      >
        <span class="day-number">${day}</span>
        <span class="day-state">${statusText}</span>
      </button>
    `);
  }

  calendarGrid.innerHTML = parts.join("");

  calendarGrid.querySelectorAll(".calendar-day").forEach((button) => {
    button.addEventListener("click", () => {
      const iso = button.getAttribute("data-date");
      selectDate(iso);
    });
  });
}

function selectDate(iso) {
  const availability = getAvailabilityForDate(iso);

  if (iso < state.todayISO || availability.day_status === "full") {
    return;
  }

  state.selectedDate = iso;

  if (!isSlotStillAvailable(state.selectedSlot, availability)) {
    state.selectedSlot = "";
  }

  renderCalendar();
  updateSelectedDateUI();
  renderSlotOptions();
  clearMessage();
}

function updateSelectedDateUI() {
  if (!state.selectedDate) {
    selectedDateText.textContent = "No date selected";
    selectedDateDisplay.value = "";
    selectedDateHelper.textContent = "Click an available date to continue.";
    return;
  }

  const availability = getAvailabilityForDate(state.selectedDate);

  selectedDateText.textContent = formatLongDate(state.selectedDate);
  selectedDateDisplay.value = formatLongDate(state.selectedDate);

  if (availability.day_status === "available") {
    selectedDateHelper.textContent = "This date is fully available. Morning, Evening, and Whole Day can be chosen.";
  } else if (availability.day_status === "partial") {
    if (availability.am_available && !availability.pm_available) {
      selectedDateHelper.textContent = "This date is partially booked. Only Morning is available.";
    } else if (!availability.am_available && availability.pm_available) {
      selectedDateHelper.textContent = "This date is partially booked. Only Evening is available.";
    } else {
      selectedDateHelper.textContent = "This date is partially booked. Whole Day is no longer available.";
    }
  } else {
    selectedDateHelper.textContent = "This date is fully booked.";
  }
}

function renderSlotOptions() {
  if (!state.selectedDate) {
    slotOptions.innerHTML = "";
    slotHelper.textContent = "Select a date first to see available time options.";
    return;
  }

  const availability = getAvailabilityForDate(state.selectedDate);

  if (availability.day_status === "full") {
    state.selectedSlot = "";
    slotOptions.innerHTML = "";
    slotHelper.textContent = "This date is fully booked.";
    return;
  }

  const options = [
    {
      value: "am",
      label: "Morning",
      time: "8:00 AM – 5:00 PM",
      available: availability.am_available
    },
    {
      value: "pm",
      label: "Evening",
      time: "8:00 PM – 5:00 AM",
      available: availability.pm_available
    },
    {
      value: "whole_day",
      label: "Whole Day",
      time: "Available only when both halves are free",
      available: availability.whole_day_available
    }
  ].filter((option) => option.available);

  if (!options.some((option) => option.value === state.selectedSlot)) {
    state.selectedSlot = "";
  }

  slotOptions.innerHTML = options.map((option) => {
    const checked = state.selectedSlot === option.value ? "checked" : "";

    return `
      <label class="slot-card">
        <input type="radio" name="slotType" value="${option.value}" ${checked} />
        <span class="slot-label">
          <strong>${escapeHtml(option.label)}</strong>
          <span>${escapeHtml(option.time)}</span>
        </span>
      </label>
    `;
  }).join("");

  slotOptions.querySelectorAll('input[name="slotType"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      state.selectedSlot = radio.value;
    });
  });

  if (availability.day_status === "available") {
    slotHelper.textContent = "All booking options are available for this date.";
  } else if (availability.am_available && !availability.pm_available) {
    slotHelper.textContent = "Morning is the only available option for this date.";
  } else if (!availability.am_available && availability.pm_available) {
    slotHelper.textContent = "Evening is the only available option for this date.";
  } else {
    slotHelper.textContent = "Whole Day is no longer available for this date.";
  }
}

async function submitBooking(event) {
  event.preventDefault();
  clearMessage();

  if (document.getElementById("website").value.trim()) {
    return;
  }

  const payload = collectFormData();
  const validationError = validateForm(payload);

  if (validationError) {
    showMessage(validationError, "error");
    return;
  }

  setLoading(true);

  try {
    const rows = await fetchSupabaseJson("/rest/v1/rpc/create_public_booking", {
      method: "POST",
      body: JSON.stringify({
        p_customer_name: payload.customerName,
        p_contact_number: payload.contactNumber,
        p_booking_date: payload.bookingDate,
        p_slot_type: payload.slotType,
        p_notes: payload.notes || ""
      })
    });

    const created = Array.isArray(rows) ? rows[0] : rows;
    const reference = created?.booking_reference;

    if (!reference) {
      throw new Error("Booking was saved, but no reference was returned.");
    }

    showMessage(
      `Booking submitted. Reference: ${reference}. Redirecting to your live status page...`,
      "success"
    );

    setTimeout(() => {
      window.location.href =
        `./status.html?ref=${encodeURIComponent(reference)}&phone=${encodeURIComponent(payload.contactNumber)}`;
    }, 900);
  } catch (error) {
    showMessage(error.message || "Booking could not be submitted.", "error");
  } finally {
    setLoading(false);
  }
}
function collectFormData() {
  return {
    customerName: document.getElementById("customerName").value.trim(),
    contactNumber: document.getElementById("contactNumber").value.trim(),
    bookingDate: state.selectedDate,
    slotType: state.selectedSlot,
    notes: document.getElementById("notes").value.trim()
  };
}

function validateForm(data) {
  if (!data.customerName || data.customerName.length < 2) {
    return "Please enter your name.";
  }

  if (!data.contactNumber || !/^[0-9+()\-\s]{7,20}$/.test(data.contactNumber)) {
    return "Please enter a valid contact number.";
  }

  if (!data.bookingDate) {
    return "Please choose a date from the calendar.";
  }

  if (data.bookingDate < state.todayISO) {
    return "Past dates are not allowed.";
  }

  const availability = getAvailabilityForDate(data.bookingDate);

  if (availability.day_status === "full") {
    return "This date is already fully booked.";
  }

  if (!data.slotType) {
    return "Please choose Morning, Evening, or Whole Day.";
  }

  if (!isSlotStillAvailable(data.slotType, availability)) {
    return "That booking option is no longer available for the selected date.";
  }

  return "";
}

function isSlotStillAvailable(slot, availability) {
  if (!slot) return false;
  if (slot === "am") return availability.am_available;
  if (slot === "pm") return availability.pm_available;
  if (slot === "whole_day") return availability.whole_day_available;
  return false;
}

function getAvailabilityForDate(iso) {
  return state.availabilityByDate.get(iso) || {
    booking_date: iso,
    day_status: "available",
    am_available: true,
    pm_available: true,
    whole_day_available: true
  };
}

function autoSelectFirstAvailableDate() {
  const year = state.currentMonth.getFullYear();
  const month = state.currentMonth.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();

  for (let day = 1; day <= lastDay; day += 1) {
    const iso = dateToISO(new Date(year, month, day));
    const availability = getAvailabilityForDate(iso);

    if (iso >= state.todayISO && availability.day_status !== "full") {
      state.selectedDate = iso;
      return;
    }
  }

  state.selectedDate = "";
}

async function fetchSupabaseJson(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    ...(options.headers || {})
  };

  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers
  });

  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    throw new Error(extractErrorMessage(data) || "Request failed.");
  }

  return data || [];
}

function extractErrorMessage(data) {
  if (!data) return "";
  if (typeof data === "string") return data;
  if (typeof data.message === "string" && data.message.trim()) return data.message.trim();
  if (typeof data.error_description === "string" && data.error_description.trim()) return data.error_description.trim();
  if (typeof data.details === "string" && data.details.trim()) return data.details.trim();
  return "";
}

function getMonthBounds(date) {
  const start = startOfMonth(date);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);

  return {
    startISO: dateToISO(start),
    endISO: dateToISO(end),
    cacheKey: `${dateToISO(start)}:${dateToISO(end)}`
  };
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function dateToISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatLongDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.textContent = isLoading ? "Submitting..." : "Submit Booking";
}

function showMessage(message, type) {
  formMessage.textContent = message;
  formMessage.className = `form-message ${type}`;
}

function clearMessage() {
  formMessage.textContent = "";
  formMessage.className = "form-message";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}