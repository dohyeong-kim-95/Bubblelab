// Constants
const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]; // 7AM - 8PM
const MINUTES = [0, 10, 20, 30, 40, 50];
const MAX_DDAYS = 3;

// Block Colors (Time Categories)
const BLOCK_COLORS = {
    useless: '#FFB3BA',  // Red - Useless time
    work: '#BAE1FF',     // Blue - Work
    rest: '#BAFFC9',     // Green - Rest
    nonwork: '#E0E0E0'   // Gray - Non-work (commute, etc.)
};
const COLORS = [BLOCK_COLORS.useless, BLOCK_COLORS.work, BLOCK_COLORS.rest, BLOCK_COLORS.nonwork];

// TODO Priority Colors (Eisenhower Matrix) - Soft pastel colors
const TODO_COLORS = {
    urgentImportant: '#F8B4B4',      // Soft Red - Urgent & Important
    urgentNotImportant: '#FDE68A',   // Soft Yellow - Urgent & Not Important
    notUrgentImportant: '#A7F3D0',   // Soft Green/Mint - Not Urgent & Important
    notUrgentNotImportant: '#E5E7EB' // Soft Gray - Not Urgent & Not Important
};
const TODO_COLOR_CYCLE = [
    TODO_COLORS.urgentImportant,
    TODO_COLORS.urgentNotImportant,
    TODO_COLORS.notUrgentImportant,
    TODO_COLORS.notUrgentNotImportant
];
const MAX_TODO_ITEMS = 7;

// Get current date in KST (Korea Standard Time)
function getKSTDateString(date = new Date()) {
    // Use Intl API for reliable timezone conversion
    return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

// Get day of week name
function getDayOfWeek(dateStr) {
    const date = new Date(dateStr + 'T12:00:00');
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[date.getDay()];
}

// State
let currentDate = getKSTDateString();
let selectedColor = COLORS[0];
let selecting = false;
let startSlot = null;
let endSlot = null;
let currentType = null; // 'plan' or 'real'
let resizing = false;
let resizeBlock = null;
let resizeHandle = null;
let longPressTimer = null;

// DOM Elements
const planContent = document.getElementById('planContent');
const realContent = document.getElementById('realContent');
const blockModal = document.getElementById('blockModal');
const confirmModal = document.getElementById('confirmModal');
const currentDateEl = document.getElementById('currentDate');
const blockTitleInput = document.getElementById('blockTitle');
const btnSave = document.getElementById('btnSave');
const btnCancel = document.getElementById('btnCancel');
const btnConfirmYes = document.getElementById('btnConfirmYes');
const btnConfirmNo = document.getElementById('btnConfirmNo');

// Initialize
function init() {
    cleanOldData(); // Remove data from previous months
    updateDateDisplay();
    createTimeGrid(planContent, 'plan');
    createTimeGrid(realContent, 'real');
    setupColorPicker();
    setupEventListeners();
    setupTodoEventListeners();
    setupNotesEventListeners();
    setupExportEventListeners();
    setupDdayEventListeners();
    setupCalendarEventListeners();
    setupKeyboardShortcuts();
    startClock();
    loadData();
    renderDdayDashboard();
}

// Update date display with day of week
function updateDateDisplay() {
    const dayOfWeek = getDayOfWeek(currentDate);
    currentDateEl.textContent = `${currentDate} (${dayOfWeek})`;
}

// Clean old data (keep only current month)
function cleanOldData() {
    const data = getData();
    const currentMonth = getKSTDateString().substring(0, 7); // "YYYY-MM"

    let deletedCount = 0;
    const keysToDelete = [];

    for (const key in data) {
        // Skip global notes and non-date keys
        if (key.startsWith('_')) continue;

        // Check if key is a date (YYYY-MM-DD format)
        if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
            const keyMonth = key.substring(0, 7);
            if (keyMonth !== currentMonth) {
                keysToDelete.push(key);
                deletedCount++;
            }
        }
    }

    if (deletedCount > 0) {
        keysToDelete.forEach(key => delete data[key]);
        localStorage.setItem('dailyPlanner', JSON.stringify(data));
        console.log(`Cleaned ${deletedCount} old entries (keeping only ${currentMonth})`);
    }
}

// Clock display
function startClock() {
    const clockEl = document.getElementById('headerClock');
    if (!clockEl) return;

    function updateClock() {
        const now = new Date();
        // Get KST time
        const kstOffset = 9 * 60;
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const kstTime = new Date(utc + (kstOffset * 60000));

        const hours = String(kstTime.getHours()).padStart(2, '0');
        const minutes = String(kstTime.getMinutes()).padStart(2, '0');
        const seconds = String(kstTime.getSeconds()).padStart(2, '0');
        clockEl.textContent = `${hours}:${minutes}:${seconds}`;
    }

    updateClock();
    setInterval(updateClock, 1000);
}

// Setup keyboard shortcuts
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ctrl + S: Export daily (prevent browser save)
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            exportDailyCSV();
            return;
        }

        // Ctrl + Left Arrow: Previous day
        if (e.ctrlKey && e.key === 'ArrowLeft') {
            e.preventDefault();
            goToPreviousDay();
            return;
        }

        // Ctrl + Right Arrow: Next day
        if (e.ctrlKey && e.key === 'ArrowRight') {
            e.preventDefault();
            goToNextDay();
            return;
        }

        // Ctrl + T: Add TODO
        if (e.ctrlKey && e.key === 't') {
            e.preventDefault();
            openTodoModal();
            return;
        }

        // Ctrl + B: Backup all data
        if (e.ctrlKey && e.key === 'b') {
            e.preventDefault();
            backupAllData();
            return;
        }

        // Ctrl + D: Add D-DAY
        if (e.ctrlKey && e.key === 'd') {
            e.preventDefault();
            openDdayModal();
            return;
        }
    });
}

// Create time grid
function createTimeGrid(container, type) {
    container.innerHTML = '';

    HOURS.forEach(hour => {
        const row = document.createElement('div');
        row.className = 'time-row';

        const hourLabel = document.createElement('div');
        hourLabel.className = 'hour-label';
        hourLabel.textContent = String(hour).padStart(2, '0');
        row.appendChild(hourLabel);

        const slotsContainer = document.createElement('div');
        slotsContainer.className = 'time-slots';

        MINUTES.forEach(minute => {
            const slot = document.createElement('div');
            slot.className = 'time-slot';
            slot.dataset.hour = hour;
            slot.dataset.minute = minute;
            slot.dataset.type = type;
            slotsContainer.appendChild(slot);
        });

        row.appendChild(slotsContainer);
        container.appendChild(row);
    });
}

// Setup color picker
function setupColorPicker() {
    const colorOptions = document.querySelectorAll('.color-option');
    colorOptions.forEach(option => {
        option.addEventListener('click', () => {
            colorOptions.forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
            selectedColor = option.dataset.color;
        });
    });
    colorOptions[0].classList.add('selected');
}

// Setup event listeners
function setupEventListeners() {
    // Date navigation
    const btnPrev = document.querySelector('.btn-prev');
    const btnNext = document.querySelector('.btn-next');
    if (btnPrev) btnPrev.addEventListener('click', goToPreviousDay);
    if (btnNext) btnNext.addEventListener('click', goToNextDay);

    // Mouse events for desktop
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // Touch events for mobile
    document.addEventListener('touchstart', handleTouchStart);
    document.addEventListener('touchend', handleTouchEnd);

    // Modal events
    btnSave.addEventListener('click', saveBlock);
    btnCancel.addEventListener('click', closeBlockModal);
    btnConfirmNo.addEventListener('click', closeConfirmModal);

    // Copy all button
    const copyAllBtn = document.getElementById('copyAllBtn');
    if (copyAllBtn) {
        copyAllBtn.addEventListener('click', copyAllBlocks);
    }

    // Delete all buttons
    const deletePlanBtn = document.getElementById('deletePlanBtn');
    const deleteRealBtn = document.getElementById('deleteRealBtn');
    if (deletePlanBtn) {
        deletePlanBtn.addEventListener('click', () => deleteAllBlocks('plan'));
    }
    if (deleteRealBtn) {
        deleteRealBtn.addEventListener('click', () => deleteAllBlocks('real'));
    }

    // Close modal on background click
    blockModal.addEventListener('click', (e) => {
        if (e.target === blockModal) closeBlockModal();
    });
    confirmModal.addEventListener('click', (e) => {
        if (e.target === confirmModal) closeConfirmModal();
    });
}

