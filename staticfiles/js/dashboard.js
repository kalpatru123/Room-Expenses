/**
 * Roommate Expense Manager - Dashboard & Visual Analytics
 */

let categoryChartInstance = null;
let monthlyChartInstance = null;
let memberChartInstance = null;

document.addEventListener('DOMContentLoaded', async () => {
    // Only execute on dashboard page
    if (!document.getElementById('dashboardRoot')) return;

    if (!Auth.requireAuth()) return;

    await initializeRoomSelector();
    await loadDashboardData();
});

async function initializeRoomSelector() {
    try {
        const rooms = await apiRequest('/api/rooms/');
        const selectContainer = document.getElementById('navbarRoomSelector');
        const activeRoom = Auth.getActiveRoom();

        if (!rooms || rooms.length === 0) {
            if (selectContainer) {
                selectContainer.innerHTML = `
                    <a href="/rooms/create-join/" class="btn btn-sm btn-warning">
                        <i class="bi bi-plus-circle me-1"></i> Create/Join Room
                    </a>
                `;
            }
            document.getElementById('dashboardRoot').innerHTML = `
                <div class="card card-custom p-5 text-center my-4">
                    <i class="bi bi-houses display-3 text-primary mb-3"></i>
                    <h3 class="fw-bold">No Active Room Found</h3>
                    <p class="text-muted max-w-md mx-auto mb-4">
                        To start managing expenses, split bills, and view debt balances, create a new room or join your roommates' room with an invite code.
                    </p>
                    <div>
                        <a href="/rooms/create-join/" class="btn btn-primary-custom px-4 py-2">
                            <i class="bi bi-plus-lg me-1"></i> Create or Join Room
                        </a>
                    </div>
                </div>
            `;
            return false;
        }

        // If no active room in storage, or stored room is no longer in user's rooms, default to first room
        let current = rooms.find(r => activeRoom && r.id === activeRoom.id);
        if (!current) {
            current = rooms[0];
            Auth.setActiveRoom(current);
        }

        if (selectContainer) {
            selectContainer.innerHTML = `
                <div class="dropdown">
                    <button class="room-selector-btn dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">
                        <i class="bi bi-door-open-fill"></i>
                        <span class="room-name-display">${current.name}</span>
                    </button>
                    <ul class="dropdown-menu dropdown-menu-end shadow-sm">
                        <li><h6 class="dropdown-header">Switch Room</h6></li>
                        ${rooms.map(r => `
                            <li>
                                <a class="dropdown-item ${r.id === current.id ? 'active fw-bold' : ''}" href="#" onclick="selectActiveRoom(${r.id})">
                                    <i class="bi bi-house me-2"></i> ${r.name}
                                </a>
                            </li>
                        `).join('')}
                        <li><hr class="dropdown-divider"></li>
                        <li>
                            <a class="dropdown-item text-primary" href="/rooms/create-join/">
                                <i class="bi bi-plus-circle me-2"></i> Create or Join Room
                            </a>
                        </li>
                    </ul>
                </div>
            `;
        }

        return true;
    } catch (e) {
        console.error('Error loading rooms for selector', e);
        return false;
    }
}

