const clientInput = document.getElementById('clientInput');
const clientIdField = document.getElementById('clientId');
const clientDropdown = document.getElementById('clientDropdown');

let filteredClients = [];
let focusedIndex = -1;

function findClientById(id) {
  return CLIENTS.find(c => c.id === id) || null;
}

function setSelectedClient(client) {
  if (!client) return;
  clientInput.value = client.name;
  clientIdField.value = client.id;
  closeDropdown();
}

function renderDropdown(items) {
  filteredClients = items;

  if (!items.length) {
    clientDropdown.innerHTML = '<li class="combo-empty">No clients found.</li>';
    openDropdown();
    return;
  }

  clientDropdown.innerHTML = items.map((client, idx) => `
    <li class="combo-item" data-index="${idx}" data-id="${client.id}" tabindex="0">${client.name}</li>
  `).join('');

  clientDropdown.querySelectorAll('.combo-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.id;
      const selClient = findClientById(id);
      setSelectedClient(selClient);
    });
  });

  openDropdown();
}

function openDropdown() {
  clientDropdown.classList.add('open');
}

function closeDropdown() {
  clientDropdown.classList.remove('open');
  focusedIndex = -1;
}

function filterClients(value) {
  const query = value.trim().toLowerCase();

  const matches = CLIENTS
    .filter(c => c.name.toLowerCase().includes(query))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  renderDropdown(matches);
}