// Mouse handlers
function handleMouseDown(e) {
    // Don't start selecting if clicking on a block or resize handle
    if (e.target.closest('.block') || e.target.closest('.resize-handle')) return;

    const slot = e.target.closest('.time-slot');
    if (!slot) return;

    selecting = true;
    startSlot = slot;
    currentType = slot.dataset.type;
    slot.classList.add('selecting');
}

function handleMouseMove(e) {
    if (!selecting || !startSlot) return;

    const slot = e.target.closest('.time-slot');
    if (!slot || slot.dataset.type !== currentType) return;

    clearSelection();
    endSlot = slot;
    highlightSelection();
}

function handleMouseUp(e) {
    if (!selecting || !startSlot) return;

    selecting = false;
    const slot = e.target.closest('.time-slot');
    if (slot && slot.dataset.type === currentType) {
        endSlot = slot;
    }

    if (startSlot && endSlot) {
        const { startTime, endTime } = getTimeRange();
        if (checkOverlap(currentType, startTime, endTime)) {
            alert('A block already exists in this time range.');
            clearSelection();
            resetSelection();
            return;
        }
        openBlockModal();
    } else {
        clearSelection();
        resetSelection();
    }
}

// Touch handlers
let touchStartSlot = null;

function handleTouchStart(e) {
    const slot = e.target.closest('.time-slot');
    if (!slot) return;

    if (!touchStartSlot) {
        touchStartSlot = slot;
        startSlot = slot;
        currentType = slot.dataset.type;
        slot.classList.add('selecting');
    } else {
        endSlot = slot;
        if (slot.dataset.type === currentType) {
            const { startTime, endTime } = getTimeRange();
            if (checkOverlap(currentType, startTime, endTime)) {
                alert('A block already exists in this time range.');
                clearSelection();
                resetTouchSelection();
                return;
            }
            openBlockModal();
        }
        touchStartSlot = null;
    }
}

function handleTouchEnd(e) {
    // Touch end is handled in touchStart for simplicity
}

// Highlight selection
function highlightSelection() {
    const slots = document.querySelectorAll(`.time-slot[data-type="${currentType}"]`);
    const start = getSlotIndex(startSlot);
    const end = getSlotIndex(endSlot);
    const [minIndex, maxIndex] = [Math.min(start, end), Math.max(start, end)];

    slots.forEach((slot, index) => {
        if (index >= minIndex && index <= maxIndex) {
            slot.classList.add('selecting');
        }
    });
}

// Clear selection
function clearSelection() {
    document.querySelectorAll('.time-slot.selecting').forEach(slot => {
        slot.classList.remove('selecting');
    });
}

// Reset selection
function resetSelection() {
    startSlot = null;
    endSlot = null;
    currentType = null;
}

function resetTouchSelection() {
    touchStartSlot = null;
    startSlot = null;
    endSlot = null;
    currentType = null;
}

// Get slot index
function getSlotIndex(slot) {
    const slots = document.querySelectorAll(`.time-slot[data-type="${currentType}"]`);
    return Array.from(slots).indexOf(slot);
}

// Get time range
function getTimeRange() {
    const start = getSlotIndex(startSlot);
    const end = getSlotIndex(endSlot);
    const [minIndex, maxIndex] = [Math.min(start, end), Math.max(start, end)];

    const slots = document.querySelectorAll(`.time-slot[data-type="${currentType}"]`);
    const startSlotEl = slots[minIndex];
    const endSlotEl = slots[maxIndex];

    const startHour = parseInt(startSlotEl.dataset.hour);
    const startMinute = parseInt(startSlotEl.dataset.minute);
    const endHour = parseInt(endSlotEl.dataset.hour);
    const endMinute = parseInt(endSlotEl.dataset.minute);

    // Calculate end time (add 10 minutes to end slot)
    let finalEndMinute = endMinute + 10;
    let finalEndHour = endHour;
    if (finalEndMinute >= 60) {
        finalEndMinute = 0;
        finalEndHour = (endHour + 1) % 24;
    }

    const startTime = `${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}`;
    const endTime = `${String(finalEndHour).padStart(2, '0')}:${String(finalEndMinute).padStart(2, '0')}`;

    return { startTime, endTime };
}

// Modal functions
function openBlockModal() {
    blockTitleInput.value = '';
    blockModal.classList.add('active');
    blockTitleInput.focus();

    // Handle Enter/Escape keys
    blockTitleInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            saveBlock();
        } else if (e.key === 'Escape') {
            closeBlockModal();
        }
    };
}

function closeBlockModal() {
    blockModal.classList.remove('active');
    clearSelection();
    resetSelection();
    resetTouchSelection();
}

function openConfirmModal(message, onConfirm) {
    document.getElementById('confirmMessage').textContent = message;
    confirmModal.classList.add('active');

    btnConfirmYes.onclick = () => {
        onConfirm();
        closeConfirmModal();
    };
}

function closeConfirmModal() {
    confirmModal.classList.remove('active');
}

// Save block
function saveBlock() {
    const title = blockTitleInput.value.trim();
    if (!title) {
        alert('Please enter a task name.');
        return;
    }

    const { startTime, endTime } = getTimeRange();
    const block = {
        id: generateId(),
        startTime,
        endTime,
        title,
        color: selectedColor
    };

    addBlockToData(currentType, block);
    saveData();
    renderBlocks();
    closeBlockModal();
}

// Check overlap
function checkOverlap(type, startTime, endTime) {
    const data = getData();
    const blocks = data[currentDate]?.[type] || [];

    const start = timeToMinutes(startTime);
    const end = timeToMinutes(endTime);

    return blocks.some(block => {
        const blockStart = timeToMinutes(block.startTime);
        const blockEnd = timeToMinutes(block.endTime);
        return (start < blockEnd && end > blockStart);
    });
}

// Time conversion
function timeToMinutes(time) {
    const [hour, minute] = time.split(':').map(Number);
    return hour * 60 + minute;
}

// Split block into multiple segments by hour boundaries
function splitBlockByHour(block) {
    const [startHour, startMinute] = block.startTime.split(':').map(Number);
    const [endHour, endMinute] = block.endTime.split(':').map(Number);

    // If same hour, no split needed
    if (startHour === endHour) {
        return [{
            ...block,
            segmentStart: block.startTime,
            segmentEnd: block.endTime
        }];
    }

    // Multiple hours - split into segments
    const segments = [];
    let currentHour = startHour;
    let currentMinute = startMinute;

    while (currentHour < endHour || (currentHour === endHour && currentMinute < endMinute)) {
        const segmentStart = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;

        // Move to next hour boundary or end time
        let nextHour = currentHour;
        let nextMinute = 0;

        if (currentHour < endHour) {
            nextHour = currentHour + 1;
            nextMinute = 0;
        } else {
            nextHour = endHour;
            nextMinute = endMinute;
        }

        const segmentEnd = `${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`;

        segments.push({
            ...block,
            segmentStart,
            segmentEnd
        });

        currentHour = nextHour;
        currentMinute = nextMinute;
    }

    return segments;
}