async function selectActiveRoom(roomId) {
    try {
        const room = await apiRequest(`/api/rooms/${roomId}/`);
        Auth.setActiveRoom(room);
        window.location.reload();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function loadDashboardData() {
    const activeRoom = Auth.getActiveRoom();
    if (!activeRoom) return;

    const roomId = activeRoom.id;
    const currency = activeRoom.currency || '$';
    const currentUser = Auth.getUser();

    try {
        // Fetch balances, analytics, recent expenses, and recent settlements concurrently
        const [balancesData, analyticsData, expensesData, settlementsData] = await Promise.all([
            apiRequest(`/api/rooms/${roomId}/balances/`),
            apiRequest(`/api/rooms/${roomId}/analytics/`),
            apiRequest(`/api/expenses/?room=${roomId}`),
            apiRequest(`/api/settlements/?room=${roomId}`)
        ]);

        // 0. Render Pending Verifications Alert if any
        renderPendingVerificationsBanner(settlementsData, currency, currentUser);

        // 1. Update Stat Cards
        renderStatCards(balancesData, currency, currentUser);

        // 2. Render Who Owes Whom (Simplified Debts)
        renderSimplifiedDebts(balancesData.simplified_debts, currency, currentUser);

        // 3. Render Chart.js Analytics
        renderCategoryChart(analyticsData.category_chart, currency);
        renderMonthlyChart(analyticsData.monthly_chart, currency);
        renderMemberChart(analyticsData.member_chart, currency);

        // 4. Render Recent Expenses & Settlements
        renderRecentActivity(expensesData, settlementsData, currency);

    } catch (e) {
        console.error('Error loading dashboard data', e);
        showToast(e.message, 'error');
    }
}

function renderPendingVerificationsBanner(settlements, currency, currentUser) {
    const bannerContainer = document.getElementById('pendingVerificationsAlertContainer');
    if (!bannerContainer || !currentUser) return;

    // Filter pending settlements where current user is the payee (recipient)
    const pendingForMe = (settlements || []).filter(s => {
        const payeeId = typeof s.payee === 'object' ? s.payee?.id : (s.payee || s.payee_id);
        return s.status === 'PENDING' && payeeId === currentUser.id;
    });

    if (pendingForMe.length === 0) {
        bannerContainer.innerHTML = '';
        return;
    }

    bannerContainer.innerHTML = `
        <div class="card border-warning bg-warning-subtle bg-opacity-25 shadow-sm mb-4">
            <div class="card-body p-3">
                <div class="d-flex align-items-center gap-2 mb-2">
                    <span class="badge bg-warning text-dark px-2 py-1"><i class="bi bi-bell-fill me-1"></i> Action Required</span>
                    <h6 class="fw-bold mb-0 text-dark">You have ${pendingForMe.length} payment${pendingForMe.length > 1 ? 's' : ''} awaiting your verification:</h6>
                </div>
                <div class="d-flex flex-column gap-2">
                    ${pendingForMe.map(s => `
                        <div class="bg-white p-3 rounded-3 border d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-2 shadow-sm">
                            <div class="d-flex align-items-center gap-3">
                                <div class="user-avatar-sm" style="background-color: ${s.payer_details.avatar_color || '#4F46E5'}">
                                    ${s.payer_details.initials}
                                </div>
                                <div>
                                    <div class="fw-bold text-dark">
                                        ${s.payer_details.display_name} marked that they paid you <span class="text-success fs-6">${currency}${parseFloat(s.amount).toFixed(2)}</span>
                                    </div>
                                    <small class="text-muted">
                                        ${s.notes ? `Note: "${s.notes}" &bull; ` : ''}Recorded on ${new Date(s.created_at).toLocaleDateString()}
                                    </small>
                                </div>
                            </div>
                            <div class="d-flex gap-2 align-items-center">
                                <button class="btn btn-sm btn-success px-3 fw-semibold" onclick="verifySettlement(${s.id})">
                                    <i class="bi bi-check-circle-fill me-1"></i> Confirm Receipt
                                </button>
                                <button class="btn btn-sm btn-outline-danger px-3" onclick="rejectSettlement(${s.id})">
                                    <i class="bi bi-x-circle me-1"></i> Reject
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

function renderStatCards(balancesData, currency, currentUser) {
    const totalRoomExpensesEl = document.getElementById('statTotalRoomExpenses');
    if (totalRoomExpensesEl) {
        totalRoomExpensesEl.textContent = `${currency}${balancesData.total_room_expenses.toFixed(2)}`;
    }

    const myBalance = balancesData.member_balances.find(b => currentUser && b.user.id === currentUser.id);

    const myPaidEl = document.getElementById('statMyPaid');
    const myShareEl = document.getElementById('statMyShare');
    const myNetCardEl = document.getElementById('statNetBalanceCard');
    const myNetValueEl = document.getElementById('statNetBalanceValue');
    const myNetSubtextEl = document.getElementById('statNetBalanceSubtext');

    if (myBalance) {
        if (myPaidEl) myPaidEl.textContent = `${currency}${myBalance.total_paid.toFixed(2)}`;
        if (myShareEl) myShareEl.textContent = `${currency}${myBalance.total_share.toFixed(2)}`;

        if (myNetValueEl && myNetSubtextEl) {
            const net = myBalance.net_balance;
            if (net > 0) {
                myNetValueEl.textContent = `+${currency}${net.toFixed(2)}`;
                myNetValueEl.className = 'stat-value text-success';
                myNetSubtextEl.textContent = 'Roommates owe you';
            } else if (net < 0) {
                myNetValueEl.textContent = `-${currency}${Math.abs(net).toFixed(2)}`;
                myNetValueEl.className = 'stat-value text-danger';
                myNetSubtextEl.textContent = 'You owe roommates';
            } else {
                myNetValueEl.textContent = `${currency}0.00`;
                myNetValueEl.className = 'stat-value text-secondary';
                myNetSubtextEl.textContent = 'All settled up!';
            }
        }
    } else {
        if (myPaidEl) myPaidEl.textContent = `${currency}0.00`;
        if (myShareEl) myShareEl.textContent = `${currency}0.00`;
        if (myNetValueEl) myNetValueEl.textContent = `${currency}0.00`;
    }
}

function renderSimplifiedDebts(debts, currency, currentUser) {
    const container = document.getElementById('simplifiedDebtsContainer');
    if (!container) return;

    if (!debts || debts.length === 0) {
        container.innerHTML = `
            <div class="text-center py-4 text-muted">
                <i class="bi bi-check-circle-fill text-success fs-1 mb-2 d-block"></i>
                <h6 class="fw-semibold text-dark">All Settled Up!</h6>
                <p class="small mb-0">No outstanding debts between roommates.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = debts.map(d => {
        const isFromMe = currentUser && d.from_user.id === currentUser.id;
        const isToMe = currentUser && d.to_user.id === currentUser.id;

        return `
            <div class="debt-card ${isFromMe ? 'border-danger-subtle bg-danger-subtle bg-opacity-10' : (isToMe ? 'border-success-subtle bg-success-subtle bg-opacity-10' : '')}">
                <div class="d-flex align-items-center gap-2 flex-grow-1">
                    <div class="user-avatar-sm" style="background-color: ${d.from_user.avatar_color || '#4F46E5'}">
                        ${d.from_user.initials}
                    </div>
                    <div class="fw-medium text-dark">${d.from_user.display_name} ${isFromMe ? '<span class="badge bg-danger">You</span>' : ''}</div>
                    
                    <i class="bi bi-arrow-right debt-arrow"></i>
                    
                    <div class="user-avatar-sm" style="background-color: ${d.to_user.avatar_color || '#10B981'}">
                        ${d.to_user.initials}
                    </div>
                    <div class="fw-medium text-dark">${d.to_user.display_name} ${isToMe ? '<span class="badge bg-success">You</span>' : ''}</div>
                </div>

                <div class="d-flex align-items-center gap-3">
                    <span class="fs-6 fw-bold text-dark">${currency}${d.amount.toFixed(2)}</span>
                    ${isFromMe ? `
                        <button class="btn btn-sm btn-success px-3 fw-semibold shadow-sm" onclick="openSettleModal(${d.from_user.id}, ${d.to_user.id}, ${d.amount}, '${d.from_user.display_name}', '${d.to_user.display_name}')">
                            <i class="bi bi-wallet2 me-1"></i> Pay Now
                        </button>
                    ` : (isToMe ? `
                        <button class="btn btn-sm btn-outline-primary px-3 fw-semibold" onclick="openSettleModal(${d.from_user.id}, ${d.to_user.id}, ${d.amount}, '${d.from_user.display_name}', '${d.to_user.display_name}')">
                            <i class="bi bi-check2 me-1"></i> Settle Up
                        </button>
                    ` : `
                        <span class="badge bg-light text-muted border px-2 py-1">
                            <i class="bi bi-people me-1"></i> Roommate Debt
                        </span>
                    `)}
                </div>
            </div>
        `;
    }).join('');
}

function renderCategoryChart(categoryData, currency = '₹') {
    const canvas = document.getElementById('categoryDoughnutChart');
    if (!canvas) return;

    if (categoryChartInstance) {
        categoryChartInstance.destroy();
    }

    if (!categoryData || !categoryData.data || categoryData.data.length === 0) {
        canvas.parentElement.innerHTML = `
            <div class="text-center py-5 text-muted">
                <i class="bi bi-pie-chart display-4 mb-2 d-block text-secondary"></i>
                <p>No expense categories to display yet.</p>
            </div>
        `;
        return;
    }

    const ctx = canvas.getContext('2d');
    categoryChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: categoryData.labels,
            datasets: [{
                data: categoryData.data,
                backgroundColor: categoryData.colors,
                borderWidth: 2,
                borderColor: '#ffffff',
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        boxWidth: 12,
                        padding: 15,
                        font: { family: 'Inter', size: 12 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const val = context.raw || 0;
                            const pct = categoryData.percentages[context.dataIndex] || 0;
                            return ` ${label}: ${currency}${val.toFixed(2)} (${pct}%)`;
                        }
                    }
                }
            },
            cutout: '70%'
        }
    });
}

function renderMonthlyChart(monthlyData, currency) {
    const canvas = document.getElementById('monthlyBarChart');
    if (!canvas) return;

    if (monthlyChartInstance) {
        monthlyChartInstance.destroy();
    }

    if (!monthlyData || !monthlyData.data || monthlyData.data.length === 0) {
        canvas.parentElement.innerHTML = `
            <div class="text-center py-5 text-muted">
                <i class="bi bi-bar-chart display-4 mb-2 d-block text-secondary"></i>
                <p>No monthly spending trend yet.</p>
            </div>
        `;
        return;
    }

    const ctx = canvas.getContext('2d');
    monthlyChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: monthlyData.labels,
            datasets: [{
                label: 'Monthly Spending',
                data: monthlyData.data,
                backgroundColor: '#3b82f6',
                borderRadius: 6,
                maxBarThickness: 45
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` Spent: ${currency}${ctx.raw.toFixed(2)}`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: '#f1f5f9' },
                    ticks: {
                        callback: (v) => `${currency}${v}`
                    }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}

function renderMemberChart(memberData, currency) {
    const canvas = document.getElementById('memberSpendingChart');
    if (!canvas) return;

    if (memberChartInstance) {
        memberChartInstance.destroy();
    }

    if (!memberData || !memberData.labels || memberData.labels.length === 0) return;

    const ctx = canvas.getContext('2d');
    memberChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: memberData.labels,
            datasets: [
                {
                    label: 'Paid for Group',
                    data: memberData.paid_data,
                    backgroundColor: '#10b981',
                    borderRadius: 4
                },
                {
                    label: 'Consumed Share',
                    data: memberData.share_data,
                    backgroundColor: '#f59e0b',
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { boxWidth: 12, font: { family: 'Inter', size: 12 } }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${currency}${ctx.raw.toFixed(2)}`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: '#f1f5f9' },
                    ticks: { callback: (v) => `${currency}${v}` }
                },
                x: { grid: { display: false } }
            }
        }
    });
}

