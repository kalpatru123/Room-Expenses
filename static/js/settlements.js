document.addEventListener('DOMContentLoaded', async () => {
    if (!Auth.isAuthenticated()) return;

    if (document.getElementById('settlementsTableBody')) {
        await loadSettlementsPage();
    }

    if (document.getElementById('settleUpModal')) {
        initSettlementModal();
    }

    if (document.getElementById('editSettlementModal')) {
        initEditSettlementModal();
    }
});

async function loadSettlementsPage() {
    const activeRoom = Auth.getActiveRoom();
    if (!activeRoom) {
        showToast('Please select a room first.', 'info');
        setTimeout(() => window.location.href = '/rooms/create-join/', 1000);
        return;
    }

    const titleEl = document.getElementById('settlementRoomTitle');
    if (titleEl) titleEl.textContent = `Settlements in ${activeRoom.name}`;

    await filterSettlements();
}

async function filterSettlements() {
    const activeRoom = Auth.getActiveRoom();
    if (!activeRoom) return;

    const tbody = document.getElementById('settlementsTableBody');
    if (!tbody) return;

    const status = document.getElementById('filterSettlementStatus')?.value || '';
    let url = `/api/settlements/?room=${activeRoom.id}`;
    if (status) url += `&status=${status}`;

    try {
        const settlements = await apiRequest(url);
        renderSettlementsTable(settlements, activeRoom.currency);
    } catch (e) {
        showToast(e.message, 'error');
    }
}

