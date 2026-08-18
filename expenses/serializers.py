from decimal import Decimal, ROUND_HALF_UP
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from django.contrib.auth import get_user_model
from rooms.models import Room, RoomMember
from accounts.serializers import UserSummarySerializer
from .models import Category, Expense, ExpenseSplit, Settlement, SettlementEditHistory

User = get_user_model()


def round_decimal(value):
    if not isinstance(value, Decimal):
        value = Decimal(str(value))
    return value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ('id', 'name', 'icon', 'color', 'room')


class ExpenseSplitSerializer(serializers.ModelSerializer):
    user = UserSummarySerializer(read_only=True)
    user_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(),
        source='user',
        write_only=True
    )

    class Meta:
        model = ExpenseSplit
        fields = ('id', 'user', 'user_id', 'amount', 'percentage', 'is_settled')


class ExpenseSerializer(serializers.ModelSerializer):
    category_details = CategorySerializer(source='category', read_only=True)
    paid_by_details = UserSummarySerializer(source='paid_by', read_only=True)
    splits = ExpenseSplitSerializer(many=True, read_only=True)
    room_name = serializers.CharField(source='room.name', read_only=True)
    currency = serializers.CharField(source='room.currency', read_only=True)

    class Meta:
        model = Expense
        fields = (
            'id', 'room', 'room_name', 'currency', 'title', 'amount',
            'category', 'category_details', 'paid_by', 'paid_by_details',
            'split_type', 'date', 'notes', 'splits', 'created_at', 'updated_at'
        )
        read_only_fields = ('id', 'created_at', 'updated_at')


class ParticipantSplitInputSerializer(serializers.Serializer):
    user_id = serializers.IntegerField(required=True)
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True)
    percentage = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)