function renderRecentActivity(expenses, settlements, currency) {
    const container = document.getElementById('recentExpensesTableBody');
    if (!container) return;

    const recentExpenses = (expenses || []).slice(0, 6);
    const currentUser = Auth.getUser();

    if (recentExpenses.length === 0) {
        container.innerHTML = `
            <tr>
                <td colspan="6" class="text-center py-4 text-muted">
                    No expenses recorded in this room yet. Click <strong>+ Add Expense</strong> to get started!
                </td>
            </tr>
        `;
        return;
    }

    container.innerHTML = recentExpenses.map(exp => {
        const isPayer = currentUser && exp.paid_by === currentUser.id;
        return `
            <tr>
                <td>
                    <div class="fw-semibold text-dark">${exp.title}</div>
                    <small class="text-muted">${exp.date}</small>
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
                <td class="text-end fw-bold text-dark">
                    ${currency}${parseFloat(exp.amount).toFixed(2)}
                </td>
                <td class="text-center">
                    <span class="badge bg-light text-secondary border">
                        ${exp.splits ? exp.splits.length : 0} split${exp.splits && exp.splits.length === 1 ? '' : 's'}
                    </span>
                </td>
                <td class="text-center">
                    <button class="btn btn-sm btn-outline-secondary py-0 px-2 me-1" title="View Details" onclick="viewExpenseSplitsModal(${JSON.stringify(exp).replace(/"/g, '&quot;')})">
                        <i class="bi bi-eye"></i>
                    </button>
                    ${isPayer ? `
                        <button class="btn btn-sm btn-outline-primary py-0 px-2 me-1" title="Edit Expense" onclick="openEditExpenseModal(${exp.id})">
                            <i class="bi bi-pencil"></i>
                        </button>
                    ` : ''}
                </td>
            </tr>
        `;
    }).join('');
}