function renderSettlementsTable(settlements, currency) {
    const tbody = document.getElementById('settlementsTableBody');
    if (!tbody) return;

    if (!settlements || settlements.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center py-5 text-muted">
                    <i class="bi bi-wallet2 display-4 d-block mb-2 text-secondary"></i>
                    <h6>No settlements found</h6>
                    <p class="small">When roommates pay each other back, record settlements to balance the accounts.</p>
                </td>
            </tr>
        `;
        return;
    }

    const currentUser = Auth.getUser();

    tbody.innerHTML = settlements.map(s => {
        const isCompleted = s.status === 'COMPLETED';
        const isPending = s.status === 'PENDING';
        const isRejected = s.status === 'REJECTED';
        const isPayeeMe = currentUser && s.payee === currentUser.id;
        const isPayerMe = currentUser && s.payer === currentUser.id;
        const canEdit = Boolean(s.can_edit);
        const hasEditHistory = s.edit_history && s.edit_history.length > 0;

        // Status badge formatting
        let statusBadgeHtml = '';
        if (isCompleted) {
            statusBadgeHtml = `
                <span class="badge bg-success-subtle text-success px-2 py-1">
                    <i class="bi bi-check-circle-fill me-1"></i> Verified & Paid
                </span>
            `;
        } else if (isPending) {
            if (isPayeeMe) {
                statusBadgeHtml = `
                    <span class="badge bg-warning-subtle text-warning-emphasis px-2 py-1 border border-warning">
                        <i class="bi bi-bell-fill me-1"></i> Needs Your Verification
                    </span>
                `;
            } else if (isPayerMe) {
                statusBadgeHtml = `
                    <span class="badge bg-warning-subtle text-dark px-2 py-1">
                        <i class="bi bi-hourglass-split me-1"></i> Awaiting ${s.payee_details.display_name}'s Approval
                    </span>
                `;
            } else {
                statusBadgeHtml = `
                    <span class="badge bg-light text-secondary border px-2 py-1">
                        <i class="bi bi-hourglass-split me-1"></i> Pending Verification
                    </span>
                `;
            }
        } else if (isRejected) {
            statusBadgeHtml = `
                <span class="badge bg-danger-subtle text-danger px-2 py-1">
                    <i class="bi bi-x-circle-fill me-1"></i> Rejected / Cancelled
                </span>
            `;
        }

        // Action buttons: Only Room Creator / Admin can edit settlements; NO delete option allowed
        let editButton = '';
        if (canEdit) {
            editButton = `
                <button class="btn btn-sm btn-outline-primary py-1 px-2" title="Edit Settlement (Room Creator)" onclick="openEditSettlementModal(${s.id})">
                    <i class="bi bi-pencil"></i>
                </button>
            `;
        }

        let actionHtml = '';
        if (isPending) {
            if (s.can_verify) {
                actionHtml = `
                    <div class="d-flex justify-content-center align-items-center gap-1">
                        <button class="btn btn-sm btn-success py-1 px-2" title="Verify Payment Received" onclick="verifySettlement(${s.id})">
                            <i class="bi bi-check-lg me-1"></i> Verify
                        </button>
                        <button class="btn btn-sm btn-outline-danger py-1 px-2" title="Reject Payment" onclick="rejectSettlement(${s.id})">
                            <i class="bi bi-x-lg"></i>
                        </button>
                        ${editButton}
                    </div>
                `;
            } else if (s.can_reject) {
                actionHtml = `
                    <div class="d-flex justify-content-center align-items-center gap-1">
                        <button class="btn btn-sm btn-outline-secondary py-1 px-2" onclick="rejectSettlement(${s.id})">
                            <i class="bi bi-x-circle me-1"></i> Cancel
                        </button>
                        ${editButton}
                    </div>
                `;
            } else {
                actionHtml = `
                    <div class="d-flex justify-content-center align-items-center gap-1">
                        <small class="text-muted fst-italic me-1">Waiting for recipient</small>
                        ${editButton}
                    </div>
                `;
            }
        } else if (isCompleted) {
            actionHtml = `
                <div class="d-flex justify-content-center align-items-center gap-2">
                    <small class="text-success fw-semibold">
                        <i class="bi bi-check2-all"></i> ${s.completed_at ? new Date(s.completed_at).toLocaleDateString() : 'Completed'}
                    </small>
                    ${editButton}
                </div>
            `;
        } else if (isRejected) {
            actionHtml = `
                <div class="d-flex justify-content-center align-items-center gap-2">
                    <small class="text-danger fw-semibold">
                        <i class="bi bi-slash-circle"></i> Voided
                    </small>
                    ${editButton}
                </div>
            `;
        }

        return `
            <tr class="${isPending && isPayeeMe ? 'table-warning bg-opacity-25' : ''}">
                <td>
                    <div class="d-flex align-items-center gap-2">
                        <div class="user-avatar-sm" style="background-color: ${s.payer_details.avatar_color || '#4F46E5'}">
                            ${s.payer_details.initials}
                        </div>
                        <span class="fw-semibold">${s.payer_details.display_name} ${isPayerMe ? '<span class="badge bg-light text-dark ms-1">You</span>' : ''}</span>
                    </div>
                </td>
                <td>
                    <div class="d-flex align-items-center gap-2">
                        <div class="user-avatar-sm" style="background-color: ${s.payee_details.avatar_color || '#10B981'}">
                            ${s.payee_details.initials}
                        </div>
                        <span class="fw-semibold">${s.payee_details.display_name} ${isPayeeMe ? '<span class="badge bg-light text-dark ms-1">You</span>' : ''}</span>
                    </div>
                </td>
                <td>
                    <div class="fw-bold text-dark fs-6">${currency}${parseFloat(s.amount).toFixed(2)}</div>
                    ${hasEditHistory ? `
                        <span role="button" class="badge bg-info-subtle text-info-emphasis border border-info px-2 py-1 mt-1 cursor-pointer" onclick="viewSettlementHistoryModal(${s.id})" title="Click to view edit history & previous values">
                            <i class="bi bi-clock-history me-1"></i> Edited (${s.edit_history.length})
                        </span>
                    ` : ''}
                </td>
                <td>
                    <div class="small text-dark">${s.notes || '<span class="text-muted fst-italic">Direct payment</span>'}</div>
                    <small class="text-muted">${new Date(s.created_at).toLocaleDateString()}</small>
                </td>
                <td>${statusBadgeHtml}</td>
                <td class="text-center">${actionHtml}</td>
            </tr>
        `;
    }).join('');
}

function initSettlementModal() {
    const modalEl = document.getElementById('settleUpModal');
    if (modalEl) {
        modalEl.addEventListener('show.bs.modal', async () => {
            const activeRoom = await Auth.ensureValidActiveRoom();
            if (!activeRoom) return;

            const currSymbol = document.getElementById('settlementCurrencySymbol');
            if (currSymbol) currSymbol.textContent = activeRoom.currency || '₹';

            const payerSelect = document.getElementById('settlementPayer');
            const payeeSelect = document.getElementById('settlementPayee');
            const currentUser = Auth.getUser();

            if (payerSelect && payeeSelect) {
                try {
                    const members = await apiRequest(`/api/rooms/${activeRoom.id}/members/`);
                    
                    // Payer is logged-in user by default
                    payerSelect.innerHTML = members
                        .filter(m => currentUser && m.user.id === currentUser.id)
                        .map(m => `<option value="${m.user.id}" selected>${m.user.display_name} (You)</option>`)
                        .join('');

                    // Payee dropdown contains other roommates
                    const otherMembers = members.filter(m => !currentUser || m.user.id !== currentUser.id);
                    payeeSelect.innerHTML = otherMembers.map(m => `
                        <option value="${m.user.id}">
                            ${m.user.display_name}
                        </option>
                    `).join('');
                } catch (err) {
                    console.error('Failed to load members for settlement modal', err);
                }
            }
        });
    }

    const form = document.getElementById('recordSettlementForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('saveSettlementBtn');
            btn.disabled = true;

            const activeRoom = await Auth.ensureValidActiveRoom();
            if (!activeRoom) {
                showToast('Please select or join a room first.', 'error');
                btn.disabled = false;
                return;
            }

            const payerVal = document.getElementById('settlementPayer').value;
            const payeeVal = document.getElementById('settlementPayee').value;
            const amountVal = document.getElementById('settlementAmount').value;

            if (!payerVal || !payeeVal || !amountVal) {
                showToast('Please select both payer and payee and enter a valid amount.', 'error');
                btn.disabled = false;
                return;
            }

            const payload = {
                room: activeRoom.id,
                payer: parseInt(payerVal),
                payee: parseInt(payeeVal),
                amount: parseFloat(amountVal),
                notes: document.getElementById('settlementNotes').value.trim()
            };

            try {
                const res = await apiRequest('/api/settlements/', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });

                if (res.status === 'PENDING') {
                    showToast('Settlement recorded! Awaiting recipient verification.', 'info');
                } else {
                    showToast('Settlement payment recorded successfully!', 'success');
                }
                
                const modal = bootstrap.Modal.getInstance(document.getElementById('settleUpModal'));
                if (modal) modal.hide();

                if (document.getElementById('settlementsTableBody')) {
                    await filterSettlements();
                } else {
                    window.location.reload();
                }
            } catch (err) {
                showToast(err.message, 'error');
            } finally {
                btn.disabled = false;
            }
        });
    }
}

async function openSettleModal(payerId, payeeId, amount, payerName, payeeName) {
    const activeRoom = await Auth.ensureValidActiveRoom();
    if (!activeRoom) return;

    try {
        const members = await apiRequest(`/api/rooms/${activeRoom.id}/members/`);
        const currentUser = Auth.getUser();
        
        const currSymbol = document.getElementById('settlementCurrencySymbol');
        if (currSymbol) currSymbol.textContent = activeRoom.currency || '₹';

        const payerSelect = document.getElementById('settlementPayer');
        const payeeSelect = document.getElementById('settlementPayee');

        if (payerSelect && payeeSelect) {
            // If current user is the payer (paying someone)
            if (currentUser && payerId === currentUser.id) {
                payerSelect.innerHTML = `<option value="${currentUser.id}" selected>${currentUser.display_name || currentUser.username} (You)</option>`;

                const otherMembers = members.filter(m => m.user.id !== currentUser.id);
                payeeSelect.innerHTML = otherMembers.map(m => `
                    <option value="${m.user.id}" ${payeeId && m.user.id === payeeId ? 'selected' : ''}>
                        ${m.user.display_name}
                    </option>
                `).join('');
            } 
            // If current user is the payee (recording receipt from someone)
            else if (currentUser && payeeId === currentUser.id) {
                payeeSelect.innerHTML = `<option value="${currentUser.id}" selected>${currentUser.display_name || currentUser.username} (You)</option>`;

                const otherMembers = members.filter(m => m.user.id !== currentUser.id);
                payerSelect.innerHTML = otherMembers.map(m => `
                    <option value="${m.user.id}" ${payerId && m.user.id === payerId ? 'selected' : ''}>
                        ${m.user.display_name}
                    </option>
                `).join('');
            }
            // General fallback
            else {
                payerSelect.innerHTML = members.map(m => `
                    <option value="${m.user.id}" ${currentUser && m.user.id === currentUser.id ? 'selected' : ''}>
                        ${m.user.display_name} ${currentUser && m.user.id === currentUser.id ? '(You)' : ''}
                    </option>
                `).join('');

                payeeSelect.innerHTML = members.map((m, idx) => `
                    <option value="${m.user.id}" ${idx === 1 ? 'selected' : ''}>
                        ${m.user.display_name}
                    </option>
                `).join('');
            }
        }

        if (amount) {
            document.getElementById('settlementAmount').value = parseFloat(amount).toFixed(2);
        }

        const modalEl = document.getElementById('settleUpModal');
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function verifySettlement(settlementId) {
    if (!confirm("Confirm that you have received this payment? Once verified, the room debt will be settled.")) {
        return;
    }

    try {
        const res = await apiRequest(`/api/settlements/${settlementId}/verify/`, { method: 'POST' });
        showToast(res.message, 'success');
        if (document.getElementById('settlementsTableBody')) {
            await filterSettlements();
        } else {
            window.location.reload();
        }
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function rejectSettlement(settlementId) {
    if (!confirm("Are you sure you want to reject/cancel this settlement payment?")) {
        return;
    }

    try {
        const res = await apiRequest(`/api/settlements/${settlementId}/reject/`, { method: 'POST' });
        showToast(res.message, 'info');
        if (document.getElementById('settlementsTableBody')) {
            await filterSettlements();
        } else {
            window.location.reload();
        }
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function markSettlementPaid(settlementId) {
    return verifySettlement(settlementId);
}

/**
 * Edit & Delete Settlement Logic
 */
function initEditSettlementModal() {
    const form = document.getElementById('editSettlementForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('updateSettlementBtn');
            btn.disabled = true;
            const origBtnText = btn.innerHTML;
            btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Updating...`;

            const activeRoom = Auth.getActiveRoom();
            if (!activeRoom) {
                showToast('Please select a room first.', 'error');
                btn.disabled = false;
                btn.innerHTML = origBtnText;
                return;
            }

            const settlementId = document.getElementById('editSettlementId').value;
            const payerVal = document.getElementById('editSettlementPayer').value;
            const payeeVal = document.getElementById('editSettlementPayee').value;
            const amountVal = document.getElementById('editSettlementAmount').value;

            if (!payerVal || !payeeVal || !amountVal) {
                showToast('Please select both payer and payee and enter a valid amount.', 'error');
                btn.disabled = false;
                btn.innerHTML = origBtnText;
                return;
            }

            const payload = {
                room: activeRoom.id,
                payer: parseInt(payerVal),
                payee: parseInt(payeeVal),
                amount: parseFloat(amountVal),
                notes: document.getElementById('editSettlementNotes').value.trim()
            };

            try {
                await apiRequest(`/api/settlements/${settlementId}/`, {
                    method: 'PUT',
                    body: JSON.stringify(payload)
                });

                showToast('Settlement payment updated successfully!', 'success');

                const modalEl = document.getElementById('editSettlementModal');
                if (modalEl) {
                    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
                    modal.hide();
                }

                if (document.getElementById('settlementsTableBody')) {
                    await filterSettlements();
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
        });
    }
}