// Generate unique ID
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// LocalStorage functions
function getData() {
    try {
        const data = localStorage.getItem('dailyPlanner');
        const parsed = data ? JSON.parse(data) : {};

        // Validate and ensure data structure for current date
        if (parsed[currentDate]) {
            if (!parsed[currentDate].plan || !Array.isArray(parsed[currentDate].plan) ||
                !parsed[currentDate].real || !Array.isArray(parsed[currentDate].real)) {
                console.warn(`Invalid data structure for ${currentDate}, clearing date data`);
                delete parsed[currentDate];
                localStorage.setItem('dailyPlanner', JSON.stringify(parsed));
            }
            // Ensure todo array exists
            if (!parsed[currentDate].todo || !Array.isArray(parsed[currentDate].todo)) {
                parsed[currentDate].todo = [];
            }
        }

        return parsed;
    } catch (e) {
        console.error('Error loading data:', e);
        // Try to recover by clearing only current date's data
        try {
            const data = localStorage.getItem('dailyPlanner');
            if (data) {
                const parsed = JSON.parse(data);
                delete parsed[currentDate];
                localStorage.setItem('dailyPlanner', JSON.stringify(parsed));
                console.log(`Cleared corrupted data for ${currentDate}`);
                return parsed;
            }
        } catch (recoveryError) {
            console.error('Failed to recover data, clearing all:', recoveryError);
            localStorage.removeItem('dailyPlanner');
        }
        return {};
    }
}

function saveData() {
    try {
        const data = getData();
        localStorage.setItem('dailyPlanner', JSON.stringify(data));
    } catch (e) {
        console.error('Error saving data:', e);

        // Try to save without current date's data
        try {
            const data = getData();
            delete data[currentDate];
            localStorage.setItem('dailyPlanner', JSON.stringify(data));
            alert(`Data save error occurred. Data for ${currentDate} has been deleted.`);
        } catch (recoveryError) {
            console.error('Failed to save data:', recoveryError);
            alert('Failed to save data. Browser storage may be full.');
        }
    }
}

function addBlockToData(type, block) {
    const data = getData();
    if (!data[currentDate]) {
        data[currentDate] = { plan: [], real: [], todo: [] };
    }
    if (!data[currentDate].todo) {
        data[currentDate].todo = [];
    }
    data[currentDate][type].push(block);
    localStorage.setItem('dailyPlanner', JSON.stringify(data));
}

function loadData() {
    renderBlocks();
    renderTodoList();
    renderDailySummary();
    renderNotes();
}

// Render blocks
function renderBlocks() {
    const data = getData();
    const dateData = data[currentDate] || { plan: [], real: [] };

    renderBlocksForType('plan', dateData.plan);
    renderBlocksForType('real', dateData.real);
    renderDailySummary();
}

function renderBlocksForType(type, blocks) {
    const container = type === 'plan' ? planContent : realContent;

    // Remove existing blocks
    container.querySelectorAll('.block').forEach(block => block.remove());

    blocks.forEach(block => {
        // Split block into hour segments
        const segments = splitBlockByHour(block);
        segments.forEach(segment => {
            createBlockElement(container, type, segment);
        });
    });
}

function createBlockElement(container, type, block) {
    const blockEl = document.createElement('div');
    blockEl.className = 'block';
    blockEl.style.backgroundColor = block.color;
    blockEl.dataset.id = block.id;
    blockEl.dataset.type = type;

    // Create time display
    const timeDisplay = document.createElement('div');
    timeDisplay.className = 'block-time';
    const displayStart = block.segmentStart || block.startTime;
    const displayEnd = block.segmentEnd || block.endTime;
    timeDisplay.textContent = `${displayStart}-${displayEnd}`;
    blockEl.appendChild(timeDisplay);

    // Create title display
    const title = document.createElement('div');
    title.className = 'block-title';
    title.textContent = block.title;
    blockEl.appendChild(title);

    // Add copy arrow button (only for PLAN blocks)
    if (type === 'plan') {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.textContent = '→';
        copyBtn.title = 'Copy to REAL';
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            copyBlock(block, type);
        });
        blockEl.appendChild(copyBtn);
    }

    // Add resize handles
    const topHandle = document.createElement('div');
    topHandle.className = 'resize-handle top';
    topHandle.dataset.handle = 'top';
    blockEl.appendChild(topHandle);

    const bottomHandle = document.createElement('div');
    bottomHandle.className = 'resize-handle bottom';
    bottomHandle.dataset.handle = 'bottom';
    blockEl.appendChild(bottomHandle);

    // Position block using segment times if available
    const startTime = block.segmentStart || block.startTime;
    const endTime = block.segmentEnd || block.endTime;
    const position = calculateBlockPosition(startTime, endTime);
    blockEl.style.top = position.top + 'px';
    blockEl.style.left = position.left + 'px';
    blockEl.style.width = position.width + 'px';
    blockEl.style.height = position.height + 'px';

    // Add event listeners
    setupBlockEventListeners(blockEl, block);

    container.appendChild(blockEl);
}

// Setup block event listeners
function setupBlockEventListeners(blockEl, block) {
    // Double click to delete (desktop)
    blockEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        deleteBlock(blockEl, block);
    });

    // Long press to delete (mobile)
    let longPressTimeout;
    blockEl.addEventListener('touchstart', (e) => {
        if (e.target.closest('.resize-handle')) return;

        longPressTimeout = setTimeout(() => {
            deleteBlock(blockEl, block);
        }, 500);
    });

    blockEl.addEventListener('touchend', () => {
        clearTimeout(longPressTimeout);
    });

    blockEl.addEventListener('touchmove', () => {
        clearTimeout(longPressTimeout);
    });

    // Resize handles
    const handles = blockEl.querySelectorAll('.resize-handle');
    handles.forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            startResize(e, blockEl, block, handle.dataset.handle);
        });

        handle.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            startResize(e, blockEl, block, handle.dataset.handle);
        });
    });
}

// Delete block
function deleteBlock(blockEl, block) {
    openConfirmModal('Delete this block?', () => {
        const type = blockEl.dataset.type;
        removeBlockFromData(type, block.id);
        saveData();
        renderBlocks();
    });
}

// Remove block from data
function removeBlockFromData(type, blockId) {
    const data = getData();
    if (!data[currentDate] || !data[currentDate][type]) return;

    data[currentDate][type] = data[currentDate][type].filter(block => block.id !== blockId);
    localStorage.setItem('dailyPlanner', JSON.stringify(data));
}

// Start resize
function startResize(e, blockEl, block, handleType) {
    e.preventDefault();
    resizing = true;
    resizeBlock = { el: blockEl, data: block, handle: handleType };

    const onMove = (e) => handleResize(e);
    const onEnd = () => endResize(onMove, onEnd);

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove);
    document.addEventListener('touchend', onEnd);
}

// Handle resize
function handleResize(e) {
    if (!resizing || !resizeBlock) return;

    const { el, data, handle } = resizeBlock;
    const type = el.dataset.type;
    const container = type === 'plan' ? planContent : realContent;

    // Get mouse/touch position
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    if (!clientY) return;

    // Get container position
    const containerRect = container.getBoundingClientRect();
    const relativeY = clientY - containerRect.top + container.scrollTop;

    // Calculate which slot is being pointed at
    const firstRow = container.querySelector('.time-row');
    const rowHeight = firstRow.offsetHeight;
    const slotIndex = Math.floor(relativeY / rowHeight);

    if (slotIndex < 0 || slotIndex >= HOURS.length) return;

    const hour = HOURS[slotIndex];
    const minuteIndexApprox = Math.floor(((relativeY % rowHeight) / rowHeight) * 6);
    const minuteIndex = Math.max(0, Math.min(5, minuteIndexApprox));
    const minute = MINUTES[minuteIndex];

    const newTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

    // Update block data based on handle
    if (handle === 'top') {
        if (timeToMinutes(newTime) < timeToMinutes(data.endTime)) {
            data.startTime = newTime;
        }
    } else {
        // For bottom handle, add 10 minutes
        let endHour = hour;
        let endMinute = minute + 10;
        if (endMinute >= 60) {
            endMinute = 0;
            endHour = (hour + 1) % 24;
        }
        const endTime = `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`;
        if (timeToMinutes(endTime) > timeToMinutes(data.startTime)) {
            data.endTime = endTime;
        }
    }

    // Reposition block
    const position = calculateBlockPosition(data.startTime, data.endTime);
    el.style.top = position.top + 'px';
    el.style.width = position.width + 'px';
    el.style.height = position.height + 'px';
}

