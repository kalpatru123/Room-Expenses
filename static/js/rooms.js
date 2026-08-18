/**
 * Roommate Expense Manager - Room Management
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Create Room Form
    const createRoomForm = document.getElementById('createRoomForm');
    if (createRoomForm) {
        createRoomForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = createRoomForm.querySelector('button[type="submit"]');
            btn.disabled = true;

            const data = {
                name: document.getElementById('roomName').value.trim(),
                description: document.getElementById('roomDescription').value.trim(),
                currency: document.getElementById('roomCurrency').value.trim() || '$',
            };

            try {
                const newRoom = await apiRequest('/api/rooms/', {
                    method: 'POST',
                    body: JSON.stringify(data)
                });
                
                Auth.setActiveRoom(newRoom);
                showToast(`Room "${newRoom.name}" created successfully!`, 'success');
                setTimeout(() => {
                    window.location.href = `/rooms/${newRoom.id}/`;
                }, 500);
            } catch (err) {
                showToast(err.message, 'error');
            } finally {
                btn.disabled = false;
            }
        });
    }

    // 2. Join Room Form
    const joinRoomForm = document.getElementById('joinRoomForm');
    if (joinRoomForm) {
        joinRoomForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = joinRoomForm.querySelector('button[type="submit"]');
            btn.disabled = true;

            const invite_code = document.getElementById('inviteCode').value.trim().toUpperCase();

            try {
                const res = await apiRequest('/api/rooms/join/', {
                    method: 'POST',
                    body: JSON.stringify({ invite_code })
                });

                Auth.setActiveRoom(res.room);
                showToast(res.message, 'success');
                setTimeout(() => {
                    window.location.href = `/rooms/${res.room.id}/`;
                }, 500);
            } catch (err) {
                showToast(err.message, 'error');
            } finally {
                btn.disabled = false;
            }
        });
    }

    // 3. Room List Page
    if (document.getElementById('roomsListContainer')) {
        Auth.requireAuth();
        loadAllRooms();
    }

    // 4. Room Detail Page
    const roomDetailContainer = document.getElementById('roomDetailContainer');
    if (roomDetailContainer) {
        Auth.requireAuth();
        const roomId = roomDetailContainer.getAttribute('data-room-id');
        if (roomId) {
            loadRoomDetail(roomId);
        }
    }
});

async function loadAllRooms() {
    const container = document.getElementById('roomsListContainer');
    if (!container) return;

    try {
        const rooms = await apiRequest('/api/rooms/');
        if (!rooms || rooms.length === 0) {
            container.innerHTML = `
                <div class="col-12 text-center py-5">
                    <i class="bi bi-door-open display-3 text-muted mb-3 d-block"></i>
                    <h5>No Rooms Joined Yet</h5>
                    <p class="text-muted">Create a room for your apartment or join an existing room with an invite code.</p>
                    <a href="/rooms/create-join/" class="btn btn-primary-custom">
                        <i class="bi bi-plus-lg me-1"></i> Create or Join Room
                    </a>
                </div>
            `;
            return;
        }

        const activeRoom = Auth.getActiveRoom();

        container.innerHTML = rooms.map(r => `
            <div class="col-md-6 col-lg-4 mb-4">
                <div class="card card-custom h-100 ${activeRoom && activeRoom.id === r.id ? 'border-primary' : ''}">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <h5 class="card-title fw-bold mb-0">${r.name}</h5>
                            <span class="badge ${r.my_role === 'ADMIN' ? 'bg-primary' : 'bg-secondary'}">${r.my_role || 'MEMBER'}</span>
                        </div>
                        <p class="card-text text-muted small mb-3">${r.description || 'No description provided.'}</p>
                        
                        <div class="d-flex align-items-center justify-content-between text-muted small mb-3">
                            <span><i class="bi bi-people me-1"></i> ${r.members_count} Members</span>
                            <span><i class="bi bi-currency-exchange me-1"></i> Currency: ${r.currency}</span>
                        </div>

                        <div class="bg-light p-2 rounded mb-3 d-flex align-items-center justify-content-between">
                            <span class="small font-monospace text-secondary">Code: <strong>${r.invite_code}</strong></span>
                            <button class="btn btn-sm btn-link p-0 text-decoration-none" onclick="copyInviteCode('${r.invite_code}')">
                                <i class="bi bi-clipboard me-1"></i> Copy
                            </button>
                        </div>

                        <div class="d-flex gap-2">
                            <a href="/rooms/${r.id}/" class="btn btn-sm btn-outline-custom flex-grow-1">
                                <i class="bi bi-gear me-1"></i> Details
                            </a>
                            <button class="btn btn-sm btn-primary-custom flex-grow-1" onclick="switchActiveRoom(${JSON.stringify(r).replace(/"/g, '&quot;')})">
                                <i class="bi bi-box-arrow-in-right me-1"></i> Switch To
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function loadRoomDetail(roomId) {
    try {
        const [room, members, balances] = await Promise.all([
            apiRequest(`/api/rooms/${roomId}/`),
            apiRequest(`/api/rooms/${roomId}/members/`),
            apiRequest(`/api/rooms/${roomId}/balances/`)
        ]);

        Auth.setActiveRoom(room);

        // Header info
        document.getElementById('roomNameHeading').textContent = room.name;
        document.getElementById('roomDescText').textContent = room.description || 'Shared apartment room';
        document.getElementById('roomInviteCodeBadge').textContent = room.invite_code;

        // Admin buttons
        const adminActions = document.getElementById('adminActions');
        if (adminActions) {
            if (room.my_role === 'ADMIN') {
                adminActions.classList.remove('d-none');
            } else {
                adminActions.classList.add('d-none');
            }
        }

        // Render Members list
        renderRoomMembers(members, room);

        // Render Balance table
        renderRoomBalances(balances.member_balances, room.currency);

    } catch (e) {
        showToast(e.message, 'error');
    }
}

function renderRoomMembers(members, room) {
    const listEl = document.getElementById('membersList');
    if (!listEl) return;

    const currentUser = Auth.getUser();

    listEl.innerHTML = members.map(m => `
        <div class="d-flex align-items-center justify-content-between py-2 border-bottom">
            <div class="d-flex align-items-center gap-3">
                <div class="user-avatar-sm" style="background-color: ${m.user.avatar_color || '#4F46E5'}">
                    ${m.user.initials}
                </div>
                <div>
                    <div class="fw-semibold text-dark">
                        ${m.user.display_name}
                        ${currentUser && currentUser.id === m.user.id ? '<span class="badge bg-light text-dark ms-1">You</span>' : ''}
                    </div>
                    <small class="text-muted">${m.user.email || m.user.username}</small>
                </div>
            </div>
            <div class="d-flex align-items-center gap-2">
                <span class="badge ${m.role === 'ADMIN' ? 'bg-primary-subtle text-primary' : 'bg-secondary-subtle text-secondary'}">
                    ${m.role_display}
                </span>
                ${(room.my_role === 'ADMIN' && currentUser && currentUser.id !== m.user.id) ? `
                    <button class="btn btn-sm btn-outline-danger p-1" title="Remove Member" onclick="removeMember(${room.id}, ${m.user.id}, '${m.user.display_name}')">
                        <i class="bi bi-person-x"></i>
                    </button>
                ` : ''}
            </div>
        </div>
    `).join('');
}

function renderRoomBalances(memberBalances, currency) {
    const tableBody = document.getElementById('roomBalancesTableBody');
    if (!tableBody) return;

    tableBody.innerHTML = memberBalances.map(b => {
        let badgeClass = 'bg-secondary';
        let badgeText = 'Settled';
        let balanceColor = 'text-secondary';

        if (b.net_balance > 0) {
            badgeClass = 'bg-success-subtle text-success';
            badgeText = `Gets back ${currency}${Math.abs(b.net_balance).toFixed(2)}`;
            balanceColor = 'text-success';
        } else if (b.net_balance < 0) {
            badgeClass = 'bg-danger-subtle text-danger';
            badgeText = `Owes ${currency}${Math.abs(b.net_balance).toFixed(2)}`;
            balanceColor = 'text-danger';
        }

        return `
            <tr>
                <td>
                    <div class="d-flex align-items-center gap-2">
                        <div class="user-avatar-sm" style="background-color: ${b.user.avatar_color || '#4F46E5'}">
                            ${b.user.initials}
                        </div>
                        <div>
                            <div class="fw-semibold">${b.user.display_name}</div>
                            <small class="text-muted">${b.role}</small>
                        </div>
                    </div>
                </td>
                <td class="text-end fw-semibold">${currency}${b.total_paid.toFixed(2)}</td>
                <td class="text-end fw-semibold">${currency}${b.total_share.toFixed(2)}</td>
                <td class="text-end fw-bold ${balanceColor}">
                    ${b.net_balance > 0 ? '+' : ''}${currency}${b.net_balance.toFixed(2)}
                </td>
                <td class="text-center">
                    <span class="badge ${badgeClass} px-2 py-1">${badgeText}</span>
                </td>
            </tr>
        `;
    }).join('');
}

function copyInviteCode(code) {
    navigator.clipboard.writeText(code).then(() => {
        showToast(`Invite code ${code} copied to clipboard!`, 'success');
    }).catch(() => {
        showToast(`Code: ${code}`, 'info');
    });
}

async function regenerateInvite(roomId) {
    if (!confirm('Are you sure you want to regenerate the invite code? The previous code will no longer work.')) return;
    try {
        const res = await apiRequest(`/api/rooms/${roomId}/regenerate-invite/`, { method: 'POST' });
        showToast(res.message, 'success');
        loadRoomDetail(roomId);
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function removeMember(roomId, userId, userName) {
    if (!confirm(`Are you sure you want to remove ${userName} from this room?`)) return;
    try {
        const res = await apiRequest(`/api/rooms/${roomId}/members/${userId}/`, { method: 'DELETE' });
        showToast(res.message, 'success');
        loadRoomDetail(roomId);
    } catch (e) {
        showToast(e.message, 'error');
    }
}

function switchActiveRoom(room) {
    Auth.setActiveRoom(room);
    showToast(`Switched active room to "${room.name}"`, 'success');
    setTimeout(() => {
        window.location.href = '/';
    }, 300);
}