async function openEditSettlementModal(settlementId) {
    const activeRoom = await Auth.ensureValidActiveRoom();
    if (!activeRoom) return;

    try {
        const [settlement, members] = await Promise.all([
            apiRequest(`/api/settlements/${settlementId}/`),
            apiRequest(`/api/rooms/${activeRoom.id}/members/`)
        ]);

        if (!settlement) return;

        document.getElementById('editSettlementId').value = settlement.id;
        document.getElementById('editSettlementAmount').value = parseFloat(settlement.amount).toFixed(2);
        document.getElementById('editSettlementNotes').value = settlement.notes || '';

        const currSymbol = document.getElementById('editSettlementCurrencySymbol');
        if (currSymbol) currSymbol.textContent = settlement.currency || activeRoom.currency || '₹';

        const payerSelect = document.getElementById('editSettlementPayer');
        const payeeSelect = document.getElementById('editSettlementPayee');

        if (payerSelect && payeeSelect) {
            payerSelect.innerHTML = members.map(m => `
                <option value="${m.user.id}" ${settlement.payer === m.user.id ? 'selected' : ''}>
                    ${m.user.display_name}
                </option>
            `).join('');

            payeeSelect.innerHTML = members.map(m => `
                <option value="${m.user.id}" ${settlement.payee === m.user.id ? 'selected' : ''}>
                    ${m.user.display_name}
                </option>
            `).join('');
        }

        const modalEl = document.getElementById('editSettlementModal');
        if (modalEl) {
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            modal.show();
        }
    } catch (err) {
        showToast('Failed to load settlement details: ' + err.message, 'error');
    }
}

