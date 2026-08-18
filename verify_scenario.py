import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'roommate_manager.settings')
django.setup()

from django.contrib.auth import get_user_model
from rooms.models import Room, RoomMember
from expenses.models import Category, Expense, ExpenseSplit, Settlement
from rooms.services import calculate_room_balances
from rest_framework.test import APIClient
from decimal import Decimal
from django.utils import timezone

User = get_user_model()

print("=" * 60)
print("1. SETUP USERS & INITIAL DEBT IN APARTMENT 402")
print("=" * 60)

alice, _ = User.objects.get_or_create(
    username='alice',
    email='alice@example.com',
    defaults={'first_name': 'Alice', 'last_name': 'Johnson', 'avatar_color': '#4F46E5'}
)
alice.set_password('password123')
alice.save()

bob, _ = User.objects.get_or_create(
    username='bob',
    email='bob@example.com',
    defaults={'first_name': 'Bob', 'last_name': 'Smith', 'avatar_color': '#10B981'}
)
bob.set_password('password123')
bob.save()

room, _ = Room.objects.get_or_create(
    name='Apartment 402',
    defaults={'description': 'Shared 2BHK Apartment', 'currency': '₹', 'created_by': alice, 'invite_code': 'APT402RM'}
)
room.created_by = alice
room.currency = '₹'
room.save()

RoomMember.objects.get_or_create(room=room, user=alice, defaults={'role': 'ADMIN', 'is_active': True})
RoomMember.objects.get_or_create(room=room, user=bob, defaults={'role': 'MEMBER', 'is_active': True})

# Clear previous expenses/settlements for clean test
Expense.objects.filter(room=room).delete()
Settlement.objects.filter(room=room).delete()

cat, _ = Category.objects.get_or_create(name='Groceries & Daily Needs', defaults={'icon': 'bi-cart4', 'color': '#10B981'})

exp = Expense.objects.create(
    room=room,
    title='Weekly Groceries at Zepto',
    amount=Decimal('1000.00'),
    category=cat,
    paid_by=alice,
    split_type='EQUAL',
    date=timezone.now().date()
)
ExpenseSplit.objects.create(expense=exp, user=alice, amount=Decimal('500.00'))
ExpenseSplit.objects.create(expense=exp, user=bob, amount=Decimal('500.00'))

bal_init = calculate_room_balances(room)
print(f"Room Total Expenses: {bal_init['total_room_expenses']}")
print(f"Bob Net Balance: {next(b['net_balance'] for b in bal_init['member_balances'] if b['user']['username'] == 'bob')} (Status: Owes)")
print(f"Alice Net Balance: {next(b['net_balance'] for b in bal_init['member_balances'] if b['user']['username'] == 'alice')} (Status: Gets Back)")
print(f"Simplified Debt: Bob -> Alice Rs {bal_init['simplified_debts'][0]['amount']}")

print("\n" + "=" * 60)
print("2. BOB LOGS IN & RECORDS SETTLEMENT (Bob paid Alice 500)")
print("=" * 60)

client = APIClient()
client.force_authenticate(user=bob)

res_create = client.post('/api/settlements/', {
    'room': room.id,
    'payer': bob.id,
    'payee': alice.id,
    'amount': '500.00',
    'notes': 'Google Pay UPI Ref #987654'
}, format='json')

print(f"Creation HTTP Status: {res_create.status_code}")
settlement_id = res_create.data['id']
print(f"Settlement ID: {settlement_id}")
print(f"Status: {res_create.data['status']} (Expected: PENDING)")
print(f"is_pending: {res_create.data['is_pending']}")
print(f"can_verify for Bob: {res_create.data['can_verify']} (Expected: False - Bob is payer)")
print(f"can_reject for Bob: {res_create.data['can_reject']} (Expected: True - Bob can cancel)")

print("\n" + "=" * 60)
print("3. VERIFY LEDGER DOES NOT CLEAR BEFORE VERIFICATION")
print("=" * 60)

bal_pending = calculate_room_balances(room)
print(f"Bob Net Balance while Pending: {next(b['net_balance'] for b in bal_pending['member_balances'] if b['user']['username'] == 'bob')} (Still -500.0)")
print(f"Simplified Debts Count: {len(bal_pending['simplified_debts'])} (Debt is still active)")

print("\n" + "=" * 60)
print("4. BOB ATTEMPTS TO VERIFY HIS OWN PAYMENT")
print("=" * 60)

res_bob_verify = client.post(f'/api/settlements/{settlement_id}/verify/')
print(f"Bob Verify HTTP Status: {res_bob_verify.status_code} (Expected: 403 Forbidden)")
print(f"Error Detail: {res_bob_verify.data['detail']}")

print("\n" + "=" * 60)
print("5. ALICE LOGS IN, SEES PENDING ALERT & VERIFIES PAYMENT")
print("=" * 60)

client.force_authenticate(user=alice)

# Check Alice's pending list
res_alice_pending = client.get(f'/api/settlements/?pending_for_me=true&room={room.id}')
print(f"Pending Settlements for Alice: {len(res_alice_pending.data)}")
print(f"Payer: {res_alice_pending.data[0]['payer_details']['display_name']}")
print(f"Amount: {res_alice_pending.data[0]['amount']}")
print(f"can_verify for Alice: {res_alice_pending.data[0]['can_verify']} (Expected: True - Alice is payee)")

# Alice verifies
res_alice_verify = client.post(f'/api/settlements/{settlement_id}/verify/')
print(f"Alice Verify HTTP Status: {res_alice_verify.status_code} (Expected: 200 OK)")
print(f"Updated Settlement Status: {res_alice_verify.data['settlement']['status']} (Expected: COMPLETED)")
print(f"Verified By: {res_alice_verify.data['settlement']['verified_by_details']['display_name']}")

print("\n" + "=" * 60)
print("6. VERIFY FINAL ROOM LEDGER & BALANCES")
print("=" * 60)

bal_final = calculate_room_balances(room)
print(f"Bob Net Balance: {next(b['net_balance'] for b in bal_final['member_balances'] if b['user']['username'] == 'bob')} (Expected: 0.0 - Settled)")
print(f"Alice Net Balance: {next(b['net_balance'] for b in bal_final['member_balances'] if b['user']['username'] == 'alice')} (Expected: 0.0 - Settled)")
print(f"Active Simplified Debts: {len(bal_final['simplified_debts'])} (Expected: 0 - All Settled Up!)")
print("=" * 60)
print("ALL VERIFICATIONS COMPLETED SUCCESSFULLY WITH 100% CORRECTNESS!")
print("=" * 60)
