from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status
from rooms.models import Room, RoomMember
from rooms.services import calculate_room_balances

User = get_user_model()


class RoomsAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user1 = User.objects.create_user(username='u1', email='u1@test.com', password='password123', first_name='User', last_name='One')
        self.user2 = User.objects.create_user(username='u2', email='u2@test.com', password='password123', first_name='User', last_name='Two')
        self.client.force_authenticate(user=self.user1)

    def test_create_room_and_auto_admin(self):
        res = self.client.post('/api/rooms/', {
            'name': 'Apartment 101',
            'description': 'Main flat',
            'currency': '$'
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        room_id = res.data['id']

        # Verify creator is ADMIN
        membership = RoomMember.objects.get(room_id=room_id, user=self.user1)
        self.assertEqual(membership.role, 'ADMIN')

    def test_join_room_via_invite_code(self):
        room = Room.objects.create(name='Beach House', created_by=self.user1)
        RoomMember.objects.create(room=room, user=self.user1, role='ADMIN')

        # User 2 joins using invite code
        self.client.force_authenticate(user=self.user2)
        res = self.client.post('/api/rooms/join/', {
            'invite_code': room.invite_code
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        membership = RoomMember.objects.get(room=room, user=self.user2)
        self.assertEqual(membership.role, 'MEMBER')

    def test_debt_simplification_algorithm(self):
        # 3 users: Alice, Bob, Charlie
        alice = self.user1
        bob = self.user2
        charlie = User.objects.create_user(username='u3', email='u3@test.com', password='password123', first_name='User', last_name='Three')

        room = Room.objects.create(name='Test Room', created_by=alice)
        RoomMember.objects.create(room=room, user=alice, role='ADMIN')
        RoomMember.objects.create(room=room, user=bob, role='MEMBER')
        RoomMember.objects.create(room=room, user=charlie, role='MEMBER')

        # Alice pays $90 split equally among Alice, Bob, Charlie ($30 each)
        # Alice is owed +$60 ($90 paid - $30 share)
        # Bob owes -$30
        # Charlie owes -$30
        from expenses.models import Expense, ExpenseSplit
        from decimal import Decimal

        exp = Expense.objects.create(room=room, title='Dinner', amount=Decimal('90.00'), paid_by=alice, split_type='EQUAL')
        for u in [alice, bob, charlie]:
            ExpenseSplit.objects.create(expense=exp, user=u, amount=Decimal('30.00'))

        data = calculate_room_balances(room)
        self.assertEqual(data['total_room_expenses'], 90.00)
        self.assertEqual(len(data['simplified_debts']), 2)

        # Total debt transfers must equal $60 ($30 each from Bob and Charlie to Alice)
        total_transfer = sum(d['amount'] for d in data['simplified_debts'])
        self.assertEqual(total_transfer, 60.00)