async function viewSettlementHistoryModal(settlementId) {
    const modalEl = document.getElementById('settlementHistoryModal');
    const modalBody = document.getElementById('settlementHistoryModalBody');
    if (!modalEl || !modalBody) return;

    modalBody.innerHTML = `
        <div class="text-center py-4">
            <div class="spinner-border text-primary" role="status"></div>
            <div class="small text-muted mt-2">Loading audit history...</div>
        </div>
    `;
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();

    try {
        const settlement = await apiRequest(`/api/settlements/${settlementId}/`);
        const history = settlement.edit_history || [];
        const currency = settlement.currency || '₹';

        if (history.length === 0) {
            modalBody.innerHTML = `
                <div class="text-center py-4 text-muted">
                    <i class="bi bi-info-circle fs-3 d-block mb-2"></i>
                    <p class="mb-0">No edit history recorded. This settlement has not been modified since creation.</p>
                </div>
            `;
            return;
        }

        modalBody.innerHTML = `
            <div class="d-flex align-items-center justify-content-between pb-3 border-bottom mb-3">
                <div>
                    <span class="text-muted small">Current Amount:</span>
                    <div class="fw-bold fs-5 text-success">${currency}${parseFloat(settlement.amount).toFixed(2)}</div>
                </div>
                <div class="text-end">
                    <span class="text-muted small">Total Edits:</span>
                    <div><span class="badge bg-primary">${history.length} change${history.length > 1 ? 's' : ''}</span></div>
                </div>
            </div>

            <div class="timeline">
                ${history.map((h, idx) => `
                    <div class="border rounded-3 p-3 mb-3 bg-light position-relative">
                        <div class="d-flex align-items-center justify-content-between mb-2">
                            <div class="d-flex align-items-center gap-2">
                                <div class="user-avatar-sm" style="background-color: ${h.edited_by_details?.avatar_color || '#4F46E5'}; width: 28px; height: 28px; font-size: 0.75rem;">
                                    ${h.edited_by_details?.initials || 'U'}
                                </div>
                                <div>
                                    <span class="fw-bold text-dark">${h.edited_by_details?.display_name || 'Room Creator'}</span>
                                    <span class="badge bg-secondary-subtle text-secondary ms-1 small">Room Creator / Admin</span>
                                </div>
                            </div>
                            <small class="text-muted">${new Date(h.edited_at).toLocaleString()}</small>
                        </div>

                        <div class="row g-2 small mt-2">
                            <div class="col-6">
                                <div class="p-2 border rounded bg-white">
                                    <div class="text-danger fw-semibold mb-1"><i class="bi bi-arrow-left-circle me-1"></i> Previous Value</div>
                                    <div class="fw-bold text-dark fs-6">${currency}${parseFloat(h.previous_amount).toFixed(2)}</div>
                                    <div class="text-muted text-truncate" title="${h.previous_notes || 'None'}">Note: ${h.previous_notes || '<span class="fst-italic">None</span>'}</div>
                                </div>
                            </div>
                            <div class="col-6">
                                <div class="p-2 border rounded bg-white">
                                    <div class="text-success fw-semibold mb-1"><i class="bi bi-arrow-right-circle me-1"></i> New Value</div>
                                    <div class="fw-bold text-dark fs-6">${currency}${parseFloat(h.new_amount).toFixed(2)}</div>
                                    <div class="text-muted text-truncate" title="${h.new_notes || 'None'}">Note: ${h.new_notes || '<span class="fst-italic">None</span>'}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (err) {
        modalBody.innerHTML = `
            <div class="alert alert-danger mb-0">
                Failed to load edit history: ${err.message}
            </div>
        `;
    }
}

