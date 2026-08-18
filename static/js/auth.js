/**
 * Roommate Expense Manager - Authentication Handling
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Login Form Handler
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        // If already logged in, redirect to dashboard
        if (Auth.isAuthenticated()) {
            window.location.href = '/';
            return;
        }

        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = loginForm.querySelector('button[type="submit"]');
            const originalText = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Signing In...`;

            const username = document.getElementById('loginUsername').value.trim();
            const password = document.getElementById('loginPassword').value;

                // Clear any previous session or cached room
                Auth.clear();

                // Obtain JWT tokens
                const tokenData = await apiRequest('/api/auth/token/', {
                    method: 'POST',
                    body: JSON.stringify({ username, password })
                });

                Auth.setTokens(tokenData.access, tokenData.refresh);

                // Fetch user profile
                const profile = await apiRequest('/api/auth/profile/');
                Auth.setUser(profile);

                // Fetch and set user's first active room
                try {
                    const rooms = await apiRequest('/api/rooms/');
                    if (rooms && rooms.length > 0) {
                        Auth.setActiveRoom(rooms[0]);
                    }
                } catch (e) {
                    console.debug('No rooms found on login', e);
                }

                showToast(`Welcome back, ${profile.display_name}!`, 'success');
                setTimeout(() => {
                    window.location.href = '/';
                }, 400);
            } catch (err) {
                const alertBox = document.getElementById('loginAlert');
                if (alertBox) {
                    alertBox.textContent = err.message || 'Invalid username or password.';
                    alertBox.classList.remove('d-none');
                } else {
                    showToast(err.message, 'error');
                }
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        });
    }

    // 2. Registration Form Handler
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        if (Auth.isAuthenticated()) {
            window.location.href = '/';
            return;
        }

        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = registerForm.querySelector('button[type="submit"]');
            const originalText = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Creating Account...`;

            const data = {
                username: document.getElementById('regUsername').value.trim(),
                email: document.getElementById('regEmail').value.trim(),
                first_name: document.getElementById('regFirstName').value.trim(),
                last_name: document.getElementById('regLastName').value.trim(),
                phone_number: document.getElementById('regPhone').value.trim(),
                password: document.getElementById('regPassword').value,
                password_confirm: document.getElementById('regPasswordConfirm').value,
            };

            try {
                const res = await apiRequest('/api/auth/register/', {
                    method: 'POST',
                    body: JSON.stringify(data)
                });

                Auth.setTokens(res.access, res.refresh);
                Auth.setUser(res.user);

                showToast('Registration successful! Welcome to Roommate Expense Manager.', 'success');
                setTimeout(() => {
                    window.location.href = '/rooms/create-join/';
                }, 500);
            } catch (err) {
                const alertBox = document.getElementById('registerAlert');
                if (alertBox) {
                    alertBox.textContent = err.message || 'Registration failed. Please check your inputs.';
                    alertBox.classList.remove('d-none');
                } else {
                    showToast(err.message, 'error');
                }
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        });
    }

    // 3. Profile Page Handler
    const profileForm = document.getElementById('profileForm');
    if (profileForm) {
        Auth.requireAuth();
        loadUserProfile();

        profileForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = profileForm.querySelector('button[type="submit"]');
            btn.disabled = true;

            const updateData = {
                first_name: document.getElementById('profileFirstName').value.trim(),
                last_name: document.getElementById('profileLastName').value.trim(),
                email: document.getElementById('profileEmail').value.trim(),
                phone_number: document.getElementById('profilePhone').value.trim(),
                avatar_color: document.getElementById('profileColor').value,
            };

            try {
                const updated = await apiRequest('/api/auth/profile/', {
                    method: 'PUT',
                    body: JSON.stringify(updateData)
                });
                Auth.setUser(updated);
                showToast('Profile updated successfully!', 'success');
                loadUserProfile();
            } catch (err) {
                showToast(err.message, 'error');
            } finally {
                btn.disabled = false;
            }
        });
    }
});

async function loadUserProfile() {
    try {
        const user = await apiRequest('/api/auth/profile/');
        Auth.setUser(user);
        
        document.getElementById('profileUsername').value = user.username;
        document.getElementById('profileEmail').value = user.email || '';
        document.getElementById('profileFirstName').value = user.first_name || '';
        document.getElementById('profileLastName').value = user.last_name || '';
        document.getElementById('profilePhone').value = user.phone_number || '';
        document.getElementById('profileColor').value = user.avatar_color || '#4F46E5';
        
        const avatarEl = document.getElementById('profileAvatar');
        if (avatarEl) {
            avatarEl.style.backgroundColor = user.avatar_color || '#4F46E5';
            avatarEl.textContent = user.initials;
        }
        const nameEl = document.getElementById('profileDisplayName');
        if (nameEl) nameEl.textContent = user.display_name;
    } catch (e) {
        console.error('Error loading profile', e);
    }
}

function handleLogout() {
    Auth.clear();
    showToast('Logged out successfully.', 'info');
    setTimeout(() => {
        window.location.href = '/login/';
    }, 300);
}