// End resize
function endResize(onMove, onEnd) {
    if (!resizing || !resizeBlock) return;

    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onEnd);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);

    // Update data in localStorage
    const { data, el } = resizeBlock;
    const type = el.dataset.type;
    updateBlockInData(type, data);
    saveData();

    resizing = false;
    resizeBlock = null;
}

// Update block in data
function updateBlockInData(type, updatedBlock) {
    const data = getData();
    if (!data[currentDate] || !data[currentDate][type]) return;

    const index = data[currentDate][type].findIndex(block => block.id === updatedBlock.id);
    if (index !== -1) {
        data[currentDate][type][index] = updatedBlock;
        localStorage.setItem('dailyPlanner', JSON.stringify(data));
    }
}

// Copy block from one type to another
function copyBlock(block, fromType) {
    const toType = fromType === 'plan' ? 'real' : 'plan';
    const direction = fromType === 'plan' ? 'REAL' : 'PLAN';

    openConfirmModal(`Copy this block to ${direction}?`, () => {
        const data = getData();
        if (!data[currentDate]) {
            data[currentDate] = { plan: [], real: [] };
        }

        // Remove overlapping blocks in target type
        const startMinutes = timeToMinutes(block.startTime);
        const endMinutes = timeToMinutes(block.endTime);

        data[currentDate][toType] = data[currentDate][toType].filter(targetBlock => {
            const targetStart = timeToMinutes(targetBlock.startTime);
            const targetEnd = timeToMinutes(targetBlock.endTime);
            // Keep blocks that don't overlap
            return !(startMinutes < targetEnd && endMinutes > targetStart);
        });

        // Create new block with new ID
        const newBlock = {
            id: generateId(),
            startTime: block.startTime,
            endTime: block.endTime,
            title: block.title,
            color: block.color
        };

        data[currentDate][toType].push(newBlock);
        localStorage.setItem('dailyPlanner', JSON.stringify(data));
        renderBlocks();
    });
}

// Copy all blocks from PLAN to REAL
function copyAllBlocks() {
    const data = getData();
    const planBlocks = data[currentDate]?.plan || [];

    if (planBlocks.length === 0) {
        alert('No PLAN blocks to copy.');
        return;
    }

    openConfirmModal('Copy all PLAN blocks to REAL?\n(Existing REAL blocks will be deleted)', () => {
        if (!data[currentDate]) {
            data[currentDate] = { plan: [], real: [] };
        }

        // Clear all REAL blocks
        data[currentDate].real = [];

        // Copy all PLAN blocks to REAL with new IDs
        planBlocks.forEach(block => {
            const newBlock = {
                id: generateId(),
                startTime: block.startTime,
                endTime: block.endTime,
                title: block.title,
                color: block.color
            };
            data[currentDate].real.push(newBlock);
        });

        localStorage.setItem('dailyPlanner', JSON.stringify(data));
        renderBlocks();
    });
}

// Delete all blocks of a specific type
function deleteAllBlocks(type) {
    const data = getData();
    const blocks = data[currentDate]?.[type] || [];

    if (blocks.length === 0) {
        alert('No blocks to delete.');
        return;
    }

    const typeName = type === 'plan' ? 'PLAN' : 'REAL';
    openConfirmModal(`Delete all ${typeName} blocks?`, () => {
        if (!data[currentDate]) {
            data[currentDate] = { plan: [], real: [] };
        }

        // Clear all blocks of the specified type
        data[currentDate][type] = [];

        localStorage.setItem('dailyPlanner', JSON.stringify(data));
        renderBlocks();
    });
}

function calculateBlockPosition(startTime, endTime) {
    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);
    const duration = endMinutes - startMinutes;

    // Calculate slot position
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);

    const startHourIndex = HOURS.indexOf(startHour);
    const startMinuteIndex = MINUTES.indexOf(startMinute);
    const endMinuteIndex = MINUTES.indexOf(endMinute);

    // Get first row to calculate dimensions
    const firstRow = planContent.querySelector('.time-row');
    const hourLabel = firstRow.querySelector('.hour-label');
    const timeSlots = firstRow.querySelector('.time-slots');
    const firstSlot = timeSlots.querySelector('.time-slot');

    const rowHeight = firstRow.offsetHeight;
    const slotWidth = firstSlot.offsetWidth;
    const labelWidth = hourLabel.offsetWidth;

    const top = startHourIndex * rowHeight + 2;
    const left = labelWidth + startMinuteIndex * slotWidth + startMinuteIndex + 2;

    // Calculate width based on duration
    // Since blocks are now split by hour, they should always be in the same row
    const width = (duration / 10) * slotWidth + (duration / 10) - 2;
    const height = rowHeight - 4;

    return { top, left, width, height };
}

// ============================================
// DAILY SUMMARY FUNCTIONS
// ============================================

// Calculate summary for a block type (plan or real)
function calculateSummaryForType(type) {
    const data = getData();
    const dayData = data[currentDate];
    const blocks = dayData?.[type] || [];

    const summary = {
        work: 0,      // Blue - #BAE1FF
        rest: 0,      // Green - #BAFFC9
        nonwork: 0,   // Gray - #E0E0E0
        useless: 0    // Red - #FFB3BA
    };

    blocks.forEach(block => {
        const startMinutes = timeToMinutes(block.startTime);
        const endMinutes = timeToMinutes(block.endTime);
        const duration = endMinutes - startMinutes;

        switch (block.color) {
            case BLOCK_COLORS.work:
                summary.work += duration;
                break;
            case BLOCK_COLORS.rest:
                summary.rest += duration;
                break;
            case BLOCK_COLORS.nonwork:
                summary.nonwork += duration;
                break;
            case BLOCK_COLORS.useless:
                summary.useless += duration;
                break;
        }
    });

    return summary;
}

// Format minutes to compact format "Xh Ym" or "Xh" or "Ym"
function formatDuration(minutes) {
    if (minutes === 0) return '0m';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) return `${mins}m`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h${mins}m`;
}

// Format difference with sign
function formatDiff(diff) {
    if (diff === 0) return '';
    const sign = diff > 0 ? '+' : '';
    return `(${sign}${formatDuration(Math.abs(diff))})`;
}

// Render daily summary with PLAN vs REAL comparison
function renderDailySummary() {
    const summaryEl = document.getElementById('dailySummary');
    if (!summaryEl) return;

    const plan = calculateSummaryForType('plan');
    const real = calculateSummaryForType('real');

    const categories = [
        { key: 'work', label: 'Work', color: BLOCK_COLORS.work },
        { key: 'rest', label: 'Rest', color: BLOCK_COLORS.rest },
        { key: 'useless', label: 'Useless', color: BLOCK_COLORS.useless }
    ];

    let html = '';
    categories.forEach(cat => {
        const realVal = real[cat.key];
        const diff = realVal - plan[cat.key];
        const diffClass = diff > 0 ? 'diff-positive' : (diff < 0 ? 'diff-negative' : '');
        html += `
            <span class="summary-item">
                <span class="summary-dot" style="background:${cat.color}"></span>
                ${cat.label}: ${formatDuration(realVal)}
                <span class="summary-diff ${diffClass}">${formatDiff(diff)}</span>
            </span>
        `;
    });

    summaryEl.innerHTML = html;
}

// ============================================
// EXPORT FUNCTIONS
// ============================================

// Download file helper
function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Get color category name
function getColorCategory(color) {
    switch (color) {
        case BLOCK_COLORS.work: return 'Work';
        case BLOCK_COLORS.rest: return 'Rest';
        case BLOCK_COLORS.nonwork: return 'Non-work';
        case BLOCK_COLORS.useless: return 'Useless';
        default: return 'Unknown';
    }
}

// Export daily data as CSV
function exportDailyCSV() {
    const data = getData();
    const dayData = data[currentDate] || { plan: [], real: [], todo: [] };

    let csv = 'Type,Start,End,Title,Category\n';

    // Add PLAN blocks
    dayData.plan.forEach(block => {
        csv += `PLAN,${block.startTime},${block.endTime},"${block.title.replace(/"/g, '""')}",${getColorCategory(block.color)}\n`;
    });

    // Add REAL blocks
    dayData.real.forEach(block => {
        csv += `REAL,${block.startTime},${block.endTime},"${block.title.replace(/"/g, '""')}",${getColorCategory(block.color)}\n`;
    });

    // Add TODO section
    csv += '\nTODO Status,Title,Priority\n';
    dayData.todo.forEach(todo => {
        const status = todo.done ? 'DONE' : 'TODO';
        const priority = getPriorityName(todo.color);
        csv += `${status},"${todo.title.replace(/"/g, '""')}",${priority}\n`;
    });

    downloadFile(csv, `daily-planner-${currentDate}.csv`, 'text/csv');
}

