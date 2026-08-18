/**
 * Roommate Expense Manager - Expenses List & Split Modal Logic
 */

let roomMembersCache = [];
let categoriesCache = [];

document.addEventListener('DOMContentLoaded', async () => {
    if (!Auth.isAuthenticated()) return;

    // Prefetch modal data in the background on page load
    const activeRoom = Auth.getActiveRoom();
    if (activeRoom) {
        ensureModalDataLoaded(activeRoom.id);
    }

    if (document.getElementById('expensesTableBody')) {
        await loadExpensesPage();
    }

    if (document.getElementById('addExpenseModal')) {
        initExpenseModalEvents();
    }

    if (document.getElementById('editExpenseModal')) {
        initEditExpenseModalEvents();
    }
});

async function loadExpensesPage() {
    const activeRoom = Auth.getActiveRoom();
    if (!activeRoom) {
        showToast('Please select or join a room first.', 'info');
        setTimeout(() => window.location.href = '/rooms/create-join/', 1000);
        return;
    }

    // Set page room info
    const titleEl = document.getElementById('expenseRoomTitle');
    if (titleEl) titleEl.textContent = `Expenses in ${activeRoom.name}`;

    try {
        const [categories, members] = await Promise.all([
            apiRequest(`/api/categories/?room=${activeRoom.id}`),
            apiRequest(`/api/rooms/${activeRoom.id}/members/`)
        ]);

        categoriesCache = categories;
        roomMembersCache = members;

        populateFilterDropdowns(categories, members);
        await filterExpenses();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

function populateFilterDropdowns(categories, members) {
    const catSelect = document.getElementById('filterCategory');
    if (catSelect) {
        catSelect.innerHTML = `<option value="">All Categories</option>` +
            categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    }

    const payerSelect = document.getElementById('filterPaidBy');
    if (payerSelect) {
        payerSelect.innerHTML = `<option value="">All Payers</option>` +
            members.map(m => `<option value="${m.user.id}">${m.user.display_name}</option>`).join('');
    }
}

async function filterExpenses() {
    const activeRoom = Auth.getActiveRoom();
    if (!activeRoom) return;

    const tbody = document.getElementById('expensesTableBody');
    if (!tbody) return;

    const category = document.getElementById('filterCategory')?.value || '';
    const paidBy = document.getElementById('filterPaidBy')?.value || '';
    const search = document.getElementById('searchExpenseInput')?.value || '';

    let url = `/api/expenses/?room=${activeRoom.id}`;
    if (category) url += `&category=${category}`;
    if (paidBy) url += `&paid_by=${paidBy}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;

    try {
        const expenses = await apiRequest(url);
        renderExpensesTable(expenses, activeRoom.currency);
    } catch (e) {
        showToast(e.message, 'error');
    }
}

function renderExpensesTable(expenses, currency) {
    const tbody = document.getElementById('expensesTableBody');
    if (!tbody) return;

    if (!expenses || expenses.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center py-5 text-muted">
                    <i class="bi bi-receipt display-4 d-block mb-2 text-secondary"></i>
                    <h6>No expenses found</h6>
                    <p class="small">Add a shared expense to split costs with your roommates.</p>
                </td>
            </tr>
        `;
        return;
    }

    const currentUser = Auth.getUser();

    tbody.innerHTML = expenses.map(exp => {
        const isPayer = currentUser && exp.paid_by === currentUser.id;
        const mySplit = exp.splits ? exp.splits.find(s => currentUser && s.user.id === currentUser.id) : null;

        return `
            <tr>
                <td>
                    <div class="fw-semibold text-dark">${exp.title}</div>
                    ${exp.notes ? `<small class="text-muted text-truncate d-block" style="max-width: 200px;">${exp.notes}</small>` : ''}
                </td>
                <td>
                    ${exp.category_details ? `
                        <span class="category-badge" style="background-color: ${exp.category_details.color || '#6B7280'}">
                            <i class="bi ${exp.category_details.icon || 'bi-tag'}"></i> ${exp.category_details.name}
                        </span>
                    ` : '<span class="badge bg-secondary">General</span>'}
                </td>
                <td>
                    <div class="d-flex align-items-center gap-2">
                        <div class="user-avatar-sm" style="background-color: ${exp.paid_by_details.avatar_color || '#4F46E5'}">
                            ${exp.paid_by_details.initials}
                        </div>
                        <span>${exp.paid_by_details.display_name} ${isPayer ? '<span class="badge bg-light text-dark">You</span>' : ''}</span>
                    </div>
                </td>
                <td class="text-muted small">${exp.date}</td>
                <td class="text-end fw-bold text-dark">${currency}${parseFloat(exp.amount).toFixed(2)}</td>
                <td class="text-end">
                    ${mySplit ? `<span class="fw-semibold text-danger">${currency}${parseFloat(mySplit.amount).toFixed(2)}</span>` : '<span class="text-muted small">Not involved</span>'}
                </td>
                <td class="text-center">
                    <button class="btn btn-sm btn-outline-secondary me-1" title="View Splits" onclick="viewExpenseSplitsModal(${JSON.stringify(exp).replace(/"/g, '&quot;')})">
                        <i class="bi bi-eye"></i>
                    </button>
                    ${isPayer ? `
                        <button class="btn btn-sm btn-outline-primary me-1" title="Edit Expense" onclick="openEditExpenseModal(${exp.id})">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" title="Delete Expense" onclick="deleteExpense(${exp.id}, '${exp.title.replace(/'/g, "\\'")}')">
                            <i class="bi bi-trash"></i>
                        </button>
                    ` : ''}
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Add Expense Modal Logic & Interactive Split UI
 */
let currentLoadedRoomId = null;

async function ensureModalDataLoaded(roomId) {
    if (currentLoadedRoomId === roomId && categoriesCache.length > 0 && roomMembersCache.length > 0) {
        return;
    }
    try {
        const [categories, members] = await Promise.all([
            apiRequest(`/api/categories/?room=${roomId}`),
            apiRequest(`/api/rooms/${roomId}/members/`)
        ]);
        categoriesCache = categories;
        roomMembersCache = members;
        currentLoadedRoomId = roomId;
    } catch (err) {
        console.error('Failed to load categories or members for expense modal', err);
    }
}

function populateExpenseModalUI() {
    const catSelect = document.getElementById('expenseCategory');
    if (catSelect) {
        if (categoriesCache && categoriesCache.length > 0) {
            catSelect.innerHTML = categoriesCache.map(c => `
                <option value="${c.id}">${c.name}</option>
            `).join('');
        } else {
            catSelect.innerHTML = `<option value="">General</option>`;
        }
    }

    const payerSelect = document.getElementById('expensePaidBy');
    const currentUser = Auth.getUser();
    if (payerSelect) {
        if (roomMembersCache && roomMembersCache.length > 0) {
            payerSelect.innerHTML = roomMembersCache.map(m => `
                <option value="${m.user.id}" ${currentUser && m.user.id === currentUser.id ? 'selected' : ''}>
                    ${m.user.display_name} (${m.user.username})
                </option>
            `).join('');
        } else if (currentUser) {
            payerSelect.innerHTML = `<option value="${currentUser.id}">${currentUser.display_name || currentUser.username}</option>`;
        }
    }

    const dateInput = document.getElementById('expenseDate');
    if (dateInput && !dateInput.value) {
        dateInput.value = new Date().toISOString().split('T')[0];
    }

    renderParticipantSplitInputs();
}

function initExpenseModalEvents() {
    const modalEl = document.getElementById('addExpenseModal');
    if (!modalEl) return;

    // Fast synchronous populate from cache, refresh in background
    modalEl.addEventListener('show.bs.modal', async () => {
        let activeRoom = Auth.getActiveRoom();
        if (!activeRoom) {
            activeRoom = await Auth.ensureValidActiveRoom();
        }
        if (!activeRoom) {
            showToast('Please select or join a room first.', 'warning');
            return;
        }

        const currSym = document.getElementById('expenseCurrencySymbol');
        if (currSym) currSym.textContent = activeRoom.currency || '₹';

        // If not cached for this room yet, load before rendering
        if (!roomMembersCache || roomMembersCache.length === 0 || currentLoadedRoomId !== activeRoom.id) {
            await ensureModalDataLoaded(activeRoom.id);
        }
        populateExpenseModalUI();
    });

    // Recalculate on amount or split type change
    document.getElementById('expenseAmount')?.addEventListener('input', updateSplitCalculations);
    document.querySelectorAll('input[name="splitType"]').forEach(radio => {
        radio.addEventListener('change', () => {
            renderParticipantSplitInputs();
            updateSplitCalculations();
        });
    });

    // Form submission
    const form = document.getElementById('addExpenseForm') || document.getElementById('createExpenseForm');
    if (form) {
        form.onsubmit = handleExpenseSubmit;
    }
}

function renderParticipantSplitInputs() {
    const container = document.getElementById('splitParticipantsList');
    if (!container) return;

    const splitType = document.querySelector('input[name="splitType"]:checked')?.value || 'EQUAL';
    const activeRoom = Auth.getActiveRoom();
    const currency = activeRoom ? activeRoom.currency : '₹';
    const currentUser = Auth.getUser();

    container.innerHTML = roomMembersCache.map(m => {
        return `
            <div class="split-member-row">
                <div class="form-check d-flex align-items-center gap-2 mb-0">
                    <input class="form-check-input participant-checkbox" type="checkbox" value="${m.user.id}" id="split_user_${m.user.id}" checked onchange="updateSplitCalculations()">
                    <label class="form-check-label d-flex align-items-center gap-2 cursor-pointer" for="split_user_${m.user.id}">
                        <div class="user-avatar-sm" style="background-color: ${m.user.avatar_color || '#4F46E5'}; width: 26px; height: 26px; font-size: 0.7rem;">
                            ${m.user.initials}
                        </div>
                        <span class="small fw-semibold">${m.user.display_name}</span>
                    </label>
                </div>

                <div class="split-input-wrapper" style="width: 130px;">
                    ${splitType === 'EQUAL' ? `
                        <span class="badge bg-light text-dark border w-100 py-2 equal-share-preview" data-user-id="${m.user.id}">${currency}0.00</span>
                    ` : (splitType === 'CUSTOM' ? `
                        <div class="input-group input-group-sm">
                            <span class="input-group-text">${currency}</span>
                            <input type="number" step="0.01" min="0" class="form-control custom-amount-input" data-user-id="${m.user.id}" placeholder="0.00" oninput="updateSplitCalculations()">
                        </div>
                    ` : `
                        <div class="input-group input-group-sm">
                            <input type="number" step="0.1" min="0" max="100" class="form-control percent-amount-input" data-user-id="${m.user.id}" placeholder="0" oninput="updateSplitCalculations()">
                            <span class="input-group-text">%</span>
                        </div>
                    `)}
                </div>
            </div>
        `;
    }).join('');

    updateSplitCalculations();
}

function updateSplitCalculations() {
    const totalAmount = parseFloat(document.getElementById('expenseAmount')?.value) || 0;
    const splitType = document.querySelector('input[name="splitType"]:checked')?.value || 'EQUAL';
    const statusBox = document.getElementById('splitValidationStatus');
    const checkedCheckboxes = Array.from(document.querySelectorAll('.participant-checkbox:checked'));
    const activeRoom = Auth.getActiveRoom();
    const currency = activeRoom ? activeRoom.currency : '₹';

    if (splitType === 'EQUAL') {
        const count = checkedCheckboxes.length;
        const equalShare = count > 0 ? (totalAmount / count).toFixed(2) : '0.00';

        document.querySelectorAll('.equal-share-preview').forEach(el => {
            const uid = el.getAttribute('data-user-id');
            const isChecked = document.getElementById(`split_user_${uid}`)?.checked;
            el.textContent = isChecked ? `${currency}${equalShare}` : 'Excluded';
            el.className = isChecked ? 'badge bg-light text-dark border w-100 py-2' : 'badge bg-secondary-subtle text-muted border w-100 py-2';
        });

        if (statusBox) {
            statusBox.innerHTML = count > 0 && totalAmount > 0 ?
                `<div class="text-success small fw-semibold"><i class="bi bi-check-circle me-1"></i> Total ${currency}${totalAmount.toFixed(2)} split equally into ${currency}${equalShare} each among ${count} roommates.</div>` :
                `<div class="text-muted small">Select participating roommates and enter total amount.</div>`;
        }
    } else if (splitType === 'CUSTOM') {
        let runningTotal = 0;
        document.querySelectorAll('.custom-amount-input').forEach(inp => {
            runningTotal += parseFloat(inp.value) || 0;
        });

        const diff = totalAmount - runningTotal;
        if (statusBox) {
            if (Math.abs(diff) < 0.01 && totalAmount > 0) {
                statusBox.innerHTML = `<div class="text-success small fw-semibold"><i class="bi bi-check-circle me-1"></i> Exact match! Total custom split matches ${currency}${totalAmount.toFixed(2)}.</div>`;
            } else {
                statusBox.innerHTML = `<div class="text-danger small fw-semibold"><i class="bi bi-exclamation-triangle me-1"></i> Assigned: ${currency}${runningTotal.toFixed(2)} / Total: ${currency}${totalAmount.toFixed(2)} (${diff > 0 ? `${currency}${diff.toFixed(2)} remaining` : `${currency}${Math.abs(diff).toFixed(2)} over limit`})</div>`;
            }
        }
    } else if (splitType === 'PERCENTAGE') {
        let totalPercent = 0;
        document.querySelectorAll('.percent-amount-input').forEach(inp => {
            totalPercent += parseFloat(inp.value) || 0;
        });

        const diff = 100 - totalPercent;
        if (statusBox) {
            if (Math.abs(diff) < 0.01) {
                statusBox.innerHTML = `<div class="text-success small fw-semibold"><i class="bi bi-check-circle me-1"></i> Percentages sum to exactly 100%.</div>`;
            } else {
                statusBox.innerHTML = `<div class="text-danger small fw-semibold"><i class="bi bi-exclamation-triangle me-1"></i> Current sum: ${totalPercent.toFixed(1)}% / 100% (${diff > 0 ? `${diff.toFixed(1)}% remaining` : `${Math.abs(diff).toFixed(1)}% over`})</div>`;
            }
        }
    }
}

async function handleExpenseSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('saveExpenseBtn');
    btn.disabled = true;

    const activeRoom = await Auth.ensureValidActiveRoom();
    if (!activeRoom) {
        showToast('Please select or join a room first.', 'error');
        btn.disabled = false;
        return;
    }

    const currency = activeRoom.currency || '₹';
    const amountVal = document.getElementById('expenseAmount').value;
    const totalAmount = parseFloat(amountVal);

    if (!amountVal || isNaN(totalAmount) || totalAmount <= 0) {
        showToast('Please enter a valid expense amount greater than 0.', 'error');
        btn.disabled = false;
        return;
    }

    const titleVal = document.getElementById('expenseTitle').value.trim();
    if (!titleVal) {
        showToast('Please enter an expense title.', 'error');
        btn.disabled = false;
        return;
    }

    const payerVal = document.getElementById('expensePaidBy').value;
    if (!payerVal) {
        showToast('Please select who paid for this expense.', 'error');
        btn.disabled = false;
        return;
    }

    const splitType = document.querySelector('input[name="splitType"]:checked')?.value || 'EQUAL';
    const splitsData = [];

    if (splitType === 'EQUAL') {
        const checked = document.querySelectorAll('.participant-checkbox:checked');
        if (checked.length === 0) {
            showToast('Please select at least one roommate to participate in the split.', 'error');
            btn.disabled = false;
            return;
        }
        checked.forEach(cb => {
            splitsData.push({ user_id: parseInt(cb.value) });
        });
    } else if (splitType === 'CUSTOM') {
        let sum = 0;
        document.querySelectorAll('.custom-amount-input').forEach(inp => {
            const uid = parseInt(inp.getAttribute('data-user-id'));
            const amt = parseFloat(inp.value) || 0;
            if (amt > 0) {
                splitsData.push({ user_id: uid, amount: amt });
                sum += amt;
            }
        });
        if (Math.abs(sum - totalAmount) > 0.01) {
            showToast(`Custom split amounts must equal total expense of ${currency}${totalAmount.toFixed(2)} (currently ${currency}${sum.toFixed(2)})`, 'error');
            btn.disabled = false;
            return;
        }
    } else if (splitType === 'PERCENTAGE') {
        let sumPct = 0;
        document.querySelectorAll('.percent-amount-input').forEach(inp => {
            const uid = parseInt(inp.getAttribute('data-user-id'));
            const pct = parseFloat(inp.value) || 0;
            if (pct > 0) {
                splitsData.push({ user_id: uid, percentage: pct });
                sumPct += pct;
            }
        });
        if (Math.abs(sumPct - 100) > 0.01) {
            showToast('Percentages must sum to 100%', 'error');
            btn.disabled = false;
            return;
        }
    }

    const catVal = document.getElementById('expenseCategory').value;

    const payload = {
        room: activeRoom.id,
        title: titleVal,
        amount: totalAmount,
        category: catVal ? parseInt(catVal) : null,
        paid_by: parseInt(payerVal),
        split_type: splitType,
        date: document.getElementById('expenseDate').value || new Date().toISOString().split('T')[0],
        notes: document.getElementById('expenseNotes').value.trim(),
        splits_data: splitsData
    };

    btn.disabled = true;
    const origBtnText = btn.innerHTML;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Saving...`;

    try {
        await apiRequest('/api/expenses/', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        showToast('Expense recorded and split successfully!', 'success');
        
        // Hide modal and reset form
        const modalEl = document.getElementById('addExpenseModal');
        if (modalEl) {
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            modal.hide();
        }
        document.getElementById('addExpenseForm')?.reset();

        // Refresh view immediately
        if (document.getElementById('expensesTableBody')) {
            await filterExpenses();
        } else if (typeof loadDashboardData === 'function') {
            await loadDashboardData();
        } else {
            window.location.reload();
        }
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = origBtnText;
    }
}

function viewExpenseSplitsModal(expense) {
    const modalEl = document.getElementById('viewSplitsModal');
    if (!modalEl) return;

    document.getElementById('viewExpenseTitle').textContent = expense.title;
    document.getElementById('viewExpenseTotal').textContent = `${expense.currency || '$'}${parseFloat(expense.amount).toFixed(2)}`;
    document.getElementById('viewExpensePaidBy').textContent = expense.paid_by_details.display_name;
    document.getElementById('viewExpenseDate').textContent = expense.date;

    const list = document.getElementById('viewExpenseSplitsList');
    list.innerHTML = (expense.splits || []).map(s => `
        <div class="d-flex align-items-center justify-content-between py-2 border-bottom">
            <div class="d-flex align-items-center gap-2">
                <div class="user-avatar-sm" style="background-color: ${s.user.avatar_color || '#4F46E5'}; width: 28px; height: 28px; font-size: 0.75rem;">
                    ${s.user.initials}
                </div>
                <span class="fw-semibold">${s.user.display_name}</span>
            </div>
            <div class="text-end">
                <span class="fw-bold text-dark">${expense.currency || '$'}${parseFloat(s.amount).toFixed(2)}</span>
                ${s.percentage ? `<small class="text-muted ms-1">(${s.percentage}%)</small>` : ''}
            </div>
        </div>
    `).join('');

    const modal = new bootstrap.Modal(modalEl);
    modal.show();
}

async function deleteExpense(expenseId, title) {
    if (!confirm(`Are you sure you want to delete "${title}"? All split records will be removed.`)) return;

    try {
        await apiRequest(`/api/expenses/${expenseId}/`, { method: 'DELETE' });
        showToast(`Expense "${title}" deleted.`, 'success');
        if (document.getElementById('expensesTableBody')) {
            await filterExpenses();
        } else if (typeof loadDashboardData === 'function') {
            await loadDashboardData();
        } else {
            window.location.reload();
        }
    } catch (e) {
        showToast(e.message, 'error');
    }
}

/**
 * Edit Expense Logic
 */
let editModalSplitsCache = [];

function initEditExpenseModalEvents() {
    document.getElementById('editExpenseAmount')?.addEventListener('input', updateEditSplitCalculations);
    document.querySelectorAll('input[name="editSplitType"]').forEach(radio => {
        radio.addEventListener('change', () => {
            renderEditParticipantSplitInputs(editModalSplitsCache);
            updateEditSplitCalculations();
        });
    });

    const editForm = document.getElementById('editExpenseForm');
    if (editForm) {
        editForm.onsubmit = handleEditExpenseSubmit;
    }
}

async function openEditExpenseModal(expenseId) {
    const activeRoom = Auth.getActiveRoom();
    if (!activeRoom) return;

    try {
        const exp = await apiRequest(`/api/expenses/${expenseId}/`);
        if (!exp) return;

        // Ensure room categories and members are loaded
        if (!roomMembersCache || roomMembersCache.length === 0 || currentLoadedRoomId !== activeRoom.id) {
            await ensureModalDataLoaded(activeRoom.id);
        }

        document.getElementById('editExpenseId').value = exp.id;
        document.getElementById('editExpenseTitle').value = exp.title;
        document.getElementById('editExpenseAmount').value = parseFloat(exp.amount).toFixed(2);
        document.getElementById('editExpenseDate').value = exp.date;
        document.getElementById('editExpenseNotes').value = exp.notes || '';

        const currSym = document.getElementById('editExpenseCurrencySymbol');
        if (currSym) currSym.textContent = exp.currency || activeRoom.currency || '₹';

        // Populate Categories
        const catSelect = document.getElementById('editExpenseCategory');
        if (catSelect && categoriesCache && categoriesCache.length > 0) {
            catSelect.innerHTML = categoriesCache.map(c => `
                <option value="${c.id}" ${exp.category === c.id ? 'selected' : ''}>${c.name}</option>
            `).join('');
        }

        // Populate Paid By
        const payerSelect = document.getElementById('editExpensePaidBy');
        if (payerSelect && roomMembersCache && roomMembersCache.length > 0) {
            payerSelect.innerHTML = roomMembersCache.map(m => `
                <option value="${m.user.id}" ${exp.paid_by === m.user.id ? 'selected' : ''}>
                    ${m.user.display_name} (${m.user.username})
                </option>
            `).join('');
        }

        // Set Split Type
        const splitType = exp.split_type || 'EQUAL';
        if (splitType === 'EQUAL') {
            const el = document.getElementById('editSplitEqually');
            if (el) el.checked = true;
        } else if (splitType === 'CUSTOM') {
            const el = document.getElementById('editSplitCustom');
            if (el) el.checked = true;
        } else if (splitType === 'PERCENTAGE') {
            const el = document.getElementById('editSplitPercent');
            if (el) el.checked = true;
        }

        editModalSplitsCache = exp.splits || [];
        renderEditParticipantSplitInputs(editModalSplitsCache);
        updateEditSplitCalculations();

        const modalEl = document.getElementById('editExpenseModal');
        if (modalEl) {
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            modal.show();
        }
    } catch (err) {
        showToast('Failed to load expense details for editing: ' + err.message, 'error');
    }
}

function renderEditParticipantSplitInputs(existingSplits = []) {
    const container = document.getElementById('editSplitParticipantsList');
    if (!container) return;

    const splitType = document.querySelector('input[name="editSplitType"]:checked')?.value || 'EQUAL';
    const activeRoom = Auth.getActiveRoom();
    const currency = activeRoom ? activeRoom.currency : '₹';

    container.innerHTML = roomMembersCache.map(m => {
        const split = existingSplits.find(s => s.user.id === m.user.id);
        const isChecked = Boolean(split);
        const splitAmt = split ? parseFloat(split.amount).toFixed(2) : '0.00';
        const splitPct = split && split.percentage ? parseFloat(split.percentage).toFixed(1) : '0';

        return `
            <div class="split-member-row">
                <div class="form-check d-flex align-items-center gap-2 mb-0">
                    <input class="form-check-input edit-participant-checkbox" type="checkbox" value="${m.user.id}" id="edit_split_user_${m.user.id}" ${isChecked ? 'checked' : ''} onchange="updateEditSplitCalculations()">
                    <label class="form-check-label d-flex align-items-center gap-2 cursor-pointer" for="edit_split_user_${m.user.id}">
                        <div class="user-avatar-sm" style="background-color: ${m.user.avatar_color || '#4F46E5'}; width: 26px; height: 26px; font-size: 0.7rem;">
                            ${m.user.initials}
                        </div>
                        <span class="small fw-semibold">${m.user.display_name}</span>
                    </label>
                </div>

                <div class="split-input-wrapper" style="width: 130px;">
                    ${splitType === 'EQUAL' ? `
                        <span class="badge bg-light text-dark border w-100 py-2 edit-equal-share-preview" data-user-id="${m.user.id}">${currency}0.00</span>
                    ` : (splitType === 'CUSTOM' ? `
                        <div class="input-group input-group-sm">
                            <span class="input-group-text">${currency}</span>
                            <input type="number" step="0.01" min="0" class="form-control edit-custom-amount-input" data-user-id="${m.user.id}" value="${splitAmt}" placeholder="0.00" oninput="updateEditSplitCalculations()">
                        </div>
                    ` : `
                        <div class="input-group input-group-sm">
                            <input type="number" step="0.1" min="0" max="100" class="form-control edit-percent-amount-input" data-user-id="${m.user.id}" value="${splitPct}" placeholder="0" oninput="updateEditSplitCalculations()">
                            <span class="input-group-text">%</span>
                        </div>
                    `)}
                </div>
            </div>
        `;
    }).join('');

    updateEditSplitCalculations();
}

function updateEditSplitCalculations() {
    const totalAmount = parseFloat(document.getElementById('editExpenseAmount')?.value) || 0;
    const splitType = document.querySelector('input[name="editSplitType"]:checked')?.value || 'EQUAL';
    const statusBox = document.getElementById('editSplitValidationStatus');
    const checkedCheckboxes = Array.from(document.querySelectorAll('.edit-participant-checkbox:checked'));
    const activeRoom = Auth.getActiveRoom();
    const currency = activeRoom ? activeRoom.currency : '₹';

    if (splitType === 'EQUAL') {
        const count = checkedCheckboxes.length;
        const equalShare = count > 0 ? (totalAmount / count).toFixed(2) : '0.00';

        document.querySelectorAll('.edit-equal-share-preview').forEach(el => {
            const uid = el.getAttribute('data-user-id');
            const isChecked = document.getElementById(`edit_split_user_${uid}`)?.checked;
            el.textContent = isChecked ? `${currency}${equalShare}` : 'Excluded';
            el.className = isChecked ? 'badge bg-light text-dark border w-100 py-2' : 'badge bg-secondary-subtle text-muted border w-100 py-2';
        });

        if (statusBox) {
            statusBox.innerHTML = count > 0 && totalAmount > 0 ?
                `<div class="text-success small fw-semibold"><i class="bi bi-check-circle me-1"></i> Total ${currency}${totalAmount.toFixed(2)} split equally into ${currency}${equalShare} each among ${count} roommates.</div>` :
                `<div class="text-muted small">Select participating roommates and enter total amount.</div>`;
        }
    } else if (splitType === 'CUSTOM') {
        let runningTotal = 0;
        document.querySelectorAll('.edit-custom-amount-input').forEach(inp => {
            runningTotal += parseFloat(inp.value) || 0;
        });

        const diff = totalAmount - runningTotal;
        if (statusBox) {
            if (Math.abs(diff) < 0.01 && totalAmount > 0) {
                statusBox.innerHTML = `<div class="text-success small fw-semibold"><i class="bi bi-check-circle me-1"></i> Exact match! Total custom split matches ${currency}${totalAmount.toFixed(2)}.</div>`;
            } else {
                statusBox.innerHTML = `<div class="text-danger small fw-semibold"><i class="bi bi-exclamation-triangle me-1"></i> Assigned: ${currency}${runningTotal.toFixed(2)} / Total: ${currency}${totalAmount.toFixed(2)} (${diff > 0 ? `${currency}${diff.toFixed(2)} remaining` : `${currency}${Math.abs(diff).toFixed(2)} over limit`})</div>`;
            }
        }
    } else if (splitType === 'PERCENTAGE') {
        let totalPercent = 0;
        document.querySelectorAll('.edit-percent-amount-input').forEach(inp => {
            totalPercent += parseFloat(inp.value) || 0;
        });

        const diff = 100 - totalPercent;
        if (statusBox) {
            if (Math.abs(diff) < 0.01) {
                statusBox.innerHTML = `<div class="text-success small fw-semibold"><i class="bi bi-check-circle me-1"></i> Percentages sum to exactly 100%.</div>`;
            } else {
                statusBox.innerHTML = `<div class="text-danger small fw-semibold"><i class="bi bi-exclamation-triangle me-1"></i> Current sum: ${totalPercent.toFixed(1)}% / 100% (${diff > 0 ? `${diff.toFixed(1)}% remaining` : `${Math.abs(diff).toFixed(1)}% over`})</div>`;
            }
        }
    }
}

async function handleEditExpenseSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('updateExpenseBtn');
    btn.disabled = true;
    const origBtnText = btn.innerHTML;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Updating...`;

    const activeRoom = Auth.getActiveRoom();
    if (!activeRoom) {
        showToast('Please select or join a room first.', 'error');
        btn.disabled = false;
        btn.innerHTML = origBtnText;
        return;
    }

    const expenseId = document.getElementById('editExpenseId').value;
    const currency = activeRoom.currency || '₹';
    const amountVal = document.getElementById('editExpenseAmount').value;
    const totalAmount = parseFloat(amountVal);

    if (!amountVal || isNaN(totalAmount) || totalAmount <= 0) {
        showToast('Please enter a valid expense amount greater than 0.', 'error');
        btn.disabled = false;
        btn.innerHTML = origBtnText;
        return;
    }

    const titleVal = document.getElementById('editExpenseTitle').value.trim();
    if (!titleVal) {
        showToast('Please enter an expense title.', 'error');
        btn.disabled = false;
        btn.innerHTML = origBtnText;
        return;
    }

    const payerVal = document.getElementById('editExpensePaidBy').value;
    if (!payerVal) {
        showToast('Please select who paid for this expense.', 'error');
        btn.disabled = false;
        btn.innerHTML = origBtnText;
        return;
    }

    const splitType = document.querySelector('input[name="editSplitType"]:checked')?.value || 'EQUAL';
    const splitsData = [];

    if (splitType === 'EQUAL') {
        const checked = document.querySelectorAll('.edit-participant-checkbox:checked');
        if (checked.length === 0) {
            showToast('Please select at least one roommate to participate in the split.', 'error');
            btn.disabled = false;
            btn.innerHTML = origBtnText;
            return;
        }
        checked.forEach(cb => {
            splitsData.push({ user_id: parseInt(cb.value) });
        });
    } else if (splitType === 'CUSTOM') {
        let sum = 0;
        document.querySelectorAll('.edit-custom-amount-input').forEach(inp => {
            const uid = parseInt(inp.getAttribute('data-user-id'));
            const amt = parseFloat(inp.value) || 0;
            if (amt > 0) {
                splitsData.push({ user_id: uid, amount: amt });
                sum += amt;
            }
        });
        if (Math.abs(sum - totalAmount) > 0.01) {
            showToast(`Custom split amounts must equal total expense of ${currency}${totalAmount.toFixed(2)} (currently ${currency}${sum.toFixed(2)})`, 'error');
            btn.disabled = false;
            btn.innerHTML = origBtnText;
            return;
        }
    } else if (splitType === 'PERCENTAGE') {
        let sumPct = 0;
        document.querySelectorAll('.edit-percent-amount-input').forEach(inp => {
            const uid = parseInt(inp.getAttribute('data-user-id'));
            const pct = parseFloat(inp.value) || 0;
            if (pct > 0) {
                splitsData.push({ user_id: uid, percentage: pct });
                sumPct += pct;
            }
        });
        if (Math.abs(sumPct - 100) > 0.01) {
            showToast('Percentages must sum to 100%', 'error');
            btn.disabled = false;
            btn.innerHTML = origBtnText;
            return;
        }
    }

    const catVal = document.getElementById('editExpenseCategory').value;

    const payload = {
        room: activeRoom.id,
        title: titleVal,
        amount: totalAmount,
        category: catVal ? parseInt(catVal) : null,
        paid_by: parseInt(payerVal),
        split_type: splitType,
        date: document.getElementById('editExpenseDate').value || new Date().toISOString().split('T')[0],
        notes: document.getElementById('editExpenseNotes').value.trim(),
        splits_data: splitsData
    };

    try {
        await apiRequest(`/api/expenses/${expenseId}/`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });

        showToast('Expense updated successfully!', 'success');

        const modalEl = document.getElementById('editExpenseModal');
        if (modalEl) {
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            modal.hide();
        }

        if (document.getElementById('expensesTableBody')) {
            await filterExpenses();
        } else if (typeof loadDashboardData === 'function') {
            await loadDashboardData();
        } else {
            window.location.reload();
        }
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = origBtnText;
    }
}
