from decimal import Decimal
from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status
from rooms.models import Room, RoomMember
from expenses.models import Category, Expense, ExpenseSplit, Settlement
from rooms.services import calculate_room_balances

User = get_user_model()


class ExpensesAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user1 = User.objects.create_user(username='u1', email='u1@test.com', password='password123', first_name='Alice')
        self.user2 = User.objects.create_user(username='u2', email='u2@test.com', password='password123', first_name='Bob')
        self.user3 = User.objects.create_user(username='u3', email='u3@test.com', password='password123', first_name='Charlie')

        self.room = Room.objects.create(name='Room 1', created_by=self.user1)
        RoomMember.objects.create(room=self.room, user=self.user1, role='ADMIN')
        RoomMember.objects.create(room=self.room, user=self.user2, role='MEMBER')
        RoomMember.objects.create(room=self.room, user=self.user3, role='MEMBER')

        self.category = Category.objects.create(name='Groceries')
        self.client.force_authenticate(user=self.user1)

    def test_create_equal_split_expense_with_penny_precision(self):
        # Total $100 split 3 ways: $33.33, $33.33, $33.34
        payload = {
            'room': self.room.id,
            'title': 'Costco Groceries',
            'amount': '100.00',
            'category': self.category.id,
            'paid_by': self.user1.id,
            'split_type': 'EQUAL',
            'date': '2026-08-17',
            'notes': 'Milk and bread',
            'splits_data': [
                {'user_id': self.user1.id},
                {'user_id': self.user2.id},
                {'user_id': self.user3.id}
            ]
        }
        res = self.client.post('/api/expenses/', payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)

        splits = ExpenseSplit.objects.filter(expense_id=res.data['id'])
        self.assertEqual(splits.count(), 3)
        total_split_amount = sum(s.amount for s in splits)
        self.assertEqual(total_split_amount, Decimal('100.00'))

    def test_custom_split_validation_failure(self):
        # Expense is $100 but custom sum is $90 -> Should fail validation
        payload = {
            'room': self.room.id,
            'title': 'Gas Bill',
            'amount': '100.00',
            'category': self.category.id,
            'paid_by': self.user1.id,
            'split_type': 'CUSTOM',
            'date': '2026-08-17',
            'splits_data': [
                {'user_id': self.user1.id, 'amount': '40.00'},
                {'user_id': self.user2.id, 'amount': '50.00'}  # sum = $90
            ]
        }
        res = self.client.post('/api/expenses/', payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_settlement_creation_and_balance_update(self):
        # Alice paid $60 for Alice and Bob ($30 each)
        exp = Expense.objects.create(
            room=self.room,
            title='Electric Bill',
            amount=Decimal('60.00'),
            paid_by=self.user1,
            split_type='EQUAL'
        )
        ExpenseSplit.objects.create(expense=exp, user=self.user1, amount=Decimal('30.00'))
        ExpenseSplit.objects.create(expense=exp, user=self.user2, amount=Decimal('30.00'))

        # Check balance before settlement: Bob owes $30, Alice gets $30
        balances = calculate_room_balances(self.room)
        bob_bal = next(b for b in balances['member_balances'] if b['user']['id'] == self.user2.id)
        self.assertEqual(bob_bal['net_balance'], -30.00)

        # 1. Bob (user2) records that he paid Alice $30
        self.client.force_authenticate(user=self.user2)
        settlement_payload = {
            'room': self.room.id,
            'payer': self.user2.id,
            'payee': self.user1.id,
            'amount': '30.00',
            'notes': 'UPI transfer to Alice'
        }
        res = self.client.post('/api/settlements/', settlement_payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        settlement_id = res.data['id']
        
        # Must be created as PENDING verification
        self.assertEqual(res.data['status'], 'PENDING')
        self.assertTrue(res.data['is_pending'])

        # Balance must NOT be updated yet while settlement is PENDING
        balances_pending = calculate_room_balances(self.room)
        bob_bal_pending = next(b for b in balances_pending['member_balances'] if b['user']['id'] == self.user2.id)
        self.assertEqual(bob_bal_pending['net_balance'], -30.00)

        # 2. Bob (payer) attempts to verify his own payment -> Must be FORBIDDEN (403)
        res_verify_fail = self.client.post(f'/api/settlements/{settlement_id}/verify/')
        self.assertEqual(res_verify_fail.status_code, status.HTTP_403_FORBIDDEN)

        # 3. Alice (payee) logs in and verifies receipt of the $30 payment
        self.client.force_authenticate(user=self.user1)
        res_verify_success = self.client.post(f'/api/settlements/{settlement_id}/verify/')
        self.assertEqual(res_verify_success.status_code, status.HTTP_200_OK)
        self.assertEqual(res_verify_success.data['settlement']['status'], 'COMPLETED')

        # 4. Check balance after verification: Both should be $0.00 (settled)
        balances_after = calculate_room_balances(self.room)
        bob_bal_after = next(b for b in balances_after['member_balances'] if b['user']['id'] == self.user2.id)
        alice_bal_after = next(b for b in balances_after['member_balances'] if b['user']['id'] == self.user1.id)
        self.assertEqual(bob_bal_after['net_balance'], 0.00)
        self.assertEqual(alice_bal_after['net_balance'], 0.00)
        self.assertEqual(len(balances_after['simplified_debts']), 0)

    def test_settlement_rejection_leaves_balance_intact(self):
        # Alice paid $50 for Charlie ($25 each)
        exp = Expense.objects.create(
            room=self.room,
            title='Wifi Bill',
            amount=Decimal('50.00'),
            paid_by=self.user1,
            split_type='EQUAL'
        )
        ExpenseSplit.objects.create(expense=exp, user=self.user1, amount=Decimal('25.00'))
        ExpenseSplit.objects.create(expense=exp, user=self.user3, amount=Decimal('25.00'))

        # Charlie records false payment of $25 to Alice
        self.client.force_authenticate(user=self.user3)
        settlement_payload = {
            'room': self.room.id,
            'payer': self.user3.id,
            'payee': self.user1.id,
            'amount': '25.00',
            'notes': 'Said I paid cash'
        }
        res = self.client.post('/api/settlements/', settlement_payload, format='json')
        settlement_id = res.data['id']

        # Alice verifies that she did NOT receive money and rejects the settlement
        self.client.force_authenticate(user=self.user1)
        res_reject = self.client.post(f'/api/settlements/{settlement_id}/reject/')
        self.assertEqual(res_reject.status_code, status.HTTP_200_OK)
        self.assertEqual(res_reject.data['settlement']['status'], 'REJECTED')

        # Balance must remain unchanged: Charlie still owes Alice $25
        balances = calculate_room_balances(self.room)
        charlie_bal = next(b for b in balances['member_balances'] if b['user']['id'] == self.user3.id)
        self.assertEqual(charlie_bal['net_balance'], -25.00)

    def test_non_participant_cannot_create_third_party_settlement(self):
        # Alice (user1) attempts to record that Bob (user2) paid Charlie (user3)
        self.client.force_authenticate(user=self.user1)
        settlement_payload = {
            'room': self.room.id,
            'payer': self.user2.id,
            'payee': self.user3.id,
            'amount': '15.00',
            'notes': 'Alice recording for Bob and Charlie'
        }
        res = self.client.post('/api/settlements/', settlement_payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("payer", res.data)