class ExpenseCreateUpdateSerializer(serializers.ModelSerializer):
    splits_data = ParticipantSplitInputSerializer(many=True, required=True, write_only=True)

    class Meta:
        model = Expense
        fields = (
            'id', 'room', 'title', 'amount', 'category', 'paid_by',
            'split_type', 'date', 'notes', 'splits_data'
        )

    def validate(self, attrs):
        room = attrs.get('room') or (self.instance.room if self.instance else None)
        paid_by = attrs.get('paid_by') or (self.instance.paid_by if self.instance else None)
        amount = attrs.get('amount') if 'amount' in attrs else (self.instance.amount if self.instance else Decimal('0.00'))
        split_type = attrs.get('split_type') or (self.instance.split_type if self.instance else 'EQUAL')
        splits_data = attrs.get('splits_data', [])

        if not room:
            raise serializers.ValidationError({"room": "Room is required."})

        if amount <= Decimal('0.00'):
            raise serializers.ValidationError({"amount": "Expense amount must be greater than zero."})

        # Verify paid_by is a room member
        if not RoomMember.objects.filter(room=room, user=paid_by, is_active=True).exists():
            raise serializers.ValidationError({"paid_by": "The paying user is not an active member of this room."})

        if not splits_data:
            raise serializers.ValidationError({"splits_data": "At least one participant must be included in the expense split."})

        # Verify all split users are active members in this room
        participant_user_ids = [s['user_id'] for s in splits_data]
        if len(participant_user_ids) != len(set(participant_user_ids)):
            raise serializers.ValidationError({"splits_data": "Duplicate participant users in split."})

        active_member_ids = set(RoomMember.objects.filter(
            room=room,
            user_id__in=participant_user_ids,
            is_active=True
        ).values_list('user_id', flat=True))

        for uid in participant_user_ids:
            if uid not in active_member_ids:
                raise serializers.ValidationError({"splits_data": f"User ID {uid} is not an active member of this room."})

        # Validate Splits by type
        total_amount = round_decimal(amount)

        if split_type == 'EQUAL':
            # Calculate equal shares with penny remainder distribution
            count = len(splits_data)
            base_share = round_decimal(total_amount / Decimal(str(count)))
            
            allocated_splits = []
            running_total = Decimal('0.00')
            
            for i, s in enumerate(splits_data):
                if i == count - 1:
                    # Last person gets remainder so sum is exact
                    share = total_amount - running_total
                else:
                    share = base_share
                    running_total += share
                
                allocated_splits.append({
                    'user_id': s['user_id'],
                    'amount': share,
                    'percentage': round_decimal((share / total_amount) * Decimal('100'))
                })
            attrs['processed_splits'] = allocated_splits

        elif split_type == 'CUSTOM':
            running_total = Decimal('0.00')
            allocated_splits = []
            for s in splits_data:
                s_amt = s.get('amount')
                if s_amt is None or s_amt < Decimal('0.00'):
                    raise serializers.ValidationError({"splits_data": "All participants must have a valid non-negative custom amount."})
                s_amt = round_decimal(s_amt)
                running_total += s_amt
                allocated_splits.append({
                    'user_id': s['user_id'],
                    'amount': s_amt,
                    'percentage': round_decimal((s_amt / total_amount) * Decimal('100')) if total_amount > 0 else Decimal('0.00')
                })
            
            if running_total != total_amount:
                raise serializers.ValidationError({
                    "splits_data": f"Custom split amounts sum to {running_total}, which does not match the total expense of {total_amount}."
                })
            attrs['processed_splits'] = allocated_splits

        elif split_type == 'PERCENTAGE':
            total_percent = Decimal('0.00')
            for s in splits_data:
                pct = s.get('percentage')
                if pct is None or pct < Decimal('0.00'):
                    raise serializers.ValidationError({"splits_data": "All participants must have a valid non-negative percentage."})
                total_percent += pct
            
            if round_decimal(total_percent) != Decimal('100.00'):
                raise serializers.ValidationError({
                    "splits_data": f"Percentages sum to {total_percent}%, but must equal exactly 100%."
                })

            allocated_splits = []
            running_total = Decimal('0.00')
            count = len(splits_data)
            
            for i, s in enumerate(splits_data):
                pct = round_decimal(s['percentage'])
                if i == count - 1:
                    share = total_amount - running_total
                else:
                    share = round_decimal((total_amount * pct) / Decimal('100'))
                    running_total += share

                allocated_splits.append({
                    'user_id': s['user_id'],
                    'amount': share,
                    'percentage': pct
                })
            attrs['processed_splits'] = allocated_splits

        return attrs

    @transaction.atomic
    def create(self, validated_data):
        splits_data = validated_data.pop('splits_data')
        processed_splits = validated_data.pop('processed_splits')
        
        expense = Expense.objects.create(**validated_data)
        
        split_objects = [
            ExpenseSplit(
                expense=expense,
                user_id=split_info['user_id'],
                amount=split_info['amount'],
                percentage=split_info.get('percentage')
            )
            for split_info in processed_splits
        ]
        ExpenseSplit.objects.bulk_create(split_objects)
        return expense

    @transaction.atomic
    def update(self, instance, validated_data):
        splits_data = validated_data.pop('splits_data', None)
        processed_splits = validated_data.pop('processed_splits', None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if processed_splits:
            instance.splits.all().delete()
            split_objects = [
                ExpenseSplit(
                    expense=instance,
                    user_id=split_info['user_id'],
                    amount=split_info['amount'],
                    percentage=split_info.get('percentage')
                )
                for split_info in processed_splits
            ]
            ExpenseSplit.objects.bulk_create(split_objects)

        return instance


class SettlementEditHistorySerializer(serializers.ModelSerializer):
    edited_by_details = UserSummarySerializer(source='edited_by', read_only=True)
    previous_payer_details = UserSummarySerializer(source='previous_payer', read_only=True)
    new_payer_details = UserSummarySerializer(source='new_payer', read_only=True)
    previous_payee_details = UserSummarySerializer(source='previous_payee', read_only=True)
    new_payee_details = UserSummarySerializer(source='new_payee', read_only=True)

    class Meta:
        model = SettlementEditHistory
        fields = (
            'id', 'edited_by', 'edited_by_details', 'edited_at',
            'previous_amount', 'new_amount',
            'previous_notes', 'new_notes',
            'previous_payer_details', 'new_payer_details',
            'previous_payee_details', 'new_payee_details'
        )


class SettlementSerializer(serializers.ModelSerializer):
    payer_details = UserSummarySerializer(source='payer', read_only=True)
    payee_details = UserSummarySerializer(source='payee', read_only=True)
    created_by_details = UserSummarySerializer(source='created_by', read_only=True)
    verified_by_details = UserSummarySerializer(source='verified_by', read_only=True)
    room_name = serializers.CharField(source='room.name', read_only=True)
    currency = serializers.CharField(source='room.currency', read_only=True)
    is_pending = serializers.SerializerMethodField()
    can_verify = serializers.SerializerMethodField()
    can_reject = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()
    edit_history = SettlementEditHistorySerializer(many=True, read_only=True)

    class Meta:
        model = Settlement
        fields = (
            'id', 'room', 'room_name', 'currency', 'payer', 'payer_details',
            'payee', 'payee_details', 'amount', 'status', 'notes',
            'created_by', 'created_by_details', 'verified_by', 'verified_by_details',
            'is_pending', 'can_verify', 'can_reject', 'can_edit', 'can_delete',
            'edit_history',
            'created_at', 'completed_at', 'rejected_at'
        )
        read_only_fields = ('id', 'created_by', 'created_at', 'completed_at', 'rejected_at', 'verified_by', 'edit_history')

    def get_is_pending(self, obj):
        return obj.status == 'PENDING'

    def get_can_verify(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.status == 'PENDING' and request.user.id == obj.payee_id
        return False

    def get_can_reject(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.status == 'PENDING' and request.user.id in [obj.payee_id, obj.payer_id, obj.room.created_by_id]
        return False

    def get_can_edit(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            # Rule: Only Room Creator (or Room Admin) can edit settlements
            return request.user.id == obj.room.created_by_id or RoomMember.objects.filter(room=obj.room, user=request.user, role='ADMIN', is_active=True).exists()
        return False

    def get_can_delete(self, obj):
        # Rule: Settlements cannot be deleted by anyone to preserve audit trail
        return False

    def validate(self, attrs):
        payer = attrs.get('payer') or (self.instance.payer if self.instance else None)
        payee = attrs.get('payee') or (self.instance.payee if self.instance else None)
        room = attrs.get('room') or (self.instance.room if self.instance else None)
        amount = attrs.get('amount') if 'amount' in attrs else (self.instance.amount if self.instance else Decimal('0.00'))

        if payer == payee:
            raise serializers.ValidationError({"payee": "Payer and payee cannot be the same user."})

        if amount <= Decimal('0.00'):
            raise serializers.ValidationError({"amount": "Settlement amount must be greater than zero."})

        if not RoomMember.objects.filter(room=room, user=payer, is_active=True).exists():
            raise serializers.ValidationError({"payer": "Payer is not an active member in this room."})

        if not RoomMember.objects.filter(room=room, user=payee, is_active=True).exists():
            raise serializers.ValidationError({"payee": "Payee is not an active member in this room."})

        # Security rule: Users can only initiate/create settlement payments involving themselves.
        # When creating (not self.instance), payer or payee must be request.user.
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            user = request.user
            if not self.instance:
                if user.id != payer.id and user.id != payee.id:
                    raise serializers.ValidationError({
                        "payer": "You can only initiate or record settlement payments involving yourself (either as the sender or recipient)."
                    })

        return attrs

    def create(self, validated_data):
        user = self.context['request'].user
        validated_data['created_by'] = user
        payee = validated_data.get('payee')

        # Security rule: Only if the payee (recipient) is recording the settlement directly
        # can it be created as COMPLETED. If payer or anyone else records it, it MUST be PENDING.
        if user.id == getattr(payee, 'id', None):
            validated_data['status'] = 'COMPLETED'
            validated_data['completed_at'] = timezone.now()
            validated_data['verified_by'] = user
        else:
            validated_data['status'] = 'PENDING'
            validated_data['completed_at'] = None
            validated_data['verified_by'] = None

        return super().create(validated_data)

    @transaction.atomic
    def update(self, instance, validated_data):
        user = self.context['request'].user

        # Track previous values for audit history
        prev_amount = instance.amount
        prev_notes = instance.notes
        prev_payer = instance.payer
        prev_payee = instance.payee

        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        # If a pending settlement is updated, ensure completed_at and verified_by remain clean
        if instance.status == 'PENDING':
            instance.completed_at = None
            instance.verified_by = None

        instance.save()

        # Record audit log entry if relevant fields changed
        new_amount = instance.amount
        new_notes = instance.notes
        new_payer = instance.payer
        new_payee = instance.payee

        if prev_amount != new_amount or prev_notes != new_notes or prev_payer != new_payer or prev_payee != new_payee:
            SettlementEditHistory.objects.create(
                settlement=instance,
                edited_by=user,
                previous_amount=prev_amount,
                new_amount=new_amount,
                previous_notes=prev_notes,
                new_notes=new_notes,
                previous_payer=prev_payer,
                new_payer=new_payer,
                previous_payee=prev_payee,
                new_payee=new_payee
            )

        return instance