// Get priority name from color
function getPriorityName(color) {
    switch (color) {
        case TODO_COLORS.urgentImportant: return 'Urgent+Important';
        case TODO_COLORS.urgentNotImportant: return 'Urgent';
        case TODO_COLORS.notUrgentImportant: return 'Important';
        case TODO_COLORS.notUrgentNotImportant: return 'Neither';
        default: return 'Unknown';
    }
}

// Export daily data as JSON
function exportDailyJSON() {
    const data = getData();
    const dayData = data[currentDate] || { plan: [], real: [], todo: [] };

    const exportData = {
        date: currentDate,
        plan: dayData.plan,
        real: dayData.real,
        todo: dayData.todo,
        summary: {
            plan: calculateSummaryForType('plan'),
            real: calculateSummaryForType('real')
        }
    };

    const json = JSON.stringify(exportData, null, 2);
    downloadFile(json, `daily-planner-${currentDate}.json`, 'application/json');
}

// Get week dates (Monday to Sunday containing current date)
function getCurrentWeekDates() {
    const date = new Date(currentDate);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Monday start

    const monday = new Date(date);
    monday.setDate(diff);

    const dates = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
}

// Calculate summary for a specific date
function calculateSummaryForDate(date) {
    const data = getData();
    const dayData = data[date];

    const result = {
        plan: { work: 0, rest: 0, nonwork: 0, useless: 0 },
        real: { work: 0, rest: 0, nonwork: 0, useless: 0 }
    };

    if (!dayData) return result;

    ['plan', 'real'].forEach(type => {
        const blocks = dayData[type] || [];
        blocks.forEach(block => {
            const duration = timeToMinutes(block.endTime) - timeToMinutes(block.startTime);
            switch (block.color) {
                case BLOCK_COLORS.work: result[type].work += duration; break;
                case BLOCK_COLORS.rest: result[type].rest += duration; break;
                case BLOCK_COLORS.nonwork: result[type].nonwork += duration; break;
                case BLOCK_COLORS.useless: result[type].useless += duration; break;
            }
        });
    });

    return result;
}

// Export weekly data as CSV
function exportWeeklyCSV() {
    const dates = getCurrentWeekDates();

    let csv = 'Date,Plan_Work,Plan_Rest,Plan_Nonwork,Plan_Useless,Real_Work,Real_Rest,Real_Nonwork,Real_Useless\n';

    dates.forEach(date => {
        const summary = calculateSummaryForDate(date);
        csv += `${date},${summary.plan.work},${summary.plan.rest},${summary.plan.nonwork},${summary.plan.useless},`;
        csv += `${summary.real.work},${summary.real.rest},${summary.real.nonwork},${summary.real.useless}\n`;
    });

    // Add totals
    let totals = { plan: { work: 0, rest: 0, nonwork: 0, useless: 0 }, real: { work: 0, rest: 0, nonwork: 0, useless: 0 } };
    dates.forEach(date => {
        const summary = calculateSummaryForDate(date);
        ['plan', 'real'].forEach(type => {
            ['work', 'rest', 'nonwork', 'useless'].forEach(cat => {
                totals[type][cat] += summary[type][cat];
            });
        });
    });

    csv += `TOTAL,${totals.plan.work},${totals.plan.rest},${totals.plan.nonwork},${totals.plan.useless},`;
    csv += `${totals.real.work},${totals.real.rest},${totals.real.nonwork},${totals.real.useless}\n`;

    const weekStart = dates[0];
    downloadFile(csv, `daily-planner-week-${weekStart}.csv`, 'text/csv');
}

// Export weekly data as JSON
function exportWeeklyJSON() {
    const dates = getCurrentWeekDates();
    const data = getData();

    const exportData = {
        weekStart: dates[0],
        weekEnd: dates[6],
        days: {}
    };

    dates.forEach(date => {
        const dayData = data[date] || { plan: [], real: [], todo: [] };
        exportData.days[date] = {
            plan: dayData.plan,
            real: dayData.real,
            todo: dayData.todo,
            summary: calculateSummaryForDate(date)
        };
    });

    const json = JSON.stringify(exportData, null, 2);
    downloadFile(json, `daily-planner-week-${dates[0]}.json`, 'application/json');
}

// Open export modal
function openExportModal() {
    const exportModal = document.getElementById('exportModal');
    if (exportModal) {
        exportModal.classList.add('active');
    }
}

// Close export modal
function closeExportModal() {
    const exportModal = document.getElementById('exportModal');
    if (exportModal) {
        exportModal.classList.remove('active');
    }
}

// Export for LLM (Markdown report)
function exportForLLM() {
    const dates = getCurrentWeekDates();
    const data = getData();

    let md = `# Weekly Time Report\n`;
    md += `**Week:** ${dates[0]} to ${dates[6]}\n`;
    md += `**Generated:** ${getKSTDateString()}\n\n`;

    // Global notes
    if (data._globalNotes) {
        md += `## Notes & Reminders\n${data._globalNotes}\n\n`;
    }

    // Weekly summary table
    md += `## Weekly Summary (in minutes)\n`;
    md += `| Date | Plan Work | Plan Rest | Real Work | Real Rest | Real Useless |\n`;
    md += `|------|-----------|-----------|-----------|-----------|-------------|\n`;

    let weekTotals = { planWork: 0, planRest: 0, realWork: 0, realRest: 0, realUseless: 0 };

    dates.forEach(date => {
        const summary = calculateSummaryForDate(date);
        md += `| ${date} | ${summary.plan.work} | ${summary.plan.rest} | ${summary.real.work} | ${summary.real.rest} | ${summary.real.useless} |\n`;
        weekTotals.planWork += summary.plan.work;
        weekTotals.planRest += summary.plan.rest;
        weekTotals.realWork += summary.real.work;
        weekTotals.realRest += summary.real.rest;
        weekTotals.realUseless += summary.real.useless;
    });

    md += `| **TOTAL** | ${weekTotals.planWork} | ${weekTotals.planRest} | ${weekTotals.realWork} | ${weekTotals.realRest} | ${weekTotals.realUseless} |\n\n`;

    // Convert to hours for readability
    md += `## Weekly Totals (hours)\n`;
    md += `- **Planned Work:** ${formatDuration(weekTotals.planWork)}\n`;
    md += `- **Actual Work:** ${formatDuration(weekTotals.realWork)} (${formatDiff(weekTotals.realWork - weekTotals.planWork)})\n`;
    md += `- **Planned Rest:** ${formatDuration(weekTotals.planRest)}\n`;
    md += `- **Actual Rest:** ${formatDuration(weekTotals.realRest)} (${formatDiff(weekTotals.realRest - weekTotals.planRest)})\n`;
    md += `- **Useless Time:** ${formatDuration(weekTotals.realUseless)}\n\n`;

    // Daily details
    md += `## Daily Details\n\n`;
    dates.forEach(date => {
        const dayData = data[date];
        if (!dayData) return;

        md += `### ${date}\n`;

        // Tasks done
        const doneTasks = (dayData.todo || []).filter(t => t.done);
        if (doneTasks.length > 0) {
            md += `**Completed:**\n`;
            doneTasks.forEach(t => md += `- ${t.title}\n`);
        }

        // Tasks not done
        const pendingTasks = (dayData.todo || []).filter(t => !t.done);
        if (pendingTasks.length > 0) {
            md += `**Not Completed:**\n`;
            pendingTasks.forEach(t => md += `- ${t.title}\n`);
        }

        md += `\n`;
    });

    downloadFile(md, `time-report-${dates[0]}.md`, 'text/markdown');
}

