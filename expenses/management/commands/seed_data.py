from decimal import Decimal
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from django.utils import timezone
from expenses.models import Category, Expense, ExpenseSplit, Settlement
from rooms.models import Room, RoomMember

User = get_user_model()


class Command(BaseCommand):
    help = 'Seeds initial categories and Indian demo data for Roommate Expense Manager'

    def add_arguments(self, parser):
        parser.add_argument('--demo', action='store_true', help='Seed demo users, room, and expenses')

    def handle(self, *args, **options):
        # 1. Seed Global Categories
        categories_data = [
            {'name': 'Rent & Maintenance', 'icon': 'bi-house-door-fill', 'color': '#6366F1'},
            {'name': 'Groceries & Daily Needs', 'icon': 'bi-cart4', 'color': '#10B981'},
            {'name': 'Electricity & Bills', 'icon': 'bi-lightning-charge-fill', 'color': '#F59E0B'},
            {'name': 'Dining & Food Delivery', 'icon': 'bi-cup-straw', 'color': '#EC4899'},
            {'name': 'Cook & Maid / Household', 'icon': 'bi-brush-fill', 'color': '#8B5CF6'},
            {'name': 'WiFi & OTT Subscriptions', 'icon': 'bi-wifi', 'color': '#3B82F6'},
            {'name': 'Cab, Fuel & Travel', 'icon': 'bi-car-front-fill', 'color': '#14B8A6'},
            {'name': 'Miscellaneous & Other', 'icon': 'bi-tag-fill', 'color': '#6B7280'},
        ]

        for cat in categories_data:
            obj, created = Category.objects.get_or_create(
                name=cat['name'],
                room__isnull=True,
                defaults={'icon': cat['icon'], 'color': cat['color']}
            )
            if created:
                self.stdout.write(self.style.SUCCESS(f"Created category: {obj.name}"))

        self.stdout.write(self.style.SUCCESS("Categories initialized successfully."))

        # 2. Seed Indian Demo Data
        if options.get('demo'):
            self.stdout.write("Seeding Indian demo data...")
            
            # Users: Aarav, Priya, Rohan (also keep Alice for convenience)
            aarav, _ = User.objects.get_or_create(
                username='aarav',
                email='aarav@example.in',
                defaults={'first_name': 'Aarav', 'last_name': 'Sharma', 'phone_number': '+91 98765 43210', 'avatar_color': '#4F46E5'}
            )
            aarav.set_password('password123')
            aarav.save()

            priya, _ = User.objects.get_or_create(
                username='priya',
                email='priya@example.in',
                defaults={'first_name': 'Priya', 'last_name': 'Patel', 'phone_number': '+91 98765 43211', 'avatar_color': '#059669'}
            )
            priya.set_password('password123')
            priya.save()

            rohan, _ = User.objects.get_or_create(
                username='rohan',
                email='rohan@example.in',
                defaults={'first_name': 'Rohan', 'last_name': 'Gupta', 'phone_number': '+91 98765 43212', 'avatar_color': '#D97706'}
            )
            rohan.set_password('password123')
            rohan.save()

            # Also maintain alice
            alice, _ = User.objects.get_or_create(
                username='alice',
                email='alice@example.com',
                defaults={'first_name': 'Alice', 'last_name': 'Johnson', 'avatar_color': '#4F46E5'}
            )
            alice.set_password('password123')
            alice.save()

            # Update any existing Apartment 402 currency to ₹
            Room.objects.filter(name='Apartment 402').update(currency='₹')

            # Create Indian Room: Flat 402 Bangalore
            room, _ = Room.objects.get_or_create(
                name='Flat 402, Bangalore',
                defaults={
                    'description': '3BHK Flat, Green Glen Layout, Bellandur, Bengaluru',
                    'currency': '₹',
                    'created_by': aarav,
                    'invite_code': 'BLR402IN'
                }
            )
            room.currency = '₹'
            room.save(update_fields=['currency'])

            RoomMember.objects.get_or_create(room=room, user=aarav, defaults={'role': 'ADMIN'})
            RoomMember.objects.get_or_create(room=room, user=priya, defaults={'role': 'MEMBER'})
            RoomMember.objects.get_or_create(room=room, user=rohan, defaults={'role': 'MEMBER'})
            RoomMember.objects.get_or_create(room=room, user=alice, defaults={'role': 'MEMBER'})

            # Get categories
            groceries_cat = Category.objects.filter(name='Groceries & Daily Needs').first()
            bills_cat = Category.objects.filter(name='Electricity & Bills').first()
            food_cat = Category.objects.filter(name='Dining & Food Delivery').first()
            wifi_cat = Category.objects.filter(name='WiFi & OTT Subscriptions').first()

            # Expense 1: Aarav paid ₹2,400 for Blinkit/Zepto groceries (Aarav, Priya, Rohan ₹800 each)
            if not Expense.objects.filter(title='Blinkit Weekly Grocery & Essentials', room=room).exists():
                exp1 = Expense.objects.create(
                    room=room,
                    title='Blinkit Weekly Grocery & Essentials',
                    amount=Decimal('2400.00'),
                    category=groceries_cat,
                    paid_by=aarav,
                    split_type='EQUAL',
                    date=timezone.now().date(),
                    notes='Atta, milk, fruits, veggies, oil and spices'
                )
                for u in [aarav, priya, rohan]:
                    ExpenseSplit.objects.create(expense=exp1, user=u, amount=Decimal('800.00'), percentage=Decimal('33.33'))

            # Expense 2: Priya paid ₹1,500 for BESCOM Electricity Bill
            if not Expense.objects.filter(title='BESCOM Electricity Bill', room=room).exists():
                exp2 = Expense.objects.create(
                    room=room,
                    title='BESCOM Electricity Bill',
                    amount=Decimal('1500.00'),
                    category=bills_cat,
                    paid_by=priya,
                    split_type='EQUAL',
                    date=timezone.now().date(),
                    notes='Electricity charges for July'
                )
                for u in [aarav, priya, rohan]:
                    ExpenseSplit.objects.create(expense=exp2, user=u, amount=Decimal('500.00'), percentage=Decimal('33.33'))

            # Expense 3: Rohan paid ₹1,200 for Swiggy Biryani Dinner (Aarav and Rohan ₹600 each, Priya was away)
            if not Expense.objects.filter(title='Swiggy Biryani Feast', room=room).exists():
                exp3 = Expense.objects.create(
                    room=room,
                    title='Swiggy Biryani Feast',
                    amount=Decimal('1200.00'),
                    category=food_cat,
                    paid_by=rohan,
                    split_type='CUSTOM',
                    date=timezone.now().date(),
                    notes='Hyderabadi Dum Biryani combo order'
                )
                ExpenseSplit.objects.create(expense=exp3, user=aarav, amount=Decimal('600.00'), percentage=Decimal('50.00'))
                ExpenseSplit.objects.create(expense=exp3, user=rohan, amount=Decimal('600.00'), percentage=Decimal('50.00'))

            # Expense 4: Aarav paid ₹999 for ACT Fibernet WiFi
            if not Expense.objects.filter(title='ACT Fibernet Broadband Bill', room=room).exists():
                exp4 = Expense.objects.create(
                    room=room,
                    title='ACT Fibernet Broadband Bill',
                    amount=Decimal('999.00'),
                    category=wifi_cat,
                    paid_by=aarav,
                    split_type='EQUAL',
                    date=timezone.now().date(),
                    notes='300 Mbps Unlimited Internet'
                )
                ExpenseSplit.objects.create(expense=exp4, user=aarav, amount=Decimal('333.00'), percentage=Decimal('33.33'))
                ExpenseSplit.objects.create(expense=exp4, user=priya, amount=Decimal('333.00'), percentage=Decimal('33.33'))
                ExpenseSplit.objects.create(expense=exp4, user=rohan, amount=Decimal('333.00'), percentage=Decimal('33.34'))

            self.stdout.write(self.style.SUCCESS("Indian demo data initialized (Aarav, Priya, Rohan & Flat 402, Bangalore with INR Rupee currency)!"))
