from django.shortcuts import render, get_object_or_404, redirect
from rest_framework import generics, status, permissions
from rest_framework.response import Response
from rest_framework.views import APIView
from django.db import transaction
from .models import Room, RoomMember
from .serializers import (
    RoomSerializer,
    RoomCreateSerializer,
    RoomMemberSerializer,
    JoinRoomSerializer
)
from .services import calculate_room_balances, get_room_analytics


class RoomListCreateAPIView(generics.ListCreateAPIView):
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.request.method == 'POST':
            return RoomCreateSerializer
        return RoomSerializer

    def get_queryset(self):
        return Room.objects.filter(
            members__user=self.request.user,
            members__is_active=True
        ).distinct()


class RoomDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = RoomSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Room.objects.filter(
            members__user=self.request.user,
            members__is_active=True
        ).distinct()

    def perform_destroy(self, instance):
        # Only room creator can delete room
        if instance.created_by != self.request.user:
            return Response(
                {"detail": "Only the room creator can delete this room."},
                status=status.HTTP_403_FORBIDDEN
            )
        instance.delete()


class JoinRoomAPIView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = JoinRoomSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        room = serializer.room
        
        # Add or reactivate membership
        member, created = RoomMember.objects.get_or_create(
            room=room,
            user=request.user,
            defaults={'role': 'MEMBER', 'is_active': True}
        )
        if not created and not member.is_active:
            member.is_active = True
            member.save(update_fields=['is_active'])

        room_data = RoomSerializer(room, context={'request': request}).data
        return Response({
            'room': room_data,
            'message': f"Successfully joined '{room.name}'!"
        }, status=status.HTTP_200_OK)


class RegenerateInviteCodeAPIView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        room = get_object_or_404(Room, pk=pk, members__user=request.user, members__role='ADMIN', members__is_active=True)
        new_code = room.regenerate_invite_code()
        return Response({
            'invite_code': new_code,
            'message': 'Invite code successfully regenerated.'
        })


class RoomMembersAPIView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        room = get_object_or_404(Room, pk=pk, members__user=request.user, members__is_active=True)
        members = room.members.filter(is_active=True).select_related('user')
        serializer = RoomMemberSerializer(members, many=True)
        return Response(serializer.data)

    def delete(self, request, pk, user_id=None):
        room = get_object_or_404(Room, pk=pk, members__user=request.user, members__is_active=True)
        requester_membership = get_object_or_404(RoomMember, room=room, user=request.user, is_active=True)

        target_user_id = user_id or request.user.id
        
        # Only admin or the user themselves can remove member
        if requester_membership.role != 'ADMIN' and target_user_id != request.user.id:
            return Response({'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)

        # Cannot remove room creator
        if target_user_id == room.created_by_id:
            return Response({'detail': 'Room creator cannot be removed from the room.'}, status=status.HTTP_400_BAD_REQUEST)

        member = get_object_or_404(RoomMember, room=room, user_id=target_user_id, is_active=True)
        member.is_active = False
        member.save(update_fields=['is_active'])

        return Response({'message': 'Member removed successfully.'})


class RoomBalancesAPIView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        room = get_object_or_404(Room, pk=pk, members__user=request.user, members__is_active=True)
        data = calculate_room_balances(room)
        return Response(data)


class RoomAnalyticsAPIView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        room = get_object_or_404(Room, pk=pk, members__user=request.user, members__is_active=True)
        data = get_room_analytics(room)
        return Response(data)


# Web Template Views
from django.views.decorators.csrf import ensure_csrf_cookie

@ensure_csrf_cookie
def dashboard_view(request):
    return render(request, 'dashboard/index.html')


@ensure_csrf_cookie
def rooms_list_view(request):
    return render(request, 'rooms/list.html')


@ensure_csrf_cookie
def room_detail_view(request, pk):
    return render(request, 'rooms/detail.html', {'room_id': pk})


@ensure_csrf_cookie
def create_join_room_view(request):
    return render(request, 'rooms/create_join.html')