// Backup all data
function backupAllData() {
    const data = getData();
    const backup = {
        version: '2.0',
        exportDate: getKSTDateString(),
        data: data
    };
    const json = JSON.stringify(backup, null, 2);
    downloadFile(json, `daily-planner-backup-${getKSTDateString()}.json`, 'application/json');
}

// Import backup data
function importBackup(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const backup = JSON.parse(e.target.result);

            // Validate backup structure
            if (!backup.data) {
                alert('Invalid backup file format.');
                return;
            }

            openConfirmModal('This will overwrite all existing data. Continue?', () => {
                localStorage.setItem('dailyPlanner', JSON.stringify(backup.data));
                loadData();
                alert('Backup restored successfully!');
            });
        } catch (error) {
            alert('Error reading backup file: ' + error.message);
        }
    };
    reader.readAsText(file);
}

// Setup export event listeners
function setupExportEventListeners() {
    const exportBtn = document.getElementById('exportBtn');
    const btnExportDailyCSV = document.getElementById('btnExportDailyCSV');
    const btnExportDailyJSON = document.getElementById('btnExportDailyJSON');
    const btnExportWeeklyCSV = document.getElementById('btnExportWeeklyCSV');
    const btnExportWeeklyJSON = document.getElementById('btnExportWeeklyJSON');
    const btnExportLLM = document.getElementById('btnExportLLM');
    const btnBackup = document.getElementById('btnBackup');
    const importFileInput = document.getElementById('importFile');
    const btnExportClose = document.getElementById('btnExportClose');
    const exportModal = document.getElementById('exportModal');

    if (exportBtn) exportBtn.addEventListener('click', openExportModal);
    if (btnExportDailyCSV) btnExportDailyCSV.addEventListener('click', () => { exportDailyCSV(); closeExportModal(); });
    if (btnExportDailyJSON) btnExportDailyJSON.addEventListener('click', () => { exportDailyJSON(); closeExportModal(); });
    if (btnExportWeeklyCSV) btnExportWeeklyCSV.addEventListener('click', () => { exportWeeklyCSV(); closeExportModal(); });
    if (btnExportWeeklyJSON) btnExportWeeklyJSON.addEventListener('click', () => { exportWeeklyJSON(); closeExportModal(); });
    if (btnExportLLM) btnExportLLM.addEventListener('click', () => { exportForLLM(); closeExportModal(); });
    if (btnBackup) btnBackup.addEventListener('click', () => { backupAllData(); closeExportModal(); });
    if (importFileInput) {
        importFileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                importBackup(e.target.files[0]);
                e.target.value = ''; // Reset input
                closeExportModal();
            }
        });
    }
    if (btnExportClose) btnExportClose.addEventListener('click', closeExportModal);
    if (exportModal) {
        exportModal.addEventListener('click', (e) => {
            if (e.target === exportModal) closeExportModal();
        });
    }
}

// ============================================
// NOTES FUNCTIONS
// ============================================

// Setup notes event listeners
function setupNotesEventListeners() {
    const notesTextarea = document.getElementById('notesTextarea');
    if (!notesTextarea) return;

    // Auto-save on input with debounce
    let saveTimeout;
    notesTextarea.addEventListener('input', () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            saveNotes(notesTextarea.value);
        }, 500);
    });

    // Save on blur immediately
    notesTextarea.addEventListener('blur', () => {
        clearTimeout(saveTimeout);
        saveNotes(notesTextarea.value);
    });
}

// Save notes to localStorage (global, not per-date)
function saveNotes(text) {
    const data = getData();
    data._globalNotes = text;
    localStorage.setItem('dailyPlanner', JSON.stringify(data));
}

// Render notes (global)
function renderNotes() {
    const notesTextarea = document.getElementById('notesTextarea');
    if (!notesTextarea) return;

    const data = getData();
    notesTextarea.value = data._globalNotes || '';
}

// ============================================
// DATE NAVIGATION FUNCTIONS
// ============================================

function goToPreviousDay() {
    const date = new Date(currentDate);
    date.setDate(date.getDate() - 1);
    currentDate = date.toISOString().split('T')[0];
    updateDateDisplay();
    loadData();
    renderDdayDashboard();
}

function goToNextDay() {
    const date = new Date(currentDate);
    date.setDate(date.getDate() + 1);
    currentDate = date.toISOString().split('T')[0];
    updateDateDisplay();
    loadData();
    renderDdayDashboard();
}

function goToDate(dateStr) {
    currentDate = dateStr;
    updateDateDisplay();
    loadData();
    renderDdayDashboard();
}

// ============================================
// TODO LIST FUNCTIONS
// ============================================

// Setup TODO event listeners
function setupTodoEventListeners() {
    const addTodoBtn = document.getElementById('addTodoBtn');
    const carryTodoBtn = document.getElementById('carryTodoBtn');
    const todoModal = document.getElementById('todoModal');
    const todoTitleInput = document.getElementById('todoTitle');
    const btnTodoSave = document.getElementById('btnTodoSave');
    const btnTodoCancel = document.getElementById('btnTodoCancel');

    if (addTodoBtn) {
        addTodoBtn.addEventListener('click', openTodoModal);
    }

    if (carryTodoBtn) {
        carryTodoBtn.addEventListener('click', carryOverTodos);
    }

    if (btnTodoSave) {
        btnTodoSave.addEventListener('click', saveTodo);
    }

    if (btnTodoCancel) {
        btnTodoCancel.addEventListener('click', closeTodoModal);
    }

    if (todoModal) {
        todoModal.addEventListener('click', (e) => {
            if (e.target === todoModal) closeTodoModal();
        });
    }
}

// Get day data with todo array ensured
function getDayData(date) {
    const data = getData();
    if (!data[date]) {
        data[date] = { plan: [], real: [], todo: [] };
    }
    if (!data[date].todo) {
        data[date].todo = [];
    }
    return data[date];
}

// Open TODO modal
function openTodoModal() {
    const dayData = getDayData(currentDate);
    const incompleteTodos = dayData.todo.filter(t => !t.done);

    if (incompleteTodos.length >= MAX_TODO_ITEMS) {
        alert(`Maximum ${MAX_TODO_ITEMS} TODO items allowed. Complete or delete existing items first.`);
        return;
    }

    const todoModal = document.getElementById('todoModal');
    const todoTitleInput = document.getElementById('todoTitle');
    todoTitleInput.value = '';
    todoModal.classList.add('active');
    todoTitleInput.focus();

    // Handle Enter key
    todoTitleInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            saveTodo();
        } else if (e.key === 'Escape') {
            closeTodoModal();
        }
    };
}

// Close TODO modal
function closeTodoModal() {
    const todoModal = document.getElementById('todoModal');
    todoModal.classList.remove('active');
}

// Save new TODO
function saveTodo() {
    const todoTitleInput = document.getElementById('todoTitle');
    const title = todoTitleInput.value.trim();

    if (!title) {
        alert('Please enter a TODO item.');
        return;
    }

    const data = getData();
    if (!data[currentDate]) {
        data[currentDate] = { plan: [], real: [], todo: [] };
    }
    if (!data[currentDate].todo) {
        data[currentDate].todo = [];
    }

    const newTodo = {
        id: generateId(),
        title: title,
        color: TODO_COLORS.notUrgentNotImportant, // Default: Gray (Not Urgent & Not Important)
        done: false
    };

    data[currentDate].todo.push(newTodo);
    localStorage.setItem('dailyPlanner', JSON.stringify(data));

    closeTodoModal();
    renderTodoList();
}

