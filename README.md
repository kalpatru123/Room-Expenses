# Roommate Expense Manager 🏠💰

A modern, full-stack **Roommate Expense Manager** web application built with **Python, Django 5/6, Django REST Framework, PostgreSQL / SQLite, SimpleJWT, Bootstrap 5, JavaScript (ES6+), and Chart.js**.

---

## 🌟 Key Features

1. **Authentication & Security (JWT)**:
   - User Registration & Login with automatic JWT tokens generation.
   - Token refresh handling with automatic retry interceptor.
   - Profile management with custom avatar initials and badge colors.

2. **Room & Roommate Management**:
   - Create apartments/rooms with customized currency symbol (`$`, `€`, `£`, `₹`, etc.).
   - Unique 8-character invite code generation and clipboard copy.
   - Join rooms instantly using invite codes.
   - Role-based permissions (`ADMIN`, `MEMBER`).
   - Admin capabilities (regenerate invite codes, remove members).

3. **Expense Tracking & Splitting Engine**:
   - Add shared expenses with custom categories (Rent, Groceries, Utilities, Dining, Household, Entertainment, etc.).
   - **Split Equally**: Automatically divides amount among selected roommates with penny-perfect remainder distribution.
   - **Custom Amounts**: Specific exact dollar amounts for each roommate with live sum matching validator.
   - **Percentages**: Percentage-based distribution with 100% sum check.
   - Multi-field expense filtering (category, payer, search keyword).

4. **Debt Simplification Algorithm ("Who Owes Whom")**:
   - Real-time net balance calculation: `(Total Paid for Group + Settlements Paid) - (Total Share Consumed + Settlements Received)`.
   - **Greedy Min-Cash-Flow algorithm**: Computes the optimal minimum number of transactions needed to settle all debts in the room.

5. **Settlements & Debt Payoffs**:
   - Record settlement payments between roommates.
   - One-click "Settle Up" action from the simplified debt ledger.
   - Mark settlements as paid/completed, immediately updating room balances.

6. **Visual Analytics with Chart.js**:
   - Category spend distribution doughnut chart.
   - Monthly expense trend bar chart.
   - Roommate paid vs consumed comparison chart.

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- Python 3.10+
- `pip` (Python package manager)
- PostgreSQL (Optional; falls back to SQLite automatically if PostgreSQL is not active)

### 2. Installation & Setup

```bash
# Navigate to the project directory
cd roommate_expense_manager

# Install dependencies
pip install -r requirements.txt

# Run database migrations
python manage.py makemigrations
python manage.py migrate

# Seed initial categories and demo data (Alice, Bob, Charlie & Apartment 402)
python manage.py seed_data --demo
```

### 3. Run the Development Server

```bash
python manage.py runserver
```

Open your browser and navigate to:
👉 **`http://127.0.0.1:8000/`**

---

## 🔑 Demo Accounts

The `seed_data --demo` command creates three sample roommates in room **Apartment 402** (Invite Code: `APT402RM`):

| Username | Password | Role |
| :--- | :--- | :--- |
| `alice` | `password123` | Room Admin |
| `bob` | `password123` | Member |
| `charlie` | `password123` | Member |

---

## 🗄️ PostgreSQL Configuration

To connect the application to PostgreSQL:

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Set your `DATABASE_URL` in `.env` or system environment:
   ```env
   DATABASE_URL=postgres://your_user:your_password@localhost:5432/your_database_name
   ```
3. Re-run migrations:
   ```bash
   python manage.py migrate
   ```

---

## 🧪 Running Automated Tests

Run the full automated test suite covering authentication, rooms, invite codes, split validations, and debt calculations:

```bash
python manage.py test
```

---

## 📡 REST API Reference

### Authentication (`/api/auth/`)
- `POST /api/auth/register/` - Register new user & retrieve JWT access/refresh tokens.
- `POST /api/auth/token/` - Obtain JWT tokens with username and password.
- `POST /api/auth/token/refresh/` - Refresh JWT access token.
- `GET /api/auth/profile/` - Fetch authenticated user profile.
- `PUT /api/auth/profile/` - Update profile information.

### Rooms (`/api/rooms/`)
- `GET /api/rooms/` - List user's rooms.
- `POST /api/rooms/` - Create a new room.
- `POST /api/rooms/join/` - Join a room with an 8-character invite code.
- `GET /api/rooms/<id>/` - Retrieve room details.
- `POST /api/rooms/<id>/regenerate-invite/` - Regenerate invite code (Admin only).
- `GET /api/rooms/<id>/members/` - List active room members.
- `DELETE /api/rooms/<id>/members/<user_id>/` - Remove member / leave room.
- `GET /api/rooms/<id>/balances/` - Calculate member balances & simplified debts.
- `GET /api/rooms/<id>/analytics/` - Chart.js metrics (categories, monthly trends).

### Expenses & Settlements (`/api/`)
- `GET /api/categories/?room=<id>` - List expense categories.
- `GET /api/expenses/?room=<id>` - List expenses (supports category, paid_by, search filters).
- `POST /api/expenses/` - Create expense with equal, custom, or percentage splits.
- `GET /api/expenses/<id>/` - Retrieve single expense details with all splits.
- `DELETE /api/expenses/<id>/` - Delete an expense.
- `GET /api/settlements/?room=<id>` - List settlements.
- `POST /api/settlements/` - Create settlement record.
- `POST /api/settlements/<id>/mark-paid/` - Mark settlement as paid/completed.
