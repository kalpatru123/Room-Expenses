import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'roommate_manager.settings')
django.setup()

from django.contrib.auth import get_user_model
from rooms.models import Room
from expenses.models import Category, Expense, ExpenseSplit
from rooms.services import calculate_room_balances
from decimal import Decimal
from django.utils import timezone

User = get_user_model()

# 1. Update/Verify Bikash user & password
bikash = User.objects.get(username='Bikash')
bikash.set_password('Password@123')
bikash.save()
print(f"User Bikash updated: username={bikash.username}, password=Password@123")

# 2. Get room J6 106
room = Room.objects.filter(name__icontains='J6').first()
print(f"Active Room: {room.name} (ID: {room.id})")

# 3. Get or create category
cat, _ = Category.objects.get_or_create(
    name='Electricity & Bills',
    defaults={'icon': 'bi-lightning-charge-fill', 'color': '#F59E0B'}
)

import datetime

# --- Configurable Parameters ---
EXPENSE_TITLE = 'Bijli bill'
EXPENSE_AMOUNT = Decimal('1400.00')
# To set an expense for September, use: datetime.date(2026, 9, 15)
# To use today's date, use: timezone.now().date()
EXPENSE_DATE = timezone.now().date()
EXPENSE_NOTES = 'Monthly Electricity Bill'

# 4. Create or get expense
exp, created = Expense.objects.get_or_create(
    room=room,
    title=EXPENSE_TITLE,
    date=EXPENSE_DATE,
    defaults={
        'amount': EXPENSE_AMOUNT,
        'category': cat,
        'paid_by': bikash,
        'split_type': 'EQUAL',
        'notes': EXPENSE_NOTES
    }
)

# 5. Split equally among room members if freshly created
members = list(room.members.filter(is_active=True))
if created and members:
    split_amount = EXPENSE_AMOUNT / Decimal(len(members))
    for m in members:
        ExpenseSplit.objects.create(
            expense=exp,
            user=m.user,
            amount=split_amount,
            percentage=Decimal('100.0') / Decimal(len(members))
        )
    print(f"Created New Expense: ID={exp.id}, Title='{exp.title}', Amount=Rs {exp.amount}, Date={exp.date.strftime('%d/%m/%Y')}, Paid By={bikash.username}")
else:
    print(f"Expense already exists: ID={exp.id}, Title='{exp.title}', Amount=Rs {exp.amount}, Date={exp.date.strftime('%d/%m/%Y')}")

# 6. Recalculate room balances for this specific month (Isolated)
exp_year, exp_month = exp.date.year, exp.date.month
month_bal = calculate_room_balances(room, year=exp_year, month=exp_month)
print("\n" + "=" * 55)
print(f"--- MONTHLY BALANCES FOR {month_bal['selected_period_label'].upper()} ---")
print(f"Total Expenses in {month_bal['selected_period_label']}: Rs {month_bal['total_room_expenses']}")
print("Member Net Balances for Month:")
for b in month_bal['member_balances']:
    print(f"  - {b['user']['display_name']} ({b['user']['username']}): Rs {b['net_balance']:+.2f} ({b['status']})")

print(f"\nSimplified Debts for {month_bal['selected_period_label']}:")
if month_bal['simplified_debts']:
    for d in month_bal['simplified_debts']:
        print(f"  - {d['from_user']['display_name']} owes {d['to_user']['display_name']}: Rs {d['amount']:.2f}")
else:
    print("  No debts / All settled!")

# 7. Recalculate All-Time balances
all_bal = calculate_room_balances(room)
print("\n" + "-" * 55)
print(f"--- ALL-TIME TOTALS ---")
print(f"All-Time Room Expenses: Rs {all_bal['total_room_expenses']}")
print("=" * 55)
 