// Render TODO list
function renderTodoList() {
    const todoListEl = document.getElementById('todoList');
    const doneListEl = document.getElementById('doneList');

    if (!todoListEl || !doneListEl) return;

    const dayData = getDayData(currentDate);
    const todos = dayData.todo || [];

    const incompleteTodos = todos.filter(t => !t.done);
    const completedTodos = todos.filter(t => t.done);

    // Render incomplete TODOs
    todoListEl.innerHTML = '';
    if (incompleteTodos.length === 0) {
        todoListEl.innerHTML = '<div class="todo-empty">No TODOs yet</div>';
    } else {
        incompleteTodos.forEach(todo => {
            const todoEl = createTodoElement(todo, false);
            todoListEl.appendChild(todoEl);
        });
    }

    // Render completed TODOs
    doneListEl.innerHTML = '';
    if (completedTodos.length === 0) {
        doneListEl.innerHTML = '<div class="todo-empty">No completed items</div>';
    } else {
        completedTodos.forEach(todo => {
            const todoEl = createTodoElement(todo, true);
            doneListEl.appendChild(todoEl);
        });
    }

    // Update TODO count
    const todoCountEl = document.getElementById('todoCount');
    if (todoCountEl) {
        todoCountEl.textContent = `(${incompleteTodos.length}/${MAX_TODO_ITEMS})`;
    }
}

// Create TODO element
function createTodoElement(todo, isDone) {
    const todoEl = document.createElement('div');
    todoEl.className = 'todo-item' + (isDone ? ' done' : '');
    todoEl.dataset.id = todo.id;
    todoEl.style.backgroundColor = todo.color;

    // Checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'todo-checkbox';
    checkbox.checked = isDone;
    checkbox.addEventListener('change', () => toggleTodoComplete(todo.id));

    // Title
    const titleEl = document.createElement('span');
    titleEl.className = 'todo-title';
    titleEl.textContent = todo.title;
    titleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        editTodoTitle(todo.id, titleEl);
    });

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'todo-delete-btn';
    deleteBtn.textContent = '×';
    deleteBtn.title = 'Delete';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTodo(todo.id);
    });

    todoEl.appendChild(checkbox);
    todoEl.appendChild(titleEl);
    todoEl.appendChild(deleteBtn);

    // Right-click to cycle priority color (only for incomplete todos)
    if (!isDone) {
        todoEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (e.target === checkbox || e.target === deleteBtn) return;
            toggleTodoPriority(todo.id);
        });
    }

    return todoEl;
}

// Toggle TODO complete status
function toggleTodoComplete(todoId) {
    const data = getData();
    const dayData = data[currentDate];
    if (!dayData || !dayData.todo) return;

    const todoIndex = dayData.todo.findIndex(t => t.id === todoId);
    if (todoIndex === -1) return;

    dayData.todo[todoIndex].done = !dayData.todo[todoIndex].done;
    localStorage.setItem('dailyPlanner', JSON.stringify(data));
    renderTodoList();
}

// Toggle TODO priority color (cycle through Eisenhower Matrix)
function toggleTodoPriority(todoId) {
    const data = getData();
    const dayData = data[currentDate];
    if (!dayData || !dayData.todo) return;

    const todoIndex = dayData.todo.findIndex(t => t.id === todoId);
    if (todoIndex === -1) return;

    const currentColor = dayData.todo[todoIndex].color;
    const currentIndex = TODO_COLOR_CYCLE.indexOf(currentColor);
    const nextIndex = (currentIndex + 1) % TODO_COLOR_CYCLE.length;
    dayData.todo[todoIndex].color = TODO_COLOR_CYCLE[nextIndex];

    localStorage.setItem('dailyPlanner', JSON.stringify(data));
    renderTodoList();
}

// Edit TODO title (inline editing)
function editTodoTitle(todoId, titleEl) {
    const data = getData();
    const dayData = data[currentDate];
    if (!dayData || !dayData.todo) return;

    const todo = dayData.todo.find(t => t.id === todoId);
    if (!todo) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'todo-edit-input';
    input.value = todo.title;

    const saveEdit = () => {
        const newTitle = input.value.trim();
        if (newTitle && newTitle !== todo.title) {
            todo.title = newTitle;
            localStorage.setItem('dailyPlanner', JSON.stringify(data));
        }
        renderTodoList();
    };

    input.addEventListener('blur', saveEdit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            input.blur();
        } else if (e.key === 'Escape') {
            renderTodoList();
        }
    });

    titleEl.replaceWith(input);
    input.focus();
    input.select();
}

// Delete TODO (no confirmation)
function deleteTodo(todoId) {
    const data = getData();
    const dayData = data[currentDate];
    if (!dayData || !dayData.todo) return;

    dayData.todo = dayData.todo.filter(t => t.id !== todoId);
    localStorage.setItem('dailyPlanner', JSON.stringify(data));
    renderTodoList();
}

// Carry over incomplete TODOs from yesterday
function carryOverTodos() {
    const yesterday = getYesterday(currentDate);
    const data = getData();

    const yesterdayData = data[yesterday];
    if (!yesterdayData || !yesterdayData.todo) {
        alert('No TODOs from yesterday to carry over.');
        return;
    }

    const incompleteTodos = yesterdayData.todo.filter(t => !t.done);
    if (incompleteTodos.length === 0) {
        alert('No incomplete TODOs from yesterday.');
        return;
    }

    const todayData = getDayData(currentDate);
    const currentIncompleteTodos = todayData.todo.filter(t => !t.done);
    const availableSlots = MAX_TODO_ITEMS - currentIncompleteTodos.length;

    if (availableSlots <= 0) {
        alert(`TODO list is full (${MAX_TODO_ITEMS} items). Complete or delete existing items first.`);
        return;
    }

    const todosToCarry = incompleteTodos.slice(0, availableSlots);
    const message = todosToCarry.length < incompleteTodos.length
        ? `Carry ${todosToCarry.length} of ${incompleteTodos.length} incomplete TODOs? (Only ${availableSlots} slots available)`
        : `Carry ${todosToCarry.length} incomplete TODO(s) from yesterday?`;

    openConfirmModal(message, () => {
        if (!data[currentDate]) {
            data[currentDate] = { plan: [], real: [], todo: [] };
        }
        if (!data[currentDate].todo) {
            data[currentDate].todo = [];
        }

        todosToCarry.forEach(todo => {
            const newTodo = {
                id: generateId(),
                title: todo.title,
                color: todo.color,
                done: false
            };
            data[currentDate].todo.push(newTodo);
        });

        localStorage.setItem('dailyPlanner', JSON.stringify(data));
        renderTodoList();
    });
}

// Get yesterday's date string
function getYesterday(dateStr) {
    const date = new Date(dateStr);
    date.setDate(date.getDate() - 1);
    return date.toISOString().split('T')[0];
}

// ============================================
// D-DAY FUNCTIONS
// ============================================

let editingDdayId = null;

function getDDays() {
    const data = getData();
    return data._ddays || [];
}

function saveDDays(ddays) {
    const data = getData();
    data._ddays = ddays;
    localStorage.setItem('dailyPlanner', JSON.stringify(data));
}

function calculateDDayCount(targetDateStr) {
    const today = getKSTDateString();
    const target = new Date(targetDateStr + 'T00:00:00');
    const current = new Date(today + 'T00:00:00');
    const diffTime = target - current;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
}

