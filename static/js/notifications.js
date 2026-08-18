/**
 * Roommate Expense Manager - Notification & Verification Pop-up Engine
 */

let shownModalSettlementIds = new Set();

document.addEventListener('DOMContentLoaded', () => {
    if (!Auth.isAuthenticated()) return;

    // Initial check on load
    checkPendingVerifications();

    // Background interval check every 10 seconds for real-time notification
    setInterval(() => {
        if (Auth.isAuthenticated()) {
            checkPendingVerifications();
        }
    }, 10000);
});

async function checkPendingVerifications() {
    const currentUser = Auth.getUser();
    if (!currentUser) return;

    try {
        // Fetch all pending settlements awaiting verification by the current user across all rooms
        const url = '/api/settlements/?pending_for_me=true';
        const pendingSettlements = await apiRequest(url);
        
        const activeRoom = Auth.getActiveRoom();
        updateNotificationUI(pendingSettlements, currentUser, activeRoom);

        // If there are pending settlements awaiting verification by this user
        if (pendingSettlements && pendingSettlements.length > 0) {
            const modalEl = document.getElementById('pendingVerificationModal');
            const isModalOpen = modalEl && modalEl.classList.contains('show');

            // Trigger modal popup if not already open
            if (!isModalOpen) {
                const newest = pendingSettlements[0];
                showVerificationPopup(newest, newest.currency || activeRoom?.currency || '₹');
            }
        }
    } catch (err) {
        console.debug('Notification check polling error:', err);
    }
}

function updateNotificationUI(pendingSettlements, currentUser, activeRoom) {
    const badge = document.getElementById('navNotificationBadge');
    const countBadge = document.getElementById('notificationCountBadge');
    const listContainer = document.getElementById('notificationListItems');

    const count = (pendingSettlements || []).length;
    const currency = activeRoom?.currency || '₹';

    if (badge) {
        if (count > 0) {
            badge.textContent = count > 9 ? '9+' : count;
            badge.classList.remove('d-none');
        } else {
            badge.classList.add('d-none');
        }
    }

    if (countBadge) {
        countBadge.textContent = `${count} New`;
    }

    if (listContainer) {
        if (count === 0) {
            listContainer.innerHTML = `
                <div class="text-center py-4 text-muted small">
                    <i class="bi bi-check2-circle fs-3 d-block text-secondary mb-1"></i>
                    No pending verifications
                </div>
            `;
            return;
        }

        listContainer.innerHTML = pendingSettlements.map(s => `
            <div class="p-2 mb-2 bg-light rounded border">
                <div class="d-flex align-items-center gap-2 mb-2">
                    <div class="user-avatar-sm" style="background-color: ${s.payer_details.avatar_color || '#4F46E5'}">
                        ${s.payer_details.initials}
                    </div>
                    <div class="flex-grow-1 overflow-hidden">
                        <div class="fw-semibold text-truncate small text-dark">${s.payer_details.display_name}</div>
                        <div class="text-success fw-bold small">${currency}${parseFloat(s.amount).toFixed(2)}</div>
                    </div>
                </div>
                ${s.notes ? `<p class="small text-muted mb-2 fst-italic">"${s.notes}"</p>` : ''}
                <div class="d-flex gap-1 justify-content-end">
                    <button class="btn btn-sm btn-outline-danger py-0 px-2 small" onclick="globalRejectSettlement(${s.id})">
                        Reject
                    </button>
                    <button class="btn btn-sm btn-success py-0 px-2 small" onclick="globalVerifySettlement(${s.id})">
                        <i class="bi bi-check-lg"></i> Confirm
                    </button>
                </div>
            </div>
        `).join('');
    }
}

function showVerificationPopup(settlement, currency) {
    const modalEl = document.getElementById('pendingVerificationModal');
    const modalBody = document.getElementById('pendingVerificationModalBody');
    if (!modalEl || !modalBody) return;

    modalBody.innerHTML = `
        <div class="text-center mb-3">
            <div class="user-avatar-sm mx-auto mb-2" style="width: 54px; height: 54px; font-size: 1.25rem; background-color: ${settlement.payer_details.avatar_color || '#4F46E5'}">
                ${settlement.payer_details.initials}
            </div>
            <h5 class="fw-bold text-dark mb-1">${settlement.payer_details.display_name}</h5>
            <p class="text-muted small mb-2">recorded a settlement payment in <strong>${settlement.room_name}</strong></p>
            <div class="display-6 fw-bold text-success my-2">
                ${currency}${parseFloat(settlement.amount).toFixed(2)}
            </div>
        </div>

        <div class="bg-light p-3 rounded-3 border mb-3 small">
            <div class="d-flex justify-content-between mb-1">
                <span class="text-muted">Payment Ref / Note:</span>
                <span class="fw-semibold text-dark">${settlement.notes || 'Direct payment / Cash / UPI'}</span>
            </div>
            <div class="d-flex justify-content-between">
                <span class="text-muted">Recorded Date:</span>
                <span class="fw-semibold text-dark">${new Date(settlement.created_at).toLocaleString()}</span>
            </div>
        </div>

        <div class="alert alert-warning py-2 px-3 small d-flex align-items-center gap-2 mb-3">
            <i class="bi bi-info-circle-fill fs-5 text-warning flex-shrink-0"></i>
            <div>Did you receive this money? Room balances will only update after your confirmation.</div>
        </div>

        <div class="d-flex gap-2">
            <button type="button" class="btn btn-outline-danger flex-grow-1" onclick="globalRejectSettlement(${settlement.id}, true)">
                <i class="bi bi-x-circle me-1"></i> No, Reject
            </button>
            <button type="button" class="btn btn-success flex-grow-1 fw-bold" onclick="globalVerifySettlement(${settlement.id}, true)">
                <i class="bi bi-check-circle-fill me-1"></i> Yes, I Received This
            </button>
        </div>
    `;

    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
}

async function globalVerifySettlement(settlementId, fromModal = false) {
    try {
        const res = await apiRequest(`/api/settlements/${settlementId}/verify/`, { method: 'POST' });
        showToast(res.message || 'Payment receipt verified successfully!', 'success');

        if (fromModal) {
            const modalEl = document.getElementById('pendingVerificationModal');
            if (modalEl) {
                const modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
                modalInstance.hide();
            }
        }

        // Refresh notifications
        await checkPendingVerifications();

        // If on settlements or dashboard page, reload/refresh
        if (typeof filterSettlements === 'function') {
            await filterSettlements();
        } else if (typeof loadDashboardData === 'function') {
            await loadDashboardData();
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function globalRejectSettlement(settlementId, fromModal = false) {
    if (!confirm("Are you sure you want to reject this payment? The debt will remain active.")) {
        return;
    }

    try {
        const res = await apiRequest(`/api/settlements/${settlementId}/reject/`, { method: 'POST' });
        showToast(res.message || 'Settlement rejected.', 'info');

        if (fromModal) {
            const modalEl = document.getElementById('pendingVerificationModal');
            if (modalEl) {
                const modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
                modalInstance.hide();
            }
        }

        // Refresh notifications
        await checkPendingVerifications();

        // If on settlements or dashboard page, reload/refresh
        if (typeof filterSettlements === 'function') {
            await filterSettlements();
        } else if (typeof loadDashboardData === 'function') {
            await loadDashboardData();
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}
