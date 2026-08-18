/**
 * Roommate Expense Manager - Central API & Auth Client
 */

const API_BASE = window.location.origin;

const Auth = {
    getAccessToken() {
        return localStorage.getItem('rem_access_token');
    },
    getRefreshToken() {
        return localStorage.getItem('rem_refresh_token');
    },
    getUser() {
        const u = localStorage.getItem('rem_user');
        return u ? JSON.parse(u) : null;
    },
    getActiveRoom() {
        const r = localStorage.getItem('rem_active_room');
        return r ? JSON.parse(r) : null;
    },
    setTokens(access, refresh) {
        if (access) localStorage.setItem('rem_access_token', access);
        if (refresh) localStorage.setItem('rem_refresh_token', refresh);
    },
    setUser(user) {
        localStorage.setItem('rem_user', JSON.stringify(user));
    },
    setActiveRoom(room) {
        if (room) {
            localStorage.setItem('rem_active_room', JSON.stringify(room));
        } else {
            localStorage.removeItem('rem_active_room');
        }
    },
    async ensureValidActiveRoom(forceRefresh = false) {
        if (!this.isAuthenticated()) return null;
        let current = this.getActiveRoom();
        if (current && !forceRefresh) {
            return current;
        }
        try {
            const rooms = await apiRequest('/api/rooms/');
            if (!rooms || rooms.length === 0) {
                this.setActiveRoom(null);
                return null;
            }
            if (!current || !rooms.some(r => r.id === current.id)) {
                current = rooms[0];
                this.setActiveRoom(current);
            }
            return current;
        } catch (e) {
            return this.getActiveRoom();
        }
    },
    clear() {
        localStorage.removeItem('rem_access_token');
        localStorage.removeItem('rem_refresh_token');
        localStorage.removeItem('rem_user');
        localStorage.removeItem('rem_active_room');
        sessionStorage.clear();
    },
    isAuthenticated() {
        return !!this.getAccessToken();
    },
    requireAuth() {
        const path = window.location.pathname;
        if (path.includes('/login/') || path.includes('/register/')) {
            return false;
        }
        if (!this.isAuthenticated()) {
            window.location.href = '/login/';
            return false;
        }
        return true;
    }
};

/**
 * Get CSRF token from Django cookie
 */
function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

/**
 * Standardized Fetch wrapper with JWT headers, CSRF token, and token refresh retry
 */
async function apiRequest(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
    const headers = options.headers || {};

    if (!(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }

    const token = Auth.getAccessToken();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    // Include CSRF token for mutating requests (POST, PUT, PATCH, DELETE)
    const method = (options.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        const csrfToken = getCookie('csrftoken');
        if (csrfToken) {
            headers['X-CSRFToken'] = csrfToken;
        }
    }

    options.headers = headers;

    try {
        let response = await fetch(url, options);

        // If 401 Unauthorized and refresh token exists, attempt refresh
        if (response.status === 401 && Auth.getRefreshToken()) {
            const refreshed = await refreshToken();
            if (refreshed) {
                headers['Authorization'] = `Bearer ${Auth.getAccessToken()}`;
                response = await fetch(url, options);
            } else {
                Auth.clear();
                window.location.href = '/login/';
                return null;
            }
        }

        if (response.status === 204) {
            return { success: true };
        }

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const errorMsg = extractErrorMessage(data) || `Request failed with status ${response.status}`;
            throw new Error(errorMsg);
        }

        return data;
    } catch (err) {
        console.error(`API Error on ${endpoint}:`, err);
        throw err;
    }
}

async function refreshToken() {
    const refresh = Auth.getRefreshToken();
    if (!refresh) return false;

    try {
        const res = await fetch(`${API_BASE}/api/auth/token/refresh/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh })
        });

        if (res.ok) {
            const data = await res.json();
            Auth.setTokens(data.access, data.refresh || refresh);
            return true;
        }
    } catch (e) {
        console.error('Failed to refresh token', e);
    }
    return false;
}

function extractErrorMessage(data) {
    if (typeof data === 'string') return data;
    if (data.detail) return data.detail;
    if (data.message) return data.message;
    if (data.error) return data.error;

    // Collect field errors
    const errors = [];
    for (const key in data) {
        const val = data[key];
        if (Array.isArray(val)) {
            errors.push(`${key}: ${val.join(', ')}`);
        } else if (typeof val === 'object') {
            errors.push(`${key}: ${extractErrorMessage(val)}`);
        } else {
            errors.push(`${key}: ${val}`);
        }
    }
    return errors.length > 0 ? errors.join(' | ') : null;
}

function showToast(message, type = 'success') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        document.body.appendChild(container);
    }

    const toastId = 'toast_' + Date.now();
    const bgClass = type === 'success' ? 'text-bg-success' : (type === 'error' ? 'text-bg-danger' : 'text-bg-primary');
    const iconClass = type === 'success' ? 'bi-check-circle' : (type === 'error' ? 'bi-exclamation-triangle' : 'bi-info-circle');

    const toastEl = document.createElement('div');
    toastEl.className = `toast align-items-center ${bgClass} border-0 shadow`;
    toastEl.id = toastId;
    toastEl.setAttribute('role', 'alert');
    toastEl.setAttribute('aria-live', 'assertive');
    toastEl.setAttribute('aria-atomic', 'true');

    toastEl.innerHTML = `
        <div class="d-flex">
            <div class="toast-body d-flex align-items-center gap-2">
                <i class="bi ${iconClass} fs-5"></i>
                <div>${message}</div>
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
    `;

    container.appendChild(toastEl);
    const toast = new bootstrap.Toast(toastEl, { delay: 4000 });
    toast.show();
    toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
}

// Global user profile sync in navigation bar
document.addEventListener('DOMContentLoaded', () => {
    const user = Auth.getUser();
    if (user) {
        const avatarEl = document.getElementById('navUserAvatar');
        if (avatarEl) {
            avatarEl.style.backgroundColor = user.avatar_color || '#4F46E5';
            avatarEl.textContent = user.initials || (user.display_name ? user.display_name.substring(0, 2).toUpperCase() : 'US');
        }
        const nameEl = document.getElementById('navUserName');
        if (nameEl) {
            nameEl.textContent = user.display_name || user.username;
        }
        const headerEl = document.getElementById('navUserDropdownHeader');
        if (headerEl) {
            headerEl.textContent = `${user.display_name || user.username} (${user.email || ''})`;
        }
    }
});