function renderDdayDashboard() {
    const ddayList = document.getElementById('ddayList');
    if (!ddayList) return;

    const ddays = getDDays();
    ddayList.innerHTML = '';

    if (ddays.length === 0) {
        ddayList.innerHTML = '<span class="dday-empty">No D-DAYs set</span>';
        return;
    }

    ddays.forEach(dday => {
        const ddayEl = document.createElement('div');
        ddayEl.className = 'dday-item';
        ddayEl.dataset.id = dday.id;

        const count = calculateDDayCount(dday.date);
        const countText = count === 0 ? 'D-DAY' : (count > 0 ? `D-${count}` : `D+${Math.abs(count)}`);
        const countClass = count === 0 ? 'dday-today' : (count > 0 ? 'dday-future' : 'dday-past');

        ddayEl.innerHTML = `
            <span class="dday-emoji">${dday.emoji || '📌'}</span>
            <span class="dday-title">${dday.title}</span>
            <span class="dday-count ${countClass}">${countText}</span>
        `;

        // Click to edit
        ddayEl.addEventListener('click', () => editDday(dday.id));

        // Right-click to delete
        ddayEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            deleteDday(dday.id);
        });

        ddayList.appendChild(ddayEl);
    });
}

function openDdayModal(ddayId = null) {
    const ddays = getDDays();

    if (!ddayId && ddays.length >= MAX_DDAYS) {
        alert(`Maximum ${MAX_DDAYS} D-DAYs allowed. Delete an existing one first.`);
        return;
    }

    const modal = document.getElementById('ddayModal');
    const titleInput = document.getElementById('ddayTitle');
    const emojiInput = document.getElementById('ddayEmoji');
    const dateInput = document.getElementById('ddayDate');
    const modalTitle = document.getElementById('ddayModalTitle');

    editingDdayId = ddayId;

    if (ddayId) {
        // Edit mode
        const dday = ddays.find(d => d.id === ddayId);
        if (dday) {
            modalTitle.textContent = 'Edit D-DAY';
            titleInput.value = dday.title;
            emojiInput.value = dday.emoji || '';
            dateInput.value = dday.date;
        }
    } else {
        // Add mode
        modalTitle.textContent = 'Add D-DAY';
        titleInput.value = '';
        emojiInput.value = '';
        dateInput.value = '';
    }

    modal.classList.add('active');
    titleInput.focus();
}

function closeDdayModal() {
    const modal = document.getElementById('ddayModal');
    modal.classList.remove('active');
    editingDdayId = null;
}

function saveDday() {
    const titleInput = document.getElementById('ddayTitle');
    const emojiInput = document.getElementById('ddayEmoji');
    const dateInput = document.getElementById('ddayDate');

    const title = titleInput.value.trim();
    const emoji = emojiInput.value.trim();
    const date = dateInput.value;

    if (!title) {
        alert('Please enter a title.');
        return;
    }

    if (!date) {
        alert('Please select a date.');
        return;
    }

    const ddays = getDDays();

    if (editingDdayId) {
        // Update existing
        const index = ddays.findIndex(d => d.id === editingDdayId);
        if (index !== -1) {
            ddays[index] = { ...ddays[index], title, emoji, date };
        }
    } else {
        // Add new
        const newDday = {
            id: 'dday_' + Date.now(),
            title,
            emoji,
            date
        };
        ddays.push(newDday);
    }

    saveDDays(ddays);
    closeDdayModal();
    renderDdayDashboard();
}

function editDday(ddayId) {
    openDdayModal(ddayId);
}

function deleteDday(ddayId) {
    openConfirmModal('Delete this D-DAY?', () => {
        const ddays = getDDays().filter(d => d.id !== ddayId);
        saveDDays(ddays);
        renderDdayDashboard();
    });
}

function setupDdayEventListeners() {
    const addDdayBtn = document.getElementById('addDdayBtn');
    const btnDdaySave = document.getElementById('btnDdaySave');
    const btnDdayCancel = document.getElementById('btnDdayCancel');
    const ddayModal = document.getElementById('ddayModal');
    const ddayTitleInput = document.getElementById('ddayTitle');

    if (addDdayBtn) addDdayBtn.addEventListener('click', () => openDdayModal());
    if (btnDdaySave) btnDdaySave.addEventListener('click', saveDday);
    if (btnDdayCancel) btnDdayCancel.addEventListener('click', closeDdayModal);

    if (ddayModal) {
        ddayModal.addEventListener('click', (e) => {
            if (e.target === ddayModal) closeDdayModal();
        });
    }

    if (ddayTitleInput) {
        ddayTitleInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') saveDday();
            if (e.key === 'Escape') closeDdayModal();
        });
    }
}

// ============================================
// CALENDAR PICKER
// ============================================

let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth();

function openCalendarModal() {
    const modal = document.getElementById('calendarModal');
    if (!modal) return;

    // Set calendar to current date's month
    const date = new Date(currentDate + 'T12:00:00');
    calendarYear = date.getFullYear();
    calendarMonth = date.getMonth();

    renderCalendar();
    modal.classList.add('active');
}

function closeCalendarModal() {
    const modal = document.getElementById('calendarModal');
    if (modal) modal.classList.remove('active');
}

function renderCalendar() {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];

    const calendarMonthEl = document.getElementById('calendarMonth');
    const calendarGrid = document.getElementById('calendarGrid');

    if (!calendarMonthEl || !calendarGrid) return;

    calendarMonthEl.textContent = `${monthNames[calendarMonth]} ${calendarYear}`;
    calendarGrid.innerHTML = '';

    // Get first day of month and total days
    const firstDay = new Date(calendarYear, calendarMonth, 1);
    const lastDay = new Date(calendarYear, calendarMonth + 1, 0);
    const totalDays = lastDay.getDate();

    // Get day of week for first day (0 = Sunday, convert to Monday start)
    let startDay = firstDay.getDay();
    startDay = startDay === 0 ? 6 : startDay - 1; // Convert to Monday = 0

    const today = getKSTDateString();
    const data = getData();

    // Add empty cells for days before first day
    for (let i = 0; i < startDay; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-day empty';
        calendarGrid.appendChild(emptyCell);
    }

    // Add day cells
    for (let day = 1; day <= totalDays; day++) {
        const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayCell = document.createElement('div');
        dayCell.className = 'calendar-day';
        dayCell.textContent = day;

        // Highlight today
        if (dateStr === today) {
            dayCell.classList.add('today');
        }

        // Highlight current selected date
        if (dateStr === currentDate) {
            dayCell.classList.add('selected');
        }

        // Show indicator if date has data
        if (data[dateStr] && (data[dateStr].plan?.length > 0 || data[dateStr].real?.length > 0 || data[dateStr].todo?.length > 0)) {
            dayCell.classList.add('has-data');
        }

        // Highlight weekends
        const dayOfWeek = new Date(dateStr + 'T12:00:00').getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            dayCell.classList.add('weekend');
        }

        dayCell.addEventListener('click', () => {
            goToDate(dateStr);
            closeCalendarModal();
        });

        calendarGrid.appendChild(dayCell);
    }
}

function setupCalendarEventListeners() {
    const currentDateEl = document.getElementById('currentDate');
    const calendarPrev = document.getElementById('calendarPrev');
    const calendarNext = document.getElementById('calendarNext');
    const calendarToday = document.getElementById('calendarToday');
    const btnCalendarClose = document.getElementById('btnCalendarClose');
    const calendarModal = document.getElementById('calendarModal');

    // Double-click on date to open calendar
    if (currentDateEl) {
        currentDateEl.addEventListener('dblclick', openCalendarModal);
        currentDateEl.style.cursor = 'pointer';
    }

    if (calendarPrev) {
        calendarPrev.addEventListener('click', () => {
            calendarMonth--;
            if (calendarMonth < 0) {
                calendarMonth = 11;
                calendarYear--;
            }
            renderCalendar();
        });
    }

    if (calendarNext) {
        calendarNext.addEventListener('click', () => {
            calendarMonth++;
            if (calendarMonth > 11) {
                calendarMonth = 0;
                calendarYear++;
            }
            renderCalendar();
        });
    }

    if (calendarToday) {
        calendarToday.addEventListener('click', () => {
            goToDate(getKSTDateString());
            closeCalendarModal();
        });
    }

    if (btnCalendarClose) {
        btnCalendarClose.addEventListener('click', closeCalendarModal);
    }

    if (calendarModal) {
        calendarModal.addEventListener('click', (e) => {
            if (e.target === calendarModal) closeCalendarModal();
        });
    }
}

// Initialize app
init();
