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

# 4. Create expense
exp = Expense.objects.create(
    room=room,
    title='Bijli bill',
    amount=Decimal('1400.00'),
    category=cat,
    paid_by=bikash,
    split_type='EQUAL',
    date=timezone.now().date(),
    notes='August Electricity Bill'
)

# 5. Split equally among room members
members = list(room.members.filter(is_active=True))
split_amount = Decimal('1400.00') / Decimal(len(members))
for m in members:
    ExpenseSplit.objects.create(
        expense=exp,
        user=m.user,
        amount=split_amount,
        percentage=Decimal('100.0') / Decimal(len(members))
    )

print(f"Created Expense: ID={exp.id}, Title='{exp.title}', Amount=Rs {exp.amount}, Paid By={bikash.username}")

# 6. Recalculate room balances & debt ledger
bal = calculate_room_balances(room)
print("\n" + "=" * 50)
print(f"Room Total Expenses: Rs {bal['total_room_expenses']}")
print("Member Net Balances:")
for b in bal['member_balances']:
    print(f"  - {b['user']['display_name']} ({b['user']['username']}): Rs {b['net_balance']:+.2f} ({b['status']})")

print("\nSimplified Debts (Who Owes Whom):")
for d in bal['simplified_debts']:
    print(f"  - {d['from_user']['display_name']} owes {d['to_user']['display_name']}: Rs {d['amount']:.2f}")
print("=" * 50)
 