if (clientInput) {
  const initialClient = findClientById(INITIAL_CLIENT_ID);
  if (initialClient) {
    setSelectedClient(initialClient);
  } else {
    clientInput.value = '';
    clientIdField.value = '';
  }

  const dateInput = document.getElementById('dateInstalled');
  const datePreview = document.getElementById('dateInstalledPreview');

  function updateDatePreview(value) {
    if (!datePreview) return;
    if (!value) {
      datePreview.textContent = 'Selected date: —';
      return;
    }
    const date = new Date(value);
    const monthNames = [
      'January','February','March','April','May','June',
      'July','August','September','October','November','December'
    ];
    if (Number.isNaN(date.getTime())) {
      datePreview.textContent = `Selected date: ${value}`;
      return;
    }
    datePreview.textContent = `Selected date: ${monthNames[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }

  if (dateInput) {
    updateDatePreview(dateInput.value);
    dateInput.addEventListener('input', (e) => updateDatePreview(e.target.value));
  }

  clientInput.addEventListener('input', (event) => {
    const query = event.target.value;
    if (query.trim().length === 0) {
      closeDropdown();
      clientIdField.value = '';
      return;
    }
    filterClients(query);
    clientIdField.value = '';
  });

  clientInput.addEventListener('keydown', (event) => {
    const items = clientDropdown.querySelectorAll('.combo-item');
    if (!items.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusedIndex = Math.min(focusedIndex + 1, items.length - 1);
      items[focusedIndex].focus();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusedIndex = Math.max(focusedIndex - 1, 0);
      items[focusedIndex].focus();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const sel = items[focusedIndex];
      if (sel) {
        const selClient = findClientById(sel.dataset.id);
        setSelectedClient(selClient);
      }
    }

    if (event.key === 'Escape') {
      closeDropdown();
    }
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.combo-wrap')) {
      closeDropdown();
    }
  });

  clientInput.addEventListener('focus', () => {
    if (clientInput.value.trim()) {
      filterClients(clientInput.value);
    } else {
      closeDropdown();
    }
  });

  // Auto-select if there is exactly one match when the user clicks away without
  // explicitly picking from the dropdown list.
  clientInput.addEventListener('blur', () => {
    // Small delay so a dropdown item click fires before this blur handler runs
    setTimeout(() => {
      if (clientIdField.value) return; // already resolved via dropdown
      const query = clientInput.value.trim().toLowerCase();
      if (!query) return;
      // Prefer exact name match first
      const exact = CLIENTS.filter(c => c.name.toLowerCase() === query);
      if (exact.length === 1) {
        setSelectedClient(exact[0]);
        return;
      }
      // Fall back to single partial match
      const partials = CLIENTS.filter(c => c.name.toLowerCase().includes(query));
      if (partials.length === 1) {
        setSelectedClient(partials[0]);
      }
    }, 150);
  });
}



const modelInput = document.getElementById('model');
const modelDropdown = document.getElementById('modelDropdown');
const unitSelect = document.getElementById('unit');
const assetForm = document.getElementById('assetForm');

let filteredModels = [];
let modelFocusedIndex = -1;

function getAvailableModels(unitKey) {
  if (!PARTS_CATALOG[unitKey]) return [];
  return Object.keys(PARTS_CATALOG[unitKey]);
}


function renderModelDropdown(items) {
  filteredModels = items;

  if (!items.length) {
    modelDropdown.innerHTML = '<li class="combo-empty">No models available.</li>';
    openModelDropdown();
    return;
  }

  modelDropdown.innerHTML = items.map((model, idx) => `
    <li class="combo-item" data-index="${idx}" data-model="${model}" tabindex="0">${model}</li>
  `).join('');

  modelDropdown.querySelectorAll('.combo-item').forEach(item => {
    item.addEventListener('click', () => {
      const model = item.dataset.model;
      setSelectedModel(model);
    });
  });

  openModelDropdown();
}

function openModelDropdown() {
  modelDropdown.classList.add('open');
}

function closeModelDropdown() {
  modelDropdown.classList.remove('open');
  modelFocusedIndex = -1;
}

function setSelectedModel(model) {
  if (!model) return;
  modelInput.value = model.toUpperCase();
  closeModelDropdown();
}

function filterModels(value) {
  const selectedUnit = unitSelect.value;
  if (!selectedUnit) {
    modelDropdown.innerHTML = '<li class="combo-empty">Select a unit first.</li>';
    openModelDropdown();
    return;
  }

  const availableModels = getAvailableModels(selectedUnit);
  const query = value.trim().toUpperCase();

  const matches = availableModels
    .filter(m => m.includes(query))
    .sort();
  
  renderModelDropdown(matches);
}

if (modelInput) {
  if (modelInput.value) {
    modelInput.value = modelInput.value.toUpperCase();
  }

  modelInput.addEventListener('input', (event) => {
    const query = event.target.value.toUpperCase();
    event.target.value = query;
    if (query.trim().length === 0) {
      closeModelDropdown();
    } else {
      filterModels(query);
    }
  });

  modelInput.addEventListener('keydown', (event) => {
    const items = modelDropdown.querySelectorAll('.combo-item');
    if (!items.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      modelFocusedIndex = Math.min(modelFocusedIndex + 1, items.length - 1);
      items[modelFocusedIndex].focus();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      modelFocusedIndex = Math.max(modelFocusedIndex - 1, 0);
      items[modelFocusedIndex].focus();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const sel = items[modelFocusedIndex];
      if (sel) {
        setSelectedModel(sel.dataset.model);
      }
    }

    if (event.key === 'Escape') {
      closeModelDropdown();
    }
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.combo-wrap') || !modelInput.closest('.combo-wrap').contains(event.target)) {
      closeModelDropdown();
    }
  });

  modelInput.addEventListener('focus', () => {
    const selectedUnit = unitSelect.value;
    if (!selectedUnit) {
      modelDropdown.innerHTML = '<li class="combo-empty">Select a unit first.</li>';
      openModelDropdown();
    } else if (modelInput.value.trim()) {
      filterModels(modelInput.value);
    } else {
      closeModelDropdown();
    }
  });

  unitSelect.addEventListener('change', () => {
    modelInput.value = '';
    closeModelDropdown();
  });

  modelInput.addEventListener('blur', () => {
    return;
  });
}

/* ── Serial number must be exactly 10 characters and unique system-wide ── */
const serialNoInput = document.getElementById('serialNo');
const SERIAL_LENGTH = 10;
const SERIAL_TAKEN_MESSAGE =
  'This serial number is already assigned to another client and cannot be used again.';
let serialCheckTimer = null;
let serialCheckToken = 0;

// States that block submission, as opposed to the transient 'checking' note.
const SERIAL_BLOCKING_STATES = new Set(['taken', 'invalid']);

function setSerialFieldState(state, message) {
  if (!serialNoInput) return;

  const existingNote = document.getElementById('serialNoNote');
  if (existingNote) existingNote.remove();
  serialNoInput.classList.remove('af-input-invalid');
  serialNoInput.setCustomValidity(SERIAL_BLOCKING_STATES.has(state) ? message : '');

  if (state === 'ok' || !message) return;

  const note = document.createElement('span');
  note.id = 'serialNoNote';
  note.className = state === 'checking' ? 'af-field-checking' : 'af-field-error';
  note.textContent = message;
  serialNoInput.insertAdjacentElement('afterend', note);

  if (SERIAL_BLOCKING_STATES.has(state)) serialNoInput.classList.add('af-input-invalid');
}

async function checkSerialAvailability() {
  if (!serialNoInput) return;
  const serialNo = serialNoInput.value.trim();

  if (!serialNo) {
    setSerialFieldState('ok');
    return;
  }

  // Wrong length is decided here rather than at the server — no point spending
  // a lookup on a serial that can't be accepted either way.
  if (serialNo.length !== SERIAL_LENGTH) {
    serialCheckToken += 1; // cancel any in-flight availability check
    setSerialFieldState(
      'invalid',
      `Serial number must be exactly ${SERIAL_LENGTH} characters — this one has ${serialNo.length}.`
    );
    return;
  }

  const token = ++serialCheckToken;
  setSerialFieldState('checking', 'Checking serial number…');

  try {
    const res = await fetch(
      `/user_account/check-serial?serialNo=${encodeURIComponent(serialNo)}`,
      { headers: { Accept: 'application/json' } }
    );
    const payload = await res.json();
    if (token !== serialCheckToken) return; // a newer keystroke superseded this

    if (payload && payload.invalidLength) {
      setSerialFieldState('invalid', payload.message);
    } else if (payload && payload.available === false) {
      const owner = payload.clientName ? ` It belongs to ${payload.clientName}.` : '';
      setSerialFieldState('taken', (payload.message || SERIAL_TAKEN_MESSAGE) + owner);
    } else {
      setSerialFieldState('ok');
    }
  } catch {
    // Network hiccup — stay silent and let the server decide on submit.
    if (token === serialCheckToken) setSerialFieldState('ok');
  }
}

if (serialNoInput) {
  serialNoInput.addEventListener('input', () => {
    serialNoInput.setCustomValidity('');
    clearTimeout(serialCheckTimer);
    serialCheckTimer = setTimeout(checkSerialAvailability, 400);
  });

  serialNoInput.addEventListener('blur', () => {
    clearTimeout(serialCheckTimer);
    checkSerialAvailability();
  });
}

if (assetForm && serialNoInput) {
  assetForm.addEventListener('submit', (event) => {
    if (serialNoInput.validationMessage) {
      event.preventDefault();
      serialNoInput.reportValidity();
      serialNoInput.focus();
    }
  });
}

/* ── A unit cannot have been installed after today ── */
const dateInstalledInput = document.getElementById('dateInstalled');

// Local calendar date, not toISOString() — that converts to UTC and can hand
// back tomorrow's date for anyone east of Greenwich, which includes Manila.
function todayIsoDate() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function setDateFieldError(message) {
  if (!dateInstalledInput) return;

  const existingNote = document.getElementById('dateInstalledNote');
  if (existingNote) existingNote.remove();
  dateInstalledInput.classList.remove('af-input-invalid');
  dateInstalledInput.setCustomValidity(message || '');

  if (!message) return;

  const note = document.createElement('span');
  note.id = 'dateInstalledNote';
  note.className = 'af-field-error';
  note.textContent = message;
  dateInstalledInput.insertAdjacentElement('afterend', note);
  dateInstalledInput.classList.add('af-input-invalid');
}

if (dateInstalledInput) {
  // Greys out later days in the native picker; the check below covers typing.
  dateInstalledInput.max = todayIsoDate();

  const validateInstallDate = () => {
    const value = dateInstalledInput.value;
    setDateFieldError(
      value && value > todayIsoDate() ? 'Date installed cannot be in the future.' : ''
    );
  };

  dateInstalledInput.addEventListener('input', validateInstallDate);
  dateInstalledInput.addEventListener('change', validateInstallDate);
  validateInstallDate();

  if (assetForm) {
    assetForm.addEventListener('submit', (event) => {
      validateInstallDate();
      if (dateInstalledInput.validationMessage) {
        event.preventDefault();
        dateInstalledInput.reportValidity();
        dateInstalledInput.focus();
      }
    });
  }
}
