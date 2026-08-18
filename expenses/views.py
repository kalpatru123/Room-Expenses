from django.shortcuts import render, get_object_or_404
from rest_framework import generics, status, permissions
from rest_framework.response import Response
from rest_framework.views import APIView
from django.db.models import Q
from django.utils import timezone
from rooms.models import Room, RoomMember
from .models import Category, Expense, ExpenseSplit, Settlement
from .serializers import (
    CategorySerializer,
    ExpenseSerializer,
    ExpenseCreateUpdateSerializer,
    SettlementSerializer
)


class CategoryListCreateAPIView(generics.ListCreateAPIView):
    serializer_class = CategorySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        room_id = self.request.query_params.get('room')
        if room_id:
            return Category.objects.filter(Q(room__isnull=True) | Q(room_id=room_id))
        return Category.objects.filter(room__isnull=True)

    def perform_create(self, serializer):
        serializer.save()


class ExpenseListCreateAPIView(generics.ListCreateAPIView):
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.request.method == 'POST':
            return ExpenseCreateUpdateSerializer
        return ExpenseSerializer

    def get_queryset(self):
        user = self.request.user
        queryset = Expense.objects.filter(
            room__members__user=user,
            room__members__is_active=True
        ).select_related('room', 'category', 'paid_by').prefetch_related('splits__user').distinct()

        # Query Filters
        room_id = self.request.query_params.get('room')
        if room_id:
            queryset = queryset.filter(room_id=room_id)

        category_id = self.request.query_params.get('category')
        if category_id:
            queryset = queryset.filter(category_id=category_id)

        paid_by_id = self.request.query_params.get('paid_by')
        if paid_by_id:
            queryset = queryset.filter(paid_by_id=paid_by_id)

        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(title__icontains=search) | Q(notes__icontains=search)
            )

        return queryset

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        expense = serializer.save()
        read_serializer = ExpenseSerializer(expense, context={'request': request})
        return Response(read_serializer.data, status=status.HTTP_201_CREATED)


class ExpenseDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.request.method in ['PUT', 'PATCH']:
            return ExpenseCreateUpdateSerializer
        return ExpenseSerializer

    def get_queryset(self):
        user = self.request.user
        return Expense.objects.filter(
            room__members__user=user,
            room__members__is_active=True
        ).select_related('room', 'category', 'paid_by').prefetch_related('splits__user').distinct()

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        user = request.user
        is_admin = RoomMember.objects.filter(room=instance.room, user=user, role='ADMIN', is_active=True).exists()
        if instance.paid_by != user and not is_admin:
            return Response(
                {"detail": "Only the person who paid this expense or the room admin can edit it."},
                status=status.HTTP_403_FORBIDDEN
            )
        serializer = self.get_serializer(instance, data=request.data, partial=partial, context={'request': request})
        serializer.is_valid(raise_exception=True)
        expense = serializer.save()
        read_serializer = ExpenseSerializer(expense, context={'request': request})
        return Response(read_serializer.data)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        user = request.user
        is_admin = RoomMember.objects.filter(room=instance.room, user=user, role='ADMIN', is_active=True).exists()
        if instance.paid_by != user and not is_admin:
            return Response(
                {"detail": "Only the person who paid this expense or the room admin can delete it."},
                status=status.HTTP_403_FORBIDDEN
            )
        return super().destroy(request, *args, **kwargs)


class SettlementListCreateAPIView(generics.ListCreateAPIView):
    serializer_class = SettlementSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        queryset = Settlement.objects.filter(
            room__members__user=user,
            room__members__is_active=True
        ).select_related('room', 'payer', 'payee', 'created_by', 'verified_by').distinct()

        room_id = self.request.query_params.get('room')
        if room_id:
            queryset = queryset.filter(room_id=room_id)

        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        pending_for_me = self.request.query_params.get('pending_for_me')
        if pending_for_me and pending_for_me.lower() in ['true', '1']:
            queryset = queryset.filter(payee=user, status='PENDING')

        return queryset


class SettlementDetailAPIView(generics.RetrieveUpdateAPIView):
    serializer_class = SettlementSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ['get', 'put', 'patch', 'head', 'options']

    def get_queryset(self):
        user = self.request.user
        return Settlement.objects.filter(
            room__members__user=user,
            room__members__is_active=True
        ).select_related('room', 'payer', 'payee', 'created_by', 'verified_by').prefetch_related('edit_history__edited_by').distinct()

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        user = request.user
        is_creator_or_admin = (user.id == instance.room.created_by_id) or RoomMember.objects.filter(
            room=instance.room, user=user, role='ADMIN', is_active=True
        ).exists()

        if not is_creator_or_admin:
            return Response(
                {"detail": "Only the room creator or room admin has permission to edit settlement records."},
                status=status.HTTP_403_FORBIDDEN
            )

        return super().update(request, *args, **kwargs)


class SettlementVerifyAPIView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        user = self.request.user
        settlement = get_object_or_404(
            Settlement,
            pk=pk,
            room__members__user=user,
            room__members__is_active=True
        )

        if settlement.payee_id != user.id:
            return Response(
                {'detail': 'Only the recipient (payee) can verify and confirm receipt of this payment.'},
                status=status.HTTP_403_FORBIDDEN
            )

        if settlement.status == 'COMPLETED':
            return Response(
                {'detail': 'This settlement is already verified and completed.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        settlement.verify(user)
        serializer = SettlementSerializer(settlement, context={'request': request})
        return Response({
            'settlement': serializer.data,
            'message': 'Payment receipt verified successfully! Room balance has been updated.'
        })


class SettlementRejectAPIView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        user = self.request.user
        settlement = get_object_or_404(
            Settlement,
            pk=pk,
            room__members__user=user,
            room__members__is_active=True
        )

        if user.id not in [settlement.payee_id, settlement.payer_id, settlement.room.created_by_id]:
            return Response(
                {'detail': 'You do not have permission to reject or cancel this settlement.'},
                status=status.HTTP_403_FORBIDDEN
            )

        if settlement.status == 'COMPLETED':
            return Response(
                {'detail': 'Completed settlements cannot be rejected.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        settlement.reject(user)
        serializer = SettlementSerializer(settlement, context={'request': request})
        return Response({
            'settlement': serializer.data,
            'message': 'Settlement payment has been rejected/cancelled.'
        })


class SettlementMarkPaidAPIView(APIView):
    """
    Backward-compatible alias for verification.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        verify_view = SettlementVerifyAPIView()
        verify_view.request = request
        return verify_view.post(request, pk)


# Web Template Views
from django.views.decorators.csrf import ensure_csrf_cookie

@ensure_csrf_cookie
def expenses_list_view(request):
    return render(request, 'expenses/list.html')


@ensure_csrf_cookie
def settlements_list_view(request):
    return render(request, 'settlements/list.html')
